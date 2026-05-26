/**
 * prep-global-plants.mjs
 *
 * Downloads and processes the Global Power Plant Database (GPPD) from WRI,
 * then outputs public/data/global-plants.json in the shape expected by the
 * UsPowerPlant interface (with optional country/countryCode/commissioningYear).
 *
 * Usage:
 *   node scripts/prep-global-plants.mjs
 *   node scripts/prep-global-plants.mjs --input /path/to/global_power_plant_database.csv
 *
 * Data source:
 *   https://datasets.wri.org/dataset/globalpowerplantdatabase
 *   Direct CSV (v1.3.0):
 *   https://storage.googleapis.com/global-power-plant-database/global_power_plant_database_v1.3.csv
 */

import { createReadStream, createWriteStream, existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import https from 'https';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GPPD_URL =
  'https://storage.googleapis.com/global-power-plant-database/global_power_plant_database_v1.3.csv';

const OUTPUT_PATH = join(ROOT, 'public', 'data', 'global-plants.json');

// Map GPPD primary_fuel values to our fuel categories
const FUEL_MAP = {
  Gas:          'natural_gas',
  'Natural Gas':'natural_gas',
  Coal:         'coal',
  Nuclear:      'nuclear',
  Wind:         'wind',
  Solar:        'solar',
  Hydro:        'hydro',
  Oil:          'oil',
  Petcoke:      'oil',
  Biomass:      'biomass',
  Waste:        'biomass',
  Geothermal:   'geothermal',
  Wave:         'other',
  Tidal:        'other',
  Storage:      'other',
  Cogeneration: 'other',
  'Other':      'other',
};

function normalizeFuel(rawFuel) {
  if (!rawFuel) return 'other';
  const trimmed = rawFuel.trim();
  return FUEL_MAP[trimmed] ?? 'other';
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = createWriteStream(destPath);
    proto.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

function parseCSVLine(line) {
  const fields = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

async function processCSV(csvPath) {
  const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });

  let headers = null;
  const plants = [];
  let lineNo = 0;

  for await (const line of rl) {
    lineNo++;
    if (!line.trim()) continue;
    const fields = parseCSVLine(line);

    if (lineNo === 1) {
      headers = fields.map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
      continue;
    }

    if (!headers) continue;

    const row = {};
    headers.forEach((h, i) => { row[h] = (fields[i] ?? '').trim(); });

    const lat = parseFloat(row.latitude);
    const lon = parseFloat(row.longitude);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

    const capacityMW = parseFloat(row.capacity_mw) || 0;
    const commissioningYear = parseInt(row.commissioning_year, 10) || undefined;

    const plant = {
      id: row.gppd_idnr || `gppd-${lineNo}`,
      name: row.name || 'Unknown',
      operator: row.owner || '',
      country: row.country_long || row.country || '',
      countryCode: row.country || '',
      lat,
      lon,
      fuelType: normalizeFuel(row.primary_fuel),
      capacityMW,
      ...(commissioningYear ? { commissioningYear } : {}),
    };

    plants.push(plant);
  }

  return plants;
}

async function main() {
  const args = process.argv.slice(2);
  let inputArg = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) inputArg = args[i + 1];
  }

  await mkdir(join(ROOT, 'public', 'data'), { recursive: true });

  let csvPath;
  if (inputArg) {
    csvPath = inputArg;
    console.log(`Using provided CSV: ${csvPath}`);
  } else {
    const tmpPath = join(ROOT, 'public', 'data', '_gppd_tmp.csv');
    console.log(`Downloading GPPD from:\n  ${GPPD_URL}`);
    try {
      await downloadFile(GPPD_URL, tmpPath);
      csvPath = tmpPath;
      console.log('Download complete.');
    } catch (err) {
      console.error(`\nDownload failed: ${err.message}`);
      console.error('\nIf your network blocks this URL, download the CSV manually from:');
      console.error('  https://datasets.wri.org/dataset/globalpowerplantdatabase');
      console.error('Then run:');
      console.error('  node scripts/prep-global-plants.mjs --input /path/to/global_power_plant_database.csv');
      process.exit(1);
    }
  }

  console.log('Parsing CSV...');
  const plants = await processCSV(csvPath);
  console.log(`  Parsed ${plants.length} plants with valid coordinates.`);

  // Bundle size note: 35k plants @ ~200 bytes each ≈ 7 MB JSON.
  // The file is fetched asynchronously at runtime (not bundled), so this is fine.
  await new Promise((resolve, reject) => {
    const ws = createWriteStream(OUTPUT_PATH);
    ws.write(JSON.stringify(plants, null, 0));
    ws.end();
    ws.on('finish', resolve);
    ws.on('error', reject);
  });

  const fileSizeKB = Math.round(
    (await import('fs')).statSync(OUTPUT_PATH).size / 1024,
  );
  console.log(`\nWrote ${plants.length} plants to:\n  ${OUTPUT_PATH}`);
  console.log(`  File size: ${fileSizeKB} KB`);
  console.log('\nDone. The map will fetch this file at runtime from /data/global-plants.json');

  // Remove temp download file if we created it
  if (!inputArg && existsSync(join(ROOT, 'public', 'data', '_gppd_tmp.csv'))) {
    const { unlink } = await import('fs/promises');
    await unlink(join(ROOT, 'public', 'data', '_gppd_tmp.csv'));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
