// Energy variant - energy.gridmonitor.app — Focused on power generation, grid infrastructure, and energy markets
import type { PanelConfig, MapLayers } from '@/types';
import type { VariantConfig } from './base';

// Re-export base config
export * from './base';

// ─────────────────────────────────────────────────────────────────────────────
// PANEL CONFIGURATION — Energy-focused panels
// Minimal set for Phase 1 scaffold. Energy-specific panels (ISO prices,
// grid status, generation mix) will be added in later phases.
// ─────────────────────────────────────────────────────────────────────────────
// Grid's Eye View panels — Phase 4 focused set. See `src/config/panels.ts`
// for the canonical override list applied via VARIANT_PANEL_OVERRIDES.
export const DEFAULT_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Energy Infrastructure Map', enabled: true, priority: 1 },
  'energy-stats': { name: 'Energy Stats', enabled: true, priority: 1 },
  energy: { name: 'Energy News', enabled: true, priority: 1 },
  insights: { name: 'AI Energy Insights', enabled: true, priority: 1 },
  'energy-complex': { name: 'Energy Complex', enabled: true, priority: 1 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

// ─────────────────────────────────────────────────────────────────────────────
// MAP LAYERS — Energy variant (Phase 2)
// Energy-specific layers enabled. More (transmission lines, ISO regions,
// grid outages) will be added in later phases.
// ─────────────────────────────────────────────────────────────────────────────
export const DEFAULT_MAP_LAYERS: MapLayers = {
  // ── Energy layers (ENABLED) ────────────────────────────────────────────────
  usPlants: true,
  usTransmission: true,
  weather: true,
  waterways: true,
  natural: true,
  fires: true,
  // Pipelines intentionally omitted — Phase 4 spec limits the sidebar to
  // Power Plants, Transmission Lines, Weather, Natural/Fires, and Waterways.
  pipelines: false,

  // ── All non-energy layers (DISABLED) ───────────────────────────────────────
  // Geopolitical / military
  gpsJamming: false,
  satellites: false,
  iranAttacks: false,
  conflicts: false,
  bases: false,
  hotspots: false,
  nuclear: false,
  irradiators: false,
  military: false,
  spaceports: false,
  ucdpEvents: false,
  displacement: false,
  // Protests / civil unrest
  protests: false,
  // Transport / tracking
  ais: false,
  flights: false,
  // Infrastructure (non-energy)
  cables: false,
  outages: false,
  datacenters: false,
  // Sanctions / financial context
  sanctions: false,
  economic: false,
  // Environmental
  climate: false,
  // Tech variant layers
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance variant layers
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
  // Happy variant layers
  positiveEvents: false,
  kindness: false,
  happiness: false,
  speciesRecovery: false,
  renewableInstallations: false,
  // Trade routes
  tradeRoutes: false,
  // Commodity variant layers
  minerals: false,
  miningSites: false,
  processingPlants: false,
  commodityPorts: false,
  // Overlay
  dayNight: false,
  cyberThreats: false,
  ciiChoropleth: false,
  resilienceScore: false,
  webcams: false,
  diseaseOutbreaks: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// MOBILE MAP LAYERS — Minimal set for energy mobile view
// ─────────────────────────────────────────────────────────────────────────────
export const MOBILE_DEFAULT_MAP_LAYERS: MapLayers = {
  // Energy layers (reduced on mobile — 13k plants too heavy)
  usPlants: false,
  usTransmission: false,
  pipelines: false,
  weather: false,
  waterways: false,
  natural: true,
  fires: true,

  // All others disabled on mobile
  gpsJamming: false,
  satellites: false,
  iranAttacks: false,
  conflicts: false,
  bases: false,
  hotspots: false,
  nuclear: false,
  irradiators: false,
  military: false,
  spaceports: false,
  ucdpEvents: false,
  displacement: false,
  protests: false,
  ais: false,
  flights: false,
  cables: false,
  outages: false,
  datacenters: false,
  sanctions: false,
  economic: false,
  climate: false,
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
  positiveEvents: false,
  kindness: false,
  happiness: false,
  speciesRecovery: false,
  renewableInstallations: false,
  tradeRoutes: false,
  minerals: false,
  miningSites: false,
  processingPlants: false,
  commodityPorts: false,
  dayNight: false,
  cyberThreats: false,
  ciiChoropleth: false,
  resilienceScore: false,
  webcams: false,
  diseaseOutbreaks: false,
};

export const VARIANT_CONFIG: VariantConfig = {
  name: 'energy',
  description: 'Energy infrastructure, grid monitoring & power market intelligence',
  panels: DEFAULT_PANELS,
  mapLayers: DEFAULT_MAP_LAYERS,
  mobileMapLayers: MOBILE_DEFAULT_MAP_LAYERS,
};
