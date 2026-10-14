/**
 * Grid's Eye View asset icons.
 *
 * Every asset type gets its own little building on its own colored plot, in a
 * chunky game-map style: dark outline, flat bright fills, one highlight, a
 * ground shadow. The plot color carries the category at low zoom, where the
 * building is too small to read; zoom in and the building takes over.
 *
 * All art is plain SVG in a 128x128 cell. One atlas is built for deck.gl, and
 * the same art is reused for the sidebar legend.
 */

import { IconLayer } from '@deck.gl/layers';
import type { GlobalOilGasField, UsPowerPlant } from '@/types';

const O = '#23170e';           // outline
const SW = 4;                  // outline width
const S = `stroke="${O}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round"`;

interface PlotColors { top: string; side: string }

const PLOTS: Record<string, PlotColors> = {
  concrete: { top: '#d8d1c3', side: '#968e7f' },
  slate:    { top: '#7d848a', side: '#4c5257' },
  steel:    { top: '#8fa3b8', side: '#5a6d81' },
  sand:     { top: '#e6c27a', side: '#ac874a' },
  mint:     { top: '#a7e3cf', side: '#5fa58d' },
  gold:     { top: '#f4d35e', side: '#b6942b' },
  water:    { top: '#63b3f2', side: '#2f78b6' },
  grass:    { top: '#86c95b', side: '#518a33' },
  ember:    { top: '#b48ad0', side: '#76528f' },
  stone:    { top: '#a7a29a', side: '#6c6760' },
  dune:     { top: '#d9a066', side: '#9c6a39' },
  frost:    { top: '#b9d4e6', side: '#7b9cb3' },
  plum:     { top: '#c38bd1', side: '#86538f' },
  teal:     { top: '#62cfc3', side: '#2f8f84' },
  harbor:   { top: '#4f9fe0', side: '#2a669c' },
};

function plot(p: PlotColors): string {
  return `
    <ellipse cx="64" cy="106" rx="52" ry="15" fill="rgba(0,0,0,0.32)"/>
    <path d="M14 90 v9 a50 17 0 0 0 100 0 v-9" fill="${p.side}" ${S}/>
    <ellipse cx="64" cy="90" rx="50" ry="17" fill="${p.top}" ${S}/>
    <ellipse cx="54" cy="85" rx="26" ry="6" fill="#ffffff" opacity="0.18"/>`;
}

/** Hazard stripes + crane: marks fields still under development. */
function construction(): string {
  return `
    <path d="M18 96 l8 5 M32 103 l8 4 M50 107 l8 1 M70 107 l8 -1 M88 104 l8 -4 M102 99 l8 -5" stroke="#ffc41f" stroke-width="5" stroke-linecap="round"/>
    <g ${S} fill="#ffc41f">
      <rect x="10" y="30" width="7" height="58" rx="1"/>
      <rect x="6" y="26" width="40" height="7" rx="1"/>
    </g>
    <path d="M40 33 v14" stroke="${O}" stroke-width="2.5"/>
    <rect x="35" y="46" width="10" height="7" rx="1.5" fill="#ff6b3d" ${S} stroke-width="3"/>`;
}

// ── Power plants ─────────────────────────────────────────────────

const nuclear = () => `${plot(PLOTS['concrete']!)}
  <path d="M24 92 Q32 66 27 36 L57 36 Q51 66 59 92 Z" fill="#efeae1" ${S}/>
  <path d="M45 36 Q50 66 45 92 L59 92 Q51 66 57 36 Z" fill="#c9c1b2"/>
  <path d="M24 92 Q32 66 27 36 L57 36 Q51 66 59 92 Z" fill="none" ${S}/>
  <path d="M64 92 Q70 72 66 50 L88 50 Q84 72 90 92 Z" fill="#efeae1" ${S}/>
  <path d="M80 50 Q84 72 80 92 L90 92 Q84 72 88 50 Z" fill="#c9c1b2"/>
  <path d="M64 92 Q70 72 66 50 L88 50 Q84 72 90 92 Z" fill="none" ${S}/>
  <g fill="#ffffff" ${S}>
    <circle cx="34" cy="26" r="9"/><circle cx="47" cy="20" r="11"/><circle cx="58" cy="28" r="8"/>
    <circle cx="74" cy="42" r="6"/><circle cx="84" cy="38" r="7"/>
  </g>
  <circle cx="98" cy="72" r="15" fill="#ffd23f" ${S}/>
  <g fill="${O}">
    <circle cx="98" cy="72" r="3"/>
    <path d="M98 72 L91 61 A13 13 0 0 1 105 61 Z" opacity="0.9"/>
    <path d="M98 72 L111 75 A13 13 0 0 1 104 84 Z" opacity="0.9"/>
    <path d="M98 72 L92 84 A13 13 0 0 1 85 75 Z" opacity="0.9"/>
  </g>`;

const coal = () => `${plot(PLOTS['slate']!)}
  <path d="M14 92 Q22 74 36 76 Q46 72 50 92 Z" fill="#2b2b2b" ${S}/>
  <rect x="34" y="56" width="50" height="36" rx="3" fill="#a24a2b" ${S}/>
  <path d="M30 58 L59 42 L88 58 Z" fill="#6f2f1b" ${S}/>
  <g fill="#ffd57a" ${S} stroke-width="3">
    <rect x="42" y="66" width="10" height="10" rx="1"/><rect x="58" y="66" width="10" height="10" rx="1"/>
  </g>
  <rect x="88" y="22" width="14" height="70" rx="2" fill="#c9c1b4" ${S}/>
  <path d="M88 34 h14 M88 46 h14" stroke="#d1402a" stroke-width="5"/>
  <rect x="88" y="22" width="14" height="70" rx="2" fill="none" ${S}/>
  <g fill="#8d8d8d" ${S}>
    <circle cx="96" cy="14" r="7"/><circle cx="108" cy="9" r="8"/><circle cx="118" cy="16" r="6"/>
  </g>`;

const gas = () => `${plot(PLOTS['steel']!)}
  <rect x="22" y="56" width="62" height="36" rx="6" fill="#e3e8ee" ${S}/>
  <rect x="22" y="56" width="62" height="11" rx="5" fill="#f08a24" ${S}/>
  <g fill="#9fb3c8" ${S} stroke-width="3">
    <circle cx="38" cy="80" r="7"/><circle cx="56" cy="80" r="7"/>
  </g>
  <rect x="88" y="36" width="13" height="56" rx="2" fill="#c7ced6" ${S}/>
  <path d="M94.5 6 C82 22 86 34 94.5 36 C103 34 107 22 94.5 6 Z" fill="#ff7a1a" ${S}/>
  <path d="M94.5 18 C89 26 91 32 94.5 33 C98 32 100 26 94.5 18 Z" fill="#ffd23f"/>`;

const oilPlant = () => `${plot(PLOTS['dune']!)}
  <path d="M26 54 v32 a24 8 0 0 0 48 0 v-32" fill="#c8382a" ${S}/>
  <path d="M26 66 a24 8 0 0 0 48 0" fill="none" stroke="#ffffff" stroke-width="5"/>
  <ellipse cx="50" cy="54" rx="24" ry="8" fill="#e5574a" ${S}/>
  <path d="M26 54 v32 a24 8 0 0 0 48 0 v-32" fill="none" ${S}/>
  <rect x="82" y="40" width="22" height="52" rx="3" fill="#5a4a3e" ${S}/>
  <rect x="88" y="22" width="10" height="20" rx="2" fill="#8c7a6c" ${S}/>
  <g fill="#6f6f6f" ${S}><circle cx="93" cy="14" r="6"/><circle cx="103" cy="9" r="6"/></g>`;

const wind = () => `${plot(PLOTS['mint']!)}
  <path d="M60 92 L62 38 L66 38 L68 92 Z" fill="#ffffff" ${S}/>
  <g transform="translate(64 36)">
    <path d="M0 0 C-5 -10 -4 -28 0 -34 C4 -28 5 -10 0 0 Z" fill="#ffffff" ${S}/>
    <path d="M0 0 C-5 -10 -4 -28 0 -34 C4 -28 5 -10 0 0 Z" fill="#ffffff" ${S} transform="rotate(120)"/>
    <path d="M0 0 C-5 -10 -4 -28 0 -34 C4 -28 5 -10 0 0 Z" fill="#ffffff" ${S} transform="rotate(240)"/>
    <circle r="6" fill="#4fb3ff" ${S}/>
  </g>
  <path d="M95 92 L97 66 L100 66 L102 92 Z" fill="#ffffff" ${S} stroke-width="3"/>
  <g transform="translate(98.5 64) rotate(40)">
    <path d="M0 0 C-4 -7 -3 -16 0 -20 C3 -16 4 -7 0 0 Z" fill="#ffffff" stroke="${O}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M0 0 C-4 -7 -3 -16 0 -20 C3 -16 4 -7 0 0 Z" fill="#ffffff" stroke="${O}" stroke-width="3" stroke-linejoin="round" transform="rotate(120)"/>
    <path d="M0 0 C-4 -7 -3 -16 0 -20 C3 -16 4 -7 0 0 Z" fill="#ffffff" stroke="${O}" stroke-width="3" stroke-linejoin="round" transform="rotate(240)"/>
    <circle r="3.5" fill="#4fb3ff" stroke="${O}" stroke-width="2.5"/>
  </g>`;

const solar = () => `${plot(PLOTS['gold']!)}
  <g>
    <path d="M18 80 L34 62 L70 62 L56 80 Z" fill="#2356b0" ${S}/>
    <path d="M26 71 h38 M44 62 l-14 18 M58 62 l-14 18" stroke="#9cc0ff" stroke-width="2.5"/>
    <path d="M18 80 L34 62 L70 62 L56 80 Z" fill="none" ${S}/>
    <path d="M58 98 L74 80 L110 80 L96 98 Z" fill="#2356b0" ${S}/>
    <path d="M66 89 h38 M84 80 l-14 18 M98 80 l-14 18" stroke="#9cc0ff" stroke-width="2.5"/>
    <path d="M58 98 L74 80 L110 80 L96 98 Z" fill="none" ${S}/>
    <path d="M36 80 v8 M54 80 v8 M76 98 v4 M94 98 v4" ${S}/>
  </g>
  <g transform="translate(98 32)">
    <g stroke="#ffb703" stroke-width="5" stroke-linecap="round">
      <path d="M0 -24 v8 M0 16 v8 M-24 0 h8 M16 0 h8 M-17 -17 l6 6 M11 11 l6 6 M17 -17 l-6 6 M-11 11 l-6 6"/>
    </g>
    <circle r="12" fill="#ffd23f" ${S}/>
  </g>`;

const hydro = () => `${plot(PLOTS['water']!)}
  <path d="M18 70 Q20 44 64 40 Q108 44 110 70 Z" fill="#2f86d6" ${S}/>
  <path d="M34 50 Q64 44 94 50" stroke="#8fd0ff" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M22 62 L106 62 L98 92 L30 92 Z" fill="#d6cfc2" ${S}/>
  <path d="M22 62 L106 62 L104 70 L24 70 Z" fill="#efe9de" ${S}/>
  <g fill="#7fd0ff" ${S} stroke-width="3">
    <path d="M44 70 h10 l4 22 h-18 Z"/><path d="M74 70 h10 l4 22 h-18 Z"/>
  </g>
  <path d="M48 75 v12 M78 75 v12" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
  <g fill="#ffffff" ${S} stroke-width="3"><circle cx="49" cy="96" r="5"/><circle cx="58" cy="98" r="4"/><circle cx="80" cy="97" r="5"/></g>`;

const biomass = () => `${plot(PLOTS['grass']!)}
  <path d="M30 46 v44 h28 v-44" fill="#3e8e4a" ${S}/>
  <path d="M30 46 a14 12 0 0 1 28 0 Z" fill="#5fb36b" ${S}/>
  <path d="M30 60 h28 M30 74 h28" stroke="#2c6a36" stroke-width="3"/>
  <path d="M30 46 v44 h28 v-44" fill="none" ${S}/>
  <path d="M62 68 h34 v24 h-34 Z" fill="#c4874e" ${S}/>
  <path d="M58 70 L79 54 L100 70 Z" fill="#8a5530" ${S}/>
  <path d="M100 18 C78 22 72 42 84 52 C100 50 110 34 100 18 Z" fill="#8bdc5a" ${S}/>
  <path d="M84 52 C88 40 94 30 100 22" stroke="${O}" stroke-width="3" fill="none"/>`;

const geothermal = () => `${plot(PLOTS['ember']!)}
  <path d="M36 92 L44 82 L52 90 L60 80 L68 92 Z" fill="#ff7a3d" ${S} stroke-width="3"/>
  <path d="M26 92 v-26 h10 v14 h20 v-22 h10 v34" fill="none" stroke="${O}" stroke-width="12" stroke-linejoin="round"/>
  <path d="M26 92 v-26 h10 v14 h20 v-22 h10 v34" fill="none" stroke="#c7ced6" stroke-width="6" stroke-linejoin="round"/>
  <rect x="74" y="58" width="32" height="34" rx="4" fill="#6c5a8a" ${S}/>
  <rect x="74" y="58" width="32" height="9" rx="4" fill="#9a86bf" ${S}/>
  <g fill="#ffffff" ${S}>
    <circle cx="58" cy="44" r="10"/><circle cx="70" cy="34" r="12"/><circle cx="84" cy="40" r="9"/>
    <circle cx="74" cy="22" r="8"/>
  </g>`;

const otherPlant = () => `${plot(PLOTS['stone']!)}
  <rect x="34" y="44" width="60" height="48" rx="8" fill="#4d5560" ${S}/>
  <rect x="54" y="36" width="20" height="10" rx="3" fill="#7d8792" ${S}/>
  <path d="M68 52 L54 72 H66 L60 86 L78 64 H66 Z" fill="#ffd23f" ${S} stroke-width="3"/>`;

// ── Oil & gas fields ─────────────────────────────────────────────

const fieldOil = () => `${plot(PLOTS['sand']!)}
  <path d="M28 92 L44 54 L60 92" fill="none" stroke="${O}" stroke-width="10" stroke-linejoin="round"/>
  <path d="M28 92 L44 54 L60 92" fill="none" stroke="#5b5b5b" stroke-width="5" stroke-linejoin="round"/>
  <g transform="rotate(-12 44 52)">
    <rect x="10" y="46" width="70" height="11" rx="3" fill="#2f2f2f" ${S}/>
    <path d="M80 42 Q96 52 80 64 Z" fill="#f08a24" ${S}/>
    <rect x="4" y="44" width="16" height="16" rx="3" fill="#f08a24" ${S}/>
  </g>
  <path d="M86 64 v28" stroke="${O}" stroke-width="5"/>
  <rect x="78" y="86" width="20" height="8" rx="2" fill="#5b5b5b" ${S} stroke-width="3"/>
  <circle cx="44" cy="52" r="5" fill="#ffd23f" ${S} stroke-width="3"/>`;

const fieldGas = () => `${plot(PLOTS['frost']!)}
  <g ${S}>
    <path d="M36 92 L40 74 M64 92 L60 74" />
  </g>
  <circle cx="50" cy="60" r="22" fill="#eef3f8" ${S}/>
  <path d="M34 54 a18 16 0 0 1 22 -14" stroke="#ffffff" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M28 64 h44" stroke="#2f7fd6" stroke-width="5"/>
  <circle cx="50" cy="60" r="22" fill="none" ${S}/>
  <rect x="88" y="34" width="9" height="58" rx="2" fill="#c7ced6" ${S}/>
  <path d="M92.5 6 C80 20 84 32 92.5 34 C101 32 105 20 92.5 6 Z" fill="#4fb3ff" ${S}/>
  <path d="M92.5 17 C88 24 89.5 30 92.5 31 C95.5 30 97 24 92.5 17 Z" fill="#c9ecff"/>`;

const fieldOilGas = () => `${plot(PLOTS['plum']!)}
  <path d="M40 92 L58 18 L76 92" fill="none" stroke="${O}" stroke-width="10" stroke-linejoin="round"/>
  <path d="M40 92 L58 18 L76 92" fill="none" stroke="#d64a2a" stroke-width="5" stroke-linejoin="round"/>
  <path d="M45 72 L71 72 M49 54 L67 54 M53 36 L63 36 M45 72 L67 54 M71 72 L49 54 M49 54 L63 36 M67 54 L53 36"
        stroke="#d64a2a" stroke-width="3"/>
  <path d="M52 16 h12 l-2 6 h-8 Z" fill="#ffd23f" ${S} stroke-width="3"/>
  <path d="M84 70 v18 a12 4 0 0 0 24 0 v-18" fill="#f2efe8" ${S}/>
  <ellipse cx="96" cy="70" rx="12" ry="4" fill="#ffffff" ${S}/>
  <path d="M16 82 v8 a10 4 0 0 0 20 0 v-8" fill="#7b4fa3" ${S} stroke-width="3"/>
  <ellipse cx="26" cy="82" rx="10" ry="4" fill="#a57bd0" ${S} stroke-width="3"/>`;

const fieldCondensate = () => `${plot(PLOTS['teal']!)}
  <path d="M22 56 v30 a16 6 0 0 0 32 0 v-30" fill="#14958a" ${S}/>
  <ellipse cx="38" cy="56" rx="16" ry="6" fill="#3bc4b7" ${S}/>
  <path d="M60 46 v40 a18 7 0 0 0 36 0 v-40" fill="#0f7d74" ${S}/>
  <ellipse cx="78" cy="46" rx="18" ry="7" fill="#33b5a8" ${S}/>
  <path d="M84 20 C76 30 76 38 84 40 C92 38 92 30 84 20 Z" fill="#9ff0e6" ${S} stroke-width="3"/>
  <path d="M54 70 h6" stroke="${O}" stroke-width="5"/>`;

const terminal = () => `${plot(PLOTS['harbor']!)}
  <path d="M20 84 h60 v6 h-60 Z" fill="#8c7a6c" ${S} stroke-width="3"/>
  <path d="M22 84 a16 16 0 0 1 32 0 Z" fill="#f4f1ea" ${S}/>
  <path d="M50 84 a16 16 0 0 1 32 0 Z" fill="#f4f1ea" ${S}/>
  <path d="M28 78 a10 10 0 0 1 8 -8 M56 78 a10 10 0 0 1 8 -8" stroke="#ffffff" stroke-width="3" fill="none"/>
  <path d="M74 98 L112 98 L106 108 L80 108 Z" fill="#d64a2a" ${S}/>
  <rect x="92" y="88" width="12" height="10" rx="2" fill="#f4f1ea" ${S} stroke-width="3"/>
  <circle cx="84" cy="96" r="4" fill="#f4f1ea" ${S} stroke-width="2.5"/>`;

// ── Atlas ────────────────────────────────────────────────────────

const ART: Record<string, () => string> = {
  nuclear, coal, natural_gas: gas, oil: oilPlant, wind, solar, hydro, biomass, geothermal, other: otherPlant,
  field_oil: fieldOil, field_gas: fieldGas, 'field_oil/gas': fieldOilGas, field_condensate: fieldCondensate, terminal,
};

const DEV_KEYS = ['field_oil', 'field_gas', 'field_oil/gas', 'field_condensate', 'terminal'];
const KEYS = [...Object.keys(ART), ...DEV_KEYS.map((k) => `${k}:dev`)];

const CELL = 128;
const COLS = 5;

function cellSvg(key: string): string {
  const [base, dev] = key.split(':');
  const art = ART[base ?? ''] ?? otherPlant;
  return art() + (dev ? construction() : '');
}

/** Standalone SVG for one asset (legend, popups). */
export function gevAssetSvg(key: string, size = 28): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128" aria-hidden="true">${cellSvg(key)}</svg>`;
}

/** Atlas layout shared by the runtime and scripts/gen-gev-icon-atlas.ts. */
export function gevAtlasLayout(): { svg: string; width: number; height: number } {
  const rows = Math.ceil(KEYS.length / COLS);
  const width = COLS * CELL;
  const height = rows * CELL;
  const cells = KEYS.map((key, i) =>
    `<g transform="translate(${(i % COLS) * CELL} ${Math.floor(i / COLS) * CELL})">${cellSvg(key)}</g>`).join('');
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${cells}</svg>`, width, height };
}

// deck.gl can't decode SVG atlases (createImageBitmap rejects SVG), so the
// atlas ships as a PNG rendered from this file. Regenerate after editing art:
//   bun scripts/gen-gev-icon-atlas.ts
const ATLAS_PNG = '/gev-icons.png';

let atlasUrl: string | null = null;
let atlasMapping: Record<string, { x: number; y: number; width: number; height: number; anchorY: number; mask: boolean }> | null = null;

function buildAtlas(): void {
  if (atlasUrl && atlasMapping) return;
  const mapping: NonNullable<typeof atlasMapping> = {};
  KEYS.forEach((key, i) => {
    // anchorY near the plot's base so the building sits on the location.
    mapping[key] = { x: (i % COLS) * CELL, y: Math.floor(i / COLS) * CELL, width: CELL, height: CELL, anchorY: 98, mask: false };
  });
  atlasUrl = ATLAS_PNG;
  atlasMapping = mapping;
}

/** Small at world view, full size from about zoom 7. */
function zoomFactor(zoom: number): number {
  return Math.max(0.34, Math.min(1, 0.34 + (zoom - 2) * 0.13));
}

const PLANT_KEYS = new Set(['nuclear', 'coal', 'natural_gas', 'oil', 'wind', 'solar', 'hydro', 'biomass', 'geothermal']);

export function createGevPlantIconLayer(data: UsPowerPlant[], zoom: number): IconLayer<UsPowerPlant> {
  buildAtlas();
  const f = zoomFactor(zoom);
  return new IconLayer<UsPowerPlant>({
    id: 'us-plants-layer',
    data,
    iconAtlas: atlasUrl!,
    iconMapping: atlasMapping!,
    getIcon: (d) => (PLANT_KEYS.has(d.fuelType) ? d.fuelType : 'other'),
    getPosition: (d) => [d.lon, d.lat],
    getSize: (d) => {
      const mw = d.capacityMW || 1;
      return Math.min(62, Math.max(22, 20 + Math.sqrt(mw) * 0.85)) * f;
    },
    sizeUnits: 'pixels',
    sizeMinPixels: 6,
    sizeMaxPixels: 66,
    updateTriggers: { getSize: [f] },
    pickable: true,
    autoHighlight: false,
    alphaCutoff: 0.1,
  });
}

export function createGevFieldIconLayer(data: GlobalOilGasField[], zoom: number): IconLayer<GlobalOilGasField> {
  buildAtlas();
  const f = zoomFactor(zoom);
  return new IconLayer<GlobalOilGasField>({
    id: 'oil-gas-fields-layer',
    data,
    iconAtlas: atlasUrl!,
    iconMapping: atlasMapping!,
    getIcon: (d) => {
      const base = d.type === 'terminal' ? 'terminal' : `field_${d.commodity}`;
      const key = ART[base] ? base : 'field_oil';
      return d.status === 'development' ? `${key}:dev` : key;
    },
    getPosition: (d) => [d.lon, d.lat],
    getSize: (d) => (d.type === 'terminal' ? 52 : 44) * f,
    sizeUnits: 'pixels',
    sizeMinPixels: 8,
    sizeMaxPixels: 56,
    updateTriggers: { getSize: [f] },
    pickable: true,
    alphaCutoff: 0.1,
  });
}

/** Legend rows for the sidebar: [assetKey, label]. */
export const GEV_PLANT_LEGEND: [string, string][] = [
  ['natural_gas', 'Gas'], ['coal', 'Coal'],
  ['nuclear', 'Nuclear'], ['wind', 'Wind'],
  ['solar', 'Solar'], ['hydro', 'Hydro'],
  ['oil', 'Oil'], ['biomass', 'Biomass'],
  ['geothermal', 'Geothermal'], ['other', 'Other'],
];

export const GEV_FIELD_LEGEND: [string, string][] = [
  ['field_oil', 'Oil field'], ['field_gas', 'Gas field'],
  ['field_oil/gas', 'Oil & gas'], ['field_condensate', 'Condensate'],
  ['terminal', 'LNG terminal'], ['field_oil:dev', 'In development'],
];
