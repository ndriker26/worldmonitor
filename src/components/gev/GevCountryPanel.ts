import { getGemData } from '@/config/gem-data';
import { getCountryEnergyMix, getEnergyMixAttribution, loadEnergyMix } from '@/config/energy-mix-data';
import { US_POWER_PLANTS } from '@/config/us-power-plants';
import { toFlagEmoji } from '@/utils/country-flag';
import { formatNumber } from '@/utils';

// Colours/labels keyed on the canonical fuel taxonomy shared with the Ember
// ingestion adapter (ingestion/gridsight/energy_taxonomy.py). Keep the two in
// sync — a fuel here that the adapter doesn't emit just never renders; a fuel
// the adapter emits that's missing here falls back to the "other" colour.
const FUEL_COLORS: Record<string, string> = {
  coal: '#3c3c3c', gas: '#ff8c00', other_fossil: '#c83232',
  nuclear: '#ffdc00', hydro: '#3282dc', wind: '#64b4ff',
  solar: '#ffe632', bioenergy: '#64b450', other_renewables: '#b450c8',
  other: '#969696',
};
const FUEL_LABELS: Record<string, string> = {
  coal: 'Coal', gas: 'Gas', other_fossil: 'Other Fossil',
  nuclear: 'Nuclear', hydro: 'Hydro', wind: 'Wind',
  solar: 'Solar', bioenergy: 'Bioenergy', other_renewables: 'Other Renew.',
  other: 'Other',
};

// The default view is generation for every country (Ember). The legacy US
// installed-capacity bar (US_POWER_PLANTS) is retained behind this flag so the
// switch is reversible; flip to true to restore the old US capacity view.
const SHOW_US_CAPACITY_FALLBACK = false;

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getCountryFields(countryName: string) {
  const lc = countryName.toLowerCase();
  return getGemData().fields.filter(f => f.country.toLowerCase().includes(lc) || lc.includes(f.country.toLowerCase().split('/')[0]?.trim() ?? ''));
}

function getCountryPipelineCount(countryName: string): number {
  const lc = countryName.toLowerCase();
  return getGemData().pipelines.filter(p =>
    p.region.toLowerCase().includes(lc) ||
    p.operator.toLowerCase().includes(lc) ||
    p.name.toLowerCase().includes(lc)
  ).length;
}

interface MixSegment { fuel: string; pct: number; color: string; label: string; }

function renderBar(segments: MixSegment[]): string {
  const bars = segments.map(s =>
    `<div class="gev-country-bar-seg" style="width:${s.pct.toFixed(1)}%;background:${s.color}" title="${escHtml(s.label)}: ${s.pct.toFixed(1)}%"></div>`
  ).join('');
  const legend = segments.slice(0, 6).map(s =>
    `<span class="gev-country-fuel-item"><span class="gev-country-fuel-dot" style="background:${s.color}"></span>${escHtml(s.label)} ${s.pct.toFixed(0)}%</span>`
  ).join('');
  return `<div class="gev-country-bar">${bars}</div><div class="gev-country-fuel-legend">${legend}</div>`;
}

// Generation mix from Ember (the default for every country). Returns the full
// section, or an explicit no-data section when we have no coverage — never an
// empty string that silently drops the whole feature.
function buildGenerationMixBar(code: string | undefined): string {
  const data = code ? getCountryEnergyMix(code) : null;
  if (!data) {
    return `
    <div class="gev-country-section">
      <div class="gev-country-section-title">Electricity Generation Mix</div>
      <div class="gev-country-no-data" style="padding:6px 0;opacity:0.7;font-size:12px">No generation data available for this country.</div>
    </div>`;
  }

  const segments: MixSegment[] = Object.entries(data.mix)
    .sort((a, b) => b[1] - a[1])
    .map(([fuel, share]) => ({
      fuel,
      pct: share * 100,
      color: FUEL_COLORS[fuel] ?? FUEL_COLORS.other!,
      label: FUEL_LABELS[fuel] ?? fuel,
    }));

  const totalTWh = formatNumber(data.total_twh, { abbreviate: false, decimals: 1 });
  const attribution = escHtml(getEnergyMixAttribution() || 'Source: Ember, CC-BY-4.0');

  return `
    <div class="gev-country-section">
      <div class="gev-country-section-title">Electricity Generation Mix
        <span style="font-weight:400;opacity:0.65;font-size:11px;margin-left:6px">Generation &middot; ${escHtml(data.period_label)}</span>
      </div>
      ${renderBar(segments)}
      <div class="gev-country-stats-row">
        <span class="gev-country-stat-item"><span class="gev-country-stat-val">${totalTWh} TWh</span><span class="gev-country-stat-lbl">Total Generation (${escHtml(data.cadence === 'yearly' ? 'year' : 'month')})</span></span>
      </div>
      <div style="margin-top:4px;font-size:10px;opacity:0.5">${attribution}</div>
    </div>`;
}

// Legacy US installed-capacity bar, retained behind SHOW_US_CAPACITY_FALLBACK.
function buildUSCapacityBar(): string {
  const byFuel = new Map<string, number>();
  for (const p of US_POWER_PLANTS) {
    const fuel = p.fuelType ?? 'other';
    byFuel.set(fuel, (byFuel.get(fuel) ?? 0) + (p.capacityMW ?? 0));
  }
  const total = Array.from(byFuel.values()).reduce((a, b) => a + b, 0);
  if (total === 0) return '';

  const segments: MixSegment[] = Array.from(byFuel.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([fuel, mw]) => ({
      fuel,
      pct: (mw / total) * 100,
      color: FUEL_COLORS[fuel] ?? FUEL_COLORS.other!,
      label: FUEL_LABELS[fuel] ?? fuel,
    }));

  const totalGW = formatNumber(total / 1000, { abbreviate: false, decimals: 0 });
  const plantCount = US_POWER_PLANTS.length.toLocaleString();

  return `
    <div class="gev-country-section">
      <div class="gev-country-section-title">Energy Mix (Installed Capacity)</div>
      ${renderBar(segments)}
      <div class="gev-country-stats-row">
        <span class="gev-country-stat-item"><span class="gev-country-stat-val">${totalGW} GW</span><span class="gev-country-stat-lbl">Total Capacity</span></span>
        <span class="gev-country-stat-item"><span class="gev-country-stat-val">${plantCount}</span><span class="gev-country-stat-lbl">Plants (dataset)</span></span>
      </div>
    </div>`;
}

function buildEnergyMixBar(code: string | undefined, isUSA: boolean): string {
  if (SHOW_US_CAPACITY_FALLBACK && isUSA) return buildUSCapacityBar();
  return buildGenerationMixBar(code);
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
    // Generation data is a static JSON (like GEM); ensure it's loaded before we
    // build the bar. Cached after first call, so this is a no-op on later opens.
    await loadEnergyMix();
    const mixBar = buildEnergyMixBar(countryCode, isUSA);

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
      </div>`;

    this.el.style.display = 'flex';
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
