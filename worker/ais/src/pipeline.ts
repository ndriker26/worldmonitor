import type { AisFrame } from './ais-types.js';
import { checkStale, processPosition, type VesselState } from './state-machine.js';
import { findTerminalForPosition, type Terminal } from './geo.js';
import type { ShipTypeRegistry } from './static-registry.js';
import type { DbWriter } from './db-writer.js';

const SNAPSHOT_MIN_INTERVAL_MS = 30_000; // at most one upsert per terminal per 30s

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
      this.registry.observe(staticData.UserID, staticData.Type);
      return;
    }

    const pr = frame.Message.PositionReport;
    if (!pr) return;

    const terminal = findTerminalForPosition({ lat: pr.Latitude, lon: pr.Longitude }, this.terminals);
    if (!terminal) return;

    const stats = this.stats.get(terminal.id)!;
    stats.totalPositionReports += 1;

    const shipType = this.registry.get(pr.UserID);
    if (shipType != null) stats.tankerPositionReports += 1;

    const key = `${terminal.id}:${pr.UserID}`;
    const prev = this.vesselStates.get(key) ?? null;
    const { state, event } = processPosition(
      prev,
      {
        mmsi: pr.UserID,
        lat: pr.Latitude,
        lon: pr.Longitude,
        sog: pr.Sog,
        navigationalStatus: pr.NavigationalStatus,
        timestamp: now,
      },
      shipType,
      terminal,
    );

    if (state) {
      this.vesselStates.set(key, state);
      stats.tankerMmsiSeen.add(pr.UserID);
    }

    if (event) {
      if (event.type === 'arrival') stats.arrivals += 1;
      else stats.departures += 1;
      await this.dbWriter.insertEvent(event);
    }

    await this.maybeFlushSnapshot(terminal.id, now);
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

  async flushAllSnapshots(now: number): Promise<void> {
    for (const t of this.terminals) await this.maybeFlushSnapshot(t.id, now, true);
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
