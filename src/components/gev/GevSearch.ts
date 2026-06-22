import type { MapContainer } from '@/components';
import { getGemData, loadGemData } from '@/config/gem-data';
import { buildSearchIndex, queryIndex, type SearchIndex, type SearchResult } from '@/services/search-index';

export class GevSearch {
  private overlay: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private clearBtn: HTMLButtonElement | null = null;
  private map: MapContainer | null = null;
  private index: SearchIndex | null = null;
  private results: SearchResult[] = [];
  private selectedIdx = -1;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private onCountrySelect?: (name: string) => void;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private btnHandler: ((e: MouseEvent) => void) | null = null;
  private isOpen = false;

  setMap(map: MapContainer): void {
    this.map = map;
  }

  setOnCountrySelect(cb: (name: string) => void): void {
    this.onCountrySelect = cb;
  }

  init(): void {
    this.buildDOM();
    this.wireGlobalShortcut();
    // Pre-load GEM data so the index builds quickly on first open
    void loadGemData();
  }

  private buildDOM(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'gev-search-overlay';
    this.overlay.setAttribute('aria-hidden', 'true');

    const modal = document.createElement('div');
    modal.className = 'gev-search-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Search energy infrastructure');

    modal.innerHTML = `
      <div class="gev-search-input-wrap">
        <span class="gev-search-icon" aria-hidden="true">🔍</span>
        <input class="gev-search-input" type="text"
          placeholder="Search plants, fields, pipelines, countries..."
          autocomplete="off" spellcheck="false" aria-autocomplete="list" />
        <button class="gev-search-clear" aria-label="Clear search">✕</button>
      </div>
      <div class="gev-search-results" role="listbox" aria-label="Search results"></div>
      <div class="gev-search-status" aria-live="polite"></div>
    `;

    this.overlay.appendChild(modal);
    document.body.appendChild(this.overlay);

    this.input = modal.querySelector('.gev-search-input');
    this.resultsEl = modal.querySelector('.gev-search-results');
    this.statusEl = modal.querySelector('.gev-search-status');
    this.clearBtn = modal.querySelector('.gev-search-clear');

    this.input?.addEventListener('input', () => this.onInput());
    this.input?.addEventListener('keydown', (e) => this.onKey(e));

    this.clearBtn?.addEventListener('click', () => {
      if (this.input) this.input.value = '';
      this.syncClearBtn();
      this.clearResults();
      this.input?.focus();
    });

    // Click backdrop to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Prevent modal clicks from closing
    modal.addEventListener('click', (e) => e.stopPropagation());

    this.syncClearBtn();
  }

  private wireGlobalShortcut(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        // Don't steal from browser address bar or other inputs
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          if (e.target !== this.input) return;
        }
        e.preventDefault();
        this.isOpen ? this.close() : this.open();
        return;
      }
      if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        this.close();
      }
    };
    document.addEventListener('keydown', this.keyHandler, true);

    // Wire the search button in GevTopBar (delegated since topBar mounts after init)
    this.btnHandler = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('#searchBtn')) this.open();
    };
    document.addEventListener('click', this.btnHandler);
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.overlay?.removeAttribute('aria-hidden');
    this.overlay?.classList.add('gev-search-overlay--open');
    requestAnimationFrame(() => {
      this.input?.focus();
      // Re-run search if there's existing text (e.g. user re-opens)
      if (this.input?.value.trim()) this.scheduleSearch();
    });
    void this.ensureIndex();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.overlay?.setAttribute('aria-hidden', 'true');
    this.overlay?.classList.remove('gev-search-overlay--open');
  }

  private async ensureIndex(): Promise<void> {
    if (this.index) return;
    const cached = getGemData();
    const data = (cached.fields.length || cached.pipelines.length)
      ? cached
      : await loadGemData();
    this.index = buildSearchIndex(data.fields, data.pipelines);
    // If the user already typed while loading
    if (this.input?.value.trim()) this.runSearch(this.input.value);
  }

  private onInput(): void {
    this.syncClearBtn();
    this.scheduleSearch();
  }

  private syncClearBtn(): void {
    if (!this.clearBtn) return;
    this.clearBtn.style.display = this.input?.value ? '' : 'none';
  }

  private scheduleSearch(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const val = this.input?.value ?? '';
    if (!val.trim()) { this.clearResults(); return; }
    this.debounceTimer = setTimeout(() => this.runSearch(val), 150);
  }

  private runSearch(query: string): void {
    if (!this.index) {
      if (this.statusEl) this.statusEl.textContent = 'Building index…';
      return;
    }
    this.results = queryIndex(this.index, query);
    this.selectedIdx = this.results.length > 0 ? 0 : -1;
    this.renderResults();
  }

  private clearResults(): void {
    this.results = [];
    this.selectedIdx = -1;
    if (this.resultsEl) this.resultsEl.innerHTML = '';
    if (this.statusEl) this.statusEl.textContent = '';
  }

  private renderResults(): void {
    if (!this.resultsEl || !this.statusEl) return;

    if (!this.results.length) {
      this.resultsEl.innerHTML = '<div class="gev-search-empty">No results found</div>';
      this.statusEl.textContent = '';
      return;
    }

    this.statusEl.textContent = `${this.results.length} result${this.results.length === 1 ? '' : 's'}`;

    this.resultsEl.innerHTML = this.results.map((r, i) => `
      <div class="gev-search-result${i === this.selectedIdx ? ' gev-search-result--selected' : ''}"
           data-idx="${i}" role="option" aria-selected="${i === this.selectedIdx}">
        <span class="gev-search-result-icon" aria-hidden="true">${r.icon}</span>
        <div class="gev-search-result-body">
          <div class="gev-search-result-name">${esc(r.name)}</div>
          <div class="gev-search-result-sub">${esc(r.subtitle)}</div>
        </div>
        <span class="gev-search-result-arrow" aria-hidden="true">→</span>
      </div>
    `).join('');

    for (const el of this.resultsEl.querySelectorAll<HTMLElement>('.gev-search-result')) {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset['idx'] ?? '', 10);
        if (!isNaN(idx)) this.selectResult(idx);
      });
      el.addEventListener('mouseenter', () => {
        const idx = parseInt(el.dataset['idx'] ?? '', 10);
        if (!isNaN(idx)) { this.selectedIdx = idx; this.highlightSelected(); }
      });
    }
  }

  private highlightSelected(): void {
    this.resultsEl?.querySelectorAll<HTMLElement>('.gev-search-result').forEach((el, i) => {
      el.classList.toggle('gev-search-result--selected', i === this.selectedIdx);
      el.setAttribute('aria-selected', String(i === this.selectedIdx));
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIdx = Math.min(this.selectedIdx + 1, this.results.length - 1);
      this.highlightSelected();
      this.scrollSelected();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIdx = Math.max(this.selectedIdx - 1, 0);
      this.highlightSelected();
      this.scrollSelected();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.selectedIdx >= 0) this.selectResult(this.selectedIdx);
    }
  }

  private scrollSelected(): void {
    this.resultsEl?.querySelector<HTMLElement>('.gev-search-result--selected')
      ?.scrollIntoView({ block: 'nearest' });
  }

  private selectResult(idx: number): void {
    const result = this.results[idx];
    if (!result) return;
    this.close();
    if (!this.map) return;

    this.map.setCenter(result.lat, result.lon, result.zoom);

    if (result.kind === 'country') {
      setTimeout(() => this.onCountrySelect?.(result.name), 1500);
      return;
    }

    if (result.kind === 'region' || result.kind === 'state') return;

    if (result.popupType && result.popupData !== undefined) {
      const type = result.popupType;
      const data = result.popupData;
      setTimeout(() => this.map?.showEnergyPopup(type, data), 1500);
    }
  }

  destroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler, true);
    if (this.btnHandler) document.removeEventListener('click', this.btnHandler);
    this.overlay?.remove();
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
