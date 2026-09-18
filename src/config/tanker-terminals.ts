// Auto-generated from worker/ais/terminals.geojson
// Re-run: node scripts/gen-tanker-terminals.mjs
// Do not edit by hand — edit terminals.geojson and regenerate.

export interface TankerTerminal {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
}

export const TANKER_TERMINALS: TankerTerminal[] = [
  {
    "id": "rotterdam",
    "name": "Rotterdam (Europoort / Maasvlakte)",
    "country": "Netherlands",
    "lat": 51.932,
    "lon": 4.07
  },
  {
    "id": "houston",
    "name": "Houston Ship Channel",
    "country": "United States",
    "lat": 29.68,
    "lon": -95.12
  },
  {
    "id": "corpus_christi",
    "name": "Corpus Christi Ship Channel",
    "country": "United States",
    "lat": 27.828,
    "lon": -97.27
  }
];
