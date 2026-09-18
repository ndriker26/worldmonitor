// Pure vessel-state logic for the tanker-activity worker. No I/O, no sockets,
// no Supabase — everything here is a plain function of (state, input) so it
// can be driven directly from tests and from --replay without a live socket.

export interface LatLon {
  lat: number;
  lon: number;
}

/** A terminal geofence: berths + immediate anchorage, as a single-ring polygon. */
export interface TerminalPolygon {
  id: string;
  name: string;
  /** Ring of vertices; does not need to be explicitly closed. */
  polygon: LatLon[];
}

/** A decoded AIS PositionReport, narrowed to the fields the state machine needs. */
export interface VesselPosition {
  mmsi: number;
  lat: number;
  lon: number;
  /** Speed over ground, knots. */
  sog: number;
  /** ITU-R M.1371 navigational status code. */
  navigationalStatus: number;
  /** Epoch ms this position was received. */
  timestamp: number;
}

export type VesselEventType = 'arrival' | 'departure';

export interface VesselEvent {
  terminalId: string;
  mmsi: number;
  type: VesselEventType;
  occurredAt: number;
}

export interface VesselState {
  mmsi: number;
  terminalId: string;
  /** Confirmed zone membership (post 2-position confirmation). */
  confirmedInside: boolean;
  /** The most recent reading that disagreed with confirmedInside, awaiting a second confirming read. null once confirmed/cleared. */
  pendingInside: boolean | null;
  /** Current docked classification: inside AND (slow OR moored/at-anchor). Not itself an event. */
  docked: boolean;
  /** Epoch ms of the last position processed for this vessel/terminal pair. */
  lastSeen: number;
  stale: boolean;
}

const NAV_STATUS_AT_ANCHOR = 1;
const NAV_STATUS_MOORED = 5;
const DOCKED_SOG_KNOTS = 0.5;
export const STALE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

/** AIS ship-type codes 80-89 are the tanker category (ITU-R M.1371 / ITU-R M.1371-5 Annex 8). */
export function isTankerType(shipType: number | undefined | null): boolean {
  return shipType != null && shipType >= 80 && shipType <= 89;
}

function isMooredOrAnchored(navigationalStatus: number): boolean {
  return navigationalStatus === NAV_STATUS_MOORED || navigationalStatus === NAV_STATUS_AT_ANCHOR;
}

/** Ray-casting point-in-polygon test. `polygon` need not be explicitly closed. */
export function isInsidePolygon(point: LatLon, polygon: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const vi = polygon[i]!;
    const vj = polygon[j]!;
    const intersects =
      vi.lat > point.lat !== vj.lat > point.lat &&
      point.lon < ((vj.lon - vi.lon) * (point.lat - vi.lat)) / (vj.lat - vi.lat) + vi.lon;
    if (intersects) inside = !inside;
  }
  return inside;
}

function classifyDocked(pos: VesselPosition, insideNow: boolean): boolean {
  return insideNow && (pos.sog < DOCKED_SOG_KNOTS || isMooredOrAnchored(pos.navigationalStatus));
}

/**
 * Advance one vessel's state by one position report against one terminal.
 *
 * - Cold start (`prev === null`, i.e. the first position this process has ever seen
 *   for this vessel/terminal pair — true on process boot and after any gap that
 *   dropped the in-memory map entry): seeds state silently. A tanker already
 *   docked when the worker starts is docked, not arrived — no event fires.
 * - Normal transitions require 2 consecutive positions agreeing on the new
 *   inside/outside reading before they confirm, filtering GPS jitter at the
 *   polygon edge.
 * - A stale vessel (see `checkStale`) that reappears outside the polygon is
 *   recorded as a departure at the moment it reappears — we already lost track
 *   of it, so there's no jitter risk from waiting for a second confirmation.
 *   One that reappears inside just resumes docked tracking with no event.
 */
export function updateVesselState(
  prev: VesselState | null,
  pos: VesselPosition,
  terminal: TerminalPolygon,
): { state: VesselState; event: VesselEvent | null } {
  const insideNow = isInsidePolygon({ lat: pos.lat, lon: pos.lon }, terminal.polygon);
  const dockedNow = classifyDocked(pos, insideNow);

  if (!prev) {
    return {
      state: {
        mmsi: pos.mmsi,
        terminalId: terminal.id,
        confirmedInside: insideNow,
        pendingInside: null,
        docked: dockedNow,
        lastSeen: pos.timestamp,
        stale: false,
      },
      event: null,
    };
  }

  if (prev.stale) {
    if (prev.confirmedInside && !insideNow) {
      return {
        state: {
          ...prev,
          confirmedInside: false,
          pendingInside: null,
          docked: dockedNow,
          lastSeen: pos.timestamp,
          stale: false,
        },
        event: { terminalId: terminal.id, mmsi: pos.mmsi, type: 'departure', occurredAt: pos.timestamp },
      };
    }
    return {
      state: {
        ...prev,
        confirmedInside: insideNow,
        pendingInside: null,
        docked: dockedNow,
        lastSeen: pos.timestamp,
        stale: false,
      },
      event: null,
    };
  }

  let confirmedInside = prev.confirmedInside;
  let pendingInside = prev.pendingInside;
  let event: VesselEvent | null = null;

  if (insideNow === confirmedInside) {
    pendingInside = null; // reading matches confirmed state — any prior flicker is discarded
  } else if (prev.pendingInside === insideNow) {
    // second consecutive reading disagreeing with the confirmed state — transition confirmed
    confirmedInside = insideNow;
    pendingInside = null;
    event = { terminalId: terminal.id, mmsi: pos.mmsi, type: insideNow ? 'arrival' : 'departure', occurredAt: pos.timestamp };
  } else {
    pendingInside = insideNow; // first disagreeing reading — wait for confirmation
  }

  return {
    state: { ...prev, confirmedInside, pendingInside, docked: dockedNow, lastSeen: pos.timestamp, stale: false },
    event,
  };
}

/** Pure timeout check, called periodically by the runner (not per-message). Never itself emits a departure. */
export function checkStale(state: VesselState, now: number): VesselState {
  if (!state.stale && now - state.lastSeen > STALE_TIMEOUT_MS) {
    return { ...state, stale: true };
  }
  return state;
}

/**
 * Orchestrates the tanker-type gate + `updateVesselState` for one incoming
 * position. Non-tankers (or vessels with no known type yet) are ignored
 * entirely — they never enter tracked state and never emit events.
 */
export function processPosition(
  prev: VesselState | null,
  pos: VesselPosition,
  shipType: number | undefined | null,
  terminal: TerminalPolygon,
): { state: VesselState | null; event: VesselEvent | null } {
  if (!isTankerType(shipType)) return { state: prev, event: null };
  const result = updateVesselState(prev, pos, terminal);
  return result;
}
