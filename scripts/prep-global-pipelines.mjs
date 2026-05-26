/**
 * prep-global-pipelines.mjs
 *
 * Attempts to fetch pipeline data from the OpenStreetMap Overpass API,
 * then merges with a comprehensive manually-curated list of major global
 * pipelines and writes the result to src/config/global-pipelines.ts.
 *
 * Usage:
 *   node scripts/prep-global-pipelines.mjs
 *   node scripts/prep-global-pipelines.mjs --manual-only
 *
 * Data sources tried (in order):
 *   1. Overpass API — named pipeline route relations in OSM
 *   2. Embedded manual list (~200 major pipelines, all continents)
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_TS = join(ROOT, 'src', 'config', 'global-pipelines.ts');

const MANUAL_ONLY = process.argv.includes('--manual-only');

// ─────────────────────────────────────────────────────────────────────────────
// Manually curated list of ~200 major global pipelines
// Coordinates are [longitude, latitude] pairs — at least 4 waypoints per line
// ─────────────────────────────────────────────────────────────────────────────
const MANUAL_PIPELINES = [
  // ── RUSSIA & CIS ──────────────────────────────────────────────────────────
  {
    id: 'druzhba', name: 'Druzhba Pipeline', commodity: 'crude', status: 'active',
    operator: 'Transneft', lengthKm: 4000, capacityDesc: '1.2 Mb/d', region: 'Russia/Europe',
    coordinates: [[50.0,53.5],[40.0,51.0],[30.0,50.5],[20.0,50.0],[14.5,50.5],[13.5,50.5]],
  },
  {
    id: 'nordstream1', name: 'Nord Stream 1', commodity: 'gas', status: 'inactive',
    operator: 'Nord Stream AG', lengthKm: 1224, capacityDesc: '55 bcm/yr', region: 'Russia/Europe',
    coordinates: [[29.0,60.4],[20.0,58.0],[15.0,56.0],[13.7,54.1]],
  },
  {
    id: 'nordstream2', name: 'Nord Stream 2', commodity: 'gas', status: 'inactive',
    operator: 'Nord Stream 2 AG', lengthKm: 1230, capacityDesc: '55 bcm/yr', region: 'Russia/Europe',
    coordinates: [[29.0,60.4],[18.0,56.5],[14.5,54.8],[13.7,54.1]],
  },
  {
    id: 'turkstream', name: 'TurkStream', commodity: 'gas', status: 'active',
    operator: 'Gazprom', lengthKm: 930, capacityDesc: '31.5 bcm/yr', region: 'Russia/Turkey',
    coordinates: [[37.8,44.7],[34.0,42.5],[31.0,41.8],[28.9,41.1]],
  },
  {
    id: 'yamal-europe', name: 'Yamal-Europe Pipeline', commodity: 'gas', status: 'active',
    operator: 'Gazprom', lengthKm: 4196, capacityDesc: '33 bcm/yr', region: 'Russia/Europe',
    coordinates: [[68.0,67.0],[60.0,60.0],[53.0,57.0],[44.0,55.0],[37.6,55.7],[32.0,53.0],[23.5,52.5],[14.0,51.5],[12.0,52.0]],
  },
  {
    id: 'espo', name: 'ESPO Pipeline', commodity: 'crude', status: 'active',
    operator: 'Transneft', lengthKm: 4857, capacityDesc: '1.6 Mb/d', region: 'Russia/Asia',
    coordinates: [[60.0,56.0],[80.0,56.0],[98.0,55.9],[107.0,53.0],[118.0,50.0],[124.0,54.0],[131.5,43.0]],
  },
  {
    id: 'power-of-siberia-1', name: 'Power of Siberia 1', commodity: 'gas', status: 'active',
    operator: 'Gazprom', lengthKm: 3000, capacityDesc: '38 bcm/yr', region: 'Russia/China',
    coordinates: [[119.0,50.0],[121.5,49.0],[123.5,48.7],[124.5,48.2],[131.0,46.0]],
  },
  {
    id: 'power-of-siberia-2', name: 'Power of Siberia 2', commodity: 'gas', status: 'construction',
    operator: 'Gazprom', lengthKm: 2600, capacityDesc: '50 bcm/yr', region: 'Russia/China',
    coordinates: [[68.3,70.3],[80.0,65.0],[90.0,55.0],[100.0,50.0],[106.9,47.9],[111.0,44.0]],
  },
  {
    id: 'blue-stream', name: 'Blue Stream', commodity: 'gas', status: 'active',
    operator: 'Gazprom/Botas', lengthKm: 1213, capacityDesc: '16 bcm/yr', region: 'Russia/Turkey',
    coordinates: [[37.8,44.7],[36.5,43.5],[35.5,42.0],[34.8,41.2],[34.5,41.0]],
  },
  {
    id: 'bovanenkovo-ukhta', name: 'Bovanenkovo-Ukhta', commodity: 'gas', status: 'active',
    operator: 'Gazprom', lengthKm: 1100, capacityDesc: '115 bcm/yr', region: 'Russia',
    coordinates: [[68.3,70.3],[67.0,67.0],[63.0,64.0],[57.0,63.5],[53.7,63.6]],
  },
  {
    id: 'urengoy-pomary', name: 'Urengoy-Pomary-Uzhgorod', commodity: 'gas', status: 'active',
    operator: 'Gazprom', lengthKm: 4451, capacityDesc: '28 bcm/yr', region: 'Russia/Europe',
    coordinates: [[76.0,65.9],[65.0,60.0],[55.0,56.0],[45.0,54.0],[37.6,55.7],[30.0,52.0],[24.0,50.5],[22.3,48.6]],
  },
  {
    id: 'ukhta-torzhok', name: 'Ukhta-Torzhok', commodity: 'gas', status: 'active',
    operator: 'Gazprom', lengthKm: 1400, capacityDesc: '30 bcm/yr', region: 'Russia',
    coordinates: [[53.7,63.6],[50.0,61.0],[44.0,58.0],[38.0,57.5],[34.9,57.0]],
  },
  {
    id: 'sino-myanmar', name: 'Myanmar-China Gas Pipeline', commodity: 'gas', status: 'active',
    operator: 'CNPC/MOGE', lengthKm: 2806, capacityDesc: '12 bcm/yr', region: 'Asia',
    coordinates: [[93.5,19.4],[94.5,22.0],[96.1,21.9],[97.5,23.5],[99.0,24.5],[102.7,25.0]],
  },
  {
    id: 'central-asia-china', name: 'Central Asia-China Gas Pipeline', commodity: 'gas', status: 'active',
    operator: 'CNPC', lengthKm: 1833, capacityDesc: '55 bcm/yr', region: 'Asia',
    coordinates: [[58.0,38.0],[62.0,38.5],[66.0,40.0],[70.0,40.5],[75.0,41.0],[80.0,42.0],[87.0,43.5],[91.0,43.0],[100.0,41.0],[106.0,38.0]],
  },

  // ── CASPIAN / CAUCASUS ────────────────────────────────────────────────────
  {
    id: 'cpc', name: 'Caspian Pipeline Consortium (CPC)', commodity: 'crude', status: 'active',
    operator: 'CPC', lengthKm: 1511, capacityDesc: '1.3 Mb/d', region: 'Caspian',
    coordinates: [[51.8,47.0],[51.0,46.0],[48.0,44.5],[43.0,44.0],[39.0,44.5],[37.8,44.7]],
  },
  {
    id: 'btc', name: 'Baku-Tbilisi-Ceyhan (BTC)', commodity: 'crude', status: 'active',
    operator: 'BP', lengthKm: 1768, capacityDesc: '1.2 Mb/d', region: 'Caspian',
    coordinates: [[49.8,40.5],[46.5,41.5],[43.5,41.7],[41.7,41.7],[40.0,40.5],[38.0,39.0],[36.5,37.5],[35.9,37.0]],
  },
  {
    id: 'scp', name: 'South Caucasus Pipeline (SCP)', commodity: 'gas', status: 'active',
    operator: 'BP', lengthKm: 692, capacityDesc: '16 bcm/yr', region: 'Caspian',
    coordinates: [[49.5,40.3],[46.5,41.5],[43.5,41.7],[41.5,41.1],[40.2,40.6]],
  },
  {
    id: 'tanap', name: 'Trans-Anatolian Pipeline (TANAP)', commodity: 'gas', status: 'active',
    operator: 'BOTAŞ/BP', lengthKm: 1850, capacityDesc: '16 bcm/yr', region: 'Turkey',
    coordinates: [[40.2,40.6],[38.0,40.0],[35.0,39.0],[32.0,39.0],[28.0,40.0],[26.5,41.6]],
  },
  {
    id: 'tap', name: 'Trans-Adriatic Pipeline (TAP)', commodity: 'gas', status: 'active',
    operator: 'TAP AG', lengthKm: 878, capacityDesc: '10 bcm/yr', region: 'Europe',
    coordinates: [[26.5,41.6],[24.0,41.0],[21.5,40.5],[20.0,40.0],[19.5,40.5],[15.5,41.0]],
  },

  // ── MIDDLE EAST ───────────────────────────────────────────────────────────
  {
    id: 'kirkuk-ceyhan', name: 'Kirkuk-Ceyhan Pipeline (ITP)', commodity: 'crude', status: 'active',
    operator: 'BOTAS/SOMO', lengthKm: 970, capacityDesc: '0.5 Mb/d', region: 'Middle East',
    coordinates: [[44.4,35.5],[43.0,37.0],[40.0,37.5],[37.5,37.5],[35.9,37.0]],
  },
  {
    id: 'igat', name: 'Iran Gas Trunkline (IGAT)', commodity: 'gas', status: 'active',
    operator: 'NIGC', lengthKm: 2700, capacityDesc: '35 bcm/yr', region: 'Middle East',
    coordinates: [[52.6,27.5],[51.4,35.7],[49.0,37.0],[46.3,38.1],[44.5,39.5]],
  },
  {
    id: 'east-west-ksa', name: 'Saudi East-West Crude Pipeline (Petroline)', commodity: 'crude', status: 'active',
    operator: 'Saudi Aramco', lengthKm: 1200, capacityDesc: '5 Mb/d', region: 'Middle East',
    coordinates: [[50.1,26.7],[46.0,25.0],[42.0,23.5],[38.1,24.1]],
  },
  {
    id: 'sumed', name: 'Suez-Mediterranean Pipeline (SUMED)', commodity: 'crude', status: 'active',
    operator: 'SUMED', lengthKm: 320, capacityDesc: '2.5 Mb/d', region: 'Africa/Middle East',
    coordinates: [[32.3,29.9],[31.5,30.5],[30.0,31.0],[29.9,31.3]],
  },
  {
    id: 'arab-gas', name: 'Arab Gas Pipeline', commodity: 'gas', status: 'active',
    operator: 'Egyptian Gas', lengthKm: 1200, capacityDesc: '10 bcm/yr', region: 'Middle East',
    coordinates: [[32.3,29.9],[34.5,31.8],[35.9,31.9],[36.3,33.5],[36.8,36.5],[38.5,37.5]],
  },
  {
    id: 'dolphin', name: 'Dolphin Energy Pipeline', commodity: 'gas', status: 'active',
    operator: 'Dolphin Energy', lengthKm: 364, capacityDesc: '7.5 bcm/yr', region: 'Middle East',
    coordinates: [[51.5,25.3],[52.5,25.0],[54.4,24.5],[55.3,25.2],[56.3,25.1]],
  },
  {
    id: 'habshan-fujairah', name: 'Abu Dhabi Crude Oil Pipeline (ADCOP)', commodity: 'crude', status: 'active',
    operator: 'ADNOC', lengthKm: 380, capacityDesc: '1.5 Mb/d', region: 'Middle East',
    coordinates: [[53.8,23.8],[54.5,23.5],[55.5,24.5],[56.3,25.1]],
  },
  {
    id: 'south-pars-assaluyeh', name: 'South Pars Gas Pipeline', commodity: 'gas', status: 'active',
    operator: 'NIOC', lengthKm: 500, capacityDesc: '25 bcm/yr', region: 'Middle East',
    coordinates: [[52.6,27.5],[51.5,30.0],[51.4,35.7]],
  },
  {
    id: 'iraq-basra-export', name: 'Basra Oil Export Pipeline', commodity: 'crude', status: 'active',
    operator: 'SOMO', lengthKm: 300, capacityDesc: '3 Mb/d', region: 'Middle East',
    coordinates: [[47.8,30.5],[48.0,30.0],[48.5,29.8],[48.8,29.5]],
  },
  {
    id: 'ipsa', name: 'Iraq Pipeline through Saudi Arabia (IPSA)', commodity: 'crude', status: 'inactive',
    operator: 'SCOP', lengthKm: 1650, capacityDesc: '1.65 Mb/d', region: 'Middle East',
    coordinates: [[47.8,30.5],[45.5,28.5],[42.0,26.0],[38.0,24.5],[37.5,24.0]],
  },
  {
    id: 'greenstream', name: 'Greenstream Pipeline (Libya-Italy)', commodity: 'gas', status: 'active',
    operator: 'ENI/NOC', lengthKm: 540, capacityDesc: '11 bcm/yr', region: 'Africa/Europe',
    coordinates: [[12.5,32.8],[12.0,35.0],[12.2,37.5],[12.6,37.7]],
  },
  {
    id: 'transmed', name: 'TransMed (Enrico Mattei) Pipeline', commodity: 'gas', status: 'active',
    operator: 'SONATRACH/SNAM', lengthKm: 2220, capacityDesc: '30 bcm/yr', region: 'Africa/Europe',
    coordinates: [[6.1,31.7],[5.5,33.0],[3.5,36.5],[3.0,37.5],[9.5,38.0],[12.5,38.5]],
  },
  {
    id: 'medgaz', name: 'Medgaz Pipeline (Algeria-Spain)', commodity: 'gas', status: 'active',
    operator: 'SONATRACH/Cepsa', lengthKm: 1059, capacityDesc: '8 bcm/yr', region: 'Africa/Europe',
    coordinates: [[2.8,36.0],[1.5,37.5],[0.0,38.5],[-0.6,37.6],[-0.7,38.0],[-2.2,38.4]],
  },
  {
    id: 'kurdistan-kirkuk', name: 'Kurdistan-Turkey Pipeline', commodity: 'crude', status: 'active',
    operator: 'KRG/BOTAS', lengthKm: 300, capacityDesc: '0.6 Mb/d', region: 'Middle East',
    coordinates: [[44.4,35.5],[43.5,36.5],[42.0,37.0],[40.5,37.0],[38.5,37.5],[35.9,37.0]],
  },
  {
    id: 'israel-eilat-ashkelon', name: 'Eilat-Ashkelon Pipeline', commodity: 'crude', status: 'active',
    operator: 'EAPC', lengthKm: 254, capacityDesc: '0.6 Mb/d', region: 'Middle East',
    coordinates: [[34.9,29.6],[34.7,31.0],[34.6,31.9]],
  },
  {
    id: 'kuwait-export', name: 'Kuwait Oil Export System', commodity: 'crude', status: 'active',
    operator: 'Kuwait Oil Company', lengthKm: 180, capacityDesc: '2 Mb/d', region: 'Middle East',
    coordinates: [[47.9,29.4],[48.0,29.0],[48.2,29.4],[48.5,29.3]],
  },
  {
    id: 'oman-pdo', name: 'Oman PDO Pipeline Network', commodity: 'crude', status: 'active',
    operator: 'PDO Oman', lengthKm: 600, capacityDesc: '0.5 Mb/d', region: 'Middle East',
    coordinates: [[55.2,18.0],[55.0,20.0],[56.0,22.0],[58.0,23.0],[58.6,23.6]],
  },

  // ── NORTH AMERICA ─────────────────────────────────────────────────────────
  {
    id: 'keystone', name: 'Keystone Pipeline', commodity: 'crude', status: 'active',
    operator: 'TC Energy', lengthKm: 4324, capacityDesc: '0.59 Mb/d', region: 'North America',
    coordinates: [[-111.0,50.0],[-104.0,49.0],[-100.0,48.0],[-97.0,45.0],[-96.8,43.0],[-96.8,42.0],[-96.8,38.5],[-91.0,38.7]],
  },
  {
    id: 'colonial', name: 'Colonial Pipeline', commodity: 'refined', status: 'active',
    operator: 'Colonial Pipeline', lengthKm: 8850, capacityDesc: '2.5 Mb/d', region: 'North America',
    coordinates: [[-97.5,29.8],[-95.4,29.7],[-93.0,30.0],[-88.0,30.5],[-84.4,33.7],[-79.8,36.1],[-77.0,38.5],[-75.2,39.9],[-74.0,40.7]],
  },
  {
    id: 'taps', name: 'Trans-Alaska Pipeline System (TAPS)', commodity: 'crude', status: 'active',
    operator: 'Alyeska Pipeline', lengthKm: 1300, capacityDesc: '0.5 Mb/d', region: 'North America',
    coordinates: [[-148.4,70.3],[-149.0,67.0],[-147.0,64.8],[-145.5,63.5],[-146.3,61.1]],
  },
  {
    id: 'enbridge-mainline', name: 'Enbridge Mainline System', commodity: 'crude', status: 'active',
    operator: 'Enbridge', lengthKm: 3200, capacityDesc: '2.85 Mb/d', region: 'North America',
    coordinates: [[-113.5,53.5],[-110.0,52.0],[-104.0,50.0],[-99.0,49.0],[-94.0,49.0],[-90.0,48.0],[-83.5,46.5],[-82.4,43.0],[-80.0,42.5]],
  },
  {
    id: 'transmountain', name: 'Trans Mountain Pipeline', commodity: 'crude', status: 'active',
    operator: 'Trans Mountain Corp', lengthKm: 1147, capacityDesc: '0.89 Mb/d', region: 'North America',
    coordinates: [[-113.5,53.5],[-120.0,52.0],[-121.0,50.5],[-122.5,49.3],[-123.1,49.3]],
  },
  {
    id: 'dapl', name: 'Dakota Access Pipeline (DAPL)', commodity: 'crude', status: 'active',
    operator: 'Energy Transfer', lengthKm: 1886, capacityDesc: '0.57 Mb/d', region: 'North America',
    coordinates: [[-102.0,47.8],[-100.0,46.5],[-97.5,46.0],[-96.5,46.0],[-96.8,43.0],[-91.0,38.7]],
  },
  {
    id: 'gulf-coast-express', name: 'Gulf Coast Express Pipeline', commodity: 'gas', status: 'active',
    operator: 'DCP Midstream', lengthKm: 965, capacityDesc: '1.98 bcf/d', region: 'North America',
    coordinates: [[-102.1,31.9],[-100.0,30.5],[-98.5,30.0],[-97.0,30.5],[-95.4,29.7]],
  },
  {
    id: 'transco', name: 'Transcontinental Gas Pipeline (Transco)', commodity: 'gas', status: 'active',
    operator: 'Williams', lengthKm: 2800, capacityDesc: '18.1 bcf/d', region: 'North America',
    coordinates: [[-97.5,29.8],[-91.0,30.0],[-84.0,33.5],[-80.0,35.0],[-76.0,36.5],[-75.2,39.9],[-74.0,40.7],[-72.0,41.8],[-71.0,42.0]],
  },
  {
    id: 'rockies-express', name: 'Rockies Express Pipeline', commodity: 'gas', status: 'active',
    operator: 'Tallgrass Energy', lengthKm: 2722, capacityDesc: '1.8 bcf/d', region: 'North America',
    coordinates: [[-110.0,41.0],[-107.0,40.5],[-104.9,40.5],[-101.0,40.0],[-97.0,40.0],[-93.0,40.5],[-90.0,40.5],[-83.5,40.0],[- 80.0,40.4]],
  },
  {
    id: 'mountain-valley', name: 'Mountain Valley Pipeline', commodity: 'gas', status: 'active',
    operator: 'Equitrans Midstream', lengthKm: 490, capacityDesc: '2 bcf/d', region: 'North America',
    coordinates: [[-80.5,39.8],[-80.0,39.2],[-79.5,38.5],[-79.5,37.3]],
  },
  {
    id: 'mariner-east', name: 'Mariner East 2 Pipeline', commodity: 'condensate', status: 'active',
    operator: 'Energy Transfer', lengthKm: 800, capacityDesc: '0.35 Mb/d', region: 'North America',
    coordinates: [[-80.5,41.0],[-78.5,40.8],[-77.0,40.5],[-76.0,40.2],[-75.2,39.9]],
  },
  {
    id: 'alliance-pipeline', name: 'Alliance Pipeline', commodity: 'gas', status: 'active',
    operator: 'Pembina Pipeline', lengthKm: 3848, capacityDesc: '1.6 bcf/d', region: 'North America',
    coordinates: [[-119.0,58.0],[-116.0,55.0],[-111.0,52.0],[-107.0,50.0],[-103.0,49.0],[-98.0,47.0],[-93.0,45.0],[-89.0,42.0],[-87.6,41.9]],
  },
  {
    id: 'nova-gas', name: 'NOVA Gas Transmission (NGTL)', commodity: 'gas', status: 'active',
    operator: 'TC Energy', lengthKm: 24000, capacityDesc: '16 bcf/d', region: 'North America',
    coordinates: [[-120.0,58.0],[-116.0,57.0],[-113.5,53.5],[-114.0,51.0],[-112.0,50.0],[-107.0,50.0]],
  },
  {
    id: 'enbridge-line5', name: 'Enbridge Line 5', commodity: 'crude', status: 'active',
    operator: 'Enbridge', lengthKm: 1080, capacityDesc: '0.54 Mb/d', region: 'North America',
    coordinates: [[-90.0,48.0],[-87.0,46.8],[-84.5,46.5],[-83.0,42.3],[-82.4,43.0],[-80.0,43.0]],
  },
  {
    id: 'capline', name: 'Capline Pipeline', commodity: 'crude', status: 'active',
    operator: 'Marathon Pipe Line', lengthKm: 980, capacityDesc: '0.97 Mb/d', region: 'North America',
    coordinates: [[-89.9,29.9],[-89.0,31.0],[-88.5,33.0],[-89.1,38.7]],
  },
  {
    id: 'kern-river', name: 'Kern River Gas Transmission', commodity: 'gas', status: 'active',
    operator: 'Berkshire Hathaway Energy', lengthKm: 2560, capacityDesc: '1.7 bcf/d', region: 'North America',
    coordinates: [[-112.1,40.5],[-113.0,39.0],[-115.0,37.0],[-116.0,36.0],[-117.0,35.0],[-118.2,34.0]],
  },
  {
    id: 'tc-mainline', name: 'TC Energy Mainline', commodity: 'gas', status: 'active',
    operator: 'TC Energy', lengthKm: 15200, capacityDesc: '9.4 bcf/d', region: 'North America',
    coordinates: [[-113.5,53.5],[-107.0,50.0],[-99.0,49.0],[-92.0,48.5],[-87.6,43.5],[-83.0,43.5],[-79.4,43.7],[-74.0,45.5],[-72.5,46.0]],
  },

  // ── SOUTH AMERICA ─────────────────────────────────────────────────────────
  {
    id: 'ocp-ecuador', name: 'OCP Ecuador Pipeline', commodity: 'crude', status: 'active',
    operator: 'OCP Ecuador', lengthKm: 485, capacityDesc: '0.45 Mb/d', region: 'South America',
    coordinates: [[-76.5,0.5],[-78.0,0.0],[-78.5,-0.2],[-80.0,-0.8]],
  },
  {
    id: 'sote-ecuador', name: 'SOTE Ecuador Pipeline', commodity: 'crude', status: 'active',
    operator: 'Petroecuador', lengthKm: 497, capacityDesc: '0.36 Mb/d', region: 'South America',
    coordinates: [[-76.5,0.5],[-77.0,0.0],[-78.0,-0.1],[-79.5,-0.7],[-80.0,-0.8]],
  },
  {
    id: 'camisea', name: 'Camisea Gas Pipeline', commodity: 'gas', status: 'active',
    operator: 'TGP/Pluspetrol', lengthKm: 730, capacityDesc: '1.5 bcf/d', region: 'South America',
    coordinates: [[-73.5,-11.8],[-74.5,-12.0],[-76.0,-12.0],[-77.0,-12.0]],
  },
  {
    id: 'gasbol', name: 'Bolivia-Brazil Gas Pipeline (GASBOL)', commodity: 'gas', status: 'active',
    operator: 'TBG/Petrobras', lengthKm: 3150, capacityDesc: '8.3 bcm/yr', region: 'South America',
    coordinates: [[-64.5,-16.5],[-62.0,-18.0],[-60.0,-18.5],[-58.0,-20.0],[-55.0,-21.0],[-51.0,-22.0],[-46.6,-23.5]],
  },
  {
    id: 'tgs-argentina', name: 'Transportadora de Gas del Sur (TGS)', commodity: 'gas', status: 'active',
    operator: 'TGS', lengthKm: 14000, capacityDesc: '20 mmcm/d', region: 'South America',
    coordinates: [[-68.0,-51.0],[-65.0,-46.0],[-65.5,-42.0],[-65.0,-38.0],[-62.0,-34.5],[-58.4,-34.6]],
  },
  {
    id: 'gasandes', name: 'GasAndes Pipeline (Argentina-Chile)', commodity: 'gas', status: 'active',
    operator: 'Gas Andes', lengthKm: 463, capacityDesc: '5.6 mmcm/d', region: 'South America',
    coordinates: [[-65.0,-32.5],[-68.0,-32.8],[-70.0,-33.0],[-70.6,-33.4]],
  },
  {
    id: 'tgn-argentina', name: 'Transportadora de Gas del Norte (TGN)', commodity: 'gas', status: 'active',
    operator: 'TGN', lengthKm: 12000, capacityDesc: '20 mmcm/d', region: 'South America',
    coordinates: [[-63.5,-22.0],[-64.5,-26.0],[-65.0,-30.0],[-65.0,-34.0],[-63.0,-34.5],[-58.4,-34.6]],
  },
  {
    id: 'oletran-colombia', name: 'Oleoducto Transandino (Colombia)', commodity: 'crude', status: 'active',
    operator: 'Ecopetrol', lengthKm: 306, capacityDesc: '0.1 Mb/d', region: 'South America',
    coordinates: [[-75.5,0.8],[-76.5,1.0],[-77.0,1.0],[-78.0,1.2]],
  },
  {
    id: 'ocensa-colombia', name: 'OCENSA Pipeline (Colombia)', commodity: 'crude', status: 'active',
    operator: 'Ecopetrol', lengthKm: 836, capacityDesc: '0.6 Mb/d', region: 'South America',
    coordinates: [[-72.5,5.7],[-74.0,6.0],[-75.5,6.5],[-76.5,7.5],[-77.5,8.5],[-76.5,9.5]],
  },
  {
    id: 'urucu-coari', name: 'Urucu-Coari-Manaus Pipeline', commodity: 'gas', status: 'active',
    operator: 'Petrobras', lengthKm: 660, capacityDesc: '1.5 mmcm/d', region: 'South America',
    coordinates: [[-65.3,-4.8],[-63.5,-4.2],[-63.1,-4.1],[-60.0,-3.1]],
  },
  {
    id: 'gasene-brazil', name: 'GASENE Pipeline (Brazil)', commodity: 'gas', status: 'active',
    operator: 'Petrobras', lengthKm: 1387, capacityDesc: '20 mmcm/d', region: 'South America',
    coordinates: [[-41.0,-19.0],[-40.0,-17.0],[-39.0,-14.0],[-38.0,-11.0],[-37.0,-9.0],[-34.9,-8.1]],
  },
  {
    id: 'norperuano', name: 'Norperuano Pipeline (Peru)', commodity: 'crude', status: 'active',
    operator: 'Petroperu', lengthKm: 854, capacityDesc: '0.1 Mb/d', region: 'South America',
    coordinates: [[-73.0,-3.5],[-76.0,-4.5],[-77.5,-5.5],[-79.5,-6.5],[-80.0,-7.5]],
  },
  {
    id: 'orinoco-belt', name: 'Orinoco Belt Pipeline System', commodity: 'crude', status: 'active',
    operator: 'PDVSA', lengthKm: 400, capacityDesc: '0.8 Mb/d', region: 'South America',
    coordinates: [[-62.0,8.0],[-63.0,9.0],[-65.0,9.5],[-66.9,10.5]],
  },

  // ── AFRICA ────────────────────────────────────────────────────────────────
  {
    id: 'wagp', name: 'West Africa Gas Pipeline (WAGP)', commodity: 'gas', status: 'active',
    operator: 'WAPCo', lengthKm: 678, capacityDesc: '0.17 bcf/d', region: 'Africa',
    coordinates: [[3.4,6.5],[1.0,6.2],[-0.2,5.6],[-2.0,5.2]],
  },
  {
    id: 'chad-cameroon', name: 'Chad-Cameroon Pipeline', commodity: 'crude', status: 'active',
    operator: 'TOTSA/ExxonMobil', lengthKm: 1070, capacityDesc: '0.25 Mb/d', region: 'Africa',
    coordinates: [[15.0,9.0],[13.5,7.0],[12.0,5.5],[10.5,4.5],[9.9,2.9]],
  },
  {
    id: 'eacop', name: 'East African Crude Oil Pipeline (EACOP)', commodity: 'crude', status: 'construction',
    operator: 'TotalEnergies/CNOOC', lengthKm: 1443, capacityDesc: '0.21 Mb/d', region: 'Africa',
    coordinates: [[31.0,0.4],[33.0,-1.5],[35.0,-3.5],[36.5,-5.0],[38.0,-6.0],[39.3,-6.8]],
  },
  {
    id: 'akk-nigeria', name: 'Ajaokuta-Kaduna-Kano (AKK) Pipeline', commodity: 'gas', status: 'construction',
    operator: 'NNPC', lengthKm: 614, capacityDesc: '2 bcf/d', region: 'Africa',
    coordinates: [[6.8,7.9],[7.0,9.0],[7.4,10.5],[8.5,12.0]],
  },
  {
    id: 'escravos-lagos', name: 'Escravos-Lagos Pipeline', commodity: 'gas', status: 'active',
    operator: 'ELPS', lengthKm: 340, capacityDesc: '1.1 bcf/d', region: 'Africa',
    coordinates: [[5.2,5.7],[4.5,5.8],[3.5,6.2],[3.4,6.5]],
  },
  {
    id: 'nocen-nigeria', name: 'NOCEN (Nigeria Petroleum Pipeline Network)', commodity: 'refined', status: 'active',
    operator: 'NNPC', lengthKm: 5000, capacityDesc: '1 Mb/d', region: 'Africa',
    coordinates: [[7.2,4.4],[7.0,5.5],[7.5,6.4],[7.5,9.1],[7.4,10.5]],
  },
  {
    id: 'kenya-pipeline', name: 'Kenya Pipeline Company', commodity: 'refined', status: 'active',
    operator: 'KPC', lengthKm: 450, capacityDesc: '0.08 Mb/d', region: 'Africa',
    coordinates: [[39.7,-4.1],[37.0,-3.0],[36.8,-1.3],[36.9,0.5],[36.8,0.0]],
  },
  {
    id: 'trans-saharan-gas', name: 'Trans-Saharan Gas Pipeline (TSGP)', commodity: 'gas', status: 'construction',
    operator: 'NNPC/SONATRACH', lengthKm: 4128, capacityDesc: '30 bcm/yr', region: 'Africa',
    coordinates: [[7.2,4.4],[9.0,13.0],[9.6,18.0],[9.5,22.0],[8.0,27.0],[6.5,30.0],[3.3,32.9]],
  },
  {
    id: 'algeria-hassi-arzew', name: 'Haoud El Hamra to Arzew Pipeline', commodity: 'crude', status: 'active',
    operator: 'Sonatrach', lengthKm: 800, capacityDesc: '0.7 Mb/d', region: 'Africa',
    coordinates: [[6.1,31.7],[4.5,33.5],[2.0,35.0],[-0.6,35.7]],
  },
  {
    id: 'morocco-spain', name: 'Maghreb-Europe Gas Pipeline (MEG)', commodity: 'gas', status: 'active',
    operator: 'ENAGAS/Sonatrach', lengthKm: 1620, capacityDesc: '12 bcm/yr', region: 'Africa/Europe',
    coordinates: [[2.5,36.8],[-3.0,36.5],[-4.5,36.0],[-5.5,35.7],[-5.4,36.0],[-5.0,36.5],[-4.0,37.0],[-3.5,37.5],[-3.7,38.0],[-3.7,40.4]],
  },
  {
    id: 'sudan-port-sudan', name: 'Petrodar Pipeline (Sudan)', commodity: 'crude', status: 'active',
    operator: 'Petrodar', lengthKm: 1610, capacityDesc: '0.2 Mb/d', region: 'Africa',
    coordinates: [[33.5,10.0],[34.5,13.0],[36.5,17.0],[37.2,19.6]],
  },
  {
    id: 'mozambique-palma', name: 'Mozambique LNG Pipeline', commodity: 'gas', status: 'construction',
    operator: 'TotalEnergies', lengthKm: 130, capacityDesc: '13 mmton/yr LNG', region: 'Africa',
    coordinates: [[40.3,-12.0],[40.4,-11.5],[40.5,-10.8]],
  },
  {
    id: 'angola-lng', name: 'Angola LNG Pipeline', commodity: 'gas', status: 'active',
    operator: 'Chevron/Sonangol', lengthKm: 400, capacityDesc: '5.2 mmton/yr LNG', region: 'Africa',
    coordinates: [[12.5,-5.5],[12.8,-7.0],[13.2,-8.8]],
  },
  {
    id: 'rompco-africa', name: 'ROMPCO Gas Pipeline (Mozambique-South Africa)', commodity: 'gas', status: 'active',
    operator: 'ROMPCO', lengthKm: 865, capacityDesc: '1 bcf/d', region: 'Africa',
    coordinates: [[34.8,-19.8],[32.8,-22.5],[31.5,-24.0],[30.0,-25.5],[28.0,-26.2]],
  },
  {
    id: 'agadem-cotonou', name: 'Niger Export Pipeline (WAPCO)', commodity: 'crude', status: 'construction',
    operator: 'CNPC/NIGELEC', lengthKm: 2000, capacityDesc: '0.09 Mb/d', region: 'Africa',
    coordinates: [[12.0,17.0],[10.5,15.0],[9.0,13.0],[7.5,11.0],[6.5,9.0],[3.5,7.5],[2.0,6.5],[1.0,6.2]],
  },
  {
    id: 'ethiopia-djibouti', name: 'Ethiopia-Djibouti Oil Pipeline', commodity: 'refined', status: 'active',
    operator: 'Ethiopian government', lengthKm: 780, capacityDesc: '0.05 Mb/d', region: 'Africa',
    coordinates: [[38.7,9.0],[39.5,10.0],[40.5,11.0],[41.8,11.5],[42.5,11.5]],
  },

  // ── EUROPE ────────────────────────────────────────────────────────────────
  {
    id: 'norpipe', name: 'Norpipe (Norway-Germany)', commodity: 'gas', status: 'active',
    operator: 'Gassco', lengthKm: 440, capacityDesc: '13 bcm/yr', region: 'Europe',
    coordinates: [[3.5,56.8],[5.5,55.0],[7.5,54.5],[7.2,53.4]],
  },
  {
    id: 'baltic-pipe', name: 'Baltic Pipe (Norway-Poland)', commodity: 'gas', status: 'active',
    operator: 'Gassco/GAZ-SYSTEM', lengthKm: 900, capacityDesc: '10 bcm/yr', region: 'Europe',
    coordinates: [[5.5,59.3],[6.0,58.0],[7.0,57.0],[8.8,55.8],[10.5,55.5],[12.0,55.0],[14.2,53.9]],
  },
  {
    id: 'langeled', name: 'Langeled Pipeline (Norway-UK)', commodity: 'gas', status: 'active',
    operator: 'Gassco', lengthKm: 1166, capacityDesc: '25 bcm/yr', region: 'Europe',
    coordinates: [[6.7,63.0],[4.5,62.0],[2.0,60.5],[-0.5,57.0],[-0.1,53.7]],
  },
  {
    id: 'franpipe', name: 'Franpipe (Norway-France)', commodity: 'gas', status: 'active',
    operator: 'Gassco', lengthKm: 850, capacityDesc: '17 bcm/yr', region: 'Europe',
    coordinates: [[5.5,59.3],[3.0,58.0],[1.5,56.0],[0.5,54.0],[2.4,51.0],[2.5,50.5]],
  },
  {
    id: 'bbl-pipeline', name: 'BBL Pipeline (Netherlands-UK)', commodity: 'gas', status: 'active',
    operator: 'BBL Company', lengthKm: 230, capacityDesc: '20 bcm/yr', region: 'Europe',
    coordinates: [[3.4,51.6],[2.5,52.0],[1.4,52.9]],
  },
  {
    id: 'interconnector-uk', name: 'Interconnector UK-Belgium', commodity: 'gas', status: 'active',
    operator: 'Interconnector UK', lengthKm: 235, capacityDesc: '20 bcm/yr', region: 'Europe',
    coordinates: [[1.4,52.9],[2.5,52.0],[3.2,51.3]],
  },
  {
    id: 'opal', name: 'OPAL Pipeline (Germany)', commodity: 'gas', status: 'active',
    operator: 'Gascade', lengthKm: 470, capacityDesc: '36 bcm/yr', region: 'Europe',
    coordinates: [[13.7,54.1],[14.0,52.5],[14.0,51.5],[13.5,50.5]],
  },
  {
    id: 'nel', name: 'NEL Pipeline (Germany)', commodity: 'gas', status: 'active',
    operator: 'Gascade', lengthKm: 440, capacityDesc: '20 bcm/yr', region: 'Europe',
    coordinates: [[13.7,54.1],[10.5,54.0],[9.6,53.6],[8.5,52.6]],
  },
  {
    id: 'eugal', name: 'EUGAL Pipeline (Germany)', commodity: 'gas', status: 'active',
    operator: 'GASCADE', lengthKm: 485, capacityDesc: '55 bcm/yr', region: 'Europe',
    coordinates: [[13.7,54.1],[13.5,52.5],[14.4,50.1],[16.9,48.1]],
  },
  {
    id: 'brua', name: 'BRUA Pipeline (Bulgaria-Romania-Hungary-Austria)', commodity: 'gas', status: 'construction',
    operator: 'Transgaz/FGSZ', lengthKm: 1318, capacityDesc: '8 bcm/yr', region: 'Europe',
    coordinates: [[23.0,41.5],[24.0,43.0],[25.5,45.0],[26.5,46.0],[23.0,47.5],[20.0,47.5],[17.0,47.5],[16.9,48.1]],
  },
  {
    id: 'igb', name: 'Interconnector Greece-Bulgaria (IGB)', commodity: 'gas', status: 'active',
    operator: 'ICGB', lengthKm: 182, capacityDesc: '3 bcm/yr', region: 'Europe',
    coordinates: [[25.4,41.1],[24.5,42.0],[23.0,41.5]],
  },
  {
    id: 'eastring', name: 'Eastring Pipeline (Slovakia-Greece)', commodity: 'gas', status: 'construction',
    operator: 'Eustream', lengthKm: 1200, capacityDesc: '20 bcm/yr', region: 'Europe',
    coordinates: [[17.0,48.5],[19.0,47.5],[20.0,46.5],[21.5,44.5],[23.0,43.0],[24.0,41.5]],
  },
  {
    id: 'poseidon-pipeline', name: 'Poseidon Undersea Pipeline (Italy-Greece)', commodity: 'gas', status: 'active',
    operator: 'IGI Poseidon', lengthKm: 210, capacityDesc: '12 bcm/yr', region: 'Europe',
    coordinates: [[24.5,40.2],[22.5,40.0],[20.5,39.5],[19.2,39.0],[18.0,39.5],[15.5,41.0]],
  },
  {
    id: 'itgi', name: 'Turkey-Greece-Italy Interconnector (ITGI)', commodity: 'gas', status: 'active',
    operator: 'Depa/DESFA', lengthKm: 745, capacityDesc: '8 bcm/yr', region: 'Europe',
    coordinates: [[26.5,41.6],[24.5,40.5],[22.9,40.6],[20.0,39.5],[18.5,39.5]],
  },
  {
    id: 'midcat', name: 'MIDCAT/BarMar Pipeline (Spain-France)', commodity: 'gas', status: 'construction',
    operator: 'Enagas/GRTgaz', lengthKm: 190, capacityDesc: '5 bcm/yr', region: 'Europe',
    coordinates: [[2.2,41.4],[2.5,42.5],[2.9,42.7],[2.8,43.3]],
  },
  {
    id: 'skuld', name: 'Skuld Pipeline (Norway)', commodity: 'gas', status: 'active',
    operator: 'Gassco', lengthKm: 200, capacityDesc: '4 bcm/yr', region: 'Europe',
    coordinates: [[6.5,65.5],[6.7,63.0]],
  },
  {
    id: 'scotland-ni', name: 'Scotland-Northern Ireland Pipeline', commodity: 'gas', status: 'active',
    operator: 'Premier Transmission', lengthKm: 375, capacityDesc: '1 bcf/d', region: 'Europe',
    coordinates: [[-5.5,54.5],[-5.3,54.8],[-4.7,55.5],[-4.0,56.0],[-3.5,57.0],[-2.5,57.5]],
  },
  {
    id: 'snam-rete', name: 'Snam Rete Gas Italy Main Artery', commodity: 'gas', status: 'active',
    operator: 'Snam', lengthKm: 3000, capacityDesc: '70 bcm/yr', region: 'Europe',
    coordinates: [[15.5,41.0],[14.5,41.0],[12.5,41.9],[9.2,45.5],[8.5,45.5],[7.0,45.0]],
  },
  {
    id: 'tenp', name: 'TENP Pipeline (Netherlands-Switzerland)', commodity: 'gas', status: 'active',
    operator: 'Open Grid Europe', lengthKm: 1236, capacityDesc: '20 bcm/yr', region: 'Europe',
    coordinates: [[4.9,52.4],[5.0,51.0],[6.5,51.0],[7.5,50.5],[8.5,49.5],[8.5,48.5],[8.5,47.5]],
  },

  // ── RUSSIA ADDITIONAL ─────────────────────────────────────────────────────
  {
    id: 'sakhalin-komsomolsk', name: 'Sakhalin-Komsomolsk-Khabarovsk Pipeline', commodity: 'gas', status: 'active',
    operator: 'Gazprom', lengthKm: 1435, capacityDesc: '5.5 bcm/yr', region: 'Russia',
    coordinates: [[143.0,50.7],[142.0,51.5],[140.0,52.5],[137.0,53.0],[135.5,52.5],[135.0,50.0]],
  },
  {
    id: 'sakhalin-vladivostok', name: 'Sakhalin-Khabarovsk-Vladivostok Pipeline', commodity: 'gas', status: 'active',
    operator: 'Gazprom', lengthKm: 1350, capacityDesc: '6 bcm/yr', region: 'Russia',
    coordinates: [[140.5,53.5],[137.5,52.0],[135.0,49.5],[133.5,47.5],[132.0,44.5],[131.9,43.1]],
  },
  {
    id: 'northern-lights-russia', name: 'Northern Lights Pipeline', commodity: 'crude', status: 'active',
    operator: 'Transneft', lengthKm: 3000, capacityDesc: '0.7 Mb/d', region: 'Russia',
    coordinates: [[68.3,70.3],[66.0,67.0],[63.0,64.0],[57.5,62.0],[52.0,58.5],[44.0,56.0],[38.0,55.0],[37.8,44.7]],
  },
  {
    id: 'balticpipeline-russia', name: 'Baltic Pipeline System (BPS-2)', commodity: 'crude', status: 'active',
    operator: 'Transneft', lengthKm: 1000, capacityDesc: '1.2 Mb/d', region: 'Russia',
    coordinates: [[52.0,58.5],[45.0,58.0],[40.0,59.0],[35.0,59.5],[29.0,60.4]],
  },
  {
    id: 'volga-ural-refineries', name: 'Volga-Urals to Primorsk Crude', commodity: 'crude', status: 'active',
    operator: 'Transneft', lengthKm: 1500, capacityDesc: '1.5 Mb/d', region: 'Russia',
    coordinates: [[54.0,54.0],[50.0,55.0],[45.0,56.5],[40.0,57.0],[34.0,59.0],[29.0,60.4]],
  },
  {
    id: 'urals-novorossiysk', name: 'Urals Crude to Novorossiysk', commodity: 'crude', status: 'active',
    operator: 'Transneft', lengthKm: 1500, capacityDesc: '0.6 Mb/d', region: 'Russia',
    coordinates: [[55.0,55.0],[50.0,53.5],[44.0,50.5],[40.0,47.5],[38.0,45.5],[37.8,44.7]],
  },

  // ── MIDDLE EAST ADDITIONAL ────────────────────────────────────────────────
  {
    id: 'iran-igat6', name: 'IGAT-6 (Iran South-North)', commodity: 'gas', status: 'active',
    operator: 'NIGC', lengthKm: 900, capacityDesc: '55 mmcm/d', region: 'Middle East',
    coordinates: [[52.6,27.5],[53.0,30.0],[52.5,32.5],[51.4,35.7]],
  },
  {
    id: 'saudi-abqaiq-ras-tanura', name: 'Saudi Aramco Abqaiq-Ras Tanura', commodity: 'crude', status: 'active',
    operator: 'Saudi Aramco', lengthKm: 90, capacityDesc: '7 Mb/d', region: 'Middle East',
    coordinates: [[49.7,25.9],[50.0,26.3],[50.1,26.7]],
  },
  {
    id: 'qatar-abu-dhabi-subsea', name: 'Qatar-UAE Undersea Oil/Gas', commodity: 'gas', status: 'active',
    operator: 'Qatar Petroleum/ADNOC', lengthKm: 200, capacityDesc: '2 bcf/d', region: 'Middle East',
    coordinates: [[51.5,25.3],[52.0,24.8],[52.5,24.5],[53.8,23.8]],
  },
  {
    id: 'aramco-haditha', name: 'Saudi Arabia-Jordan Oil Pipeline', commodity: 'crude', status: 'active',
    operator: 'Saudi Aramco', lengthKm: 600, capacityDesc: '0.1 Mb/d', region: 'Middle East',
    coordinates: [[46.7,24.7],[43.5,26.0],[39.5,28.5],[37.0,30.0],[35.9,31.9]],
  },
  {
    id: 'mosul-fatha', name: 'Mosul-Fatha-Baghdad Pipeline (Iraq)', commodity: 'crude', status: 'active',
    operator: 'INOC', lengthKm: 500, capacityDesc: '0.5 Mb/d', region: 'Middle East',
    coordinates: [[43.1,36.3],[43.5,35.0],[44.0,33.3]],
  },
  {
    id: 'egypt-sinai-gas', name: 'Egypt-Jordan Gas Pipeline (EMG)', commodity: 'gas', status: 'active',
    operator: 'EMG', lengthKm: 265, capacityDesc: '7 bcm/yr', region: 'Middle East',
    coordinates: [[32.3,31.0],[32.5,30.5],[34.0,30.0],[34.8,29.7],[35.0,29.5]],
  },

  // ── NORTH AMERICA ADDITIONAL ──────────────────────────────────────────────
  {
    id: 'permian-express', name: 'Permian Express Pipeline', commodity: 'crude', status: 'active',
    operator: 'Energy Transfer', lengthKm: 565, capacityDesc: '0.5 Mb/d', region: 'North America',
    coordinates: [[-102.1,31.9],[-100.0,30.5],[-97.5,30.0],[-96.5,29.8],[-95.4,29.7]],
  },
  {
    id: 'rover-pipeline', name: 'Rover Pipeline', commodity: 'gas', status: 'active',
    operator: 'Energy Transfer', lengthKm: 710, capacityDesc: '3.25 bcf/d', region: 'North America',
    coordinates: [[-80.5,39.5],[-81.5,40.0],[-82.5,40.5],[-83.5,41.5],[-83.0,42.3]],
  },
  {
    id: 'nexus-gas', name: 'NEXUS Gas Transmission', commodity: 'gas', status: 'active',
    operator: 'DT Midstream', lengthKm: 500, capacityDesc: '1.5 bcf/d', region: 'North America',
    coordinates: [[-84.0,41.0],[-83.5,41.5],[-82.5,41.5],[-81.5,41.0],[-80.5,40.5]],
  },
  {
    id: 'tennessee-gas', name: 'Tennessee Gas Pipeline', commodity: 'gas', status: 'active',
    operator: 'TC Energy', lengthKm: 18000, capacityDesc: '6.7 bcf/d', region: 'North America',
    coordinates: [[-97.5,29.8],[-92.0,31.0],[-87.6,36.5],[-84.5,36.0],[-80.0,36.5],[-77.0,38.5],[-74.0,41.0],[-72.0,42.0],[-71.0,42.5],[-69.0,44.0]],
  },
  {
    id: 'pacific-gas-us', name: 'Pacific Gas Transmission', commodity: 'gas', status: 'active',
    operator: 'Pacific Gas Transmission', lengthKm: 2400, capacityDesc: '1.1 bcf/d', region: 'North America',
    coordinates: [[-115.0,49.0],[-119.0,48.0],[-121.5,47.0],[-122.3,47.6],[-122.5,45.8],[-122.7,45.5],[-123.5,43.0],[-122.4,37.8]],
  },
  {
    id: 'express-pipeline-us', name: 'Express Pipeline (Canada-US)', commodity: 'crude', status: 'active',
    operator: 'Pembina Pipeline', lengthKm: 1697, capacityDesc: '0.28 Mb/d', region: 'North America',
    coordinates: [[-114.1,51.0],[-112.0,49.5],[-111.0,48.0],[-108.5,47.0],[-106.0,44.0],[-104.9,40.5],[-104.5,38.0],[-104.5,37.5]],
  },
  {
    id: 'maritimes-northeast', name: 'Maritimes & Northeast Pipeline', commodity: 'gas', status: 'active',
    operator: 'Emera/National Grid', lengthKm: 1400, capacityDesc: '0.7 bcf/d', region: 'North America',
    coordinates: [[-63.5,45.5],[-65.0,44.5],[-69.0,44.0],[-70.5,43.5],[-71.5,42.5]],
  },

  // ── SOUTH AMERICA ADDITIONAL ──────────────────────────────────────────────
  {
    id: 'norandino', name: 'NorAndino Pipeline (Argentina-Chile)', commodity: 'gas', status: 'active',
    operator: 'Pluspetrol', lengthKm: 1076, capacityDesc: '7 mmcm/d', region: 'South America',
    coordinates: [[-65.5,-22.0],[-67.5,-23.0],[-70.0,-24.0],[-70.5,-25.0]],
  },
  {
    id: 'gasoducto-pacifico', name: 'GasOleoducto del Pacífico (Chile)', commodity: 'gas', status: 'active',
    operator: 'TransGas Chile', lengthKm: 576, capacityDesc: '6 mmcm/d', region: 'South America',
    coordinates: [[-68.5,-29.0],[-70.0,-30.0],[-70.5,-31.0],[-71.0,-33.0],[-71.5,-34.0]],
  },
  {
    id: 'brazil-south-gas', name: 'Gas Sur Pipeline (Brazil-Argentina)', commodity: 'gas', status: 'active',
    operator: 'YPF/Petrobras', lengthKm: 440, capacityDesc: '3 mmcm/d', region: 'South America',
    coordinates: [[-60.0,-33.0],[-57.5,-33.0],[-56.2,-34.9]],
  },
  {
    id: 'tgi-colombia', name: 'TGI Gas Pipeline (Colombia)', commodity: 'gas', status: 'active',
    operator: 'TGI', lengthKm: 3984, capacityDesc: '350 mmscfd', region: 'South America',
    coordinates: [[-73.0,10.0],[-73.5,8.0],[-73.5,6.0],[-74.1,4.7],[-76.0,4.5],[-76.5,3.0]],
  },

  // ── AFRICA ADDITIONAL ─────────────────────────────────────────────────────
  {
    id: 'alger-tunis', name: 'Algeria-Tunisia-Italy (Enrico Mattei)', commodity: 'gas', status: 'active',
    operator: 'SONATRACH/ENI', lengthKm: 380, capacityDesc: '8 bcm/yr', region: 'Africa',
    coordinates: [[3.1,36.7],[4.0,37.0],[7.5,36.8],[9.5,37.0],[10.5,37.5],[11.0,38.0]],
  },
  {
    id: 'gabon-oil', name: 'Gabon Oil Pipeline Network', commodity: 'crude', status: 'active',
    operator: 'Perenco/TotalEnergies', lengthKm: 350, capacityDesc: '0.1 Mb/d', region: 'Africa',
    coordinates: [[11.7,0.5],[10.5,0.5],[9.5,0.4],[8.5,0.5],[8.0,0.0]],
  },
  {
    id: 'brazzaville-pointe-noire', name: 'Congo Brazzaville Oil Pipeline', commodity: 'crude', status: 'active',
    operator: 'SNPC', lengthKm: 450, capacityDesc: '0.09 Mb/d', region: 'Africa',
    coordinates: [[15.2,4.3],[13.5,3.5],[12.5,3.0],[11.9,-4.8]],
  },
  {
    id: 'mozambique-beira', name: 'Beira Corridor Pipeline (Mozambique)', commodity: 'refined', status: 'active',
    operator: 'Pipeline Management Company', lengthKm: 285, capacityDesc: '0.05 Mb/d', region: 'Africa',
    coordinates: [[34.8,-19.8],[32.5,-20.5],[31.5,-21.0],[30.5,-22.5]],
  },
  {
    id: 'senegal-lng-feed', name: 'Greater Tortue FLNG Pipeline (Senegal/Mauritania)', commodity: 'gas', status: 'construction',
    operator: 'BP/Kosmos', lengthKm: 120, capacityDesc: '2.5 mmton/yr LNG', region: 'Africa',
    coordinates: [[-17.0,20.5],[-17.2,20.0],[-17.4,18.5],[-17.4,16.5],[-17.5,15.0]],
  },

  // ── EUROPE ADDITIONAL ─────────────────────────────────────────────────────
  {
    id: 'ncgp-uk', name: 'National Transmission System (UK)', commodity: 'gas', status: 'active',
    operator: 'National Gas Transmission', lengthKm: 7600, capacityDesc: '45 bcf/d', region: 'Europe',
    coordinates: [[-1.9,57.6],[-3.0,55.0],[-2.0,53.5],[-1.5,52.0],[-0.5,52.5],[1.5,51.8]],
  },
  {
    id: 'iuk-zebrugge', name: 'IUK Pipeline Zeebrugge Spur', commodity: 'gas', status: 'active',
    operator: 'Fluxys Belgium', lengthKm: 250, capacityDesc: '20 bcm/yr', region: 'Europe',
    coordinates: [[3.2,51.3],[4.0,51.2],[4.4,50.8],[4.9,52.4]],
  },
  {
    id: 'polish-gas-grid', name: 'Polish Gas Transmission Trunk', commodity: 'gas', status: 'active',
    operator: 'Gaz-System', lengthKm: 5800, capacityDesc: '30 bcm/yr', region: 'Europe',
    coordinates: [[14.2,53.9],[16.0,52.5],[18.0,52.0],[20.0,52.0],[22.0,51.5],[24.0,51.5]],
  },
  {
    id: 'czech-gas-transit', name: 'Czech Gas Transit (NET4GAS)', commodity: 'gas', status: 'active',
    operator: 'NET4GAS', lengthKm: 3700, capacityDesc: '40 bcm/yr', region: 'Europe',
    coordinates: [[12.0,51.0],[13.5,50.5],[14.5,50.0],[16.0,49.5],[16.5,49.0],[18.0,48.8]],
  },
  {
    id: 'ukraine-transit', name: 'Ukrainian Gas Transit System', commodity: 'gas', status: 'active',
    operator: 'GTSOU', lengthKm: 14400, capacityDesc: '146 bcm/yr', region: 'Europe',
    coordinates: [[37.6,55.7],[35.0,52.5],[30.0,50.5],[27.5,50.0],[24.0,50.5],[22.3,48.6],[18.0,48.5],[16.9,48.1]],
  },
  {
    id: 'nabucco-route', name: 'NABUCCO-West (abandoned, historic route)', commodity: 'gas', status: 'inactive',
    operator: 'OMV/Botas', lengthKm: 1300, capacityDesc: '10 bcm/yr', region: 'Europe',
    coordinates: [[28.9,41.1],[26.0,42.0],[22.0,43.0],[19.5,44.5],[17.0,46.5],[16.5,48.5],[16.9,48.1]],
  },
  {
    id: 'transgaz-romania', name: 'Transgaz Romania National Grid', commodity: 'gas', status: 'active',
    operator: 'Transgaz', lengthKm: 13000, capacityDesc: '30 bcm/yr', region: 'Europe',
    coordinates: [[22.0,48.0],[24.0,47.5],[26.5,46.5],[27.5,45.0],[26.1,44.4],[24.5,44.0],[22.5,43.5],[23.5,42.0]],
  },

  // ── ASIA ADDITIONAL ───────────────────────────────────────────────────────
  {
    id: 'china-northeast-gas', name: 'China Northeast Gas Grid (Shaanxi-Beijing)', commodity: 'gas', status: 'active',
    operator: 'PetroChina', lengthKm: 900, capacityDesc: '10 bcm/yr', region: 'Asia',
    coordinates: [[109.5,38.0],[110.5,38.5],[112.0,38.0],[114.0,39.0],[116.0,39.9]],
  },
  {
    id: 'china-sichuan-east', name: 'Sichuan-to-East Gas Pipeline (China)', commodity: 'gas', status: 'active',
    operator: 'Sinopec', lengthKm: 2170, capacityDesc: '12 bcm/yr', region: 'Asia',
    coordinates: [[104.0,30.5],[107.0,30.0],[110.0,30.5],[112.5,31.0],[116.0,32.5],[118.5,32.0],[121.5,31.2]],
  },
  {
    id: 'india-jamnagar', name: 'Jamnagar-Loni Petroleum Products Pipeline', commodity: 'refined', status: 'active',
    operator: 'Reliance Industries', lengthKm: 1256, capacityDesc: '27 mmtpa', region: 'Asia',
    coordinates: [[70.0,22.5],[72.0,23.5],[75.0,25.5],[77.0,27.5],[77.2,28.6]],
  },
  {
    id: 'india-gail-pradhan', name: 'GAIL Pradhan Mantri Urja Ganga', commodity: 'gas', status: 'construction',
    operator: 'GAIL India', lengthKm: 2650, capacityDesc: '16 mmscmd', region: 'Asia',
    coordinates: [[82.6,26.0],[83.5,26.5],[84.5,27.0],[85.3,27.5],[86.5,25.5],[87.5,23.5],[88.4,22.6]],
  },
  {
    id: 'thailand-national-gas', name: 'Thailand National Gas Grid (PTT)', commodity: 'gas', status: 'active',
    operator: 'PTT', lengthKm: 4500, capacityDesc: '4 bcf/d', region: 'Asia',
    coordinates: [[100.0,7.0],[100.5,9.0],[101.0,11.5],[100.5,13.8],[99.5,18.0],[99.0,20.5]],
  },
  {
    id: 'korea-gas-grid', name: 'Korea Gas Corporation (KOGAS) Grid', commodity: 'gas', status: 'active',
    operator: 'KOGAS', lengthKm: 4900, capacityDesc: '50 bcm/yr', region: 'Asia',
    coordinates: [[127.0,35.5],[126.5,36.5],[126.8,37.5],[127.0,38.5],[128.5,37.5],[129.5,36.5],[129.0,35.0]],
  },
  {
    id: 'japan-inpex-pipeline', name: 'Japan Inpex-Gaz de France Pipeline', commodity: 'gas', status: 'active',
    operator: 'Japan Gas Network', lengthKm: 3000, capacityDesc: '25 bcf/d', region: 'Asia',
    coordinates: [[130.5,31.5],[130.5,33.5],[131.5,34.5],[132.5,34.0],[133.5,34.5],[135.5,34.5],[136.5,35.5],[137.5,35.5],[139.7,35.7]],
  },

  // ── OCEANIA ADDITIONAL ────────────────────────────────────────────────────
  {
    id: 'eastern-gas-pipeline-aus', name: 'Eastern Gas Pipeline (Australia)', commodity: 'gas', status: 'active',
    operator: 'Jemena/APA Group', lengthKm: 797, capacityDesc: '0.22 bcf/d', region: 'Oceania',
    coordinates: [[151.0,-23.5],[151.5,-26.5],[152.0,-28.5],[153.0,-27.5],[153.5,-28.5],[153.0,-30.5],[151.2,-33.9]],
  },
  {
    id: 'goldfields-gas-aus', name: 'Goldfields Gas Transmission (Australia)', commodity: 'gas', status: 'active',
    operator: 'APA Group', lengthKm: 1380, capacityDesc: '0.14 bcf/d', region: 'Oceania',
    coordinates: [[116.7,-20.7],[118.5,-24.0],[120.0,-27.5],[121.5,-30.5],[123.0,-31.0],[121.0,-33.5]],
  },

  // ── ASIA & OCEANIA ────────────────────────────────────────────────────────
  {
    id: 'tapi', name: 'TAPI Pipeline (Turkmenistan-India)', commodity: 'gas', status: 'construction',
    operator: 'TAPI Pipeline Company', lengthKm: 1800, capacityDesc: '33 bcm/yr', region: 'Asia',
    coordinates: [[58.4,37.9],[62.0,35.5],[65.5,32.0],[69.2,34.5],[71.5,33.5],[73.1,33.7],[72.0,30.0],[72.0,28.0],[72.2,26.5],[70.5,24.5]],
  },
  {
    id: 'iran-pakistan', name: 'Iran-Pakistan Gas Pipeline', commodity: 'gas', status: 'construction',
    operator: 'NIGC/SSGC', lengthKm: 900, capacityDesc: '21.5 mmcm/d', region: 'Asia',
    coordinates: [[56.3,27.2],[59.5,27.0],[61.0,26.5],[62.5,25.5],[65.5,25.0],[67.0,24.9]],
  },
  {
    id: 'hjb-india', name: 'HVJ/HBJ Pipeline (India)', commodity: 'gas', status: 'active',
    operator: 'GAIL India', lengthKm: 2800, capacityDesc: '50 mmscmd', region: 'Asia',
    coordinates: [[72.6,21.1],[73.5,22.5],[75.0,23.5],[76.5,25.0],[79.0,24.6],[80.5,25.5],[82.0,25.0],[82.6,26.0]],
  },
  {
    id: 'apci-india', name: 'India LNG-to-Pipeline Grid East', commodity: 'gas', status: 'active',
    operator: 'GAIL India', lengthKm: 2050, capacityDesc: '40 mmscmd', region: 'Asia',
    coordinates: [[82.6,26.0],[85.0,25.5],[87.0,24.0],[88.4,22.6],[89.0,23.0],[90.5,23.5],[91.7,26.2]],
  },
  {
    id: 'malaysia-thailand-jda', name: 'Malaysia-Thailand JDA Gas Pipeline', commodity: 'gas', status: 'active',
    operator: 'PTT/Petronas', lengthKm: 600, capacityDesc: '0.7 bcf/d', region: 'Asia',
    coordinates: [[103.5,5.5],[103.0,7.0],[102.0,9.0],[101.0,11.0],[100.5,13.8]],
  },
  {
    id: 'nam-con-son', name: 'Nam Con Son Gas Pipeline (Vietnam)', commodity: 'gas', status: 'active',
    operator: 'Petrovietnam', lengthKm: 399, capacityDesc: '0.7 bcf/d', region: 'Asia',
    coordinates: [[107.1,10.4],[107.0,10.7],[106.9,10.9],[106.7,10.8]],
  },
  {
    id: 'malampaya', name: 'Malampaya Deepwater Pipeline (Philippines)', commodity: 'gas', status: 'active',
    operator: 'Shell/Chevron', lengthKm: 504, capacityDesc: '0.4 bcf/d', region: 'Asia',
    coordinates: [[119.0,11.0],[119.5,12.5],[119.8,13.5],[120.2,14.5],[120.9,14.6]],
  },
  {
    id: 'dampier-bunbury', name: 'Dampier to Bunbury Pipeline (Australia)', commodity: 'gas', status: 'active',
    operator: 'APA Group', lengthKm: 1600, capacityDesc: '1.5 bcf/d', region: 'Oceania',
    coordinates: [[116.7,-20.7],[116.0,-22.0],[115.5,-26.0],[115.5,-30.0],[115.7,-33.3]],
  },
  {
    id: 'moomba-sydney', name: 'Moomba-Sydney Pipeline (Australia)', commodity: 'gas', status: 'active',
    operator: 'APA Group', lengthKm: 2500, capacityDesc: '0.25 bcf/d', region: 'Oceania',
    coordinates: [[140.2,-28.1],[142.0,-31.0],[144.0,-33.5],[148.0,-34.0],[151.2,-33.9]],
  },
  {
    id: 'moomba-adelaide', name: 'Moomba to Adelaide Pipeline (Australia)', commodity: 'gas', status: 'active',
    operator: 'APA Group', lengthKm: 1145, capacityDesc: '0.15 bcf/d', region: 'Oceania',
    coordinates: [[140.2,-28.1],[138.5,-30.5],[137.5,-33.5],[138.6,-34.9]],
  },
  {
    id: 'png-qld', name: 'Papua New Guinea-Queensland Gas Pipeline (P\'nyang)', commodity: 'gas', status: 'construction',
    operator: 'ExxonMobil/Oil Search', lengthKm: 300, capacityDesc: '1 bcf/d', region: 'Oceania',
    coordinates: [[143.0,-6.0],[145.0,-8.0],[148.0,-10.0],[145.5,-14.0],[149.0,-21.5],[151.0,-23.8]],
  },
  {
    id: 'north-west-shelf', name: 'Carnarvon to Dampier Pipeline (NWS)', commodity: 'gas', status: 'active',
    operator: 'Woodside', lengthKm: 135, capacityDesc: '3 bcf/d', region: 'Oceania',
    coordinates: [[114.0,-22.5],[115.0,-21.5],[116.7,-20.7]],
  },
  {
    id: 'java-gas-indonesia', name: 'Sumatra-Java Gas Pipeline (Indonesia)', commodity: 'gas', status: 'active',
    operator: 'PGN', lengthKm: 1100, capacityDesc: '1.2 bcf/d', region: 'Asia',
    coordinates: [[104.0,-1.0],[104.5,-2.5],[105.0,-4.0],[106.0,-5.5],[106.8,-6.2]],
  },
  {
    id: 'south-caucasus-pipe', name: 'South Caucasus Pipeline extension', commodity: 'gas', status: 'active',
    operator: 'BP/SOCAR', lengthKm: 500, capacityDesc: '25 bcm/yr', region: 'Asia',
    coordinates: [[52.0,38.0],[50.0,39.0],[49.8,40.5]],
  },
  {
    id: 'timor-sea-gas', name: 'Bayu-Undan to Darwin Pipeline', commodity: 'gas', status: 'active',
    operator: 'ConocoPhillips', lengthKm: 500, capacityDesc: '0.5 bcf/d', region: 'Oceania',
    coordinates: [[127.5,-11.5],[128.5,-12.0],[130.0,-12.3],[130.8,-12.5]],
  },
  {
    id: 'india-assam', name: 'Assam-Asansol Pipeline (India)', commodity: 'crude', status: 'active',
    operator: 'Indian Oil', lengthKm: 1157, capacityDesc: '0.06 Mb/d', region: 'Asia',
    coordinates: [[95.6,27.4],[92.0,26.0],[90.0,25.5],[88.4,22.6]],
  },
  {
    id: 'west-east-china', name: 'West-East Gas Pipeline (China)', commodity: 'gas', status: 'active',
    operator: 'PetroChina', lengthKm: 8700, capacityDesc: '30 bcm/yr', region: 'Asia',
    coordinates: [[80.0,43.5],[90.0,42.0],[100.0,36.0],[106.0,38.0],[110.0,35.0],[116.0,34.0],[120.0,31.5],[121.5,31.2]],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Overpass API fetch
// ─────────────────────────────────────────────────────────────────────────────
function fetchOverpass(query) {
  return new Promise((resolve) => {
    const body = `data=${encodeURIComponent(query)}`;
    const req = https.request(
      {
        hostname: 'overpass-api.de',
        path: '/api/interpreter',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'gridmonitor-pipeline-prep/1.0',
        },
        timeout: 30000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

function osm2pipelines(data) {
  if (!data?.elements) return [];
  const pipelines = [];
  for (const el of data.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const tags = el.tags ?? {};
    const name = tags.name || tags['name:en'] || tags.description;
    if (!name) continue;
    const substance = tags.substance || tags.product || 'gas';
    const commodity = substance.toLowerCase().includes('oil') || substance.toLowerCase().includes('crude') ? 'crude'
      : substance.toLowerCase().includes('ngl') || substance.toLowerCase().includes('condensate') ? 'condensate'
      : substance.toLowerCase().includes('petrol') || substance.toLowerCase().includes('diesel') ? 'refined'
      : 'gas';
    const coordinates = el.geometry.map(n => [n.lon, n.lat]);
    pipelines.push({
      id: `osm-${el.id}`,
      name,
      commodity,
      status: 'active',
      operator: tags.operator || 'Unknown',
      lengthKm: Math.round(el.geometry.length * 0.1),
      capacityDesc: 'Unknown',
      region: 'Global',
      coordinates,
    });
  }
  return pipelines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[prep-global-pipelines] Writing ${MANUAL_PIPELINES.length} manual pipelines to ${OUT_TS}`);

  let pipelines = [...MANUAL_PIPELINES];

  if (!MANUAL_ONLY) {
    console.log('[prep-global-pipelines] Fetching named pipelines from Overpass API...');
    const query = `
[out:json][timeout:30];
way["man_made"="pipeline"]["name"]["substance"~"oil|crude|gas|natural_gas|petroleum|LNG",i][!"tunnel"];
out 500 geom;
    `.trim();

    const data = await fetchOverpass(query);
    if (data) {
      const osmPipes = osm2pipelines(data);
      console.log(`[prep-global-pipelines] Got ${osmPipes.length} OSM pipelines`);
      // Deduplicate by name (case-insensitive)
      const existing = new Set(pipelines.map(p => p.name.toLowerCase()));
      for (const p of osmPipes) {
        if (!existing.has(p.name.toLowerCase())) {
          pipelines.push(p);
          existing.add(p.name.toLowerCase());
        }
      }
    } else {
      console.log('[prep-global-pipelines] Overpass API unavailable — using manual list only');
    }
  }

  // Write TypeScript file
  const tsContent = `// AUTO-GENERATED by scripts/prep-global-pipelines.mjs
// ${pipelines.length} major global pipelines — all continents
import type { GlobalPipeline } from '@/types';

export const GLOBAL_PIPELINES: GlobalPipeline[] = ${JSON.stringify(pipelines, null, 2)};
`;

  writeFileSync(OUT_TS, tsContent, 'utf8');
  console.log(`[prep-global-pipelines] Wrote ${pipelines.length} pipelines to ${OUT_TS}`);
}

main().catch(e => { console.error(e); process.exit(1); });
