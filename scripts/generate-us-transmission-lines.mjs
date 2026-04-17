#!/usr/bin/env node
/**
 * Generate US transmission lines data from HIFLD ArcGIS Feature Service.
 *
 * Downloads electric power transmission lines (230 kV+) via paginated
 * REST queries and outputs a typed TypeScript file for the energy variant.
 *
 * Usage:
 *   node scripts/generate-us-transmission-lines.mjs [--min-kv 230] [--file path/to/local.geojson]
 *
 * Options:
 *   --min-kv <number>   Minimum voltage filter in kV (default: 230)
 *   --file <path>       Use a local GeoJSON file instead of downloading from HIFLD
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'src', 'config', 'us-transmission-lines.ts');

const FEATURE_SERVICE_URL =
  'https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0/query';
const PAGE_SIZE = 2000;

// ── CLI args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const MIN_KV = Number(flag('--min-kv') ?? 230);
const LOCAL_FILE = flag('--file');

// ── Coordinate helpers ─────────────────────────────────────────────────────────

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/** Squared perpendicular distance from point p to segment a-b */
function perpendicularDistSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return (px - ax) ** 2 + (py - ay) ** 2;
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  const nx = ax + t * dx;
  const ny = ay + t * dy;
  return (px - nx) ** 2 + (py - ny) ** 2;
}

/**
 * Ramer-Douglas-Peucker line simplification.
 * Epsilon in degrees — 0.001° ≈ 111 m at the equator, good enough for map viz.
 */
function simplifyLine(coords, epsilon = 0.001) {
  if (coords.length <= 2) return coords;
  const epsSq = epsilon * epsilon;
  let maxDist = 0;
  let maxIdx = 0;
  const first = coords[0];
  const last = coords[coords.length - 1];
  for (let i = 1; i < coords.length - 1; i++) {
    const d = perpendicularDistSq(coords[i][0], coords[i][1], first[0], first[1], last[0], last[1]);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsSq) {
    const left = simplifyLine(coords.slice(0, maxIdx + 1), epsilon);
    const right = simplifyLine(coords.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

// ── Download from ArcGIS REST API ──────────────────────────────────────────────

async function fetchPage(offset) {
  const params = new URLSearchParams({
    where: `VOLTAGE >= ${MIN_KV}`,
    outFields: 'OBJECTID,VOLTAGE,OWNER,TYPE',
    f: 'geojson',
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(offset),
    outSR: '4326',
  });
  const url = `${FEATURE_SERVICE_URL}?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'WorldMonitor-DataPrep/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching offset ${offset}: ${res.statusText}`);
  return res.json();
}

async function downloadAllFeatures() {
  const allFeatures = [];
  let offset = 0;
  let page = 1;
  while (true) {
    process.stdout.write(`  Fetching page ${page} (offset ${offset})...`);
    const data = await fetchPage(offset);
    const features = data.features || [];
    process.stdout.write(` ${features.length} features\n`);
    if (features.length === 0) break;
    allFeatures.push(...features);
    if (features.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    page++;
    // Be polite to the HIFLD server
    await new Promise(r => setTimeout(r, 500));
  }
  return allFeatures;
}

function loadLocalFile(path) {
  console.log(`  Loading local GeoJSON: ${path}`);
  const raw = readFileSync(path, 'utf8');
  const geojson = JSON.parse(raw);
  const features = geojson.features || [];
  console.log(`  Loaded ${features.length} total features`);
  return features.filter(f => {
    const v = f.properties?.VOLTAGE ?? f.properties?.voltage ?? 0;
    return Number(v) >= MIN_KV;
  });
}

// ── Process features ───────────────────────────────────────────────────────────

function processFeatures(features) {
  const lines = [];
  let skippedGeom = 0;
  let skippedVoltage = 0;

  for (const f of features) {
    const props = f.properties || {};
    const geom = f.geometry;

    if (!geom || !geom.coordinates || geom.coordinates.length < 2) {
      skippedGeom++;
      continue;
    }

    const voltage = Number(props.VOLTAGE ?? props.voltage ?? 0);
    if (!voltage || voltage < MIN_KV) {
      skippedVoltage++;
      continue;
    }

    let coords;
    if (geom.type === 'LineString') {
      coords = geom.coordinates;
    } else if (geom.type === 'MultiLineString') {
      // Flatten multi-line into longest segment for simplicity
      coords = geom.coordinates.reduce((a, b) => a.length >= b.length ? a : b, []);
    } else {
      skippedGeom++;
      continue;
    }

    if (coords.length < 2) { skippedGeom++; continue; }

    // Round and simplify coordinates
    const rounded = coords.map(c => [round4(c[0]), round4(c[1])]);
    const simplified = simplifyLine(rounded);
    if (simplified.length < 2) { skippedGeom++; continue; }

    const id = String(props.OBJECTID ?? props.ID ?? props.id ?? lines.length);
    const owner = (props.OWNER ?? props.owner ?? '').trim();
    const lineType = (props.TYPE ?? props.type ?? '').trim();

    lines.push({ id, voltageKv: voltage, owner: owner || undefined, lineType: lineType || undefined, coordinates: simplified });
  }

  console.log(`  Processed: ${lines.length} lines kept, ${skippedGeom} bad geometry, ${skippedVoltage} below ${MIN_KV} kV`);

  // Sort by voltage descending so highest-voltage (most important) lines render first
  lines.sort((a, b) => b.voltageKv - a.voltageKv);
  return lines;
}

// ── Generate TypeScript ────────────────────────────────────────────────────────

function generateTypeScript(lines) {
  const esc = (s) => (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const output = [
    `// Auto-generated from HIFLD Electric Power Transmission Lines`,
    `// Source: https://hifld-geoplatform.hub.arcgis.com/datasets/electric-power-transmission-lines`,
    `// Generated: ${new Date().toISOString().slice(0, 10)}`,
    `// Re-run: cd scripts && node generate-us-transmission-lines.mjs --min-kv ${MIN_KV}`,
    `//`,
    `// ${lines.length} US transmission lines (${MIN_KV} kV+)`,
    ``,
    `import type { UsTransmissionLine } from '@/types';`,
    ``,
    `export const US_TRANSMISSION_LINES: UsTransmissionLine[] = ([`,
  ];

  for (const l of lines) {
    const coordStr = JSON.stringify(l.coordinates);
    const ownerPart = l.owner ? `, owner: '${esc(l.owner)}'` : '';
    const typePart = l.lineType ? `, lineType: '${esc(l.lineType)}'` : '';
    output.push(`  { id: '${l.id}', voltageKv: ${l.voltageKv}${ownerPart}${typePart}, coordinates: ${coordStr} },`);
  }

  output.push(`] as unknown) as UsTransmissionLine[];`);
  output.push(``);

  return output.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔌 Generating US transmission lines data (${MIN_KV} kV+)\n`);

  let features;
  if (LOCAL_FILE) {
    if (!existsSync(LOCAL_FILE)) {
      console.error(`Error: File not found: ${LOCAL_FILE}`);
      process.exit(1);
    }
    features = loadLocalFile(LOCAL_FILE);
  } else {
    console.log('  Downloading from HIFLD ArcGIS Feature Service...');
    features = await downloadAllFeatures();
  }

  console.log(`  Total features fetched: ${features.length}`);

  const lines = processFeatures(features);
  if (lines.length === 0) {
    console.error('Error: No valid transmission lines found!');
    process.exit(1);
  }

  const tsContent = generateTypeScript(lines);
  writeFileSync(OUTPUT_PATH, tsContent, 'utf8');

  const fileSizeMB = (Buffer.byteLength(tsContent) / (1024 * 1024)).toFixed(1);
  console.log(`\n  ✅ Written ${OUTPUT_PATH}`);
  console.log(`     ${lines.length} lines, ${fileSizeMB} MB`);
  console.log(`     Voltage range: ${lines[lines.length - 1].voltageKv}–${lines[0].voltageKv} kV\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
