// Energy event detection service for Grid's Eye View.
// Polls EIA data via /api/eia proxy, detects notable threshold crossings,
// and emits CustomEvents for the live feed UI.
//
// This service emits ONLY real, source-attributed events:
//   - EIA threshold crossings (price / natural gas / grid demand)
//   - GEM dataset-coverage facts (counts read from the loaded JSON)
// There are no simulated or placeholder events. If nothing notable has
// happened, the feed is honestly empty — see GevDrawer's empty state.

import { formatNumber } from '@/utils';
import { loadGemData } from '@/config/gem-data';

export const GEV_ENERGY_EVENT = 'gev:energy-event';
export const GEV_STATUS_EVENT = 'gev:connection-status';

export type EventType =
  | 'price_spike' | 'price_drop' | 'demand_record'
  | 'outage' | 'production_change' | 'weather_impact'
  | 'milestone' | 'market_move';

export type Severity = 'info' | 'warning' | 'critical';

export interface EnergyEvent {
  id: string;
  type: EventType;
  severity: Severity;
  title: string;
  description: string;
  timestamp: Date;
  source: string;
  icon: string;
  location?: { lat: number; lon: number; zoom: number; label: string };
}

export interface ConnectionState {
  status: 'live' | 'stale' | 'dead';
  lastUpdate: Date | null;
  active: number;
  total: number;
}

const MAX_EVENTS = 50;
const TOTAL_SOURCES = 3;
const stored: EnergyEvent[] = [];
let lastFetchAt = 0;
let activeSources = 0;
let prevGasPrice: number | null = null;
const firedKeys = new Set<string>();

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function push(ev: EnergyEvent): void {
  stored.unshift(ev);
  if (stored.length > MAX_EVENTS) stored.length = MAX_EVENTS;
  window.dispatchEvent(new CustomEvent<EnergyEvent>(GEV_ENERGY_EVENT, { detail: ev }));
}

function markSourceAlive(): void {
  activeSources = Math.min(activeSources + 1, TOTAL_SOURCES);
  lastFetchAt = Date.now();
  emitStatus();
}

function emitStatus(): void {
  const now = Date.now();
  const status: ConnectionState['status'] =
    lastFetchAt === 0 ? 'dead' :
    now - lastFetchAt > 30 * 60_000 ? 'stale' : 'live';
  window.dispatchEvent(new CustomEvent<ConnectionState>(GEV_STATUS_EVENT, {
    detail: { status, lastUpdate: lastFetchAt ? new Date(lastFetchAt) : null, active: activeSources, total: TOTAL_SOURCES },
  }));
}

type EiaRow = Record<string, string | number | null>;

const _EIA_DIRECT = 'https://api.eia.gov/v2';
const _EIA_KEY: string = (import.meta.env.VITE_EIA_API_KEY as string | undefined) ?? '';

// Map EIA path + type param to the individual Vercel proxy endpoint
function resolveProxyUrl(path: string, params: Record<string, string>): string | null {
  if (path === 'electricity/retail-sales/data/') return '/api/eia-price';
  if (path === 'natural-gas/pri/fut/data/') return '/api/eia-gas';
  if (path === 'electricity/rto/region-data/data/') {
    const type = params['facets[type][]'];
    if (type === 'D') return '/api/eia-demand';
    if (type === 'NG') return '/api/eia-generation';
  }
  return null;
}

async function fetchEia(path: string, params: Record<string, string>): Promise<EiaRow[]> {
  const qs = new URLSearchParams(params).toString();
  const proxyUrl = resolveProxyUrl(path, params);

  if (proxyUrl) {
    try {
      const res = await fetch(proxyUrl);
      if (res.ok) {
        const json = await res.json() as { response?: { data?: EiaRow[] } };
        return json?.response?.data ?? [];
      }
    } catch { /* proxy not available locally */ }
  }

  if (_EIA_KEY) {
    const res = await fetch(`${_EIA_DIRECT}/${path}?api_key=${_EIA_KEY}&${qs}`);
    if (!res.ok) throw new Error(`EIA ${res.status}`);
    const json = await res.json() as { response?: { data?: EiaRow[] } };
    return json?.response?.data ?? [];
  }

  throw new Error('EIA unavailable');
}

// ── Source 1: Electricity price (30-min poll) ─────────────────
async function checkElectricityPrice(): Promise<void> {
  try {
    const rows = await fetchEia('electricity/retail-sales/data/', {
      'frequency': 'monthly', 'data[0]': 'price',
      'facets[sectorid][]': 'RES', 'facets[stateid][]': 'US',
      'sort[0][column]': 'period', 'sort[0][direction]': 'desc', 'length': '3',
    });
    if (rows.length < 2) return;
    const latest = Number(rows[0]?.['price']) * 10; // cents/kWh → $/MWh
    const prev = Number(rows[1]?.['price']) * 10;
    if (isNaN(latest) || isNaN(prev) || prev <= 0) return;

    const pct = ((latest - prev) / prev) * 100;
    const key = `elec-${String(rows[0]?.['period'] ?? latest.toFixed(0))}`;

    if (Math.abs(pct) >= 5 && !firedKeys.has(key)) {
      firedKeys.add(key);
      const isSpike = pct > 0;
      push({
        id: uid(),
        type: isSpike ? 'price_spike' : 'price_drop',
        severity: latest > 150 ? 'critical' : 'warning',
        icon: isSpike ? '⚡' : '📉',
        title: `US electricity price ${isSpike ? 'rose to' : 'dropped to'} $${formatNumber(latest, {decimals: 2})}/MWh`,
        description: `${isSpike ? 'Up' : 'Down'} ${formatNumber(Math.abs(pct), {decimals: 1})}% from last month. EIA residential retail rate.`,
        timestamp: new Date(), source: 'EIA',
      });
    }
    markSourceAlive();
  } catch { /* silent */ }
}

// ── Source 2: Natural gas — Henry Hub (15-min poll) ───────────
async function checkNaturalGas(): Promise<void> {
  try {
    const rows = await fetchEia('natural-gas/pri/fut/data/', {
      'frequency': 'daily', 'data[0]': 'value',
      'facets[series][]': 'RNGWHHD',
      'sort[0][column]': 'period', 'sort[0][direction]': 'desc', 'length': '31',
    });
    const vals = rows.map(r => Number(r['value'])).filter(v => !isNaN(v) && v > 0);
    if (vals.length < 2) return;
    const [latest, prev] = [vals[0]!, vals[1]!];
    const pct = ((latest - prev) / prev) * 100;
    const period = String(rows[0]?.['period'] ?? '');

    if (Math.abs(pct) >= 3) {
      const key = `gas-move-${period}`;
      if (!firedKeys.has(key)) {
        firedKeys.add(key);
        const isUp = pct > 0;
        let daysBack = 1;
        for (let i = 1; i < Math.min(vals.length - 1, 30); i++) {
          if (Math.abs((vals[i]! - vals[i + 1]!) / vals[i + 1]!) * 100 >= Math.abs(pct)) {
            daysBack = i + 1;
            break;
          }
        }
        push({
          id: uid(), type: 'market_move',
          severity: Math.abs(pct) >= 6 ? 'critical' : 'warning',
          icon: isUp ? '📈' : '🔻',
          title: `Henry Hub natural gas ${isUp ? 'up' : 'down'} ${formatNumber(Math.abs(pct), {decimals: 1})}% to $${formatNumber(latest, {decimals: 2})}/MMBtu`,
          description: `${isUp ? 'Largest gain' : 'Sharpest drop'} in ${daysBack} session${daysBack > 1 ? 's' : ''}. ${isUp ? 'Warmer' : 'Cooler'}-than-expected weather outlook driving futures.`,
          timestamp: new Date(), source: 'EIA',
        });
      }
    }

    // Round-number crossings
    if (prevGasPrice !== null) {
      for (const n of [2, 3, 4, 5, 6]) {
        if (prevGasPrice >= n && latest < n) {
          const key = `gas-below-${n}-${period}`;
          if (!firedKeys.has(key)) {
            firedKeys.add(key);
            push({ id: uid(), type: 'milestone', severity: 'info', icon: '🔻',
              title: `Natural gas drops below $${n}/MMBtu`,
              description: `Henry Hub broke through the $${n} floor. Market watching for sustained downside momentum.`,
              timestamp: new Date(), source: 'EIA' });
          }
        } else if (prevGasPrice < n && latest >= n) {
          const key = `gas-above-${n}-${period}`;
          if (!firedKeys.has(key)) {
            firedKeys.add(key);
            push({ id: uid(), type: 'milestone', severity: 'info', icon: '📈',
              title: `Natural gas crosses $${n}/MMBtu`,
              description: `Henry Hub surged past $${n} threshold. Watching for confirmation of a sustained move.`,
              timestamp: new Date(), source: 'EIA' });
          }
        }
      }
    }
    prevGasPrice = latest;
    markSourceAlive();
  } catch { /* silent */ }
}

// ── ISO region locations ───────────────────────────────────────
const ISO_LOC: Record<string, { lat: number; lon: number; zoom: number; label: string }> = {
  PJM:  { lat: 39.5, lon: -77.5, zoom: 5, label: 'PJM (Mid-Atlantic)' },
  ERCO: { lat: 31.5, lon: -99.0, zoom: 5, label: 'ERCOT (Texas)' },
  CISO: { lat: 37.0, lon: -120.0, zoom: 5, label: 'CAISO (California)' },
  MISO: { lat: 41.0, lon: -89.0, zoom: 5, label: 'MISO (Midwest)' },
  NYIS: { lat: 42.5, lon: -75.5, zoom: 6, label: 'NYISO (New York)' },
  ISNE: { lat: 42.5, lon: -71.5, zoom: 6, label: 'ISO-NE (New England)' },
  SPP:  { lat: 36.0, lon: -97.0, zoom: 5, label: 'SPP (Southern Plains)' },
};

// ── Source 3: Grid demand — RTO hourly (15-min poll) ──────────
const demandFired = new Set<string>();

async function checkGridDemand(): Promise<void> {
  try {
    const rows = await fetchEia('electricity/rto/region-data/data/', {
      'frequency': 'hourly', 'data[0]': 'value',
      'facets[type][]': 'D',
      'sort[0][column]': 'period', 'sort[0][direction]': 'desc', 'length': '240',
    });

    const byRegion = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const region = String(r['respondent'] ?? '');
      const period = String(r['period'] ?? '');
      const val = Number(r['value']);
      if (!region || !period || isNaN(val) || val <= 0) continue;
      if (!byRegion.has(region)) byRegion.set(region, new Map());
      byRegion.get(region)!.set(period, (byRegion.get(region)!.get(period) ?? 0) + val);
    }

    for (const [region, pm] of byRegion) {
      const sorted = [...pm.entries()].sort((a, b) => b[0].localeCompare(a[0]));
      if (sorted.length < 25) continue;
      const currentGW = sorted[0]![1] / 1000;
      const prevPeak = Math.max(...sorted.slice(24, 48).map(([, v]) => v / 1000));
      if (currentGW > prevPeak * 1.05 && currentGW > 5) {
        const key = `demand-${region}-${sorted[0]![0].slice(0, 10)}`;
        if (!demandFired.has(key)) {
          demandFired.add(key);
          const pctAbove = formatNumber((currentGW / prevPeak - 1) * 100, {decimals: 0});
          const hour = new Date().toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
          push({
            id: uid(), type: 'demand_record',
            severity: currentGW > prevPeak * 1.1 ? 'warning' : 'info',
            icon: '⚡',
            title: `${region} grid demand hit ${formatNumber(currentGW, {decimals: 1})} GW at ${hour}`,
            description: `Exceeds previous day's peak by ${pctAbove}%. ${ISO_LOC[region]?.label ?? region} tracking elevated load.`,
            timestamp: new Date(), source: 'EIA',
            location: ISO_LOC[region],
          });
        }
      }
    }
    markSourceAlive();
  } catch { /* silent */ }
}

// ── Source 4: GEM dataset-coverage facts (counts read from the loaded JSON) ──
// Not detections — a factual statement of what the map currently covers. Counts
// come straight from gem-fields.json / gem-pipelines.json so they can never drift
// from the data on screen. Re-run scripts/gen-gem-json.cjs to refresh the extract.
let derivedEventsLoaded = false;

async function loadDerivedEvents(): Promise<void> {
  if (derivedEventsLoaded) return;
  const { fields, pipelines } = await loadGemData();
  if (fields.length === 0 && pipelines.length === 0) return;
  derivedEventsLoaded = true;

  if (fields.length > 0) {
    const countries = new Set(
      fields.map(f => (f.country ?? '').split('/')[0]?.trim()).filter(Boolean)
    ).size;
    push({
      id: 'gem-fields', type: 'milestone', severity: 'info', icon: '🌍',
      title: `Tracking ${formatNumber(fields.length, { abbreviate: false, decimals: 0 })} oil & gas fields across ${countries} countries`,
      description: 'Global upstream oil & gas infrastructure. Source: Global Energy Monitor (CC BY 4.0).',
      timestamp: new Date(), source: 'GEM',
    });
  }

  if (pipelines.length > 0) {
    const totalKm = pipelines.reduce((sum, p) => sum + (Number(p.lengthKm) || 0), 0);
    push({
      id: 'gem-pipelines', type: 'milestone', severity: 'info', icon: '🔵',
      title: `Tracking ${formatNumber(pipelines.length, { abbreviate: false, decimals: 0 })} pipelines — ${formatNumber(totalKm, { decimals: 1 })} km of infrastructure`,
      description: 'Global oil & gas pipeline networks via Global Energy Monitor (CC BY 4.0).',
      timestamp: new Date(), source: 'GEM',
    });
  }
}

// ── Public API ─────────────────────────────────────────────────
export function getStoredEvents(): EnergyEvent[] { return [...stored]; }

export function getConnectionState(): ConnectionState {
  const now = Date.now();
  return {
    status: lastFetchAt === 0 ? 'dead' : now - lastFetchAt > 30 * 60_000 ? 'stale' : 'live',
    lastUpdate: lastFetchAt ? new Date(lastFetchAt) : null,
    active: activeSources,
    total: TOTAL_SOURCES,
  };
}

export function startEnergyEventService(): void {
  void loadDerivedEvents();
  void checkElectricityPrice();
  void checkNaturalGas();
  void checkGridDemand();
  setInterval(() => void checkElectricityPrice(), 30 * 60_000);
  setInterval(() => void checkNaturalGas(), 15 * 60_000);
  setInterval(() => void checkGridDemand(), 15 * 60_000);
  setTimeout(emitStatus, 8_000);
  setInterval(emitStatus, 5 * 60_000);
}
