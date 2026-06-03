import { toggleGevTheme, getGevTheme, THEME_CHANGE_EVENT } from './GevTheme';
import type { MapContainer } from '@/components';
import { FALLBACK_DARK_STYLE, FALLBACK_LIGHT_STYLE } from '@/config/basemap';
import { GEV_STATUS_EVENT, type ConnectionState } from '@/services/energy-events';

export class GevTopBar {
  private el: HTMLElement;
  private clockInterval: ReturnType<typeof setInterval> | null = null;
  private map: MapContainer | null = null;
  private themeHandler: ((e: Event) => void) | null = null;
  private statusHandler: ((e: Event) => void) | null = null;

  constructor() {
    this.el = document.createElement('header');
    this.el.className = 'gev-topbar';
    this.el.id = 'gevTopbar';
    this.el.innerHTML = this.render();
  }

  private render(): string {
    const theme = getGevTheme();
    return `
      <div class="gev-topbar-left">
        <button class="gev-sidebar-toggle" id="gevSidebarToggle" title="Toggle layers" aria-label="Toggle layer panel">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
        <span class="gev-brand">GRID'S EYE VIEW</span>
        <span class="gev-version">v1.0</span>
      </div>

      <div class="gev-topbar-center">
        <span class="gev-live-dot" aria-hidden="true"></span>
        <span class="gev-live-label">LIVE</span>
        <span class="gev-clock" id="gevClock"></span>
      </div>

      <div class="gev-topbar-right">
        <button class="gev-theme-btn" id="gevThemeBtn" title="Toggle light/dark theme" aria-label="Toggle theme">
          ${theme === 'dark' ? '☀' : '🌙'}
        </button>
        <button class="gev-search-btn" id="searchBtn">
          <kbd>⌘K</kbd> Search
        </button>
      </div>

      <!-- Hidden clock anchor used by EventHandlerManager.startHeaderClock() -->
      <span id="headerClock" style="display:none" aria-hidden="true"></span>
    `;
  }

  mount(container: HTMLElement): void {
    container.prepend(this.el);
    this.startClock();
    this.bindEvents();
  }

  setMap(map: MapContainer): void {
    this.map = map;
  }

  private startClock(): void {
    const clockEl = this.el.querySelector<HTMLElement>('#gevClock');
    if (!clockEl) return;
    const tick = () => {
      clockEl.textContent = new Date().toUTCString().slice(17, 25) + ' UTC';
    };
    tick();
    this.clockInterval = setInterval(tick, 1000);
  }

  private bindEvents(): void {
    this.el.querySelector('#gevThemeBtn')?.addEventListener('click', () => {
      toggleGevTheme();
      const btn = this.el.querySelector<HTMLButtonElement>('#gevThemeBtn');
      if (btn) btn.textContent = getGevTheme() === 'dark' ? '☀' : '🌙';
    });

    this.themeHandler = (e: Event) => {
      const theme = (e as CustomEvent<string>).detail;
      this.switchBasemap(theme);
    };
    window.addEventListener(THEME_CHANGE_EVENT, this.themeHandler);

    this.statusHandler = (e: Event) => {
      const state = (e as CustomEvent<ConnectionState>).detail;
      this.applyLiveStatus(state);
    };
    window.addEventListener(GEV_STATUS_EVENT, this.statusHandler);
  }

  private applyLiveStatus(state: ConnectionState): void {
    const dot = this.el.querySelector<HTMLElement>('.gev-live-dot');
    const label = this.el.querySelector<HTMLElement>('.gev-live-label');
    if (!dot) return;
    dot.dataset['status'] = state.status;
    const tooltip = state.lastUpdate
      ? `Last update: ${state.lastUpdate.toLocaleTimeString()} · Sources: ${state.active}/${state.total} active`
      : `Connecting… · Sources: 0/${state.total}`;
    dot.title = tooltip;
    if (label) label.title = tooltip;
  }

  private switchBasemap(theme: string): void {
    if (!this.map) return;
    // Access the underlying MapLibre instance via the DeckGLMap internals
    const mapLibre = (this.map as unknown as { deckGLMap?: { maplibreMap?: { setStyle: (s: string) => void } } }).deckGLMap?.maplibreMap;
    if (!mapLibre) return;
    const style = theme === 'light' ? FALLBACK_LIGHT_STYLE : FALLBACK_DARK_STYLE;
    try {
      (mapLibre as unknown as { setStyle(s: string, opts: object): void }).setStyle(style, { diff: false });
    } catch {
      // Silently ignore style switch errors
    }
  }

  destroy(): void {
    if (this.clockInterval) clearInterval(this.clockInterval);
    if (this.themeHandler) window.removeEventListener(THEME_CHANGE_EVENT, this.themeHandler);
    if (this.statusHandler) window.removeEventListener(GEV_STATUS_EVENT, this.statusHandler);
  }
}
