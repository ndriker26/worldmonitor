import { GLOBAL_OILGAS_FIELDS } from '@/config/global-oilgas-fields';
import { GLOBAL_PIPELINES } from '@/config/global-pipelines';
import { US_POWER_PLANTS } from '@/config/us-power-plants';
import { toFlagEmoji } from '@/utils/country-flag';
import { fetchEIACountry } from '@/services/eia-live';

const FUEL_COLORS: Record<string, string> = {
  natural_gas: '#ff8c00', coal: '#3c3c3c', nuclear: '#ffdc00',
  wind: '#64b4ff', solar: '#ffe632', hydro: '#3282dc',
  oil: '#c83232', biomass: '#64b450', geothermal: '#b450c8', other: '#969696',
};
const FUEL_LABELS: Record<string, string> = {
  natural_gas: 'Nat. Gas', coal: 'Coal', nuclear: 'Nuclear',
  wind: 'Wind', solar: 'Solar', hydro: 'Hydro',
  oil: 'Oil', biomass: 'Biomass', geothermal: 'Geo.', other: 'Other',
};

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getCountryFields(countryName: string) {
  const lc = countryName.toLowerCase();
  return GLOBAL_OILGAS_FIELDS.filter(f => f.country.toLowerCase().includes(lc) || lc.includes(f.country.toLowerCase().split('/')[0]?.trim() ?? ''));
}

function getCountryPipelineCount(countryName: string): number {
  const lc = countryName.toLowerCase();
  return GLOBAL_PIPELINES.filter(p =>
    p.region.toLowerCase().includes(lc) ||
    p.operator.toLowerCase().includes(lc) ||
    p.name.toLowerCase().includes(lc)
  ).length;
}

function buildEnergyMixBar(isUSA: boolean): string {
  if (!isUSA) return '';
  const byFuel = new Map<string, number>();
  for (const p of US_POWER_PLANTS) {
    const fuel = p.fuelType ?? 'other';
    byFuel.set(fuel, (byFuel.get(fuel) ?? 0) + (p.capacityMW ?? 0));
  }
  const total = Array.from(byFuel.values()).reduce((a, b) => a + b, 0);
  if (total === 0) return '';

  const segments = Array.from(byFuel.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([fuel, mw]) => ({
      fuel,
      pct: (mw / total) * 100,
      color: FUEL_COLORS[fuel] ?? FUEL_COLORS.other!,
      label: FUEL_LABELS[fuel] ?? fuel,
    }));

  const bars = segments.map(s =>
    `<div class="gev-country-bar-seg" style="width:${s.pct.toFixed(1)}%;background:${s.color}" title="${escHtml(s.label)}: ${s.pct.toFixed(1)}%"></div>`
  ).join('');

  const legend = segments.slice(0, 6).map(s =>
    `<span class="gev-country-fuel-item"><span class="gev-country-fuel-dot" style="background:${s.color}"></span>${escHtml(s.label)} ${s.pct.toFixed(0)}%</span>`
  ).join('');

  const totalGW = (total / 1000).toFixed(0);
  const plantCount = US_POWER_PLANTS.length.toLocaleString();

  return `
    <div class="gev-country-section">
      <div class="gev-country-section-title">Energy Mix (Installed Capacity)</div>
      <div class="gev-country-bar">${bars}</div>
      <div class="gev-country-fuel-legend">${legend}</div>
      <div class="gev-country-stats-row">
        <span class="gev-country-stat-item"><span class="gev-country-stat-val">${totalGW} GW</span><span class="gev-country-stat-lbl">Total Capacity</span></span>
        <span class="gev-country-stat-item"><span class="gev-country-stat-val">${plantCount}</span><span class="gev-country-stat-lbl">Plants (dataset)</span></span>
      </div>
    </div>`;
}

export class GevCountryPanel {
  private el: HTMLElement;
  private visible = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'gev-country-panel';
    this.el.id = 'gevCountryPanel';
    this.el.style.display = 'none';
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('gev-country-close')) this.hide();
    });
  }

  async show(countryName: string, countryCode?: string): Promise<void> {
    this.visible = true;
    const flag = countryCode ? toFlagEmoji(countryCode) : '';
    const isUSA = countryName.toLowerCase().includes('united states') || countryCode === 'US' || countryCode === 'USA';
    const fields = getCountryFields(countryName);
    const pipelineCount = getCountryPipelineCount(countryName);
    const mixBar = buildEnergyMixBar(isUSA);

    this.el.innerHTML = `
      <div class="gev-country-header">
        <div class="gev-country-title">
          <span class="gev-country-flag">${flag}</span>
          <span class="gev-country-name">${escHtml(countryName)}</span>
        </div>
        <button class="gev-country-close" aria-label="Close">×</button>
      </div>
      <div class="gev-country-body">
        ${mixBar}
        <div class="gev-country-section">
          <div class="gev-country-section-title">Energy Infrastructure</div>
          <div class="gev-country-stats-row">
            <span class="gev-country-stat-item"><span class="gev-country-stat-val">${fields.length}</span><span class="gev-country-stat-lbl">Oil &amp; Gas Fields</span></span>
            <span class="gev-country-stat-item"><span class="gev-country-stat-val">${pipelineCount}</span><span class="gev-country-stat-lbl">Pipelines</span></span>
          </div>
          ${fields.length ? `<div class="gev-country-fields-list">${fields.slice(0, 5).map(f => `<div class="gev-country-field-tag">${escHtml(f.name)}</div>`).join('')}${fields.length > 5 ? `<div class="gev-country-field-tag gev-country-field-more">+${fields.length - 5} more</div>` : ''}</div>` : ''}
        </div>
        <div class="gev-country-section gev-country-eia-section" id="gevCountryEIA">
          <div class="gev-country-section-title">EIA Energy Data <span class="gev-country-loading">loading…</span></div>
        </div>
      </div>`;

    this.el.style.display = 'flex';

    // Async EIA data
    if (countryCode) {
      try {
        const eia = await fetchEIACountry(countryCode);
        const eiaEl = this.el.querySelector('#gevCountryEIA');
        if (eiaEl && this.visible) {
          if (eia) {
            eiaEl.innerHTML = `
              <div class="gev-country-section-title">EIA Energy Data</div>
              <div class="gev-country-stats-row">
                <span class="gev-country-stat-item"><span class="gev-country-stat-val">${escHtml(eia.production)}</span><span class="gev-country-stat-lbl">Primary Energy Production</span></span>
              </div>`;
          } else {
            eiaEl.innerHTML = `<div class="gev-country-section-title">EIA Energy Data <span class="gev-country-no-data">No data available</span></div>`;
          }
        }
      } catch {
        const eiaEl = this.el.querySelector('#gevCountryEIA');
        if (eiaEl && this.visible) {
          eiaEl.innerHTML = `<div class="gev-country-section-title">EIA Energy Data <span class="gev-country-no-data">Unavailable</span></div>`;
        }
      }
    }
  }

  hide(): void {
    this.visible = false;
    this.el.style.display = 'none';
  }

  isVisible(): boolean { return this.visible; }

  destroy(): void {
    if (this.el.parentNode) this.el.remove();
  }
}
