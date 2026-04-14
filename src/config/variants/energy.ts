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
export const DEFAULT_PANELS: Record<string, PanelConfig> = {
  // Core
  map: { name: 'Energy Infrastructure Map', enabled: true, priority: 1 },
  'live-news': { name: 'Energy Headlines', enabled: true, priority: 1 },
  insights: { name: 'AI Energy Insights', enabled: true, priority: 1 },
  // Energy & commodity context
  energy: { name: 'Energy Markets', enabled: true, priority: 1 },
  commodities: { name: 'Commodity Prices', enabled: true, priority: 1 },
  'energy-complex': { name: 'Energy Complex', enabled: true, priority: 1 },
  climate: { name: 'Climate & Weather Impact', enabled: true, priority: 2 },
  'supply-chain': { name: 'Supply Chain & Logistics', enabled: true, priority: 2 },
  // Situational awareness
  'strategic-posture': { name: 'Strategic Posture', enabled: true, priority: 2 },
  'world-clock': { name: 'World Clock', enabled: true, priority: 2 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

// ─────────────────────────────────────────────────────────────────────────────
// MAP LAYERS — Energy scaffold (Phase 1)
// Only contextual layers enabled. Energy-specific layers (power plants,
// transmission lines, ISO regions, grid outages) will be added in Phase 2.
// ─────────────────────────────────────────────────────────────────────────────
export const DEFAULT_MAP_LAYERS: MapLayers = {
  // ── Contextual layers for energy (ENABLED) ─────────────────────────────────
  weather: true,
  waterways: true,
  natural: true,
  fires: true,

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
  pipelines: false,
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
  // Contextual layers (reduced on mobile for performance)
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
  pipelines: false,
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
