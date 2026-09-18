// Field names verified against aisstream's own generated TypeScript models
// (github.com/aisstream/ais-message-models, typescript/aisStream/models/*.ts),
// not guessed. See docs/AUTH_GATE.md-adjacent worker README for the full trail.

export interface RawPositionReport {
  UserID: number;
  Latitude: number;
  Longitude: number;
  Sog: number;
  NavigationalStatus: number;
  Cog?: number;
  TrueHeading?: number;
}

export interface RawShipStaticData {
  UserID: number;
  Type: number;
  ImoNumber?: number;
  Name?: string;
  CallSign?: string;
}

export interface AisMetaData {
  MMSI: number;
  ShipName?: string;
  latitude?: number;
  longitude?: number;
  time_utc?: string;
}

export interface AisFrame {
  MessageType: string;
  Message: {
    PositionReport?: RawPositionReport;
    ShipStaticData?: RawShipStaticData;
  };
  MetaData?: AisMetaData;
}

export function parseFrameTimestamp(frame: AisFrame, fallback: number): number {
  const raw = frame.MetaData?.time_utc;
  if (!raw) return fallback;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}
