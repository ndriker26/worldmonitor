import type { MapLayers } from '@/types';
import { getLayersForVariant } from '@/config/map-layer-definitions';
import { saveToStorage } from '@/utils';
import { STORAGE_KEYS } from '@/config';
import type { MapContainer } from '@/components';
import { getDistanceUnit, setDistanceUnit, type DistanceUnit } from '@/utils/unit-pref';

export class GevSidebar {
  private el: HTMLElement;
  private map: MapContainer | null = null;
  private layers: MapLayers;
  private _collapsed = false;

  constructor(layers: MapLayers) {
    this.layers = { ...layers };
    this.el = document.createElement('aside');
    this.el.className = 'gev-sidebar';
    this.el.id = 'gevSidebar';
    this.render();
  }

  private render(): void {
    const layerDefs = getLayersForVariant('energy', 'flat');
    const LAYER_COUNTS: Partial<Record<string, string>> = {
      usPlants: '35k',
      usTransmission: '97k',
      oilGasPipelines: '162',
      oilGasFields: '50+',
      weather: 'live',
      waterways: 'static',
      natural: 'live',
      fires: 'live',
    };

    const items = layerDefs.map(def => {
      const key = def.key as keyof MapLayers;
      const active = this.layers[key] ? 'active' : '';
      const count = LAYER_COUNTS[key];
      return `
        <div class="gev-layer-item ${active}" data-layer="${key}" role="button" tabindex="0" aria-pressed="${this.layers[key] ? 'true' : 'false'}">
          <span class="gev-layer-icon">${def.icon}</span>
          <span class="gev-layer-label">${def.fallbackLabel}${key === 'usTransmission' ? ' <span class="gev-layer-region">(US)</span>' : ''}</span>
          ${count ? `<span class="gev-layer-count">${count}</span>` : ''}
        </div>`;
    }).join('');

    const fuelLegend = [
      ['#ff8c00', 'Nat. Gas'], ['#3c3c3c', 'Coal'],
      ['#ffdc00', 'Nuclear'],  ['#64b4ff', 'Wind'],
      ['#ffe632', 'Solar'],    ['#3282dc', 'Hydro'],
      ['#c83232', 'Oil'],      ['#64b450', 'Biomass'],
      ['#b450c8', 'Geo.'],     ['#969696', 'Other'],
    ].map(([color, label]) =>
      `<span class="gev-legend-dot" style="background:${color}"></span><span class="gev-legend-label">${label}</span>`
    ).join('');

    const pipeLegend = [
      ['#8b0000', 'Crude Oil'],
      ['#2563eb', 'Natural Gas'],
      ['#ea580c', 'Refined'],
      ['#0d9488', 'Condensate'],
    ].map(([color, label]) =>
      `<div class="gev-legend-pipe"><div class="gev-legend-pipe-line" style="background:${color}"></div><span class="gev-legend-label">${label}</span></div>`
    ).join('');

    const unit = getDistanceUnit();

    this.el.innerHTML = `
      <div class="gev-sidebar-header">Map Layers</div>
      <div class="gev-layer-list" id="gevLayerList">
        ${items}
      </div>
      <div class="gev-sidebar-divider"></div>
      <div class="gev-sidebar-scroll">
        <div class="gev-sidebar-section">
          <div class="gev-sidebar-section-title">Plant Fuel Types</div>
          <div class="gev-legend-grid">${fuelLegend}</div>
        </div>
        <div class="gev-sidebar-section">
          <div class="gev-sidebar-section-title">Pipeline Types</div>
          ${pipeLegend}
        </div>
        <div class="gev-sidebar-section gev-unit-section">
          <div class="gev-sidebar-section-title">Distance Units</div>
          <div class="gev-unit-toggle" id="gevUnitToggle">
            <button class="gev-unit-btn${unit === 'mi' ? ' active' : ''}" data-unit="mi">mi</button>
            <button class="gev-unit-btn${unit === 'km' ? ' active' : ''}" data-unit="km">km</button>
          </div>
        </div>
        <div class="gev-sidebar-footer">by natantheskier</div>
      </div>
    `;

    this.el.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-layer]');
      if (item) {
        const key = item.dataset.layer as keyof MapLayers;
        if (!key) return;
        const newVal = !(this.layers as unknown as Record<string, boolean>)[key];
        (this.layers as unknown as Record<string, boolean>)[key] = newVal;
        saveToStorage(STORAGE_KEYS.mapLayers, this.layers);
        item.classList.toggle('active', newVal);
        item.setAttribute('aria-pressed', String(newVal));
        this.map?.setLayers({ ...this.layers });
      }
      const unitBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-unit]');
      if (unitBtn) {
        const unit = unitBtn.dataset.unit as DistanceUnit;
        setDistanceUnit(unit);
        this.el.querySelectorAll('.gev-unit-btn').forEach(b => b.classList.remove('active'));
        unitBtn.classList.add('active');
      }
    });
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
  }

  setMap(map: MapContainer): void {
    this.map = map;
  }

  setLayers(layers: MapLayers): void {
    this.layers = { ...layers };
    this.el.querySelectorAll<HTMLElement>('[data-layer]').forEach(item => {
      const key = item.dataset.layer as keyof MapLayers;
      if (!key) return;
      const active = !!(this.layers as unknown as Record<string, boolean>)[key];
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
  }

  toggle(): void {
    this._collapsed = !this._collapsed;
    this.el.classList.toggle('collapsed', this._collapsed);
  }

  collapse(): void {
    this._collapsed = true;
    this.el.classList.add('collapsed');
  }

  expand(): void {
    this._collapsed = false;
    this.el.classList.remove('collapsed');
  }

  get collapsed(): boolean { return this._collapsed; }
}
