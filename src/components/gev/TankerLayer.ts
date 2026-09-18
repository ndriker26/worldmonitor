import maplibregl from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { MapLayers } from '@/types';
import type { MapContainer } from '@/components';
import { TANKER_TERMINALS, type TankerTerminal } from '@/config/tanker-terminals';
import { sparkline } from '@/utils/sparkline';
import { escapeHtml } from '@/utils/sanitize';
import { getCSSColor } from '@/utils';
import { startSmartPollLoop, type SmartPollLoopHandle } from '@/services/runtime';

interface HourlyBucket {
  hour_start: string;
  arrivals: number;
  departures: number;
}

interface TerminalActivity {
  terminal_id: string;
  docked_count: number;
  stale_count: number;
  updated_at: string;
  arrivals_24h: number;
  departures_24h: number;
  hourly: HourlyBucket[];
}

interface TankerActivityResponse {
  terminals?: TerminalActivity[];
}

const SOURCE_ID = 'tanker-activity-source';
const LAYER_ID = 'tanker-activity-layer';
const STALE_THRESHOLD_MS = 30 * 60 * 1000;
const POLL_INTERVAL_MS = 60_000;

type TankerFeatureCollection = FeatureCollection<Point, { terminalId: string; dockedCount: number; fresh: boolean }>;

/**
 * Tanker Activity layer — lives outside DeckGLMap entirely (see
 * MapContainer.getMaplibreMap()). A plain MapLibre GeoJSON circle layer +
 * native maplibregl.Popup, driven by /api/tanker-activity. Visibility is
 * wired through MapContainer.onLayersChanged rather than a bespoke hook in
 * GevSidebar, so the sidebar toggle stays completely generic.
 */
export class TankerLayer {
  private readonly map: MapContainer;
  private maplibreMap: maplibregl.Map | null = null;
  private visible: boolean;
  private data = new Map<string, TerminalActivity>();
  private popup: maplibregl.Popup | null = null;
  private pollHandle: SmartPollLoopHandle | null = null;

  constructor(map: MapContainer, initialLayers: MapLayers) {
    this.map = map;
    this.visible = !!initialLayers.tankerActivity;
    this.map.onLayersChanged((layers) => this.setVisible(!!layers.tankerActivity));
  }

  mount(): void {
    this.maplibreMap = this.map.getMaplibreMap();
    if (!this.maplibreMap) return; // globe / mobile-SVG mode — no native MapLibre layer support

    const addLayer = () => this.addLayerToMap();
    if (this.maplibreMap.isStyleLoaded()) addLayer();
    else this.maplibreMap.once('load', addLayer);

    this.pollHandle = startSmartPollLoop(async () => { await this.refresh(); }, {
      intervalMs: POLL_INTERVAL_MS,
      runImmediately: true,
      pauseWhenHidden: true,
    });
  }

  destroy(): void {
    this.pollHandle?.stop();
    this.popup?.remove();
    const map = this.maplibreMap;
    if (map?.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map?.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  }

  private addLayerToMap(): void {
    const map = this.maplibreMap;
    if (!map || map.getSource(SOURCE_ID)) return;

    map.addSource(SOURCE_ID, { type: 'geojson', data: this.buildFeatureCollection() });
    map.addLayer({
      id: LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      layout: { visibility: this.visible ? 'visible' : 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'dockedCount'], 0, 8, 50, 22],
        'circle-color': ['case', ['get', 'fresh'], getCSSColor('--gev-accent') || '#00c8a0', getCSSColor('--text-dim') || '#888888'],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.9,
      },
    });

    map.on('click', LAYER_ID, (e) => this.handleClick(e));
    map.on('mouseenter', LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', LAYER_ID, () => { map.getCanvas().style.cursor = ''; });
  }

  private setVisible(visible: boolean): void {
    this.visible = visible;
    const map = this.maplibreMap;
    if (map?.getLayer(LAYER_ID)) {
      map.setLayoutProperty(LAYER_ID, 'visibility', visible ? 'visible' : 'none');
    }
  }

  private async refresh(): Promise<void> {
    try {
      const res = await fetch('/api/tanker-activity');
      if (!res.ok) return;
      const body = (await res.json()) as TankerActivityResponse;
      if (!Array.isArray(body.terminals)) return;
      this.data = new Map(body.terminals.map((t) => [t.terminal_id, t]));
    } catch {
      // Network/parse failure — keep showing the last-known data (or the empty state).
    }
    this.updateSource();
  }

  private updateSource(): void {
    const map = this.maplibreMap;
    if (!map) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(this.buildFeatureCollection());
  }

  private isFresh(activity: TerminalActivity | undefined, now: number): boolean {
    return !!activity && now - Date.parse(activity.updated_at) < STALE_THRESHOLD_MS;
  }

  private buildFeatureCollection(): TankerFeatureCollection {
    const now = Date.now();
    return {
      type: 'FeatureCollection',
      features: TANKER_TERMINALS.map((t) => {
        const activity = this.data.get(t.id);
        const fresh = this.isFresh(activity, now);
        return {
          type: 'Feature',
          properties: {
            terminalId: t.id,
            dockedCount: fresh ? (activity!.docked_count ?? 0) : 0,
            fresh,
          },
          geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
        };
      }),
    };
  }

  private handleClick(e: maplibregl.MapLayerMouseEvent): void {
    const feature = e.features?.[0];
    const terminalId = feature?.properties?.terminalId as string | undefined;
    const terminal = TANKER_TERMINALS.find((t) => t.id === terminalId);
    if (!terminal || !this.maplibreMap) return;

    this.popup?.remove();
    this.popup = new maplibregl.Popup({ closeButton: true, className: 'gev-tanker-popup' })
      .setLngLat([terminal.lon, terminal.lat])
      .setHTML(this.buildPopupHtml(terminal))
      .addTo(this.maplibreMap);
  }

  private buildPopupHtml(terminal: TankerTerminal): string {
    const now = Date.now();
    const activity = this.data.get(terminal.id);
    const name = escapeHtml(terminal.name);
    const fresh = this.isFresh(activity, now);

    if (!fresh || !activity) {
      return `<div class="gev-tanker-popup-body">
        <div class="gev-tanker-popup-title">${name}</div>
        <div class="gev-tanker-popup-empty">No data yet</div>
      </div>`;
    }

    const hourlyVals = activity.hourly.map((h) => h.arrivals + h.departures);
    const spark = hourlyVals.length >= 2 ? sparkline(hourlyVals, getCSSColor('--gev-accent') || '#00c8a0', 90, 26) : '';
    const minsAgo = Math.max(0, Math.round((now - Date.parse(activity.updated_at)) / 60_000));
    const updatedText = minsAgo < 1 ? 'updated just now' : `updated ${minsAgo} min ago`;

    return `<div class="gev-tanker-popup-body">
      <div class="gev-tanker-popup-title">${name}</div>
      <div class="gev-tanker-popup-row"><span>Docked</span><strong>${activity.docked_count}</strong></div>
      <div class="gev-tanker-popup-row"><span>Arrivals (24h)</span><strong>${activity.arrivals_24h}</strong></div>
      <div class="gev-tanker-popup-row"><span>Departures (24h)</span><strong>${activity.departures_24h}</strong></div>
      <div class="gev-tanker-popup-row"><span>Stale</span><strong>${activity.stale_count}</strong></div>
      ${spark ? `<div class="gev-tanker-popup-spark">${spark}</div>` : ''}
      <div class="gev-tanker-popup-updated">${escapeHtml(updatedText)}</div>
    </div>`;
  }
}
