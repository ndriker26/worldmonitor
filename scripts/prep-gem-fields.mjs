#!/usr/bin/env node
/**
 * prep-gem-fields.mjs
 *
 * Reads the GEM Global Oil and Gas Extraction Tracker Excel file,
 * filters to producing/in-development fields with coordinates, and
 * outputs public/data/oilgas-fields.json.
 *
 * Usage:
 *   node scripts/prep-gem-fields.mjs
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const FIELDS_XLSX = join(ROOT, 'data/gem/Global-Oil-and-Gas-Extraction-Tracker-March-2026.xlsx');
const OUT = join(ROOT, 'public/data/oilgas-fields.json');

const KEEP_STATUSES = new Set(['operating', 'in-development']);

function r3(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return null;
  return Math.round(n * 1000) / 1000;
}

function safeInt(v) {
  const n = parseInt(v);
  return isNaN(n) ? null : n;
}

async function main() {
  console.log('=== prep-gem-fields ===');
  console.log(`Reading ${FIELDS_XLSX}...`);

  const wb = xlsx.readFile(FIELDS_XLSX);
  const ws = wb.Sheets['Field-level main data'];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });
  const headers = rows[0];
  const data = rows.slice(1);
  console.log(`  Total rows: ${data.length}`);

  // Build column index lookup
  const ci = (name) => {
    const idx = headers.indexOf(name);
    if (idx === -1) console.warn(`  Warning: column "${name}" not found`);
    return idx;
  };

  const cols = {
    id:              ci('Unit ID'),
    name:            ci('Unit Name'),
    fuelType:        ci('Fuel type'),
    country:         ci('Country/Area'),
    subnatUnit:      ci('Subnational unit'),
    productionType:  ci('Production Type'),
    status:          ci('Status'),
    discoveryYear:   ci('Discovery year'),
    fidYear:         ci('FID Year'),
    startYear:       ci('Production start year'),
    operator:        ci('Operator'),
    owners:          ci('Owner(s)'),
    wikiProject:     ci('Wiki URL (project)'),
    wikiField:       ci('Wiki URL (field)'),
    lat:             ci('Latitude'),
    lon:             ci('Longitude'),
    locAccuracy:     ci('Location accuracy'),
    onshoreOffshore: ci('Onshore/Offshore'),
    basin:           ci('Basin'),
    blocks:          ci('Block(s)'),
  };

  const fields = [];
  const skippedByStatus = {};
  let skippedNoCoords = 0;

  for (const row of data) {
    const rawStatus = (row[cols.status] || '').toString().toLowerCase().trim();

    if (!KEEP_STATUSES.has(rawStatus)) {
      skippedByStatus[rawStatus] = (skippedByStatus[rawStatus] || 0) + 1;
      continue;
    }

    const lat = r3(row[cols.lat]);
    const lon = r3(row[cols.lon]);
    if (lat === null || lon === null) {
      skippedNoCoords++;
      continue;
    }

    // Prefer field-level wiki URL, fall back to project wiki
    const wiki = row[cols.wikiField] || row[cols.wikiProject] || null;

    fields.push({
      id:              row[cols.id] || '',
      name:            row[cols.name] || '',
      fuelType:        (row[cols.fuelType] || '').toLowerCase(),
      country:         row[cols.country] || '',
      subnatUnit:      row[cols.subnatUnit] || null,
      productionType:  row[cols.productionType] || null,
      status:          rawStatus,
      operator:        row[cols.operator] || '',
      discoveryYear:   safeInt(row[cols.discoveryYear]),
      startYear:       safeInt(row[cols.startYear]),
      onshoreOffshore: row[cols.onshoreOffshore] || null,
      basin:           row[cols.basin] || null,
      lat,
      lon,
      wiki,
    });
  }

  console.log(`  Kept: ${fields.length}`);
  console.log(`  Skipped (no coords): ${skippedNoCoords}`);
  console.log(`  Skipped by status:`, skippedByStatus);

  // Breakdown of kept fields
  const byFuel = {};
  const byStatus = {};
  for (const f of fields) {
    byFuel[f.fuelType] = (byFuel[f.fuelType] || 0) + 1;
    byStatus[f.status] = (byStatus[f.status] || 0) + 1;
  }
  console.log('  By fuel type:', byFuel);
  console.log('  By status:', byStatus);

  const content = JSON.stringify(fields);
  const sizeKB = Math.round(Buffer.byteLength(content, 'utf8') / 1024);
  writeFileSync(OUT, content);

  console.log(`\nOutput: ${OUT} (${sizeKB} KB)`);
  console.log('Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
