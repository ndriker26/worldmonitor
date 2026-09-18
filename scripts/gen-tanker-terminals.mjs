#!/usr/bin/env node
// Regenerates src/config/tanker-terminals.ts from worker/ais/terminals.geojson.
// Re-run: node scripts/gen-tanker-terminals.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const geojsonPath = join(here, '..', 'worker', 'ais', 'terminals.geojson');
const outPath = join(here, '..', 'src', 'config', 'tanker-terminals.ts');

const fc = JSON.parse(readFileSync(geojsonPath, 'utf-8'));

function centroid(ring) {
  // Simple vertex-average centroid — fine for these small, near-rectangular
  // polygons; not a proper area-weighted centroid.
  const pts = ring[0].length && Array.isArray(ring[0][0]) ? ring[0] : ring;
  let latSum = 0, lonSum = 0;
  for (const [lon, lat] of pts) { latSum += lat; lonSum += lon; }
  return { lat: latSum / pts.length, lon: lonSum / pts.length };
}

const terminals = fc.features.map((f) => {
  const c = centroid(f.geometry.coordinates);
  return {
    id: f.properties.id,
    name: f.properties.name,
    country: f.properties.country,
    lat: Math.round(c.lat * 10000) / 10000,
    lon: Math.round(c.lon * 10000) / 10000,
  };
});

const body = `// Auto-generated from worker/ais/terminals.geojson
// Re-run: node scripts/gen-tanker-terminals.mjs
// Do not edit by hand — edit terminals.geojson and regenerate.

export interface TankerTerminal {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
}

export const TANKER_TERMINALS: TankerTerminal[] = ${JSON.stringify(terminals, null, 2)};
`;

writeFileSync(outPath, body);
console.log(`Wrote ${terminals.length} terminals to ${outPath}`);
