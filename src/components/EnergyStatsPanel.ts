import { Panel } from './Panel';

/**
 * EnergyStatsPanel — a Grid's Eye View scaffold panel that renders four
 * at-a-glance energy metrics (electricity price, Henry Hub natural gas,
 * grid demand, active outages).
 *
 * The values here are intentionally static placeholders for Phase 4. A
 * later phase will wire each card to a live upstream source (EIA,
 * poweroutage.us, ISO feeds, etc.) — keeping the render shape stable
 * so the switch to live data is a one-line replacement.
 */

interface EnergyStat {
  key: string;
  label: string;
  value: string;
  unit: string;
  sub?: string;
}

const PLACEHOLDER_STATS: EnergyStat[] = [
  {
    key: 'electricity-price',
    label: 'Avg. Electricity Price',
    value: '$45.20',
    unit: '/ MWh',
    sub: 'US wholesale (placeholder)',
  },
  {
    key: 'henry-hub',
    label: 'Natural Gas (Henry Hub)',
    value: '$2.85',
    unit: '/ MMBtu',
    sub: 'Spot (placeholder)',
  },
  {
    key: 'grid-demand',
    label: 'Grid Demand',
    value: '425',
    unit: 'GW',
    sub: 'US total (placeholder)',
  },
  {
    key: 'active-outages',
    label: 'Active Outages',
    value: '12,450',
    unit: 'customers',
    sub: 'Affected nationwide (placeholder)',
  },
];

export class EnergyStatsPanel extends Panel {
  constructor() {
    super({
      id: 'energy-stats',
      title: 'Energy Stats',
      trackActivity: false,
      infoTooltip: 'Live US energy metrics. Values shown are placeholders while live feeds are wired.',
    });
    this.render();
  }

  private render(): void {
    const cards = PLACEHOLDER_STATS.map(stat => `
      <div class="energy-stat-card" data-stat="${stat.key}">
        <div class="energy-stat-label">${stat.label}</div>
        <div class="energy-stat-value-row">
          <span class="energy-stat-value">${stat.value}</span>
          <span class="energy-stat-unit">${stat.unit}</span>
        </div>
        ${stat.sub ? `<div class="energy-stat-sub">${stat.sub}</div>` : ''}
      </div>
    `).join('');

    this.setContent(`<div class="energy-stat-grid">${cards}</div>`);
  }
}
