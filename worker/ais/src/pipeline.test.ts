import { describe, expect, it } from 'vitest';
import { createLoggingDbWriter, type DbWriter, type TerminalSnapshotWrite } from './db-writer.js';
import type { Terminal } from './geo.js';
import { Pipeline } from './pipeline.js';
import { ShipTypeRegistry } from './static-registry.js';
import type { VesselEvent } from './state-machine.js';
import type { AisFrame } from './ais-types.js';

const TERMINAL: Terminal = {
  id: 'test-terminal',
  name: 'Test Terminal',
  country: 'Testland',
  polygon: [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 1 },
    { lat: 1, lon: 1 },
    { lat: 1, lon: 0 },
  ],
  bbox: { sw: [-0.1, -0.1], ne: [1.1, 1.1] },
};

const INSIDE = { lat: 0.5, lon: 0.5 };

function positionFrame(mmsi: number, overrides: Partial<{ sog: number; navigationalStatus: number }> = {}): AisFrame {
  return {
    MessageType: 'PositionReport',
    Message: {
      PositionReport: {
        UserID: mmsi,
        Latitude: INSIDE.lat,
        Longitude: INSIDE.lon,
        Sog: overrides.sog ?? 10,
        NavigationalStatus: overrides.navigationalStatus ?? 0,
      },
    },
  };
}

function staticFrame(mmsi: number, type: number): AisFrame {
  return {
    MessageType: 'ShipStaticData',
    Message: { ShipStaticData: { UserID: mmsi, Type: type } },
  };
}

function recordingWriter(): { writer: DbWriter; events: VesselEvent[]; snapshots: TerminalSnapshotWrite[] } {
  const events: VesselEvent[] = [];
  const snapshots: TerminalSnapshotWrite[] = [];
  return {
    events,
    snapshots,
    writer: {
      async insertEvent(e) { events.push(e); },
      async upsertSnapshot(s) { snapshots.push(s); },
    },
  };
}

describe('static-data buffering', () => {
  it('buffers a position with unknown ship type, then processes it as a cold start once ShipStaticData resolves it as a tanker', async () => {
    const { writer } = recordingWriter();
    const pipeline = new Pipeline([TERMINAL], new ShipTypeRegistry(), writer);

    // Ship type unknown at this point — must not be tracked yet.
    await pipeline.handleFrame(positionFrame(111, { sog: 0.1, navigationalStatus: 5 }), 1000);
    expect(pipeline.getCurrentDockedAndStale(TERMINAL.id)).toEqual({ docked: 0, stale: 0 });
    expect(pipeline.getStats()[0]!.tankerPositionReports).toBe(0);

    // Now resolved as a tanker — the buffered position is processed as a cold start.
    await pipeline.handleFrame(staticFrame(111, 84), 2000);

    const stats = pipeline.getStats()[0]!;
    expect(stats.tankerMmsiSeen.has(111)).toBe(true);
    expect(stats.tankerPositionReports).toBe(1); // retroactively counted once, not twice
    expect(stats.arrivals).toBe(0); // cold start — no false arrival
    expect(pipeline.getCurrentDockedAndStale(TERMINAL.id)).toEqual({ docked: 1, stale: 0 });
  });

  it('drops the buffered position for a non-tanker', async () => {
    const { writer } = recordingWriter();
    const pipeline = new Pipeline([TERMINAL], new ShipTypeRegistry(), writer);

    await pipeline.handleFrame(positionFrame(222, { sog: 0.1, navigationalStatus: 5 }), 1000);
    await pipeline.handleFrame(staticFrame(222, 70) /* cargo */, 2000);

    const stats = pipeline.getStats()[0]!;
    expect(stats.tankerMmsiSeen.has(222)).toBe(false);
    expect(stats.tankerPositionReports).toBe(0);
    expect(pipeline.getCurrentDockedAndStale(TERMINAL.id)).toEqual({ docked: 0, stale: 0 });
  });

  it('keeps only the latest buffered position per MMSI', async () => {
    const { writer } = recordingWriter();
    const pipeline = new Pipeline([TERMINAL], new ShipTypeRegistry(), writer);

    await pipeline.handleFrame(positionFrame(333, { sog: 12, navigationalStatus: 0 }), 1000); // moving — would not be docked
    await pipeline.handleFrame(positionFrame(333, { sog: 0.1, navigationalStatus: 5 }), 1500); // now moored — latest wins
    await pipeline.handleFrame(staticFrame(333, 84), 2000);

    const stats = pipeline.getStats()[0]!;
    expect(stats.totalPositionReports).toBe(2); // both counted as "any type" on arrival
    expect(stats.tankerPositionReports).toBe(1); // only the latest is replayed
    expect(pipeline.getCurrentDockedAndStale(TERMINAL.id)).toEqual({ docked: 1, stale: 0 });
  });

  it('a vessel already known to be a tanker is processed immediately, no buffering involved', async () => {
    const { writer } = recordingWriter();
    const registry = new ShipTypeRegistry();
    registry.observe(444, 84);
    const pipeline = new Pipeline([TERMINAL], registry, writer);

    await pipeline.handleFrame(positionFrame(444, { sog: 0.1, navigationalStatus: 5 }), 1000);

    const stats = pipeline.getStats()[0]!;
    expect(stats.tankerPositionReports).toBe(1);
    expect(pipeline.getCurrentDockedAndStale(TERMINAL.id)).toEqual({ docked: 1, stale: 0 });
  });
});

describe('sanity: logging writer is still the default for these tests', () => {
  it('createLoggingDbWriter does not throw when called directly', async () => {
    await expect(createLoggingDbWriter().insertEvent({ terminalId: 't', mmsi: 1, type: 'arrival', occurredAt: 0 })).resolves.toBeUndefined();
  });
});
