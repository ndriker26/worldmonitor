#!/usr/bin/env node
//
// One-time data-generation script for US power plant locations.
// Source: EIA Form 860 — annual survey of all US power plants.
//   https://www.eia.gov/electricity/data/eia860/
//
// Parses TWO sheets from the archive:
//   - 2___Plant_Y20XX.xlsx   → plant location & identity
//   - 3_1_Generator_Y20XX.xlsx → generator fuel type, capacity, status
//
// Usage:
//   cd scripts && npm install   # exceljs must be installed
//   node generate-us-power-plants.mjs [--year 2024]
//
// Output: ../src/config/us-power-plants.ts

import { writeFileSync, mkdirSync, existsSync, createWriteStream, readdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = join(__dirname, '.tmp-eia860');
const OUTPUT_PATH = join(__dirname, '..', 'src', 'config', 'us-power-plants.ts');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let DATA_YEAR = 2024;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--year' && args[i + 1]) DATA_YEAR = Number(args[++i]);
  else if (args[i].startsWith('--year=')) DATA_YEAR = Number(args[i].split('=')[1]);
}

const ZIP_URL = `https://www.eia.gov/electricity/data/eia860/xls/eia860${DATA_YEAR}.zip`;

// ── Fuel-type normalization ──────────────────────────────────────────────────
// EIA energy source codes → our categorical fuel types.
const FUEL_MAP = {
  // Natural gas
  NG: 'natural_gas', LFG: 'natural_gas', OBG: 'natural_gas', BFG: 'natural_gas',
  // Coal
  BIT: 'coal', SUB: 'coal', LIG: 'coal', RC: 'coal', WC: 'coal', SC: 'coal',
  ANT: 'coal', SGC: 'coal', PC: 'coal', TDF: 'coal',
  // Nuclear
  NUC: 'nuclear',
  // Wind
  WND: 'wind',
  // Solar
  SUN: 'solar',
  // Hydro
  WAT: 'hydro',
  // Oil / petroleum
  DFO: 'oil', RFO: 'oil', JF: 'oil', KER: 'oil', WO: 'oil', PG: 'oil',
  SGP: 'oil', PET: 'oil',
  // Biomass
  WDS: 'biomass', OBS: 'biomass', MSW: 'biomass', BLQ: 'biomass', AB: 'biomass',
  WDL: 'biomass', SLW: 'biomass', MSB: 'biomass', MSN: 'biomass', OBL: 'biomass',
  // Geothermal
  GEO: 'geothermal', GST: 'geothermal',
  // Storage / other
  MWH: 'other', WH: 'other', OTH: 'other', PUR: 'other', HYD: 'other',
  NB: 'other', H2: 'other',
};

function normalizeFuel(code) {
  if (!code) return 'other';
  return FUEL_MAP[String(code).trim().toUpperCase()] || 'other';
}

// ── Download helper ──────────────────────────────────────────────────────────
async function downloadFile(url, dest) {
  console.log(`  Downloading ${url}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': 'WorldMonitor-DataGen/1.0 (energy grid monitor)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const fileStream = createWriteStream(dest);
  await pipeline(Readable.fromWeb(res.body), fileStream);
  console.log(`  Saved to ${dest}`);
}

// ── Unzip helper ─────────────────────────────────────────────────────────────
async function extractZip(zipPath, destDir) {
  const { execSync } = await import('node:child_process');
  mkdirSync(destDir, { recursive: true });
  try {
    if (process.platform === 'win32') {
      execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'pipe' });
    } else {
      execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'pipe' });
    }
    console.log('  Extracted ZIP archive');
  } catch (e) {
    throw new Error(`Failed to extract ZIP. ${e.message}`);
  }
}

// ── Column detection (case-insensitive, partial match) ───────────────────────
function findHeaderRow(worksheet, requiredTerms, maxRow = 5) {
  for (let r = 1; r <= Math.min(maxRow, worksheet.rowCount); r++) {
    const row = worksheet.getRow(r);
    const vals = [];
    row.eachCell({ includeEmpty: false }, (cell) => {
      vals.push(String(cell.value || '').toLowerCase());
    });
    const joined = vals.join(' ');
    if (requiredTerms.every(t => joined.includes(t))) return r;
  }
  return 1;
}

function colIndex(row, ...terms) {
  let result = null;
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    if (result) return;
    const v = String(cell.value || '').toLowerCase();
    if (terms.every(t => v.includes(t))) result = col;
  });
  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== EIA-860 US Power Plant Data Generator ===`);
  console.log(`Data year: ${DATA_YEAR}\n`);

  mkdirSync(TMP_DIR, { recursive: true });
  const zipPath = join(TMP_DIR, `eia860${DATA_YEAR}.zip`);

  if (!existsSync(zipPath)) {
    await downloadFile(ZIP_URL, zipPath);
  } else {
    console.log('  ZIP already downloaded, skipping.');
  }

  const extractDir = join(TMP_DIR, 'extracted');
  await extractZip(zipPath, extractDir);

  const allFiles = readdirSync(extractDir, { recursive: true }).map(String);
  console.log(`  Files in archive: ${allFiles.length}`);

  // ── Find the two XLSX files we need ──────────────────────────────────────
  const plantFile = allFiles.find(f => /2___.*Plant.*\.xlsx$/i.test(f));
  const genFile = allFiles.find(f => /3_1_.*Generator.*\.xlsx$/i.test(f))
    || allFiles.find(f => /Existing.*Generator.*\.xlsx$/i.test(f))
    || allFiles.find(f => /Generator.*\.xlsx$/i.test(f) && !/Proposed/i.test(f) && !/Retired/i.test(f));

  if (!plantFile) { console.error('  Plant XLSX not found'); process.exit(1); }
  if (!genFile) { console.error('  Generator XLSX not found'); process.exit(1); }

  console.log(`  Plant file: ${plantFile}`);
  console.log(`  Generator file: ${genFile}`);

  // ── Parse Plant sheet → plant location map ───────────────────────────────
  console.log('\n  Parsing Plant sheet...');
  const plantWb = new ExcelJS.Workbook();
  await plantWb.xlsx.readFile(join(extractDir, plantFile));
  const plantWs = plantWb.worksheets.find(ws => /plant/i.test(ws.name)) || plantWb.worksheets[0];
  console.log(`  Worksheet: "${plantWs.name}" (${plantWs.rowCount} rows)`);

  const pHdr = findHeaderRow(plantWs, ['plant code', 'latitude']);
  const pRow = plantWs.getRow(pHdr);
  const pCols = {
    code: colIndex(pRow, 'plant code') || colIndex(pRow, 'plant', 'code'),
    name: colIndex(pRow, 'plant name') || colIndex(pRow, 'plant', 'name'),
    utility: colIndex(pRow, 'utility name') || colIndex(pRow, 'utility', 'name'),
    state: colIndex(pRow, 'state'),
    lat: colIndex(pRow, 'latitude'),
    lon: colIndex(pRow, 'longitude'),
  };
  console.log(`  Plant columns (row ${pHdr}):`, JSON.stringify(pCols));

  const plantMap = new Map(); // plantCode → { name, operator, state, lat, lon }
  for (let r = pHdr + 1; r <= plantWs.rowCount; r++) {
    const row = plantWs.getRow(r);
    const code = String(row.getCell(pCols.code).value || '').trim();
    if (!code) continue;
    const lat = Number(row.getCell(pCols.lat).value);
    const lon = Number(row.getCell(pCols.lon).value);
    if (!lat || !lon || isNaN(lat) || isNaN(lon)) continue;

    plantMap.set(code, {
      name: String(row.getCell(pCols.name).value || '').trim(),
      operator: pCols.utility ? String(row.getCell(pCols.utility).value || '').trim() : '',
      state: pCols.state ? String(row.getCell(pCols.state).value || '').trim().substring(0, 2).toUpperCase() : '',
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(lon * 10000) / 10000,
    });
  }
  console.log(`  Plants with valid coordinates: ${plantMap.size}`);

  // ── Parse Generator sheet → aggregate fuel + capacity per plant ──────────
  console.log('\n  Parsing Generator sheet...');
  const genWb = new ExcelJS.Workbook();
  await genWb.xlsx.readFile(join(extractDir, genFile));
  const genWs = genWb.worksheets.find(ws => /operable|existing|generator/i.test(ws.name))
    || genWb.worksheets[0];
  console.log(`  Worksheet: "${genWs.name}" (${genWs.rowCount} rows)`);

  const gHdr = findHeaderRow(genWs, ['plant code']);
  const gRow = genWs.getRow(gHdr);

  // Dump generator column headers for debugging
  console.log('  Generator columns:');
  gRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const v = String(cell.value || '');
    if (col <= 30 || /fuel|energy|source|capacity|nameplate|status/i.test(v)) {
      console.log(`    Col ${col}: "${v}"`);
    }
  });

  const gCols = {
    code: colIndex(gRow, 'plant code') || colIndex(gRow, 'plant', 'code'),
    status: colIndex(gRow, 'status'),
    fuel: colIndex(gRow, 'energy source') || colIndex(gRow, 'energy', 'source')
      || colIndex(gRow, 'primary', 'source') || colIndex(gRow, 'fuel', 'type'),
    capacity: colIndex(gRow, 'nameplate', 'capacity')
      || colIndex(gRow, 'nameplate'),
  };
  console.log(`  Generator cols (row ${gHdr}):`, JSON.stringify(gCols));

  if (!gCols.code) { console.error('  Generator plant code column not found'); process.exit(1); }

  // Aggregate: per plant, accumulate capacity by fuel type
  const genAgg = new Map(); // plantCode → Map<fuelType, totalMW>

  // Operating status codes: OP=operating, SB=standby, OA=out of service (temp), OS=out of service
  const OP_STATUSES = new Set(['OP', 'SB', 'OA', 'OS']);
  let genTotal = 0;
  let genKept = 0;

  for (let r = gHdr + 1; r <= genWs.rowCount; r++) {
    const row = genWs.getRow(r);
    const code = String(row.getCell(gCols.code).value || '').trim();
    if (!code) continue;
    genTotal++;

    // Filter by status if available
    if (gCols.status) {
      const st = String(row.getCell(gCols.status).value || '').trim().toUpperCase();
      if (st && !OP_STATUSES.has(st)) continue;
    }

    const fuelRaw = gCols.fuel ? String(row.getCell(gCols.fuel).value || '').trim() : '';
    const fuel = normalizeFuel(fuelRaw);
    const capRaw = gCols.capacity ? Number(row.getCell(gCols.capacity).value) : 0;
    const capMW = isNaN(capRaw) ? 0 : capRaw;

    if (!genAgg.has(code)) genAgg.set(code, new Map());
    const fuelMap = genAgg.get(code);
    fuelMap.set(fuel, (fuelMap.get(fuel) || 0) + capMW);
    genKept++;
  }

  console.log(`  Generator rows: ${genTotal} total, ${genKept} operating`);
  console.log(`  Plants with generators: ${genAgg.size}`);

  // ── Merge: plant location + generator aggregates ─────────────────────────
  const plants = [];
  for (const [code, plant] of plantMap) {
    const fuelMap = genAgg.get(code);
    if (!fuelMap || fuelMap.size === 0) continue; // no operating generators

    let totalMW = 0;
    let primaryFuel = 'other';
    let maxFuelMW = 0;

    for (const [fuel, mw] of fuelMap) {
      totalMW += mw;
      if (mw > maxFuelMW) { maxFuelMW = mw; primaryFuel = fuel; }
    }

    plants.push({
      id: code,
      name: plant.name,
      operator: plant.operator,
      state: plant.state,
      lat: plant.lat,
      lon: plant.lon,
      fuelType: primaryFuel,
      capacityMW: Math.round(totalMW * 10) / 10,
    });
  }

  // Sort by capacity descending for readability
  plants.sort((a, b) => b.capacityMW - a.capacityMW);

  console.log(`\n  Final: ${plants.length} operating plants with coords + generators`);

  // Fuel type breakdown
  const fuelCounts = {};
  const fuelCapacity = {};
  for (const p of plants) {
    fuelCounts[p.fuelType] = (fuelCounts[p.fuelType] || 0) + 1;
    fuelCapacity[p.fuelType] = (fuelCapacity[p.fuelType] || 0) + p.capacityMW;
  }
  console.log('\n  Fuel type breakdown (count / total MW):');
  for (const [ft, count] of Object.entries(fuelCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${ft.padEnd(14)} ${String(count).padStart(5)} plants  ${Math.round(fuelCapacity[ft]).toLocaleString().padStart(10)} MW`);
  }

  // ── Generate TypeScript output ───────────────────────────────────────────
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const lines = [
    `// Auto-generated from EIA Form 860 (${DATA_YEAR} data)`,
    `// Source: https://www.eia.gov/electricity/data/eia860/`,
    `// Generated: ${new Date().toISOString().slice(0, 10)}`,
    `// Re-run: cd scripts && node generate-us-power-plants.mjs --year ${DATA_YEAR}`,
    `//`,
    `// ${plants.length} operating US power plants with valid coordinates`,
    ``,
    `import type { UsPowerPlant } from '@/types';`,
    ``,
    `export const US_POWER_PLANTS: UsPowerPlant[] = ([`,
  ];

  for (const p of plants) {
    lines.push(`  { id: '${p.id}', name: '${esc(p.name)}', operator: '${esc(p.operator)}', state: '${p.state}', lat: ${p.lat}, lon: ${p.lon}, fuelType: '${p.fuelType}', capacityMW: ${p.capacityMW} },`);
  }

  lines.push(`] as unknown) as UsPowerPlant[];`);
  lines.push(``);

  writeFileSync(OUTPUT_PATH, lines.join('\n'), 'utf8');
  console.log(`\n  Wrote ${OUTPUT_PATH}`);

  // Cleanup
  const { rmSync } = await import('node:fs');
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }

  console.log('  Done!\n');
}

main().catch(err => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
