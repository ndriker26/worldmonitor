import { loadFromStorage, saveToStorage } from '@/utils';
import { STORAGE_KEYS } from '@/config';
import { toggleGevTheme, getGevTheme } from './GevTheme';
import type { MapContainer } from '@/components';

export class GevTopBar {
  private el: HTMLElement;
  private clockInterval: ReturnType<typeof setInterval> | null = null;
  private map: MapContainer | null = null;

  constructor() {
    this.el = document.createElement('header');
    this.el.className = 'gev-topbar';
    this.el.id = 'gevTopbar';
    this.el.innerHTML = this.render();
  }

  private render(): string {
    const savedMode = loadFromStorage<string>(STORAGE_KEYS.mapMode, 'flat');
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
        <div class="gev-2d3d-toggle" id="gevDimToggle">
          <button class="gev-dim-btn ${savedMode !== 'globe' ? 'active' : ''}" data-mode="flat" title="2D flat map">2D</button>
          <button class="gev-dim-btn ${savedMode === 'globe' ? 'active' : ''}" data-mode="globe" title="3D globe">3D</button>
        </div>
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

    this.el.querySelector('#gevDimToggle')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]');
      if (!btn || !this.map) return;
      const mode = btn.dataset.mode as 'flat' | 'globe';
      saveToStorage(STORAGE_KEYS.mapMode, mode);
      this.el.querySelectorAll('.gev-dim-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      (this.map as unknown as { setMode?: (m: string) => void }).setMode?.(mode);
    });
  }

  destroy(): void {
    if (this.clockInterval) clearInterval(this.clockInterval);
  }
}
