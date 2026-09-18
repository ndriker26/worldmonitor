import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LatLon, TerminalPolygon } from './state-machine.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TERMINALS_PATH = join(moduleDir, '..', 'terminals.geojson');

interface TerminalFeature {
  type: 'Feature';
  properties: { id: string; name: string; country: string; verified: boolean };
  geometry: { type: 'Polygon'; coordinates: number[][][] };
}

interface TerminalFeatureCollection {
  type: 'FeatureCollection';
  features: TerminalFeature[];
}

export interface BoundingBox {
  /** [lat, lon] */
  sw: [number, number];
  /** [lat, lon] */
  ne: [number, number];
}

export interface Terminal extends TerminalPolygon {
  country: string;
  bbox: BoundingBox;
}

/** Small margin (degrees) around each terminal's polygon extent for the AIS bounding-box subscription. */
const BBOX_PADDING_DEG = 0.02;

export function loadTerminals(path: string = DEFAULT_TERMINALS_PATH): Terminal[] {
  const raw = readFileSync(path, 'utf-8');
  const fc = JSON.parse(raw) as TerminalFeatureCollection;

  return fc.features.map((feature): Terminal => {
    const ring = feature.geometry.coordinates[0];
    if (!ring || ring.length < 3) {
      throw new Error(`Terminal "${feature.properties.id}" has an invalid polygon ring`);
    }
    const polygon: LatLon[] = ring.map(([lon, lat]) => ({ lat: lat as number, lon: lon as number }));
    const lats = polygon.map((p) => p.lat);
    const lons = polygon.map((p) => p.lon);

    return {
      id: feature.properties.id,
      name: feature.properties.name,
      country: feature.properties.country,
      polygon,
      bbox: {
        sw: [Math.min(...lats) - BBOX_PADDING_DEG, Math.min(...lons) - BBOX_PADDING_DEG],
        ne: [Math.max(...lats) + BBOX_PADDING_DEG, Math.max(...lons) + BBOX_PADDING_DEG],
      },
    };
  });
}

export function isWithinBbox(point: LatLon, bbox: BoundingBox): boolean {
  return (
    point.lat >= bbox.sw[0] && point.lat <= bbox.ne[0] &&
    point.lon >= bbox.sw[1] && point.lon <= bbox.ne[1]
  );
}

/** Which terminal (if any) a position falls near, by bounding box — terminals are geographically far apart, so this is unambiguous in practice. */
export function findTerminalForPosition(point: LatLon, terminals: Terminal[]): Terminal | undefined {
  return terminals.find((t) => isWithinBbox(point, t.bbox));
}
