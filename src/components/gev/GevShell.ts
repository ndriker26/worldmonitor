import type { AppContext } from '@/app/app-context';
import { MapContainer, NewsPanel } from '@/components';
import { loadFromStorage } from '@/utils';
import { STORAGE_KEYS } from '@/config';
import { initGevTheme } from './GevTheme';
import { GevTopBar } from './GevTopBar';
import { GevSidebar } from './GevSidebar';
import { GevDrawer } from './GevDrawer';

export class GevShell {
  private ctx: AppContext;
  private topBar: GevTopBar;
  private sidebar: GevSidebar;
  private drawer: GevDrawer;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
    this.topBar = new GevTopBar();
    this.sidebar = new GevSidebar(ctx.mapLayers);
    this.drawer = new GevDrawer();
  }

  init(): void {
    initGevTheme();
    this.buildDOM();
    this.mountMap();
    this.mountNewsPanel();
    this.wireSidebarToggle();
  }

  private buildDOM(): void {
    // Replace container contents with the GevShell layout
    this.ctx.container.innerHTML = '';
    this.ctx.container.className = 'gev-shell';
    // Remove the container's original body-level class if set
    this.ctx.container.removeAttribute('data-variant');

    // Full-viewport map background
    const mapWrap = document.createElement('div');
    mapWrap.className = 'gev-map-wrap';
    mapWrap.id = 'mapContainer';  // keeps existing MapContainer ID expectations
    this.ctx.container.appendChild(mapWrap);

    // Topbar (overlay)
    this.topBar.mount(this.ctx.container);

    // Sidebar
    this.sidebar.mount(this.ctx.container);

    // Drawer
    this.drawer.mount(this.ctx.container);

    // Provide a hidden #panelsGrid and #mapSection so existing event
    // handlers that querySelector for them don't throw.
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

    // Wire escalation getters (same as panel-layout does)
    this.ctx.map.initEscalationGetters?.();

    // Capture current time range for data filters
    this.ctx.currentTimeRange = this.ctx.map.getTimeRange?.() ?? '7d';

    // Give top bar + sidebar access to map
    this.topBar.setMap(this.ctx.map);
    this.sidebar.setMap(this.ctx.map);

    // Keep layer state in sync when map changes layers externally (e.g. URL state)
    // MapContainer doesn't have a layers-changed callback, so we expose setLayers
    // for the url-sync path which calls ctx.map.setLayers() directly.
  }

  private mountNewsPanel(): void {
    // Create the energy news panel and register it so the data loader can push to it
    if (!this.ctx.panelSettings['energy']) return;

    const label = this.ctx.panelSettings['energy']?.name ?? 'Energy News';
    const panel = new NewsPanel('energy', label);
    this.ctx.newsPanels['energy'] = panel;
    this.ctx.panels['energy'] = panel;

    // Embed the panel element in the drawer
    this.drawer.mountNewsPanel(panel.getElement());
  }

  private wireSidebarToggle(): void {
    // The topbar renders #gevSidebarToggle; bind after DOM is in place
    this.ctx.container.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('#gevSidebarToggle')) {
        this.sidebar.toggle();
      }
    });
  }

  /** Called by App after URL state is applied to sync sidebar checkboxes. */
  syncLayers(): void {
    if (this.ctx.map) {
      this.sidebar.setLayers(this.ctx.map.getState().layers ?? this.ctx.mapLayers);
    }
  }

  destroy(): void {
    this.topBar.destroy();
  }
}
