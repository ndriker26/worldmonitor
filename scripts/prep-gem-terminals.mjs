#!/usr/bin/env node
/**
 * prep-gem-terminals.mjs
 *
 * Reads the GEM GGIT LNG Terminals GeoJSON, filters to operating and
 * under-construction terminals, and outputs public/data/lng-terminals.json.
 *
 * Usage:
 *   node scripts/prep-gem-terminals.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const LNG_GEOJSON = join(ROOT, 'data/gem/GEM-GGIT-LNG-Terminals-2025-09-gis-files/GEM-GGIT-LNG-Terminals-2025-09.geojson');
const OUT = join(ROOT, 'public/data/lng-terminals.json');

const KEEP_STATUSES = new Set(['operating', 'construction']);

function r3(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n)) return null;
  return Math.round(n * 1000) / 1000;
}

function safeInt(v) {
  if (v === null || v === undefined) return null;
  const n = parseInt(v);
  return isNaN(n) ? null : n;
}

function boolVal(v) {
  if (v === true || v === 1 || v === '1' || v === 'yes') return true;
  return false;
}

async function main() {
  console.log('=== prep-gem-terminals ===');
  console.log(`Reading ${LNG_GEOJSON}...`);

  const raw = readFileSync(LNG_GEOJSON, 'utf8');
  const geojson = JSON.parse(raw);
  console.log(`  Total features: ${geojson.features.length}`);

  const terminals = [];
  const skippedByStatus = {};
  let skippedNoCoords = 0;

  for (const feature of geojson.features) {
    const p = feature.properties;
    if (!p) continue;

    const status = (p.Status || '').toLowerCase().trim();

    if (!KEEP_STATUSES.has(status)) {
      skippedByStatus[status] = (skippedByStatus[status] || 0) + 1;
      continue;
    }

    // Prefer geometry coordinates, fall back to property lat/lon
    let lon, lat;
    if (feature.geometry?.type === 'Point' && feature.geometry.coordinates?.length >= 2) {
      [lon, lat] = feature.geometry.coordinates;
    } else {
      lon = p.Longitude;
      lat = p.Latitude;
    }

    lon = r3(lon);
    lat = r3(lat);

    if (lon === null || lat === null) {
      skippedNoCoords++;
      continue;
    }

    // Best available start year: actual > latest planned > original planned
    const startYear = safeInt(p.ActualStartYear)
      || safeInt(p.LatestPlannedStartYear)
      || safeInt(p.OriginalPlannedStartYear);

    // Capacity: use unit-level, fall back to terminal total
    const capacityMtpa = p.CapacityinMtpa != null
      ? p.CapacityinMtpa
      : (p.TotExportLNGTerminalCapacityinMtpa || p.TotImportLNGTerminalCapacityinMtpa || null);

    terminals.push({
      id:            p.ProjectID || '',
      unitId:        p.UnitID || null,
      name:          p.TerminalName || '',
      unitName:      p.UnitName || null,
      country:       p['Country/Area'] || '',
      region:        p.Region || null,
      facilityType:  p.FacilityType || '',
      status:        p.Status || '',
      capacityMtpa:  capacityMtpa != null ? parseFloat(capacityMtpa) : null,
      operator:      p.Operator || p.Owner || '',
      startYear,
      floating:      boolVal(p.Floating),
      offshore:      boolVal(p.Offshore),
      lat,
      lon,
      wiki:          p.Wiki || null,
    });
  }

  console.log(`  Kept: ${terminals.length}`);
  console.log(`  Skipped by status:`, skippedByStatus);
  console.log(`  Skipped (no coords): ${skippedNoCoords}`);

  // Breakdown
  const byType = {};
  const byStatus = {};
  const byRegion = {};
  for (const t of terminals) {
    byType[t.facilityType]   = (byType[t.facilityType] || 0) + 1;
    byStatus[t.status]       = (byStatus[t.status] || 0) + 1;
    byRegion[t.region || '?'] = (byRegion[t.region || '?'] || 0) + 1;
  }
  console.log('  By facility type:', byType);
  console.log('  By status:', byStatus);
  console.log('  By region:', byRegion);

  const content = JSON.stringify(terminals);
  const sizeKB = Math.round(Buffer.byteLength(content, 'utf8') / 1024);
  writeFileSync(OUT, content);

  console.log(`\nOutput: ${OUT} (${sizeKB} KB)`);
  console.log('Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
