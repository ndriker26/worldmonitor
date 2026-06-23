import type { AppContext } from '@/app/app-context';
import { MapContainer, NewsPanel } from '@/components';
import { loadFromStorage } from '@/utils';
import { STORAGE_KEYS } from '@/config';
import { initGevTheme } from './GevTheme';
import { GevTopBar } from './GevTopBar';
import { GevSidebar } from './GevSidebar';
import { GevDrawer } from './GevDrawer';
import { GevCountryPanel } from './GevCountryPanel';
import { GevToast } from './GevToast';
import { GevSearch } from './GevSearch';
import { startEnergyEventService } from '@/services/energy-events';

export class GevShell {
  private ctx: AppContext;
  private topBar: GevTopBar;
  private sidebar: GevSidebar;
  private drawer: GevDrawer;
  private countryPanel: GevCountryPanel;
  private toast: GevToast;
  private search: GevSearch;
  private loadingEl: HTMLElement | null = null;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
    this.topBar = new GevTopBar();
    this.sidebar = new GevSidebar(ctx.mapLayers);
    this.drawer = new GevDrawer();
    this.countryPanel = new GevCountryPanel();
    this.toast = new GevToast();
    this.search = new GevSearch();
  }

  /**
   * Show the GEV loading screen and fully set up the shell DOM + map immediately.
   * Call this as early as possible (before any awaited async work in App.init) so
   * there is never a blank or WM-branded frame visible.
   */
  initEarly(): void {
    this.loadingEl = this.buildLoadingScreen();
    this.setupBranding();
    initGevTheme();
    this.buildDOM();
    this.mountMap();
    this.mountNewsPanel();
    this.wireSidebarToggle();
    this.startEventFeed();
    this.search.init();
  }

  /** Start the dismiss timer for the loading screen (call after async init is done). */
  scheduleDismiss(): void {
    setTimeout(() => this.dismissLoadingScreen(this.loadingEl!), 2800);
  }

  init(): void {
    this.initEarly();
    this.scheduleDismiss();
  }

  private setupBranding(): void {
    document.title = "Grid's Eye View — Energy Infrastructure Monitor";
    const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
    const link = existing ?? document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    (link as HTMLLinkElement).href = '/favicon.svg';
    if (!existing) document.head.appendChild(link);
  }

  private buildLoadingScreen(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'gev-loading';
    el.id = 'gevLoading';
    el.innerHTML = `
      <div class="gev-loading-logo">
        <svg width="48" height="48" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="gevLoadingGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <radialGradient id="gevLoadingHalo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#c084fc" stop-opacity="0.55"/>
              <stop offset="100%" stop-color="#a855f7" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <path d="M 4,32 C 16,16 48,16 60,32 C 48,48 16,48 4,32 Z"
                fill="none" stroke="#a855f7" stroke-width="2.5" stroke-linejoin="round"/>
          <circle cx="32" cy="32" r="12" fill="none" stroke="#a855f7" stroke-width="1.5" opacity="0.5"/>
          <line x1="32" y1="22" x2="32" y2="42" stroke="#a855f7" stroke-width="1.5" opacity="0.65"/>
          <line x1="22" y1="32" x2="42" y2="32" stroke="#a855f7" stroke-width="1.5" opacity="0.65"/>
          <line x1="32" y1="22" x2="26" y2="27" stroke="#a855f7" stroke-width="1" opacity="0.5"/>
          <line x1="32" y1="22" x2="38" y2="27" stroke="#a855f7" stroke-width="1" opacity="0.5"/>
          <line x1="22" y1="32" x2="26" y2="27" stroke="#a855f7" stroke-width="1" opacity="0.5"/>
          <line x1="42" y1="32" x2="38" y2="27" stroke="#a855f7" stroke-width="1" opacity="0.5"/>
          <circle cx="32" cy="22" r="2.2" fill="#a855f7"/>
          <circle cx="32" cy="42" r="2.2" fill="#a855f7"/>
          <circle cx="22" cy="32" r="2.2" fill="#a855f7"/>
          <circle cx="42" cy="32" r="2.2" fill="#a855f7"/>
          <circle cx="26" cy="27" r="1.8" fill="#a855f7" opacity="0.9"/>
          <circle cx="38" cy="27" r="1.8" fill="#a855f7" opacity="0.9"/>
          <circle cx="32" cy="32" r="9" fill="url(#gevLoadingHalo)"/>
          <circle cx="32" cy="32" r="3.5" fill="#c084fc" filter="url(#gevLoadingGlow)"/>
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
    this.drawer.setMap(this.ctx.map);
    this.search.setMap(this.ctx.map);
    this.search.setOnCountrySelect((name) => void this.countryPanel.show(name));

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

  private startEventFeed(): void {
    this.toast.onToastClick(() => this.drawer.expandToFeed());
    startEnergyEventService();
    // Wire new energy events to the toast
    window.addEventListener('gev:energy-event', (e) => {
      const ev = (e as CustomEvent).detail;
      if (ev) this.toast.show(ev);
    });
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
    this.toast.destroy();
    this.search.destroy();
  }
}
