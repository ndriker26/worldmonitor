import maplibregl from 'maplibre-gl';
import type { MapContainer } from '@/components';
import type { MapLayers } from '@/types';
import type { GevStory, GevStoryStep } from '@/config/gev-stories';

/**
 * Guided story player. Flies the camera between stops, draws highlighted
 * pipelines, and shows one short caption per stop. The dashboard sits behind
 * it; skipping or finishing hands control back.
 */

type MapLibreLike = maplibregl.Map;

const LINE_SOURCE = 'gev-story-lines';
const LINE_LAYER = 'gev-story-line';
const GLOW_LAYER = 'gev-story-glow';
const SEEN_KEY = 'gev_story_seen';

interface PipelineFeature {
  id: string;
  coordinates: [number, number][];
}

export class GevStoryPlayer {
  private story: GevStory;
  private map: MapContainer | null = null;
  private el: HTMLElement;
  private index = 0;
  private active = false;
  private marker: maplibregl.Marker | null = null;
  private pipelineCache: Map<string, PipelineFeature> | null = null;
  private drawRaf = 0;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private onExit: (() => void) | null = null;
  private onEnter: (() => void) | null = null;
  private savedMaxPitch: number | null = null;
  private reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  constructor(story: GevStory) {
    this.story = story;
    this.el = document.createElement('section');
    this.el.className = 'gev-story';
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('aria-label', story.title);
    this.el.innerHTML = this.renderShell();
  }

  setMap(map: MapContainer): void { this.map = map; }
  setHandlers(onEnter: () => void, onExit: () => void): void {
    this.onEnter = onEnter;
    this.onExit = onExit;
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
    this.el.querySelector('#gevStoryNext')?.addEventListener('click', () => this.next());
    this.el.querySelector('#gevStoryPrev')?.addEventListener('click', () => this.prev());
    this.el.querySelector('#gevStorySkip')?.addEventListener('click', () => this.exit());
    this.el.querySelectorAll<HTMLButtonElement>('.gev-story-seg').forEach((seg) => {
      seg.addEventListener('click', () => this.go(Number(seg.dataset['i'])));
    });
  }

  /** True when the visitor hasn't seen the story in this browser session. */
  static shouldAutoplay(): boolean {
    try {
      if (new URLSearchParams(location.search).has('nostory')) return false;
      return sessionStorage.getItem(SEEN_KEY) !== '1';
    } catch {
      return true;
    }
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.onEnter?.();
    this.allowPitch(true);
    this.enableLayers(this.story.steps.flatMap((s) => s.layers ?? []));
    this.el.classList.add('open');
    document.addEventListener('keydown', this.keyHandler);
    this.go(0);
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* storage blocked */ }
    document.removeEventListener('keydown', this.keyHandler);
    this.el.classList.remove('open');
    this.clearMarker();
    // Flatten the camera, then clean up the story overlays.
    const ml = this.getMapLibre();
    if (ml) {
      ml.easeTo({ pitch: 0, bearing: 0, duration: this.reduceMotion ? 0 : 900 });
      ml.once('moveend', () => {
        this.allowPitch(false);
        this.removeLines();
      });
    }
    this.onExit?.();
  }

  get isActive(): boolean { return this.active; }

  private next(): void {
    if (this.index >= this.story.steps.length - 1) { this.exit(); return; }
    this.go(this.index + 1);
  }

  private prev(): void {
    if (this.index > 0) this.go(this.index - 1);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.active) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); this.next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); this.prev(); }
    else if (e.key === 'Escape') { e.preventDefault(); this.exit(); }
  }

  private go(i: number): void {
    const step = this.story.steps[i];
    if (!step) return;
    const dir = i >= this.index ? 1 : -1;
    this.index = i;
    this.renderStep(step, dir);
    this.fly(step);
    this.updateMarker(step);
    void this.updateLines(step);
  }

  // ── Rendering ────────────────────────────────────────────────

  private renderShell(): string {
    const segs = this.story.steps
      .map((_, i) => `<button class="gev-story-seg" data-i="${i}" aria-label="Go to stop ${i + 1}"><span></span></button>`)
      .join('');
    return `
      <div class="gev-story-scrim" aria-hidden="true"></div>
      <div class="gev-story-card">
        <div class="gev-story-progress">${segs}</div>
        <div class="gev-story-text">
          <div class="gev-story-kicker"></div>
          <h2 class="gev-story-title"></h2>
          <p class="gev-story-body"></p>
        </div>
        <div class="gev-story-controls">
          <button class="gev-story-skip" id="gevStorySkip">Skip to map</button>
          <div class="gev-story-nav">
            <button class="gev-story-btn" id="gevStoryPrev" aria-label="Previous stop">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <button class="gev-story-btn gev-story-btn--primary" id="gevStoryNext">
              <span class="gev-story-next-label">Next</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
        </div>
        <div class="gev-story-sources">Sources: ${this.story.sources}</div>
      </div>
    `;
  }

  private renderStep(step: GevStoryStep, dir: number): void {
    const text = this.el.querySelector<HTMLElement>('.gev-story-text');
    if (!text) return;
    const last = this.index === this.story.steps.length - 1;

    const apply = () => {
      text.querySelector('.gev-story-kicker')!.textContent = step.kicker;
      text.querySelector('.gev-story-title')!.textContent = step.title;
      text.querySelector('.gev-story-body')!.textContent = step.body;
    };

    if (this.reduceMotion || !text.animate) {
      apply();
    } else {
      // Outgoing text slides the way we're travelling; incoming arrives from the
      // opposite side, so forward and back mirror each other.
      text.getAnimations().forEach((a) => a.cancel());
      const out = text.animate(
        [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${-14 * dir}px)` }],
        { duration: 160, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
      );
      out.onfinish = () => {
        apply();
        text.animate(
          [{ opacity: 0, transform: `translateX(${18 * dir}px)` }, { opacity: 1, transform: 'translateX(0)' }],
          { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
        );
      };
    }

    this.el.querySelectorAll<HTMLElement>('.gev-story-seg').forEach((seg, i) => {
      seg.classList.toggle('done', i < this.index);
      seg.classList.toggle('current', i === this.index);
    });
    const prev = this.el.querySelector<HTMLButtonElement>('#gevStoryPrev');
    if (prev) prev.disabled = this.index === 0;
    const label = this.el.querySelector<HTMLElement>('.gev-story-next-label');
    if (label) label.textContent = last ? 'Open the map' : this.index === 0 ? 'Start' : 'Next';
    this.el.classList.toggle('last', last);
  }

  // ── Camera ───────────────────────────────────────────────────

  private getMapLibre(): MapLibreLike | null {
    const ml = (this.map as unknown as { deckGLMap?: { maplibreMap?: MapLibreLike } } | null)?.deckGLMap?.maplibreMap;
    return ml ?? null;
  }

  private allowPitch(on: boolean): void {
    const ml = this.getMapLibre();
    if (!ml) return;
    try {
      if (on) {
        if (this.savedMaxPitch === null) this.savedMaxPitch = ml.getMaxPitch();
        if (ml.getMaxPitch() < 50) ml.setMaxPitch(50);
      } else if (this.savedMaxPitch !== null) {
        ml.setMaxPitch(this.savedMaxPitch);
        this.savedMaxPitch = null;
      }
    } catch { /* older map versions */ }
  }

  private fly(step: GevStoryStep): void {
    const c = step.camera;
    const ml = this.getMapLibre();
    if (!ml) {
      this.map?.setCenter(c.lat, c.lon, c.zoom);
      return;
    }
    // Leave room for the caption card: shift the focus point up on mobile, right on desktop.
    const mobile = window.innerWidth <= 640;
    const padding = mobile
      ? { top: 40, bottom: Math.round(window.innerHeight * 0.42), left: 20, right: 20 }
      : { top: 60, bottom: 60, left: 440, right: 40 };
    const opts = {
      center: [c.lon, c.lat] as [number, number],
      zoom: c.zoom,
      pitch: c.pitch ?? 0,
      bearing: c.bearing ?? 0,
      padding,
    };
    if (this.reduceMotion) {
      ml.jumpTo(opts);
      return;
    }
    // flyTo starts from the live camera, so a mid-flight click just re-targets.
    ml.flyTo({ ...opts, duration: 2600, curve: 1.35, essential: true });
  }

  private enableLayers(keys: string[]): void {
    if (!this.map) return;
    for (const k of new Set(keys)) {
      try { this.map.enableLayer(k as keyof MapLayers); } catch { /* unknown layer */ }
    }
  }

  // ── Marker ───────────────────────────────────────────────────

  private updateMarker(step: GevStoryStep): void {
    const ml = this.getMapLibre();
    if (!step.marker || !ml) { this.clearMarker(); return; }
    if (!this.marker) {
      const dot = document.createElement('div');
      dot.className = 'gev-story-marker';
      dot.innerHTML = '<span class="ring"></span><span class="ring r2"></span><span class="core"></span>';
      this.marker = new maplibregl.Marker({ element: dot }).setLngLat(step.marker).addTo(ml);
    } else {
      this.marker.setLngLat(step.marker);
    }
    const el = this.marker.getElement();
    el.classList.remove('in');
    void el.offsetWidth;
    el.classList.add('in');
  }

  private clearMarker(): void {
    this.marker?.remove();
    this.marker = null;
  }

  // ── Pipeline highlight ───────────────────────────────────────

  private async loadPipelines(): Promise<Map<string, PipelineFeature>> {
    if (this.pipelineCache) return this.pipelineCache;
    const cache = new Map<string, PipelineFeature>();
    try {
      const res = await fetch('/data/gem-pipelines.json');
      const all = (await res.json()) as PipelineFeature[];
      const wanted = new Set(this.story.steps.flatMap((s) => s.pipelines ?? []));
      for (const p of all) if (wanted.has(p.id)) cache.set(p.id, p);
    } catch { /* highlight is decoration; skip on failure */ }
    this.pipelineCache = cache;
    return cache;
  }

  private async updateLines(step: GevStoryStep): Promise<void> {
    const ml = this.getMapLibre();
    if (!ml) return;
    const ids = step.pipelines ?? [];
    const cache = await this.loadPipelines();
    if (!this.active) return;
    const features = ids
      .map((id) => cache.get(id))
      .filter((p): p is PipelineFeature => !!p && p.coordinates?.length > 1)
      .map((p) => ({
        type: 'Feature' as const,
        properties: { id: p.id },
        geometry: { type: 'LineString' as const, coordinates: p.coordinates },
      }));
    const data = { type: 'FeatureCollection' as const, features };

    const ensure = () => {
      const src = ml.getSource(LINE_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
      } else {
        ml.addSource(LINE_SOURCE, { type: 'geojson', data, lineMetrics: true });
        ml.addLayer({
          id: GLOW_LAYER, type: 'line', source: LINE_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#f2a33a', 'line-width': 12, 'line-blur': 8, 'line-opacity': 0.35 },
        });
        ml.addLayer({
          id: LINE_LAYER, type: 'line', source: LINE_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-width': 3.5, 'line-gradient': this.gradient(1) },
        });
      }
      this.animateDraw(ml, features.length > 0);
    };

    try {
      if (ml.isStyleLoaded()) ensure();
      else ml.once('idle', ensure);
    } catch { /* style swapped mid-story */ }
  }

  private gradient(p: number): maplibregl.ExpressionSpecification {
    const solid = '#ffc46b';
    if (p >= 1) return ['interpolate', ['linear'], ['line-progress'], 0, solid, 1, solid];
    const edge = Math.max(0.0001, Math.min(0.9998, p));
    return ['interpolate', ['linear'], ['line-progress'], 0, solid, edge, solid, edge + 0.0001, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0)'];
  }

  /** Draws the route on from origin to terminal, timed to land with the camera. */
  private animateDraw(ml: MapLibreLike, hasLines: boolean): void {
    cancelAnimationFrame(this.drawRaf);
    if (!hasLines || this.reduceMotion) {
      try { ml.setPaintProperty(LINE_LAYER, 'line-gradient', this.gradient(1)); } catch { /* no layer */ }
      return;
    }
    const start = performance.now();
    const delay = 700;
    const dur = 2200;
    const tick = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start - delay) / dur));
      const eased = 1 - Math.pow(1 - t, 3);
      try { ml.setPaintProperty(LINE_LAYER, 'line-gradient', this.gradient(eased)); } catch { return; }
      if (t < 1) this.drawRaf = requestAnimationFrame(tick);
    };
    this.drawRaf = requestAnimationFrame(tick);
  }

  private removeLines(): void {
    cancelAnimationFrame(this.drawRaf);
    const ml = this.getMapLibre();
    if (!ml) return;
    try {
      if (ml.getLayer(LINE_LAYER)) ml.removeLayer(LINE_LAYER);
      if (ml.getLayer(GLOW_LAYER)) ml.removeLayer(GLOW_LAYER);
      if (ml.getSource(LINE_SOURCE)) ml.removeSource(LINE_SOURCE);
    } catch { /* already gone */ }
  }

  destroy(): void {
    document.removeEventListener('keydown', this.keyHandler);
    this.clearMarker();
    this.removeLines();
    this.el.remove();
  }
}
