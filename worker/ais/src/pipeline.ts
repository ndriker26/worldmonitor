import type { AisFrame } from './ais-types.js';
import { checkStale, isTankerType, processPosition, type VesselPosition, type VesselState } from './state-machine.js';
import { findTerminalForPosition, type Terminal } from './geo.js';
import type { ShipTypeRegistry } from './static-registry.js';
import type { DbWriter } from './db-writer.js';

const SNAPSHOT_MIN_INTERVAL_MS = 30_000; // at most one upsert per terminal per 30s

/** Bound on in-memory pending positions for vessels whose ship type isn't known yet. */
const MAX_PENDING_POSITIONS = 5000;

interface PendingPosition {
  pos: VesselPosition;
  terminal: Terminal;
}

export interface TerminalStats {
  terminalId: string;
  /** All AIS position reports seen inside this terminal's bounding box, any ship type. */
  totalPositionReports: number;
  /** Position reports from vessels the registry has already classified as tankers. */
  tankerPositionReports: number;
  tankerMmsiSeen: Set<number>;
  arrivals: number;
  departures: number;
}

/**
 * Shared processing core for live, --record, and --replay — the only
 * difference between modes is which DbWriter and which frame source feed it.
 */
export class Pipeline {
  private readonly vesselStates = new Map<string, VesselState>(); // key: `${terminalId}:${mmsi}`
  private readonly lastSnapshotAt = new Map<string, number>();
  private readonly stats = new Map<string, TerminalStats>();
  /** Latest position per MMSI while its ship type is still unknown — resolved (or dropped) once ShipStaticData arrives. */
  private readonly pendingPositions = new Map<number, PendingPosition>();

  constructor(
    private readonly terminals: Terminal[],
    private readonly registry: ShipTypeRegistry,
    private readonly dbWriter: DbWriter,
  ) {
    for (const t of terminals) {
      this.stats.set(t.id, {
        terminalId: t.id,
        totalPositionReports: 0,
        tankerPositionReports: 0,
        tankerMmsiSeen: new Set(),
        arrivals: 0,
        departures: 0,
      });
    }
  }

  async handleFrame(frame: AisFrame, now: number): Promise<void> {
    const staticData = frame.Message.ShipStaticData;
    if (staticData) {
      const mmsi = staticData.UserID;
      this.registry.observe(mmsi, staticData.Type);

      const pending = this.pendingPositions.get(mmsi);
      if (pending) {
        this.pendingPositions.delete(mmsi);
        // Drop it for non-tankers; a tanker's last-known position is processed
        // now, through the exact same path a live position takes. Since this
        // vessel has no prior VesselState, this is necessarily a cold start —
        // it seeds state without emitting a false arrival.
        if (isTankerType(staticData.Type)) {
          await this.processTankerPosition(pending.terminal, pending.pos, staticData.Type);
        }
      }
      return;
    }

    const pr = frame.Message.PositionReport;
    if (!pr) return;

    const terminal = findTerminalForPosition({ lat: pr.Latitude, lon: pr.Longitude }, this.terminals);
    if (!terminal) return;

    this.stats.get(terminal.id)!.totalPositionReports += 1;

    const pos: VesselPosition = {
      mmsi: pr.UserID,
      lat: pr.Latitude,
      lon: pr.Longitude,
      sog: pr.Sog,
      navigationalStatus: pr.NavigationalStatus,
      timestamp: now,
    };

    const shipType = this.registry.get(pr.UserID);
    if (shipType == null) {
      this.bufferPending(pr.UserID, pos, terminal);
      return;
    }

    await this.processTankerPosition(terminal, pos, shipType);
  }

  /** Bounded MMSI -> latest-position cache for vessels with no known ship type yet. */
  private bufferPending(mmsi: number, pos: VesselPosition, terminal: Terminal): void {
    if (!this.pendingPositions.has(mmsi) && this.pendingPositions.size >= MAX_PENDING_POSITIONS) {
      const oldest = this.pendingPositions.keys().next().value;
      if (oldest !== undefined) this.pendingPositions.delete(oldest);
    }
    this.pendingPositions.set(mmsi, { pos, terminal });
  }

  /** The common path for a position known (or just resolved) to belong to a tanker. */
  private async processTankerPosition(terminal: Terminal, pos: VesselPosition, shipType: number): Promise<void> {
    const stats = this.stats.get(terminal.id)!;
    stats.tankerPositionReports += 1;

    const key = `${terminal.id}:${pos.mmsi}`;
    const prev = this.vesselStates.get(key) ?? null;
    const { state, event } = processPosition(prev, pos, shipType, terminal);

    if (state) {
      this.vesselStates.set(key, state);
      stats.tankerMmsiSeen.add(pos.mmsi);
    }

    if (event) {
      if (event.type === 'arrival') stats.arrivals += 1;
      else stats.departures += 1;
      await this.dbWriter.insertEvent(event);
    }

    await this.maybeFlushSnapshot(terminal.id, pos.timestamp);
  }

  /** Periodic timeout sweep — call roughly every minute in live mode. Never itself the source of an event. */
  sweepStale(now: number): void {
    for (const [key, state] of this.vesselStates) {
      this.vesselStates.set(key, checkStale(state, now));
    }
  }

  private async maybeFlushSnapshot(terminalId: string, now: number, force = false): Promise<void> {
    const last = this.lastSnapshotAt.get(terminalId) ?? 0;
    if (!force && now - last < SNAPSHOT_MIN_INTERVAL_MS) return;
    this.lastSnapshotAt.set(terminalId, now);

    const { docked, stale } = this.getCurrentDockedAndStale(terminalId);
    await this.dbWriter.upsertSnapshot({ terminalId, dockedCount: docked, staleCount: stale, updatedAt: now });
  }

  /** Force-writes a row for every terminal regardless of the 30s throttle. Call once at startup and at replay end, so a terminal with zero tanker traffic still gets a row. */
  async flushAllSnapshots(now: number): Promise<void> {
    for (const t of this.terminals) await this.maybeFlushSnapshot(t.id, now, true);
  }

  /**
   * Periodic heartbeat — call every 60s in live mode. Unlike flushAllSnapshots
   * this is NOT forced: it reuses the same 30s throttle as the event-driven
   * path, so a terminal that just wrote (e.g. from a real arrival/departure)
   * won't double-write. But because this runs every 60s and the throttle is
   * only 30s, every terminal — including ones with no tanker traffic at all —
   * gets a fresh row at least once per sweep, so updated_at never goes stale
   * past the frontend's 30-minute threshold just because a terminal is quiet.
   */
  async sweepSnapshots(now: number): Promise<void> {
    for (const t of this.terminals) await this.maybeFlushSnapshot(t.id, now);
  }

  getCurrentDockedAndStale(terminalId: string): { docked: number; stale: number } {
    let docked = 0;
    let stale = 0;
    const prefix = `${terminalId}:`;
    for (const [key, state] of this.vesselStates) {
      if (!key.startsWith(prefix)) continue;
      if (state.stale) stale += 1;
      else if (state.docked) docked += 1;
    }
    return { docked, stale };
  }

  getStats(): TerminalStats[] {
    return [...this.stats.values()];
  }
}
