'use strict';
const fs = require('fs');
const vm = require('vm');

function extractTSArray(filePath, exportName) {
  let raw = fs.readFileSync(filePath, 'utf8');
  raw = raw.replace(/^\/\/[^\n]*/gm, '');  // strip full-line comments only (not // inside strings)
  raw = raw.replace(/import\s+type[^;]*;/g, '');
  raw = raw.replace(
    new RegExp('export\\s+const\\s+' + exportName + '\\s*:[^=]+=\\s*'),
    'data = '
  );
  raw = 'var data; ' + raw.replace(/;\s*$/, '');
  const ctx = vm.createContext({});
  vm.runInContext(raw, ctx, { timeout: 60000 });
  return ctx.data;
}

console.time('extract pipelines');
const pipelines = extractTSArray('src/config/global-pipelines.ts', 'GLOBAL_PIPELINES');
console.timeEnd('extract pipelines');
console.log('Pipelines:', pipelines.length, 'entries, sample keys:', Object.keys(pipelines[0]));

const pStripped = pipelines.map(p => ({
  id: p.id,
  name: p.name,
  commodity: p.commodity,
  status: p.status,
  region: p.region,
  lengthKm: p.lengthKm,
  operator: p.operator,
  coordinates: p.coordinates,
}));
const pJson = JSON.stringify(pStripped);
fs.writeFileSync('public/data/gem-pipelines.json', pJson);
console.log('gem-pipelines.json:', (pJson.length / 1024 / 1024).toFixed(2), 'MB');

console.time('extract fields');
const fields = extractTSArray('src/config/global-oilgas-fields.ts', 'GLOBAL_OILGAS_FIELDS');
console.timeEnd('extract fields');
console.log('Fields:', fields.length, 'entries, sample keys:', Object.keys(fields[0]));

const fStripped = fields.map(f => ({
  id: f.id,
  name: f.name,
  type: f.type,
  commodity: f.commodity,
  status: f.status,
  country: f.country,
  lat: f.lat,
  lon: f.lon,
}));
const fJson = JSON.stringify(fStripped);
fs.writeFileSync('public/data/gem-fields.json', fJson);
console.log('gem-fields.json:', (fJson.length / 1024 / 1024).toFixed(2), 'MB');

console.log('Done.');
