import type { AppContext } from '@/app/app-context';
import { MapContainer, NewsPanel } from '@/components';
import { loadFromStorage } from '@/utils';
import { STORAGE_KEYS } from '@/config';
import { initGevTheme } from './GevTheme';
import { GevTopBar } from './GevTopBar';
import { GevSidebar } from './GevSidebar';
import { GevDrawer } from './GevDrawer';
import { GevCountryPanel } from './GevCountryPanel';

export class GevShell {
  private ctx: AppContext;
  private topBar: GevTopBar;
  private sidebar: GevSidebar;
  private drawer: GevDrawer;
  private countryPanel: GevCountryPanel;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
    this.topBar = new GevTopBar();
    this.sidebar = new GevSidebar(ctx.mapLayers);
    this.drawer = new GevDrawer();
    this.countryPanel = new GevCountryPanel();
  }

  init(): void {
    const loadingEl = this.buildLoadingScreen();
    this.setupBranding();
    initGevTheme();
    this.buildDOM();
    this.mountMap();
    this.mountNewsPanel();
    this.wireSidebarToggle();
    setTimeout(() => this.dismissLoadingScreen(loadingEl), 2800);
  }

  private setupBranding(): void {
    document.title = "Grid's Eye View — Energy Infrastructure Monitor";
    const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
    const link = existing ?? document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    (link as HTMLLinkElement).href = '/favicon-gev.svg';
    if (!existing) document.head.appendChild(link);
  }

  private buildLoadingScreen(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'gev-loading';
    el.id = 'gevLoading';
    el.innerHTML = `
      <div class="gev-loading-logo">
        <svg width="52" height="52" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          <path d="M1,16 C6,7 12,4 16,4 C20,4 26,7 31,16 C26,25 20,28 16,28 C12,28 6,25 1,16 Z"
                fill="rgba(59,130,246,0.08)" stroke="#3b82f6" stroke-width="2"/>
          <circle cx="16" cy="16" r="7" fill="none" stroke="#3b82f6" stroke-width="1.5"/>
          <line x1="9" y1="16" x2="23" y2="16" stroke="#3b82f6" stroke-width="0.7" opacity="0.6"/>
          <line x1="16" y1="9" x2="16" y2="23" stroke="#3b82f6" stroke-width="0.7" opacity="0.6"/>
          <circle cx="16" cy="16" r="3" fill="#3b82f6"/>
          <circle cx="3.5" cy="16" r="1.5" fill="#3b82f6" opacity="0.8"/>
          <circle cx="28.5" cy="16" r="1.5" fill="#3b82f6" opacity="0.8"/>
        </svg>
      </div>
      <div class="gev-loading-brand">GRID'S EYE VIEW</div>
      <div class="gev-loading-sub">Energy Infrastructure Monitor</div>
      <div class="gev-loading-bar-wrap">
        <div class="gev-loading-bar"></div>
      </div>
    `;
    document.body.appendChild(el);
    return el;
  }

  private dismissLoadingScreen(el: HTMLElement): void {
    el.classList.add('fadeout');
    setTimeout(() => { if (el.parentNode) el.remove(); }, 700);
  }

  private buildDOM(): void {
    this.ctx.container.innerHTML = '';
    this.ctx.container.className = 'gev-shell';
    this.ctx.container.removeAttribute('data-variant');

    const mapWrap = document.createElement('div');
    mapWrap.className = 'gev-map-wrap';
    mapWrap.id = 'mapContainer';
    this.ctx.container.appendChild(mapWrap);

    this.topBar.mount(this.ctx.container);
    this.sidebar.mount(this.ctx.container);
    this.drawer.mount(this.ctx.container);

    const ghost = document.createElement('div');
    ghost.id = 'panelsGrid';
    ghost.style.cssText = 'display:none;position:absolute;';
    this.ctx.container.appendChild(ghost);

    const ghostMap = document.createElement('div');
    ghostMap.id = 'mapSection';
    ghostMap.style.cssText = 'display:none;position:absolute;';
    this.ctx.container.appendChild(ghostMap);
  }

  private mountMap(): void {
    const mapWrap = this.ctx.container.querySelector<HTMLElement>('#mapContainer');
    if (!mapWrap) return;

    const preferGlobe = loadFromStorage<string>(STORAGE_KEYS.mapMode, 'flat') === 'globe';
    this.ctx.map = new MapContainer(mapWrap, {
      zoom: this.ctx.isMobile ? 2.5 : 1.0,
      pan: { x: 0, y: 0 },
      view: 'global',
      layers: this.ctx.mapLayers,
      timeRange: '7d',
    }, preferGlobe);

    this.ctx.map.initEscalationGetters?.();
    this.ctx.currentTimeRange = this.ctx.map.getTimeRange?.() ?? '7d';

    this.topBar.setMap(this.ctx.map);
    this.sidebar.setMap(this.ctx.map);

    // Register energy-specific country click handler
    this.ctx.map.onCountryClicked((payload) => {
      const name = payload.name ?? 'Unknown Country';
      const code = payload.code ?? undefined;
      void this.countryPanel.show(name, code);
    });
  }

  private mountNewsPanel(): void {
    if (!this.ctx.panelSettings['energy']) return;

    const label = this.ctx.panelSettings['energy']?.name ?? 'Energy News';
    const panel = new NewsPanel('energy', label);
    this.ctx.newsPanels['energy'] = panel;
    this.ctx.panels['energy'] = panel;

    this.drawer.mountNewsPanel(panel.getElement());
  }

  private wireSidebarToggle(): void {
    this.ctx.container.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('#gevSidebarToggle')) {
        this.sidebar.toggle();
      }
    });
  }

  syncLayers(): void {
    if (this.ctx.map) {
      this.sidebar.setLayers(this.ctx.map.getState().layers ?? this.ctx.mapLayers);
    }
  }

  destroy(): void {
    this.topBar.destroy();
    this.countryPanel.destroy();
    this.drawer.destroy();
  }
}
