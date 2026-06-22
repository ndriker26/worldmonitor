import type { GlobalOilGasField, GlobalPipeline } from '@/types';
import { US_POWER_PLANTS } from '@/config/us-power-plants';

export type SearchResultKind = 'plant' | 'field' | 'terminal' | 'pipeline' | 'country' | 'state' | 'region';

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  name: string;
  icon: string;
  subtitle: string;
  lat: number;
  lon: number;
  zoom: number;
  popupType?: string;
  popupData?: unknown;
}

interface IndexEntry extends SearchResult {
  nameLower: string;
  tokens: string;
}

// ─── Static geo data ────────────────────────────────────────────────────────

const COUNTRY_CENTROIDS: Array<{ name: string; lat: number; lon: number; aliases?: string[] }> = [
  { name: 'United States', lat: 39.5, lon: -98.35, aliases: ['usa', 'us', 'america'] },
  { name: 'Russia', lat: 61.0, lon: 105.0 },
  { name: 'Saudi Arabia', lat: 23.9, lon: 45.1, aliases: ['ksa'] },
  { name: 'China', lat: 35.5, lon: 105.0 },
  { name: 'Iraq', lat: 33.0, lon: 43.8 },
  { name: 'UAE', lat: 23.4, lon: 53.9, aliases: ['united arab emirates'] },
  { name: 'Kuwait', lat: 29.4, lon: 47.7 },
  { name: 'Iran', lat: 32.4, lon: 53.7 },
  { name: 'Qatar', lat: 25.4, lon: 51.2 },
  { name: 'Venezuela', lat: 8.0, lon: -66.0 },
  { name: 'Nigeria', lat: 9.1, lon: 8.7 },
  { name: 'Libya', lat: 26.3, lon: 17.2 },
  { name: 'Algeria', lat: 28.0, lon: 2.6 },
  { name: 'Kazakhstan', lat: 48.0, lon: 68.0 },
  { name: 'Canada', lat: 56.1, lon: -106.3 },
  { name: 'Mexico', lat: 23.6, lon: -102.6 },
  { name: 'Brazil', lat: -14.2, lon: -51.9 },
  { name: 'Norway', lat: 60.5, lon: 8.5 },
  { name: 'United Kingdom', lat: 55.4, lon: -3.4, aliases: ['uk', 'gb', 'britain'] },
  { name: 'Germany', lat: 51.2, lon: 10.5 },
  { name: 'France', lat: 46.2, lon: 2.2 },
  { name: 'Australia', lat: -25.3, lon: 133.8 },
  { name: 'India', lat: 20.6, lon: 78.9 },
  { name: 'Indonesia', lat: -0.8, lon: 113.9 },
  { name: 'Malaysia', lat: 4.2, lon: 108.0 },
  { name: 'Azerbaijan', lat: 40.1, lon: 47.6 },
  { name: 'Turkmenistan', lat: 38.9, lon: 59.6 },
  { name: 'Angola', lat: -11.2, lon: 17.9 },
  { name: 'Egypt', lat: 26.8, lon: 30.8 },
  { name: 'Oman', lat: 21.5, lon: 55.9 },
  { name: 'Colombia', lat: 4.1, lon: -72.9 },
  { name: 'Argentina', lat: -38.4, lon: -63.6 },
  { name: 'Ecuador', lat: -1.8, lon: -78.2 },
  { name: 'Pakistan', lat: 30.4, lon: 69.3 },
  { name: 'Japan', lat: 36.2, lon: 138.3 },
  { name: 'South Korea', lat: 35.9, lon: 127.9, aliases: ['korea'] },
  { name: 'Turkey', lat: 39.0, lon: 35.2 },
  { name: 'Ukraine', lat: 49.0, lon: 31.5 },
  { name: 'Poland', lat: 51.9, lon: 19.1 },
  { name: 'Netherlands', lat: 52.3, lon: 5.3 },
  { name: 'Trinidad and Tobago', lat: 10.7, lon: -61.2 },
  { name: 'Ghana', lat: 7.9, lon: -1.2 },
  { name: 'Mozambique', lat: -18.7, lon: 35.5 },
  { name: 'Tanzania', lat: -6.4, lon: 34.9 },
  { name: 'South Africa', lat: -30.6, lon: 22.9 },
  { name: 'Myanmar', lat: 19.2, lon: 96.7 },
  { name: 'Thailand', lat: 15.9, lon: 100.9 },
  { name: 'Bahrain', lat: 26.1, lon: 50.6 },
  { name: 'Papua New Guinea', lat: -6.3, lon: 143.9 },
  { name: 'Senegal', lat: 14.4, lon: -14.5 },
];

const US_STATES: Array<{ code: string; name: string; lat: number; lon: number }> = [
  { code: 'AL', name: 'Alabama', lat: 32.8, lon: -86.8 },
  { code: 'AK', name: 'Alaska', lat: 64.2, lon: -153.4 },
  { code: 'AZ', name: 'Arizona', lat: 34.3, lon: -111.1 },
  { code: 'AR', name: 'Arkansas', lat: 34.9, lon: -92.4 },
  { code: 'CA', name: 'California', lat: 36.8, lon: -119.4 },
  { code: 'CO', name: 'Colorado', lat: 39.1, lon: -105.4 },
  { code: 'CT', name: 'Connecticut', lat: 41.6, lon: -72.7 },
  { code: 'DE', name: 'Delaware', lat: 38.9, lon: -75.5 },
  { code: 'FL', name: 'Florida', lat: 27.8, lon: -81.7 },
  { code: 'GA', name: 'Georgia', lat: 32.2, lon: -83.4 },
  { code: 'HI', name: 'Hawaii', lat: 20.1, lon: -156.1 },
  { code: 'ID', name: 'Idaho', lat: 44.4, lon: -114.5 },
  { code: 'IL', name: 'Illinois', lat: 40.4, lon: -89.0 },
  { code: 'IN', name: 'Indiana', lat: 40.3, lon: -86.1 },
  { code: 'IA', name: 'Iowa', lat: 42.0, lon: -93.2 },
  { code: 'KS', name: 'Kansas', lat: 38.5, lon: -98.4 },
  { code: 'KY', name: 'Kentucky', lat: 37.7, lon: -84.7 },
  { code: 'LA', name: 'Louisiana', lat: 31.2, lon: -92.0 },
  { code: 'ME', name: 'Maine', lat: 45.4, lon: -69.0 },
  { code: 'MD', name: 'Maryland', lat: 39.1, lon: -76.8 },
  { code: 'MA', name: 'Massachusetts', lat: 42.2, lon: -71.5 },
  { code: 'MI', name: 'Michigan', lat: 44.3, lon: -85.6 },
  { code: 'MN', name: 'Minnesota', lat: 46.4, lon: -93.1 },
  { code: 'MS', name: 'Mississippi', lat: 32.7, lon: -89.7 },
  { code: 'MO', name: 'Missouri', lat: 38.5, lon: -92.3 },
  { code: 'MT', name: 'Montana', lat: 47.0, lon: -110.4 },
  { code: 'NE', name: 'Nebraska', lat: 41.5, lon: -99.9 },
  { code: 'NV', name: 'Nevada', lat: 38.5, lon: -117.1 },
  { code: 'NH', name: 'New Hampshire', lat: 43.2, lon: -71.5 },
  { code: 'NJ', name: 'New Jersey', lat: 40.1, lon: -74.5 },
  { code: 'NM', name: 'New Mexico', lat: 34.3, lon: -106.0 },
  { code: 'NY', name: 'New York', lat: 43.3, lon: -74.2 },
  { code: 'NC', name: 'North Carolina', lat: 35.5, lon: -79.4 },
  { code: 'ND', name: 'North Dakota', lat: 47.5, lon: -100.5 },
  { code: 'OH', name: 'Ohio', lat: 40.4, lon: -82.8 },
  { code: 'OK', name: 'Oklahoma', lat: 35.6, lon: -97.5 },
  { code: 'OR', name: 'Oregon', lat: 44.6, lon: -122.1 },
  { code: 'PA', name: 'Pennsylvania', lat: 40.6, lon: -77.2 },
  { code: 'RI', name: 'Rhode Island', lat: 41.7, lon: -71.5 },
  { code: 'SC', name: 'South Carolina', lat: 33.8, lon: -80.9 },
  { code: 'SD', name: 'South Dakota', lat: 44.4, lon: -100.2 },
  { code: 'TN', name: 'Tennessee', lat: 35.9, lon: -86.7 },
  { code: 'TX', name: 'Texas', lat: 31.1, lon: -97.6 },
  { code: 'UT', name: 'Utah', lat: 39.3, lon: -111.1 },
  { code: 'VT', name: 'Vermont', lat: 44.0, lon: -72.7 },
  { code: 'VA', name: 'Virginia', lat: 37.8, lon: -79.5 },
  { code: 'WA', name: 'Washington', lat: 47.4, lon: -121.5 },
  { code: 'WV', name: 'West Virginia', lat: 38.7, lon: -80.7 },
  { code: 'WI', name: 'Wisconsin', lat: 44.5, lon: -89.5 },
  { code: 'WY', name: 'Wyoming', lat: 43.1, lon: -107.3 },
];

const ENERGY_REGIONS: Array<{ name: string; lat: number; lon: number; zoom: number }> = [
  { name: 'Permian Basin', lat: 31.95, lon: -102.1, zoom: 7 },
  { name: 'Caspian Sea', lat: 42.0, lon: 51.0, zoom: 5 },
  { name: 'Gulf of Mexico', lat: 26.0, lon: -90.0, zoom: 5 },
  { name: 'North Sea', lat: 57.0, lon: 2.0, zoom: 5 },
  { name: 'Middle East', lat: 28.0, lon: 48.0, zoom: 4 },
  { name: 'Persian Gulf', lat: 26.5, lon: 51.5, zoom: 6 },
  { name: 'South China Sea', lat: 15.0, lon: 115.0, zoom: 5 },
  { name: 'Niger Delta', lat: 5.0, lon: 6.5, zoom: 7 },
  { name: 'Marcellus Shale', lat: 41.0, lon: -77.5, zoom: 6 },
  { name: 'Eagle Ford', lat: 28.7, lon: -98.5, zoom: 7 },
  { name: 'Bakken', lat: 48.1, lon: -103.5, zoom: 7 },
  { name: 'Alberta Oil Sands', lat: 57.0, lon: -111.5, zoom: 6 },
  { name: 'Santos Basin', lat: -25.0, lon: -42.0, zoom: 6 },
  { name: 'Vaca Muerta', lat: -38.5, lon: -69.0, zoom: 7 },
  { name: 'Southern Gas Corridor', lat: 40.0, lon: 45.0, zoom: 4 },
  { name: 'ERCOT Grid', lat: 31.5, lon: -99.0, zoom: 5 },
  { name: 'PJM Region', lat: 39.5, lon: -77.5, zoom: 5 },
];

const FUEL_LABELS: Record<string, string> = {
  natural_gas: 'Natural Gas', coal: 'Coal', nuclear: 'Nuclear',
  wind: 'Wind', solar: 'Solar', hydro: 'Hydro', oil: 'Oil',
  biomass: 'Biomass', geothermal: 'Geothermal', other: 'Other',
};

const PLANT_PRIMARY_LIMIT = 5000;

// ─── Index types ─────────────────────────────────────────────────────────────

export interface SearchIndex {
  primary: IndexEntry[];
  secondary: IndexEntry[];
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export function buildSearchIndex(fields: GlobalOilGasField[], pipelines: GlobalPipeline[]): SearchIndex {
  const primary: IndexEntry[] = [];
  const secondary: IndexEntry[] = [];

  // Tally plants per state/country for subtitles
  const plantsPerState: Record<string, number> = {};
  const plantsPerCountry: Record<string, number> = {};
  for (const p of US_POWER_PLANTS) {
    if (p.state) plantsPerState[p.state] = (plantsPerState[p.state] ?? 0) + 1;
    const c = p.country ?? 'United States';
    plantsPerCountry[c] = (plantsPerCountry[c] ?? 0) + 1;
  }
  const fieldsPerCountry: Record<string, number> = {};
  for (const f of fields) {
    fieldsPerCountry[f.country] = (fieldsPerCountry[f.country] ?? 0) + 1;
  }

  // Plants sorted by capacity desc — top N go to primary, rest to secondary
  const sorted = [...US_POWER_PLANTS].sort((a, b) => b.capacityMW - a.capacityMW);
  for (const [i, p] of sorted.entries()) {
    const fuel = FUEL_LABELS[p.fuelType] ?? p.fuelType;
    const location = p.state ?? p.country ?? 'United States';
    const entry: IndexEntry = {
      kind: 'plant', id: p.id, name: p.name, icon: '⚡',
      subtitle: `Power Plant · ${fuel} · ${location}`,
      lat: p.lat, lon: p.lon, zoom: 10,
      popupType: 'usPlant', popupData: p,
      nameLower: p.name.toLowerCase(),
      tokens: `${p.name} ${p.operator} ${p.state ?? ''} ${p.country ?? 'United States'} ${fuel}`.toLowerCase(),
    };
    (i < PLANT_PRIMARY_LIMIT ? primary : secondary).push(entry);
  }

  // Oil & gas fields and LNG terminals
  for (const f of fields) {
    const isTerminal = f.facilityType === 'export' || f.facilityType === 'import';
    const kind: SearchResultKind = isTerminal ? 'terminal' : 'field';
    const icon = isTerminal ? '🏭' : '🛢️';
    const typeTag = isTerminal
      ? `LNG Terminal · ${f.facilityType === 'export' ? 'Export' : 'Import'} · ${f.country}`
      : `Oil & Gas Field · ${f.commodity} · ${f.country}`;
    primary.push({
      kind, id: f.id, name: f.name, icon, subtitle: typeTag,
      lat: f.lat, lon: f.lon, zoom: isTerminal ? 10 : 8,
      popupType: 'oilGasField', popupData: f,
      nameLower: f.name.toLowerCase(),
      tokens: `${f.name} ${f.operator} ${f.country} ${f.commodity} ${f.basin ?? ''} ${f.subnatUnit ?? ''}`.toLowerCase(),
    });
  }

  // Pipelines — midpoint of coordinate array ([lon, lat] GeoJSON order)
  for (const p of pipelines) {
    const mid = p.coordinates[Math.floor(p.coordinates.length / 2)] ?? [0, 0];
    primary.push({
      kind: 'pipeline', id: p.id, name: p.name, icon: '🔵',
      subtitle: `Pipeline · ${p.commodity} · ${p.countries ?? p.region}`,
      lat: mid[1], lon: mid[0], zoom: 5,
      popupType: 'oilGasPipeline', popupData: p,
      nameLower: p.name.toLowerCase(),
      tokens: `${p.name} ${p.operator} ${p.countries ?? ''} ${p.region} ${p.commodity}`.toLowerCase(),
    });
  }

  // Countries
  for (const c of COUNTRY_CENTROIDS) {
    const pc = plantsPerCountry[c.name] ?? 0;
    const fc = fieldsPerCountry[c.name] ?? 0;
    const detail = [pc && `${pc} plants`, fc && `${fc} fields`].filter(Boolean).join(', ');
    primary.push({
      kind: 'country', id: `country:${c.name}`, name: c.name, icon: '🌍',
      subtitle: `Country${detail ? ` · ${detail}` : ''}`,
      lat: c.lat, lon: c.lon, zoom: 4,
      nameLower: c.name.toLowerCase(),
      tokens: `${c.name} ${(c.aliases ?? []).join(' ')}`.toLowerCase(),
    });
  }

  // US states
  for (const s of US_STATES) {
    const count = plantsPerState[s.code] ?? 0;
    primary.push({
      kind: 'state', id: `state:${s.code}`, name: s.name, icon: '🗺️',
      subtitle: `US State · ${count} plants`,
      lat: s.lat, lon: s.lon, zoom: 6,
      nameLower: s.name.toLowerCase(),
      tokens: `${s.name} ${s.code}`.toLowerCase(),
    });
  }

  // Key energy regions
  for (const r of ENERGY_REGIONS) {
    primary.push({
      kind: 'region', id: `region:${r.name}`, name: r.name, icon: '📍',
      subtitle: 'Energy Region',
      lat: r.lat, lon: r.lon, zoom: r.zoom,
      nameLower: r.name.toLowerCase(),
      tokens: r.name.toLowerCase(),
    });
  }

  return { primary, secondary };
}

// ─── Query ────────────────────────────────────────────────────────────────────

function score(entry: IndexEntry, q: string): number {
  const n = entry.nameLower;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  if (n.includes(q)) return 60;
  if (entry.tokens.includes(q)) return 40;
  return 0;
}

export function queryIndex(index: SearchIndex, raw: string, limit = 10): SearchResult[] {
  const q = raw.trim().toLowerCase();
  if (!q) return [];

  const scored: Array<{ e: IndexEntry; s: number }> = [];

  for (const e of index.primary) {
    const s = score(e, q);
    if (s > 0) scored.push({ e, s });
  }

  if (q.length >= 3) {
    for (const e of index.secondary) {
      const s = score(e, q);
      if (s > 0) scored.push({ e, s });
    }
  }

  scored.sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name));

  return scored.slice(0, limit).map(({ e }) => ({
    kind: e.kind, id: e.id, name: e.name, icon: e.icon,
    subtitle: e.subtitle, lat: e.lat, lon: e.lon, zoom: e.zoom,
    popupType: e.popupType, popupData: e.popupData,
  }));
}
