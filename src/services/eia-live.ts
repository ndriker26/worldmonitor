// EIA requests go through /api/eia/ on Vercel (key injected server-side).
// On local dev the proxy returns 404, so we fall back to the direct EIA API
// using VITE_EIA_API_KEY (a free public key — safe to expose in dev).
const PROXY_BASE = '/api/eia';
const DIRECT_BASE = 'https://api.eia.gov/v2';
const DEV_KEY: string = (import.meta.env.VITE_EIA_API_KEY as string | undefined) ?? '';
const CACHE_TTL_MS = 15 * 60 * 1000;

interface CacheEntry<T> { data: T; ts: number }
const cache = new Map<string, CacheEntry<unknown>>();

function isFresh<T>(entry: CacheEntry<T>): boolean {
  return Date.now() - entry.ts < CACHE_TTL_MS;
}

// Support multi-value params (e.g. facets[respondent][] for multiple RTOs)
function buildQS(params: Record<string, string | string[]>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) { for (const vi of v) sp.append(k, vi); }
    else sp.set(k, v);
  }
  return sp.toString();
}

async function eia<T>(path: string, params: Record<string, string | string[]>): Promise<T> {
  const qs = buildQS(params);
  const cacheKey = `${path}?${qs}`;

  const cached = cache.get(cacheKey) as CacheEntry<T> | undefined;
  if (cached && isFresh(cached)) return cached.data;

  // Try Vercel edge-function proxy first
  try {
    const res = await fetch(`${PROXY_BASE}/${path}?${qs}`);
    if (res.ok) {
      const json = await res.json() as { response?: { data?: unknown[] } };
      const data = (json?.response?.data ?? []) as T;
      cache.set(cacheKey, { data, ts: Date.now() });
      return data;
    }
  } catch { /* proxy unavailable in local dev */ }

  // Fallback: call EIA API directly (requires VITE_EIA_API_KEY in .env)
  if (DEV_KEY) {
    const res = await fetch(`${DIRECT_BASE}/${path}?api_key=${DEV_KEY}&${qs}`);
    if (!res.ok) throw new Error(`EIA direct ${res.status}: ${path}`);
    const json = await res.json() as { response?: { data?: unknown[] } };
    const data = (json?.response?.data ?? []) as T;
    cache.set(cacheKey, { data, ts: Date.now() });
    return data;
  }

  throw new Error('EIA unavailable: proxy failed and VITE_EIA_API_KEY not set');
}

export interface MetricResult {
  value: number;
  unit: string;
  label: string;
  sparkline: number[];
  trend: '+' | '-' | '';
  changePct: string;
}

type EiaRow = Record<string, string | number | null>;

export async function fetchElectricityPrice(): Promise<MetricResult> {
  const rows = await eia<EiaRow[]>('electricity/retail-sales/data/', {
    'frequency': 'monthly',
    'data[0]': 'price',
    'facets[sectorid][]': 'RES',
    'facets[stateid][]': 'US',
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    'length': '13',
  });
  // Price is in cents/kWh; ×10 → $/MWh
  const vals = rows
    .map(r => Number(r['price']) * 10)
    .filter(v => !isNaN(v) && v > 0)
    .slice(0, 12);
  const latest = vals[0] ?? 0;
  const prev = vals[1] ?? latest;
  const changePct = prev ? (((latest - prev) / prev) * 100).toFixed(1) : '0.0';
  return {
    value: latest,
    unit: '$/MWh',
    label: 'Electricity Price',
    sparkline: vals.slice(0, 12).reverse(),
    trend: latest > prev ? '+' : latest < prev ? '-' : '',
    changePct,
  };
}

export async function fetchNaturalGas(): Promise<MetricResult> {
  const rows = await eia<EiaRow[]>('natural-gas/pri/fut/data/', {
    'frequency': 'daily',
    'data[0]': 'value',
    'facets[series][]': 'RNGWHHD',
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    'length': '30',
  });
  const vals = rows
    .map(r => Number(r['value']))
    .filter(v => !isNaN(v) && v > 0)
    .slice(0, 30);
  const latest = vals[0] ?? 0;
  const prev = vals[1] ?? latest;
  const changePct = prev ? (((latest - prev) / prev) * 100).toFixed(1) : '0.0';
  return {
    value: latest,
    unit: '$/MMBtu',
    label: 'Nat. Gas (Henry Hub)',
    sparkline: vals.slice(0, 30).reverse(),
    trend: latest > prev ? '+' : latest < prev ? '-' : '',
    changePct,
  };
}

// The 7 major non-overlapping US ISO/RTO regions — summing only these
// avoids double-counting the hierarchical respondents EIA also reports.
const MAJOR_RTOS = ['PJM', 'ERCO', 'CISO', 'MISO', 'NYIS', 'ISNE', 'SPP'];

export async function fetchGridDemand(): Promise<MetricResult> {
  const rows = await eia<EiaRow[]>('electricity/rto/region-data/data/', {
    'frequency': 'hourly',
    'data[0]': 'value',
    'facets[type][]': 'D',
    'facets[respondent][]': MAJOR_RTOS,
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    'length': '500',
  });

  // Sum across the 7 major RTOs per hour (non-overlapping → accurate US total)
  const byPeriod = new Map<string, number>();
  for (const r of rows) {
    const period = String(r['period'] ?? '');
    const val = Number(r['value']);
    if (!period || isNaN(val)) continue;
    byPeriod.set(period, (byPeriod.get(period) ?? 0) + val);
  }
  const sorted = Array.from(byPeriod.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 24)
    .map(([, v]) => v / 1000); // MW → GW

  const latest = sorted[0] ?? 0;
  const prev = sorted[1] ?? latest;
  const changePct = prev ? (((latest - prev) / prev) * 100).toFixed(1) : '0.0';
  return {
    value: latest,
    unit: 'GW demand',
    label: 'Grid Demand',
    sparkline: sorted.slice(0, 24).reverse(),
    trend: latest > prev ? '+' : latest < prev ? '-' : '',
    changePct,
  };
}

export async function fetchUSGeneration(): Promise<MetricResult> {
  const rows = await eia<EiaRow[]>('electricity/rto/region-data/data/', {
    'frequency': 'hourly',
    'data[0]': 'value',
    'facets[type][]': 'NG',
    'facets[respondent][]': MAJOR_RTOS,
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    'length': '500',
  });

  const byPeriod = new Map<string, number>();
  for (const r of rows) {
    const period = String(r['period'] ?? '');
    const val = Number(r['value']);
    if (!period || isNaN(val)) continue;
    byPeriod.set(period, (byPeriod.get(period) ?? 0) + val);
  }
  const sorted = Array.from(byPeriod.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 24)
    .map(([, v]) => v / 1000);

  const latest = sorted[0] ?? 0;
  const prev = sorted[1] ?? latest;
  const changePct = prev ? (((latest - prev) / prev) * 100).toFixed(1) : '0.0';
  return {
    value: latest,
    unit: 'GW generation',
    label: 'US Generation',
    sparkline: sorted.slice(0, 24).reverse(),
    trend: latest > prev ? '+' : latest < prev ? '-' : '',
    changePct,
  };
}

export async function fetchEIACountry(countryCode: string): Promise<{ production: string; consumption: string } | null> {
  try {
    const rows = await eia<EiaRow[]>('international/data/', {
      'frequency': 'annual',
      'data[0]': 'value',
      'facets[countryRegionCode][]': countryCode,
      'facets[productId][]': '44',
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
      'length': '1',
    });
    if (!rows.length) return null;
    const val = Number(rows[0]!['value']);
    return { production: isNaN(val) ? 'N/A' : `${val.toFixed(0)} quad BTU`, consumption: 'See EIA' };
  } catch {
    return null;
  }
}
