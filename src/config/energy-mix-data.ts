// Async loader for global electricity generation mix (Ember, CC-BY-4.0).
// Data lives in public/data/energy-mix.json — generated from the ingestion
// store (see ingestion/gridsight/export_energy_mix.py), NOT bundled into JS.
// Keyed by ISO alpha-2 (what the country panel receives); a few no-alpha-2
// territories fall back to their ISO-3 key.
//
// Call loadEnergyMix() before reading; use getCountryEnergyMix(code) for
// sync access anywhere after that.

export interface CountryGenerationMix {
  iso3: string;
  cadence: 'monthly' | 'yearly';
  period: string;        // "YYYY-MM"
  period_label: string;  // "Jun 2026" or "2024"
  total_twh: number;
  mix: Record<string, number>; // canonical fuel -> share (0..1), sums to ~1
}

interface EnergyMixData {
  attribution: string;
  metric: string;
  countries: Record<string, CountryGenerationMix>;
}

const _empty: EnergyMixData = { attribution: '', metric: 'generation', countries: {} };
let _cache: EnergyMixData | null = null;
let _pending: Promise<EnergyMixData> | null = null;

export function getEnergyMixAttribution(): string {
  return _cache?.attribution ?? '';
}

/** Latest generation mix for a country, or null if we have no data for it. */
export function getCountryEnergyMix(code: string | null | undefined): CountryGenerationMix | null {
  if (!code || !_cache) return null;
  return _cache.countries[code.trim().toUpperCase()] ?? null;
}

export async function loadEnergyMix(): Promise<EnergyMixData> {
  if (_cache) return _cache;
  if (_pending) return _pending;

  _pending = fetch('/data/energy-mix.json')
    .then((r) => (r.ok ? (r.json() as Promise<EnergyMixData>) : _empty))
    .then((data) => {
      _cache = data?.countries ? data : _empty;
      _pending = null;
      return _cache;
    })
    .catch(() => {
      _pending = null;
      return _empty;
    });

  return _pending;
}
