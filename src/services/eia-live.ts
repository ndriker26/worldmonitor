const BASE_URL = 'https://api.eia.gov/v2';
const API_KEY = import.meta.env.VITE_EIA_API_KEY as string;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CacheEntry<T> { data: T; ts: number }
const cache = new Map<string, CacheEntry<unknown>>();

function isFresh<T>(entry: CacheEntry<T>): boolean {
  return Date.now() - entry.ts < CACHE_TTL_MS;
}

async function eia<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}/${path}`);
  url.searchParams.set('api_key', API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const key = url.toString();

  const cached = cache.get(key) as CacheEntry<T> | undefined;
  if (cached && isFresh(cached)) return cached.data;

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`EIA ${res.status}: ${path}`);
  const json = await res.json() as { response?: { data?: T[] } };
  const data = (json?.response?.data ?? []) as T;
  cache.set(key, { data, ts: Date.now() });
  return data;
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
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    'length': '13',
  });
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

export async function fetchGridDemand(): Promise<MetricResult> {
  const rows = await eia<EiaRow[]>('electricity/rto/region-data/data/', {
    'frequency': 'hourly',
    'data[0]': 'value',
    'facets[type][]': 'D',
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    'length': '240', // 10 regions × 24 hours
  });

  // Group by period and sum across regions
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
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    'length': '240',
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
