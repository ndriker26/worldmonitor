const DRAWER_STATE_KEY = 'gev-drawer-expanded';

interface MetricTile {
  label: string;
  value: string;
  sub: string;
  id: string;
}

const PLACEHOLDER_METRICS: MetricTile[] = [
  { id: 'wti', label: 'WTI Crude', value: '—', sub: 'USD/bbl' },
  { id: 'ng', label: 'Nat. Gas', value: '—', sub: 'USD/MMBtu' },
  { id: 'brent', label: 'Brent', value: '—', sub: 'USD/bbl' },
];

export class GevDrawer {
  private el: HTMLElement;
  private _expanded: boolean;

  constructor() {
    this._expanded = localStorage.getItem(DRAWER_STATE_KEY) === 'true';
    this.el = document.createElement('div');
    this.el.className = `gev-drawer${this._expanded ? ' expanded' : ''}`;
    this.el.id = 'gevDrawer';
    this.el.innerHTML = this.render();
    this.bindEvents();
  }

  private render(): string {
    const tiles = PLACEHOLDER_METRICS.map(m => `
      <div class="gev-metric-tile" id="gevMetric-${m.id}">
        <div class="gev-metric-label">${m.label}</div>
        <div class="gev-metric-value" id="gevMetricVal-${m.id}">${m.value}</div>
        <div class="gev-metric-sub">${m.sub}</div>
      </div>`).join('');

    return `
      <div class="gev-drawer-handle" id="gevDrawerHandle">
        <div class="gev-drawer-grip" aria-hidden="true"></div>
        <span class="gev-drawer-title">Energy Intelligence</span>
        <button class="gev-drawer-toggle" id="gevDrawerToggle" aria-label="Toggle drawer" title="Toggle panel">▲</button>
      </div>
      <div class="gev-drawer-body">
        <div class="gev-metrics-col">${tiles}</div>
        <div class="gev-news-wrap" id="gevNewsWrap"></div>
      </div>
    `;
  }

  private bindEvents(): void {
    this.el.querySelector('#gevDrawerHandle')?.addEventListener('click', () => this.toggle());
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
  }

  /** Embed an existing Panel DOM element into the news slot. */
  mountNewsPanel(panelEl: HTMLElement): void {
    const wrap = this.el.querySelector<HTMLElement>('#gevNewsWrap');
    if (wrap) wrap.appendChild(panelEl);
  }

  toggle(): void {
    this._expanded = !this._expanded;
    this.el.classList.toggle('expanded', this._expanded);
    localStorage.setItem(DRAWER_STATE_KEY, String(this._expanded));
  }

  /** Update a metric tile value by id. */
  setMetric(id: string, value: string): void {
    const el = this.el.querySelector<HTMLElement>(`#gevMetricVal-${id}`);
    if (el) el.textContent = value;
  }

  get expanded(): boolean { return this._expanded; }
}
