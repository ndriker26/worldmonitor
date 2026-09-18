import { describe, expect, it } from 'vitest';
import {
  checkStale,
  isTankerType,
  processPosition,
  updateVesselState,
  type TerminalPolygon,
  type VesselPosition,
  type VesselState,
} from './state-machine.js';

const TERMINAL: TerminalPolygon = {
  id: 'test-terminal',
  name: 'Test Terminal',
  polygon: [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 1 },
    { lat: 1, lon: 1 },
    { lat: 1, lon: 0 },
  ],
};

const INSIDE = { lat: 0.5, lon: 0.5 };
const OUTSIDE = { lat: 5, lon: 5 };

let t = 1_000_000; // monotonically increasing fake clock, ms
const nextTime = () => (t += 60_000); // +1 min per call

function pos(overrides: Partial<VesselPosition> = {}): VesselPosition {
  return {
    mmsi: 123456789,
    lat: INSIDE.lat,
    lon: INSIDE.lon,
    sog: 0.2,
    navigationalStatus: 5, // moored
    timestamp: nextTime(),
    ...overrides,
  };
}

describe('isTankerType', () => {
  it('accepts 80-89', () => {
    expect(isTankerType(80)).toBe(true);
    expect(isTankerType(84)).toBe(true);
    expect(isTankerType(89)).toBe(true);
  });
  it('rejects everything else, including undefined/null', () => {
    expect(isTankerType(79)).toBe(false);
    expect(isTankerType(90)).toBe(false);
    expect(isTankerType(70)).toBe(false); // cargo
    expect(isTankerType(undefined)).toBe(false);
    expect(isTankerType(null)).toBe(false);
  });
});

describe('cold start', () => {
  it('seeds state from the first position with no event, even when starting outside', () => {
    const { state, event } = updateVesselState(null, pos({ lat: OUTSIDE.lat, lon: OUTSIDE.lon, sog: 12, navigationalStatus: 0 }), TERMINAL);
    expect(event).toBeNull();
    expect(state.confirmedInside).toBe(false);
    expect(state.docked).toBe(false);
  });

  it('a tanker already docked when the worker starts counts as docked, not arrived', () => {
    const { state, event } = updateVesselState(null, pos({ sog: 0.1, navigationalStatus: 5 }), TERMINAL);
    expect(event).toBeNull(); // no arrival event on first-ever observation
    expect(state.confirmedInside).toBe(true);
    expect(state.docked).toBe(true);
  });
});

describe('arrival', () => {
  it('confirms after 2 consecutive inside positions, not on the first', () => {
    const seed = updateVesselState(null, pos({ lat: OUTSIDE.lat, lon: OUTSIDE.lon, sog: 12, navigationalStatus: 0 }), TERMINAL);
    expect(seed.state.confirmedInside).toBe(false);

    const first = updateVesselState(seed.state, pos({ lat: INSIDE.lat, lon: INSIDE.lon, sog: 5, navigationalStatus: 0 }), TERMINAL);
    expect(first.event).toBeNull(); // one reading is not enough
    expect(first.state.confirmedInside).toBe(false); // not yet confirmed
    expect(first.state.pendingInside).toBe(true);

    const second = updateVesselState(first.state, pos({ lat: INSIDE.lat, lon: INSIDE.lon, sog: 0.1, navigationalStatus: 5 }), TERMINAL);
    expect(second.event).toEqual({ terminalId: TERMINAL.id, mmsi: 123456789, type: 'arrival', occurredAt: expect.any(Number) });
    expect(second.state.confirmedInside).toBe(true);
    expect(second.state.docked).toBe(true);
  });
});

describe('departure', () => {
  it('confirms after 2 consecutive outside positions, not on the first', () => {
    const seed = updateVesselState(null, pos(), TERMINAL); // docked at cold start
    expect(seed.state.confirmedInside).toBe(true);

    const first = updateVesselState(seed.state, pos({ lat: OUTSIDE.lat, lon: OUTSIDE.lon, sog: 8, navigationalStatus: 0 }), TERMINAL);
    expect(first.event).toBeNull();
    expect(first.state.confirmedInside).toBe(true); // not yet confirmed

    const second = updateVesselState(first.state, pos({ lat: OUTSIDE.lat, lon: OUTSIDE.lon, sog: 9, navigationalStatus: 0 }), TERMINAL);
    expect(second.event).toEqual({ terminalId: TERMINAL.id, mmsi: 123456789, type: 'departure', occurredAt: expect.any(Number) });
    expect(second.state.confirmedInside).toBe(false);
    expect(second.state.docked).toBe(false);
  });
});

describe('jitter at the polygon edge', () => {
  it('a single flickered reading does not confirm a transition', () => {
    const seed = updateVesselState(null, pos(), TERMINAL); // confirmed inside, docked

    const flicker = updateVesselState(seed.state, pos({ lat: OUTSIDE.lat, lon: OUTSIDE.lon, sog: 9, navigationalStatus: 0 }), TERMINAL);
    expect(flicker.event).toBeNull();
    expect(flicker.state.confirmedInside).toBe(true); // still confirmed inside
    expect(flicker.state.pendingInside).toBe(false);

    const backInside = updateVesselState(flicker.state, pos({ lat: INSIDE.lat, lon: INSIDE.lon, sog: 0.1, navigationalStatus: 5 }), TERMINAL);
    expect(backInside.event).toBeNull(); // jitter absorbed, no departure+arrival pair
    expect(backInside.state.confirmedInside).toBe(true);
    expect(backInside.state.pendingInside).toBeNull();
  });
});

describe('stale', () => {
  it('marks stale after the timeout without emitting a departure', () => {
    const seed = updateVesselState(null, pos(), TERMINAL);
    const twoHoursOneMinuteLater = seed.state.lastSeen + 2 * 60 * 60 * 1000 + 60_000;
    const staled = checkStale(seed.state, twoHoursOneMinuteLater);
    expect(staled.stale).toBe(true);
    expect(staled.confirmedInside).toBe(true); // unchanged — checkStale never touches zone/docked state
  });

  it('does not mark stale before the timeout', () => {
    const seed = updateVesselState(null, pos(), TERMINAL);
    const oneHourLater = seed.state.lastSeen + 60 * 60 * 1000;
    expect(checkStale(seed.state, oneHourLater).stale).toBe(false);
  });

  it('a stale vessel that reappears outside the polygon departs at the moment it reappears', () => {
    const seed = updateVesselState(null, pos(), TERMINAL); // confirmed inside
    const stale = checkStale(seed.state, seed.state.lastSeen + 3 * 60 * 60 * 1000);
    expect(stale.stale).toBe(true);

    const { state, event } = updateVesselState(stale, pos({ lat: OUTSIDE.lat, lon: OUTSIDE.lon, sog: 10, navigationalStatus: 0 }), TERMINAL);
    expect(event).toEqual({ terminalId: TERMINAL.id, mmsi: 123456789, type: 'departure', occurredAt: expect.any(Number) });
    expect(state.confirmedInside).toBe(false);
    expect(state.stale).toBe(false); // fresh position clears staleness
  });

  it('a stale vessel that reappears inside the polygon just resumes docked, no event', () => {
    const seed = updateVesselState(null, pos(), TERMINAL); // confirmed inside
    const stale = checkStale(seed.state, seed.state.lastSeen + 3 * 60 * 60 * 1000);
    expect(stale.stale).toBe(true);

    const { state, event } = updateVesselState(stale, pos({ sog: 0.1, navigationalStatus: 5 }), TERMINAL);
    expect(event).toBeNull();
    expect(state.confirmedInside).toBe(true);
    expect(state.docked).toBe(true);
    expect(state.stale).toBe(false);
  });
});

describe('non-tanker ignored', () => {
  it('never creates or updates state for a non-tanker ship type', () => {
    const prev: VesselState | null = null;
    const result = processPosition(prev, pos(), 70 /* cargo */, TERMINAL);
    expect(result.state).toBeNull();
    expect(result.event).toBeNull();
  });

  it('an already-tracked tanker keeps being tracked, but an unrelated cargo MMSI is never gated in', () => {
    // Sanity check that the gate is purely about ship type, not the polygon.
    const result = processPosition(null, pos({ lat: OUTSIDE.lat, lon: OUTSIDE.lon, sog: 15, navigationalStatus: 0 }), 60 /* passenger */, TERMINAL);
    expect(result.state).toBeNull();
  });

  it('a tanker type is tracked normally through the same gate', () => {
    const result = processPosition(null, pos(), 84, TERMINAL);
    expect(result.state).not.toBeNull();
    expect(result.event).toBeNull(); // cold start, no event
  });
});
