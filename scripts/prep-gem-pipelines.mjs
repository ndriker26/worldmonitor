#!/usr/bin/env node
/**
 * prep-gem-pipelines.mjs
 *
 * Reads GEM oil (GOIT) and gas (GGIT) pipeline GeoJSON files, filters to
 * active/relevant statuses, rounds coordinates to 3 decimal places, and
 * outputs public/data/pipelines.json (or regional splits if >15 MB).
 *
 * Usage:
 *   node scripts/prep-gem-pipelines.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const OIL_GEOJSON = join(ROOT, 'data/gem/GEM-GOIT-Oil-NGL-Pipelines-2025-03/GEM-GOIT-Oil-NGL-Pipelines-2025-03.geojson');
const GAS_GEOJSON = join(ROOT, 'data/gem/GEM-GGIT-Gas-Pipelines-2025-11/GEM-GGIT-Gas-Pipelines-2025-11.geojson');
const OUT_COMBINED = join(ROOT, 'public/data/pipelines.json');
const OUT_DIR = join(ROOT, 'public/data');

const KEEP_STATUSES = new Set(['operating', 'construction', 'mothballed', 'idle', 'mixed status']);
// Famous shelved projects to keep despite not being in KEEP_STATUSES
const FAMOUS_SHELVED = new Set(['nord stream 2', 'nordstream 2', 'north stream 2']);

// Simplification tolerance in degrees (~1 km at equator). Pipelines with
// sub-meter routing in the raw GeoJSON would otherwise produce 40MB+ files.
const SIMPLIFY_TOLERANCE = 0.01;

// ── Coordinate helpers ────────────────────────────────────────────────────────

function r3(n) {
  return Math.round(n * 1000) / 1000;
}

// Ramer–Douglas–Peucker line simplification (iterative to avoid stack overflow
// on very long coordinate arrays).
function simplifyRDP(points, tolerance) {
  if (points.length <= 2) return points;
  const sqTol = tolerance * tolerance;

  function sqSegDist(px, py, ax, ay, bx, by) {
    let dx = bx - ax, dy = by - ay;
    if (dx !== 0 || dy !== 0) {
      const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
      if (t > 1) { ax = bx; ay = by; }
      else if (t > 0) { ax += dx * t; ay += dy * t; }
    }
    return (px - ax) ** 2 + (py - ay) ** 2;
  }

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Use an explicit stack of [first, last] ranges
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let maxSqDist = 0;
    let maxIdx = -1;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(points[i][0], points[i][1], ax, ay, bx, by);
      if (d > maxSqDist) { maxSqDist = d; maxIdx = i; }
    }
    if (maxSqDist > sqTol) {
      keep[maxIdx] = 1;
      if (maxIdx - first > 1) stack.push([first, maxIdx]);
      if (last - maxIdx > 1) stack.push([maxIdx, last]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

function extractPaths(geometry) {
  if (!geometry) return null;

  const processLine = (coords) => {
    if (coords.length < 2) return null;
    const rounded = coords.map(([lon, lat]) => [r3(lon), r3(lat)]);
    // Only simplify if dense enough to be worth it (>50 pts)
    return rounded.length > 50 ? simplifyRDP(rounded, SIMPLIFY_TOLERANCE) : rounded;
  };

  if (geometry.type === 'LineString') {
    const path = processLine(geometry.coordinates);
    return path ? [path] : null;
  }
  if (geometry.type === 'MultiLineString') {
    const paths = geometry.coordinates
      .map(processLine)
      .filter(Boolean);
    return paths.length > 0 ? paths : null;
  }
  return null;
}

// ── Field normalizers ─────────────────────────────────────────────────────────

function normalizeCommodity(fuel) {
  const f = (fuel || '').toLowerCase().trim();
  if (f === 'gas') return 'gas';
  if (f === 'oil' || f.startsWith('oil,') || f.startsWith('oil ')) return 'oil';
  if (f.includes('ngl') || f.includes('naphtha')) return 'ngl';
  if (f.includes('lpg')) return 'lpg';
  if (f.includes('oil')) return 'oil';
  return f || 'oil';
}

function normalizeStatus(s) {
  return (s || 'unknown').toLowerCase().trim();
}

// ── Region assignment for split output ───────────────────────────────────────

function getRegionBucket(p) {
  const region = p.StartRegion || '';
  const sub = p.StartSubRegion || '';
  if (region === 'Americas') return 'americas';
  if (region === 'Africa') return 'mideast-africa';
  if (region === 'Oceania') return 'asia-pacific';
  if (region === 'Europe') return 'europe-russia';
  if (region === 'Asia') {
    if (sub === 'Western Asia' || sub === 'Central Asia') return 'mideast-africa';
    return 'asia-pacific';
  }
  return 'asia-pacific';
}

// ── Feature processor ─────────────────────────────────────────────────────────

function processPipeline(feature) {
  const p = feature.properties;
  if (!p || !feature.geometry) return null;

  const status = normalizeStatus(p.Status);
  const nameLC = (p.PipelineName || '').toLowerCase();
  const isFamous = FAMOUS_SHELVED.has(nameLC);

  if (!KEEP_STATUSES.has(status) && !isFamous) return null;

  const paths = extractPaths(feature.geometry);
  if (!paths) return null;

  // Oil uses "Countries", gas uses "CountriesOrAreas"
  const countries = p.Countries || p.CountriesOrAreas || '';

  const diameter = p.Diameter
    ? `${p.Diameter} ${p.DiameterUnits || 'in'}`.trim()
    : null;

  const capacityDesc = (p.Capacity && p.CapacityUnits)
    ? `${p.Capacity} ${p.CapacityUnits}`
    : null;

  const lengthKm = p.LengthMergedKm
    ? Math.round(parseFloat(p.LengthMergedKm))
    : (p.LengthKnownKm ? Math.round(parseFloat(p.LengthKnownKm)) : null);

  return {
    id: p.ProjectID || '',
    name: p.PipelineName || p.SegmentName || '',
    segment: p.SegmentName || null,
    commodity: normalizeCommodity(p.Fuel),
    status,
    operator: p.Owner || p.Parent || '',
    countries,
    capacityBOEd: p.CapacityBOEd ? Math.round(parseFloat(p.CapacityBOEd)) : null,
    capacityDesc,
    lengthKm,
    diameter,
    startYear: p.StartYear1 ? parseInt(p.StartYear1) : null,
    wiki: p.Wiki || null,
    paths,
    _region: getRegionBucket(p),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function readAndProcess(filePath, label) {
  console.log(`\nReading ${label}...`);
  const raw = readFileSync(filePath, 'utf8');
  console.log(`  File size: ${(raw.length / 1024 / 1024).toFixed(1)} MB`);

  const geojson = JSON.parse(raw);
  const total = geojson.features.length;
  console.log(`  Total features: ${total}`);

  const kept = [];
  let skipped = 0;

  for (const feature of geojson.features) {
    const result = processPipeline(feature);
    if (result) {
      kept.push(result);
    } else {
      skipped++;
    }
  }

  console.log(`  Kept: ${kept.length}  Skipped: ${skipped}`);
  return kept;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function main() {
  console.log('=== prep-gem-pipelines ===');

  const oilPipelines = readAndProcess(OIL_GEOJSON, 'Oil/NGL Pipelines (GOIT)');
  const gasPipelines = readAndProcess(GAS_GEOJSON, 'Gas Pipelines (GGIT)');

  const all = [...oilPipelines, ...gasPipelines];
  console.log(`\nCombined total: ${all.length} pipelines`);

  // Status breakdown
  const byStatus = {};
  const byCommodity = {};
  for (const p of all) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    byCommodity[p.commodity] = (byCommodity[p.commodity] || 0) + 1;
  }
  console.log('By status:', byStatus);
  console.log('By commodity:', byCommodity);

  // Strip internal _region before size check
  const forOutput = all.map(({ _region, ...rest }) => rest);
  const combined = JSON.stringify(forOutput);
  const combinedBytes = Buffer.byteLength(combined, 'utf8');

  console.log(`\nCombined output size: ${kb(combinedBytes)} (${(combinedBytes / 1024 / 1024).toFixed(1)} MB)`);

  if (combinedBytes <= 15 * 1024 * 1024) {
    writeFileSync(OUT_COMBINED, combined);
    console.log(`Wrote: ${OUT_COMBINED}`);
  } else {
    console.log('Exceeds 15 MB — writing regional split files...');

    const buckets = {
      americas: [],
      'europe-russia': [],
      'mideast-africa': [],
      'asia-pacific': [],
    };

    for (let i = 0; i < all.length; i++) {
      const { _region, ...pipeline } = all[i];
      (buckets[_region] || buckets['asia-pacific']).push(pipeline);
    }

    const fileNames = [];
    for (const [region, pipelines] of Object.entries(buckets)) {
      const fileName = `pipelines-${region}.json`;
      const outPath = join(OUT_DIR, fileName);
      const content = JSON.stringify(pipelines);
      const size = Buffer.byteLength(content, 'utf8');
      writeFileSync(outPath, content);
      fileNames.push(fileName);
      console.log(`  ${fileName}: ${pipelines.length} pipelines, ${kb(size)}`);
    }

    // Write manifest so the data loader knows which files to fetch
    const manifest = {
      split: true,
      files: fileNames,
      total: all.length,
    };
    writeFileSync(OUT_COMBINED, JSON.stringify(manifest));
    console.log(`  Manifest: ${OUT_COMBINED}`);
  }

  console.log('\nDone!');
}

main().catch(e => { console.error(e); process.exit(1); });
