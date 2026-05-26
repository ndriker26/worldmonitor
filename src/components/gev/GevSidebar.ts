import type { MapLayers } from '@/types';
import { getLayersForVariant } from '@/config/map-layer-definitions';
import { saveToStorage } from '@/utils';
import { STORAGE_KEYS } from '@/config';
import type { MapContainer } from '@/components';

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

    const items = layerDefs.map(def => {
      const key = def.key as keyof MapLayers;
      const checked = this.layers[key] ? 'checked' : '';
      const active = this.layers[key] ? 'active' : '';
      return `
        <label class="gev-layer-item ${active}" data-layer="${key}">
          <input type="checkbox" data-layer="${key}" ${checked} />
          <span class="gev-layer-icon">${def.icon}</span>
          <span class="gev-layer-label">${def.fallbackLabel}${key === 'usTransmission' ? ' <span class="gev-layer-region">(US)</span>' : ''}</span>
        </label>`;
    }).join('');

    this.el.innerHTML = `
      <div class="gev-sidebar-header">Map Layers</div>
      <div class="gev-layer-list" id="gevLayerList">
        ${items}
      </div>
    `;

    this.el.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.type !== 'checkbox') return;
      const key = input.dataset.layer as keyof MapLayers;
      if (!key) return;
      (this.layers as unknown as Record<string, boolean>)[key] = input.checked;
      saveToStorage(STORAGE_KEYS.mapLayers, this.layers);
      input.closest('.gev-layer-item')?.classList.toggle('active', input.checked);
      this.map?.setLayers({ ...this.layers });
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
    this.el.querySelectorAll<HTMLInputElement>('input[data-layer]').forEach(input => {
      const key = input.dataset.layer as keyof MapLayers;
      if (!key) return;
      input.checked = !!(this.layers as unknown as Record<string, boolean>)[key];
      input.closest('.gev-layer-item')?.classList.toggle('active', input.checked);
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
