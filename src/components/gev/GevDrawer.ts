import {
  fetchElectricityPrice,
  fetchNaturalGas,
  fetchGridDemand,
  fetchUSGeneration,
  type MetricResult,
} from '@/services/eia-live';

const DRAWER_STATE_KEY = 'gev-drawer-expanded';

interface MetricTile {
  id: string;
  label: string;
  value: string;
  sub: string;
  sparkline: string;
  trend: '+' | '-' | '';
  change: string;
}

interface NewsItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string | null;
}

const PLACEHOLDER_METRICS: MetricTile[] = [
  { id: 'elec-price', label: 'Avg Electricity Price', value: '—', sub: '$/MWh',      sparkline: '0,14 8,12 16,15 24,10 32,13 40,9 48,11 56,8 60,10', trend: '', change: '…' },
  { id: 'natgas',     label: 'Nat. Gas (Henry Hub)',   value: '—', sub: '$/MMBtu',    sparkline: '0,16 8,14 16,11 24,13 32,9 40,12 48,7 56,10 60,8',  trend: '', change: '…' },
  { id: 'demand',     label: 'Grid Demand',            value: '—', sub: 'GW demand',  sparkline: '0,13 8,11 16,14 24,10 32,12 40,9 48,11 56,9 60,11',  trend: '', change: '…' },
  { id: 'gen',        label: 'US Generation',          value: '—', sub: 'GW gen.',    sparkline: '0,10 8,12 16,11 24,13 32,10 40,14 48,12 56,11 60,13', trend: '', change: '…' },
];

const PLACEHOLDER_NEWS: NewsItem[] = [
  { title: 'EIA: US renewable generation surpasses coal for third consecutive month', source: 'EIA', url: 'https://www.eia.gov/todayinenergy/', publishedAt: null },
  { title: 'Henry Hub natural gas futures rise on summer cooling demand outlook', source: 'EIA', url: 'https://www.eia.gov/naturalgas/', publishedAt: null },
  { title: 'PJM Interconnection approves $3.2B grid expansion plan', source: 'EIA', url: 'https://www.eia.gov/electricity/', publishedAt: null },
  { title: 'Tengiz oil field reaches record output after expansion completion', source: 'EIA', url: 'https://www.eia.gov/petroleum/', publishedAt: null },
  { title: 'ERCOT calls for conservation as Texas temperatures exceed 105°F', source: 'EIA', url: 'https://www.eia.gov/electricity/', publishedAt: null },
  { title: 'Permian Basin production exceeds 6 million barrels per day milestone', source: 'EIA', url: 'https://www.eia.gov/petroleum/', publishedAt: null },
];

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 2) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch { return ''; }
}

function renderNewsItems(items: NewsItem[]): string {
  return items.map(item => `
    <a class="gev-news-item" href="${item.url}" target="_blank" rel="noopener noreferrer">
      <div class="gev-news-title">${item.title}</div>
      <div class="gev-news-meta">${item.source}${item.publishedAt ? ` · ${relativeTime(item.publishedAt)}` : ''}</div>
    </a>`).join('');
}

export class GevDrawer {
  private el: HTMLElement;
  private _expanded: boolean;
  private priceInterval: ReturnType<typeof setInterval> | null = null;
  private demandInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this._expanded = localStorage.getItem(DRAWER_STATE_KEY) === 'true';
    this.el = document.createElement('div');
    this.el.className = `gev-drawer${this._expanded ? ' expanded' : ''}`;
    this.el.id = 'gevDrawer';
    this.el.innerHTML = this.render();
    this.bindEvents();
    void this.loadAllMetrics();
    void this.loadNews();
    this.startPolling();
  }

  private render(): string {
    const tiles = PLACEHOLDER_METRICS.map(m => {
      const changeClass = m.trend === '+' ? 'up' : m.trend === '-' ? 'down' : 'flat';
      const arrow = m.trend === '+' ? '▲' : m.trend === '-' ? '▼' : '—';
      const strokeColor = m.trend === '+' ? '#22c55e' : m.trend === '-' ? '#ef4444' : '#888';
      return `
        <div class="gev-metric-tile" id="gevMetric-${m.id}">
          <div class="gev-metric-label">${m.label}</div>
          <div class="gev-metric-value" id="gevMetricVal-${m.id}">${m.value}</div>
          <div class="gev-metric-sub" id="gevMetricSub-${m.id}">${m.sub}</div>
          <svg class="gev-metric-sparkline" width="60" height="20" viewBox="0 0 60 20" id="gevMetricSpark-${m.id}">
            <polyline points="${m.sparkline}" fill="none" stroke="${strokeColor}" stroke-width="1.5"
                      stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="gev-metric-change ${changeClass}" id="gevMetricChange-${m.id}">${arrow} ${m.change}</div>
        </div>`;
    }).join('');

    const newsPlaceholder = renderNewsItems(PLACEHOLDER_NEWS);

    return `
      <div class="gev-drawer-handle" id="gevDrawerHandle">
        <div class="gev-drawer-grip" aria-hidden="true"></div>
        <span class="gev-drawer-title">Energy Intelligence</span>
        <button class="gev-drawer-toggle" id="gevDrawerToggle" aria-label="Toggle drawer" title="Toggle panel">▲</button>
      </div>
      <div class="gev-drawer-body">
        <div class="gev-metrics-col">${tiles}</div>
        <div class="gev-news-col" id="gevNewsCol">
          <div class="gev-news-header">Energy News</div>
          <div class="gev-news-list" id="gevNewsList">${newsPlaceholder}</div>
        </div>
        <div class="gev-news-wrap" id="gevNewsWrap" style="display:none"></div>
      </div>
    `;
  }

  private applyMetric(id: string, result: MetricResult): void {
    const changeClass = result.trend === '+' ? 'up' : result.trend === '-' ? 'down' : 'flat';
    const arrow = result.trend === '+' ? '▲' : result.trend === '-' ? '▼' : '—';
    const strokeColor = result.trend === '+' ? '#22c55e' : result.trend === '-' ? '#ef4444' : '#888';

    const valEl = this.el.querySelector<HTMLElement>(`#gevMetricVal-${id}`);
    const changeEl = this.el.querySelector<HTMLElement>(`#gevMetricChange-${id}`);
    const sparkEl = this.el.querySelector<SVGElement>(`#gevMetricSpark-${id}`);

    if (valEl) valEl.textContent = result.value > 0 ? result.value.toFixed(result.value >= 100 ? 0 : 1) : '—';
    if (changeEl) {
      changeEl.className = `gev-metric-change ${changeClass}`;
      changeEl.textContent = `${arrow} ${result.changePct}%`;
    }

    if (sparkEl && result.sparkline.length > 1) {
      const vals = result.sparkline;
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const range = max - min || 1;
      const points = vals.map((v, i) => {
        const x = (i / (vals.length - 1)) * 60;
        const y = 18 - ((v - min) / range) * 16;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      sparkEl.innerHTML = `<polyline points="${points}" fill="none" stroke="${strokeColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }

  private async loadAllMetrics(): Promise<void> {
    const fetchers: Array<[string, () => Promise<MetricResult>]> = [
      ['elec-price', fetchElectricityPrice],
      ['natgas',     fetchNaturalGas],
      ['demand',     fetchGridDemand],
      ['gen',        fetchUSGeneration],
    ];
    await Promise.allSettled(
      fetchers.map(async ([id, fn]) => {
        try {
          const result = await fn();
          this.applyMetric(id, result);
        } catch {
          // Leave placeholder on error
        }
      })
    );
  }

  private async loadNews(): Promise<void> {
    try {
      const res = await fetch('/api/energy-news');
      if (!res.ok) return;
      const items = await res.json() as NewsItem[];
      if (!Array.isArray(items) || items.length === 0) return;
      const listEl = this.el.querySelector<HTMLElement>('#gevNewsList');
      if (listEl) listEl.innerHTML = renderNewsItems(items);
    } catch {
      // Keep placeholder headlines on error
    }
  }

  private startPolling(): void {
    // Electricity price and gas: refresh hourly
    this.priceInterval = setInterval(() => {
      void Promise.allSettled([
        fetchElectricityPrice().then(r => this.applyMetric('elec-price', r)).catch(() => {}),
        fetchNaturalGas().then(r => this.applyMetric('natgas', r)).catch(() => {}),
      ]);
    }, 60 * 60 * 1000);

    // Grid demand and generation: refresh every 15 minutes
    this.demandInterval = setInterval(() => {
      void Promise.allSettled([
        fetchGridDemand().then(r => this.applyMetric('demand', r)).catch(() => {}),
        fetchUSGeneration().then(r => this.applyMetric('gen', r)).catch(() => {}),
      ]);
    }, 15 * 60 * 1000);
  }

  private bindEvents(): void {
    this.el.querySelector('#gevDrawerHandle')?.addEventListener('click', () => this.toggle());
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
  }

  mountNewsPanel(_panelEl: HTMLElement): void {
    // News is handled inline via /api/energy-news; legacy NewsPanel is suppressed.
  }

  toggle(): void {
    this._expanded = !this._expanded;
    this.el.classList.toggle('expanded', this._expanded);
    localStorage.setItem(DRAWER_STATE_KEY, String(this._expanded));
  }

  setMetric(id: string, value: string): void {
    const el = this.el.querySelector<HTMLElement>(`#gevMetricVal-${id}`);
    if (el) el.textContent = value;
  }

  destroy(): void {
    if (this.priceInterval) clearInterval(this.priceInterval);
    if (this.demandInterval) clearInterval(this.demandInterval);
  }

  get expanded(): boolean { return this._expanded; }
}
