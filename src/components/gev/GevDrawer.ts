import {
  fetchElectricityPrice,
  fetchNaturalGas,
  fetchGridDemand,
  fetchUSGeneration,
  type MetricResult,
} from '@/services/eia-live';
import {
  GEV_ENERGY_EVENT,
  GEV_STATUS_EVENT,
  getStoredEvents,
  type EnergyEvent,
  type ConnectionState,
} from '@/services/energy-events';
import type { MapContainer } from '@/components';

const DRAWER_STATE_KEY = 'gev-drawer-expanded';
const TAB_STATE_KEY = 'gev-drawer-tab';

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
  isFallback?: boolean;
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

// ── Geographic keyword → map location ─────────────────────────────────
interface GeoEntry { re: RegExp; lat: number; lon: number; zoom: number }
const GEO_LOCATIONS: GeoEntry[] = [
  { re: /\b(Texas|ERCOT)\b/i,                         lat: 31.5,  lon: -99.0,  zoom: 5 },
  { re: /\b(California|CAISO)\b/i,                     lat: 37.0,  lon: -120.0, zoom: 5 },
  { re: /\b(PJM|mid-Atlantic)\b/i,                     lat: 39.5,  lon: -77.5,  zoom: 5 },
  { re: /\b(MISO|Midwest)\b/i,                         lat: 41.0,  lon: -89.0,  zoom: 5 },
  { re: /\b(New York|NYISO)\b/i,                       lat: 42.5,  lon: -75.5,  zoom: 6 },
  { re: /\b(New England|ISO-NE)\b/i,                   lat: 42.5,  lon: -71.5,  zoom: 6 },
  { re: /\bSPP\b/,                                     lat: 36.0,  lon: -97.0,  zoom: 5 },
  { re: /\b(Gulf Coast|Houston)\b/i,                   lat: 29.7,  lon: -95.4,  zoom: 6 },
  { re: /\bAlaska\b/i,                                 lat: 64.0,  lon: -153.0, zoom: 4 },
  { re: /\bPermian\b/i,                                lat: 31.95, lon: -102.1, zoom: 7 },
  { re: /\bBakken\b/i,                                 lat: 48.1,  lon: -103.5, zoom: 7 },
  { re: /\bEagle Ford\b/i,                             lat: 28.7,  lon: -98.5,  zoom: 7 },
  { re: /\bMarcellus\b/i,                              lat: 41.0,  lon: -77.5,  zoom: 6 },
  { re: /\bHaynesville\b/i,                            lat: 32.5,  lon: -93.5,  zoom: 7 },
  { re: /\bKashagan\b/i,                               lat: 45.4,  lon: 53.0,   zoom: 7 },
  { re: /\b(Kazakhstan|Tengiz)\b/i,                    lat: 46.5,  lon: 52.5,   zoom: 5 },
  { re: /\bCaspian\b/i,                                lat: 42.0,  lon: 50.0,   zoom: 5 },
  { re: /\b(Azerbaijan|Baku)\b/i,                      lat: 40.4,  lon: 49.8,   zoom: 6 },
  { re: /\b(Saudi|Ghawar)\b/i,                         lat: 25.5,  lon: 49.5,   zoom: 6 },
  { re: /\b(Nord Stream|Baltic)\b/i,                   lat: 57.0,  lon: 18.0,   zoom: 5 },
  { re: /\bEurope(an)?\b/i,                            lat: 50.0,  lon: 10.0,   zoom: 4 },
  { re: /\bRussi(a|an)\b/i,                            lat: 60.0,  lon: 80.0,   zoom: 3 },
  { re: /\bChin(a|ese)\b/i,                            lat: 35.0,  lon: 105.0,  zoom: 4 },
  { re: /\bIran(ian)?\b/i,                             lat: 32.0,  lon: 53.0,   zoom: 5 },
  { re: /\bIraqi?\b/i,                                 lat: 33.0,  lon: 44.0,   zoom: 5 },
  { re: /\bNigeria(n)?\b/i,                            lat: 9.0,   lon: 7.5,    zoom: 5 },
  { re: /\bColonial Pipeline\b/i,                      lat: 34.0,  lon: -84.0,  zoom: 5 },
  { re: /\bKeystone\b/i,                               lat: 45.0,  lon: -100.0, zoom: 4 },
];

function findNewsLocation(title: string): { lat: number; lon: number; zoom: number } | null {
  for (const entry of GEO_LOCATIONS) {
    if (entry.re.test(title)) return { lat: entry.lat, lon: entry.lon, zoom: entry.zoom };
  }
  return null;
}

// ── Utilities ─────────────────────────────────────────────────────────
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function relativeTime(ts: Date | string | null): string {
  if (!ts) return '';
  try {
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 2) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch { return ''; }
}

function renderNewsItems(items: NewsItem[], isPlaceholder = false): string {
  const allFallback = items.length > 0 && items.every(item => item.isFallback);
  const header = isPlaceholder
    ? '<div class="gev-news-placeholder-note">📡 Live feed connecting…</div>'
    : allFallback
    ? '<div class="gev-news-placeholder-note">⚠️ Live feed unavailable — showing sample headlines</div>'
    : '';

  const rows = items.map(item => {
    const fallback = isPlaceholder || !!item.isFallback;
    const loc = !fallback ? findNewsLocation(item.title) : null;
    const mapBtn = loc
      ? `<button class="gev-news-map-btn" data-lat="${loc.lat}" data-lon="${loc.lon}" data-zoom="${loc.zoom}" title="View on map">📍</button>`
      : '';
    const timeStr = item.publishedAt ? ` · ${relativeTime(item.publishedAt)}` : '';
    const clickable = !fallback;
    return `
      <div class="gev-news-item${clickable ? '' : ' gev-news-item--static'}${fallback ? ' gev-news-item--fallback' : ''}" ${clickable ? `data-url="${escHtml(item.url)}"` : ''} ${clickable ? 'role="button" tabindex="0"' : ''}>
        <div class="gev-news-content">
          <div class="gev-news-title" title="${escHtml(item.title)}">${escHtml(item.title)}</div>
          <div class="gev-news-meta">${escHtml(item.source)}${item.publishedAt ? escHtml(timeStr) : ''}</div>
        </div>
        ${mapBtn}
      </div>`;
  }).join('');

  return header + rows;
}

function renderEventCard(ev: EnergyEvent, isNew = false): string {
  const locBtn = ev.location
    ? `<button class="gev-event-location" data-lat="${ev.location.lat}" data-lon="${ev.location.lon}" data-zoom="${ev.location.zoom}">View on map →</button>`
    : '';
  return `
    <div class="gev-event-card gev-event-${ev.severity}${isNew ? ' gev-event-new' : ''}" data-event-id="${ev.id}">
      <div class="gev-event-header">
        <span class="gev-event-icon">${ev.icon}</span>
        <span class="gev-event-title">${ev.title}</span>
      </div>
      <div class="gev-event-desc">${ev.description}</div>
      <div class="gev-event-footer">
        <span class="gev-event-time">${relativeTime(ev.timestamp)}</span>
        <span class="gev-event-source">${ev.source}</span>
        ${locBtn}
      </div>
    </div>`;
}

// ── RSS parser (browser-side fallback) ────────────────────────────────
function parseRSS(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const content = m[1] ?? '';
    const titleM = content.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)
      ?? content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkM = content.match(/<link[^>]*>(https?:\/\/[^\s<]+)<\/link>/i)
      ?? content.match(/<guid[^>]*isPermaLink="true"[^>]*>(https?:\/\/[^\s<]+)<\/guid>/i)
      ?? content.match(/<guid[^>]*>(https?:\/\/[^\s<]+)<\/guid>/i);
    const dateM = content.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);

    const rawTitle = titleM?.[1]?.trim() ?? '';
    const title = rawTitle
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    const url = linkM?.[1]?.trim() ?? '';
    if (!title || !url) continue;

    let publishedAt: string | null = null;
    if (dateM?.[1]) {
      try { publishedAt = new Date(dateM[1].trim()).toISOString(); } catch { /* ignore */ }
    }
    items.push({ title, source, url, publishedAt });
  }
  return items;
}

async function fetchRSSDirect(feedUrl: string, source: string): Promise<NewsItem[]> {
  const res = await fetch(feedUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
  const xml = await res.text();
  return parseRSS(xml, source);
}

async function fetchRSSViaProxy(feedUrl: string, source: string): Promise<NewsItem[]> {
  const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(feedUrl)}`;
  const res = await fetch(proxy, { cache: 'no-store' });
  if (!res.ok) throw new Error(`CORS proxy HTTP ${res.status}`);
  const xml = await res.text();
  return parseRSS(xml, source);
}

// ── Drawer class ──────────────────────────────────────────────────────
export class GevDrawer {
  private el: HTMLElement;
  private _expanded: boolean;
  private _tab: 'feed' | 'metrics';
  private map: MapContainer | null = null;
  private priceInterval: ReturnType<typeof setInterval> | null = null;
  private demandInterval: ReturnType<typeof setInterval> | null = null;
  private timeInterval: ReturnType<typeof setInterval> | null = null;
  private eventHandler: ((e: Event) => void) | null = null;
  private statusHandler: ((e: Event) => void) | null = null;

  constructor() {
    this._expanded = localStorage.getItem(DRAWER_STATE_KEY) === 'true';
    this._tab = (localStorage.getItem(TAB_STATE_KEY) as 'feed' | 'metrics' | null) ?? 'feed';
    this.el = document.createElement('div');
    this.el.className = `gev-drawer${this._expanded ? ' expanded' : ''}`;
    this.el.id = 'gevDrawer';
    this.el.innerHTML = this.buildHTML();
    this.bindEvents();
    void this.loadAllMetrics();
    void this.loadNews();
    this.startPolling();
    this.startTimeUpdater();
  }

  private buildHTML(): string {
    const tiles = PLACEHOLDER_METRICS.map(m => {
      const cc = m.trend === '+' ? 'up' : m.trend === '-' ? 'down' : 'flat';
      const arrow = m.trend === '+' ? '▲' : m.trend === '-' ? '▼' : '—';
      const stroke = m.trend === '+' ? '#22c55e' : m.trend === '-' ? '#ef4444' : '#888';
      return `
        <div class="gev-metric-tile" id="gevMetric-${m.id}">
          <div class="gev-metric-label">${m.label}</div>
          <div class="gev-metric-value" id="gevMetricVal-${m.id}">${m.value}</div>
          <div class="gev-metric-sub" id="gevMetricSub-${m.id}">${m.sub}</div>
          <svg class="gev-metric-sparkline" width="60" height="20" viewBox="0 0 60 20" id="gevMetricSpark-${m.id}">
            <polyline points="${m.sparkline}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="gev-metric-change ${cc}" id="gevMetricChange-${m.id}">${arrow} ${m.change}</div>
        </div>`;
    }).join('');

    const feedActive = this._tab === 'feed';

    return `
      <div class="gev-drawer-handle" id="gevDrawerHandle">
        <div class="gev-drawer-grip" aria-hidden="true"></div>
        <span class="gev-drawer-title">Energy Intelligence</span>
        <span class="gev-peek-ticker" id="gevPeekTicker"></span>
        <button class="gev-drawer-toggle" id="gevDrawerToggle" aria-label="Toggle drawer" title="Toggle panel">▲</button>
      </div>
      <div class="gev-drawer-body">
        <div class="gev-drawer-tabs" role="tablist">
          <button class="gev-tab${feedActive ? ' active' : ''}" data-tab="feed" role="tab" aria-selected="${feedActive}">
            <span class="gev-feed-pulse" id="gevFeedPulse" aria-hidden="true"></span>
            LIVE FEED
          </button>
          <button class="gev-tab${!feedActive ? ' active' : ''}" data-tab="metrics" role="tab" aria-selected="${!feedActive}">
            METRICS
          </button>
        </div>
        <div class="gev-feed-panel" id="gevFeedPanel"${feedActive ? '' : ' style="display:none"'}></div>
        <div class="gev-metrics-panel" id="gevMetricsPanel"${feedActive ? ' style="display:none"' : ''}>
          <div class="gev-metrics-col">${tiles}</div>
          <div class="gev-news-col" id="gevNewsCol">
            <div class="gev-news-header">Energy News</div>
            <div class="gev-news-list" id="gevNewsList">${renderNewsItems(PLACEHOLDER_NEWS, true)}</div>
          </div>
          <div class="gev-news-wrap" id="gevNewsWrap" style="display:none"></div>
        </div>
      </div>`;
  }

  // ── Metric helpers ─────────────────────────────────────────────
  private applyMetric(id: string, result: MetricResult): void {
    const cc = result.trend === '+' ? 'up' : result.trend === '-' ? 'down' : 'flat';
    const arrow = result.trend === '+' ? '▲' : result.trend === '-' ? '▼' : '—';
    const stroke = result.trend === '+' ? '#22c55e' : result.trend === '-' ? '#ef4444' : '#888';

    const valEl = this.el.querySelector<HTMLElement>(`#gevMetricVal-${id}`);
    const changeEl = this.el.querySelector<HTMLElement>(`#gevMetricChange-${id}`);
    const sparkEl = this.el.querySelector<SVGElement>(`#gevMetricSpark-${id}`);

    if (valEl) valEl.textContent = result.value > 0 ? result.value.toFixed(result.value >= 100 ? 0 : 2) : '—';
    if (changeEl) {
      changeEl.className = `gev-metric-change ${cc}`;
      changeEl.textContent = `${arrow} ${result.changePct}%`;
    }

    if (sparkEl && result.sparkline.length > 1) {
      const vals = result.sparkline;
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const range = max - min || 1;
      const pts = vals.map((v, i) => {
        const x = (i / (vals.length - 1)) * 60;
        const y = 18 - ((v - min) / range) * 16;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      sparkEl.innerHTML = `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
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
        try { this.applyMetric(id, await fn()); } catch { /* keep placeholder */ }
      })
    );
  }

  // ── News loading with fallback chain ──────────────────────────
  private async loadNews(): Promise<void> {
    const EIA_FEEDS = [
      { url: 'https://www.eia.gov/todayinenergy/rss.xml', source: 'EIA' },
      { url: 'https://www.eia.gov/rss/press_room.xml',    source: 'EIA Press' },
    ];

    const applyItems = (items: NewsItem[], isPlaceholder: boolean) => {
      const listEl = this.el.querySelector<HTMLElement>('#gevNewsList');
      if (listEl) listEl.innerHTML = renderNewsItems(items, isPlaceholder);
    };

    const sortAndSlice = (items: NewsItem[]) =>
      items
        .sort((a, b) => {
          if (!a.publishedAt) return 1;
          if (!b.publishedAt) return -1;
          return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
        })
        .slice(0, 15);

    // 1. Try Vercel edge function (works in production)
    try {
      console.log('[GEV news] trying /api/energy-news…');
      const res = await fetch('/api/energy-news');
      console.log('[GEV news] /api/energy-news →', res.status);
      if (res.ok) {
        const items = await res.json() as NewsItem[];
        if (Array.isArray(items) && items.length > 0) {
          console.log('[GEV news] edge function OK:', items.length, 'items');
          applyItems(items, false);
          return;
        }
      }
    } catch (e) {
      console.log('[GEV news] edge function error:', e);
    }

    // 2. Direct RSS fetch (EIA is a .gov site — sometimes CORS-permissive)
    console.log('[GEV news] trying direct RSS…');
    const directResults = await Promise.allSettled(
      EIA_FEEDS.map(f => fetchRSSDirect(f.url, f.source))
    );
    directResults.forEach((r, i) => {
      if (r.status === 'rejected') console.log('[GEV news] direct', EIA_FEEDS[i]?.url, 'failed:', r.reason);
    });
    const directItems = directResults.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    if (directItems.length > 0) {
      console.log('[GEV news] direct RSS OK:', directItems.length, 'items');
      applyItems(sortAndSlice(directItems), false);
      return;
    }

    // 3. CORS proxy (allorigins.win) — reliable local-dev fallback
    console.log('[GEV news] trying allorigins.win proxy…');
    const proxyResults = await Promise.allSettled(
      EIA_FEEDS.map(f => fetchRSSViaProxy(f.url, f.source))
    );
    proxyResults.forEach((r, i) => {
      if (r.status === 'rejected') console.log('[GEV news] proxy', EIA_FEEDS[i]?.url, 'failed:', r.reason);
    });
    const proxyItems = proxyResults.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    if (proxyItems.length > 0) {
      console.log('[GEV news] proxy OK:', proxyItems.length, 'items');
      applyItems(sortAndSlice(proxyItems), false);
      return;
    }

    // 4. All paths failed — show placeholder with connecting label
    console.log('[GEV news] all sources failed — showing placeholders');
    applyItems(PLACEHOLDER_NEWS, true);
  }

  // ── Feed helpers ───────────────────────────────────────────────
  private renderAllEvents(): void {
    const panel = this.el.querySelector<HTMLElement>('#gevFeedPanel');
    if (!panel) return;
    const events = getStoredEvents();
    panel.innerHTML = events.map(ev => renderEventCard(ev)).join('');
    this.updatePeekTicker(events.slice(0, 3));
  }

  private prependEvent(ev: EnergyEvent): void {
    const panel = this.el.querySelector<HTMLElement>('#gevFeedPanel');
    if (!panel) return;
    panel.insertAdjacentHTML('afterbegin', renderEventCard(ev, true));
    const cards = panel.querySelectorAll('.gev-event-card');
    if (cards.length > 50) cards[cards.length - 1]?.remove();
    const newCard = panel.querySelector<HTMLElement>(`[data-event-id="${ev.id}"]`);
    if (newCard) setTimeout(() => newCard.classList.remove('gev-event-new'), 700);
    this.updatePeekTicker(getStoredEvents().slice(0, 3));
  }

  private updatePeekTicker(recent: EnergyEvent[]): void {
    const el = this.el.querySelector<HTMLElement>('#gevPeekTicker');
    if (!el) return;
    el.textContent = recent.length
      ? recent.map(e => `${e.icon} ${e.title}`).join('  ·  ')
      : '';
  }

  private updateEventTimes(): void {
    const events = getStoredEvents();
    const byId = new Map(events.map(e => [e.id, e]));
    this.el.querySelectorAll<HTMLElement>('.gev-event-card').forEach(card => {
      const ev = byId.get(card.dataset['eventId'] ?? '');
      if (!ev) return;
      const timeEl = card.querySelector<HTMLElement>('.gev-event-time');
      if (timeEl) timeEl.textContent = relativeTime(ev.timestamp);
    });
  }

  // ── Polling ────────────────────────────────────────────────────
  private startPolling(): void {
    this.priceInterval = setInterval(() => {
      void Promise.allSettled([
        fetchElectricityPrice().then(r => this.applyMetric('elec-price', r)).catch(() => {}),
        fetchNaturalGas().then(r => this.applyMetric('natgas', r)).catch(() => {}),
      ]);
    }, 60 * 60_000);

    this.demandInterval = setInterval(() => {
      void Promise.allSettled([
        fetchGridDemand().then(r => this.applyMetric('demand', r)).catch(() => {}),
        fetchUSGeneration().then(r => this.applyMetric('gen', r)).catch(() => {}),
      ]);
    }, 15 * 60_000);
  }

  private startTimeUpdater(): void {
    this.timeInterval = setInterval(() => this.updateEventTimes(), 60_000);
  }

  // ── Event binding ──────────────────────────────────────────────
  private bindEvents(): void {
    this.el.querySelector('#gevDrawerHandle')?.addEventListener('click', () => this.toggle());

    this.el.querySelector('.gev-drawer-tabs')?.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset['tab'];
      if (tab === 'feed' || tab === 'metrics') this.switchTab(tab);
    });

    // Event card "View on map →" buttons
    this.el.addEventListener('click', (e) => {
      const locBtn = (e.target as HTMLElement).closest<HTMLElement>('.gev-event-location');
      if (locBtn && this.map) {
        e.stopPropagation();
        const lat = parseFloat(locBtn.dataset['lat'] ?? '');
        const lon = parseFloat(locBtn.dataset['lon'] ?? '');
        const zoom = parseFloat(locBtn.dataset['zoom'] ?? '5');
        if (!isNaN(lat) && !isNaN(lon)) this.map.setCenter(lat, lon, zoom);
        return;
      }

      // News item map button — fly to location
      const mapBtn = (e.target as HTMLElement).closest<HTMLElement>('.gev-news-map-btn');
      if (mapBtn) {
        e.stopPropagation();
        const lat = parseFloat(mapBtn.dataset['lat'] ?? '');
        const lon = parseFloat(mapBtn.dataset['lon'] ?? '');
        const zoom = parseFloat(mapBtn.dataset['zoom'] ?? '5');
        if (!isNaN(lat) && !isNaN(lon) && this.map) this.map.setCenter(lat, lon, zoom);
        return;
      }

      // News item row click — open article URL
      const newsItem = (e.target as HTMLElement).closest<HTMLElement>('.gev-news-item');
      if (newsItem) {
        const url = newsItem.dataset['url'];
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
      }
    });

    this.eventHandler = (e: Event) => {
      this.prependEvent((e as CustomEvent<EnergyEvent>).detail);
    };
    window.addEventListener(GEV_ENERGY_EVENT, this.eventHandler);

    this.statusHandler = (e: Event) => {
      this.applyConnectionStatus((e as CustomEvent<ConnectionState>).detail);
    };
    window.addEventListener(GEV_STATUS_EVENT, this.statusHandler);
  }

  private switchTab(tab: 'feed' | 'metrics'): void {
    if (this._tab === tab) return;
    this._tab = tab;
    localStorage.setItem(TAB_STATE_KEY, tab);

    this.el.querySelectorAll<HTMLElement>('.gev-tab').forEach(t => {
      const active = t.dataset['tab'] === tab;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
    });

    const feedPanel = this.el.querySelector<HTMLElement>('#gevFeedPanel');
    const metricsPanel = this.el.querySelector<HTMLElement>('#gevMetricsPanel');
    if (feedPanel) feedPanel.style.display = tab === 'feed' ? '' : 'none';
    if (metricsPanel) metricsPanel.style.display = tab === 'metrics' ? '' : 'none';
  }

  private applyConnectionStatus(state: ConnectionState): void {
    const dot = this.el.querySelector<HTMLElement>('#gevFeedPulse');
    if (dot) dot.dataset['status'] = state.status;
  }

  // ── Public API ─────────────────────────────────────────────────
  setMap(map: MapContainer): void {
    this.map = map;
  }

  expandToFeed(): void {
    this._expanded = true;
    this.el.classList.add('expanded');
    localStorage.setItem(DRAWER_STATE_KEY, 'true');
    this.switchTab('feed');
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
    this.renderAllEvents();
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
    if (this.timeInterval) clearInterval(this.timeInterval);
    if (this.eventHandler) window.removeEventListener(GEV_ENERGY_EVENT, this.eventHandler);
    if (this.statusHandler) window.removeEventListener(GEV_STATUS_EVENT, this.statusHandler);
  }

  get expanded(): boolean { return this._expanded; }
}
