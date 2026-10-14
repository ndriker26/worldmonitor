/**
 * Grid's Eye View guided stories.
 *
 * A story is a list of camera stops. Adding a new story is just adding data
 * here: no new code. Keep copy short and plain. Every claim needs a source.
 */

export interface GevStoryCamera {
  lon: number;
  lat: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
}

export interface GevStoryStep {
  kicker: string;
  title: string;
  body: string;
  camera: GevStoryCamera;
  /** Optional point to pulse on the map. [lon, lat] */
  marker?: [number, number];
  /** Optional GEM pipeline IDs to draw on (from public/data/gem-pipelines.json). */
  pipelines?: string[];
  /** Map layers this step needs switched on. */
  layers?: string[];
}

export interface GevStory {
  id: string;
  title: string;
  sources: string;
  steps: GevStoryStep[];
}

export const CASPIAN_STORY: GevStory = {
  id: 'caspian-way-out',
  title: "The Caspian's way out",
  sources: 'Global Energy Monitor, EIA, Caspian Pipeline Consortium, BTC Co.',
  steps: [
    {
      kicker: 'The Caspian, explained',
      title: 'Landlocked oil.',
      body: 'The Caspian Sea has no outlet to the ocean. Every barrel pumped here has to leave by pipe. Where those pipes run decides who holds the leverage.',
      camera: { lon: 50.5, lat: 42.6, zoom: 4.4, pitch: 0, bearing: 0 },
      layers: ['oilGasPipelines', 'oilGasFields'],
    },
    {
      kicker: 'Kazakhstan · onshore',
      title: 'Tengiz',
      body: 'On the northeast shore. Chevron-led Tengizchevroil has pumped here since 1991. It is one of the deepest and largest oil fields on Earth.',
      camera: { lon: 53.37, lat: 46.13, zoom: 7.4, pitch: 40, bearing: -18 },
      marker: [53.369, 46.129],
    },
    {
      kicker: 'Kazakhstan · offshore',
      title: 'Kashagan',
      body: 'Shallow water that freezes in winter. Seven partners, years of delays, and first oil only in October 2016. One of the most expensive oil projects ever built.',
      camera: { lon: 50.14, lat: 46.49, zoom: 7.4, pitch: 40, bearing: 12 },
      marker: [50.137, 46.486],
    },
    {
      kicker: 'Route one',
      title: 'The Russian door',
      body: 'Most Kazakh crude leaves through the CPC pipeline: 1,510 km west to Novorossiysk on Russia’s Black Sea coast. In 2021 it carried about 80% of the country’s output. Russia’s Transneft owns 24%.',
      camera: { lon: 44.6, lat: 45.4, zoom: 5.1, pitch: 30, bearing: -12 },
      pipelines: ['P0646'],
    },
    {
      kicker: 'The chokepoint',
      title: 'Novorossiysk',
      body: 'One terminal, roughly 1% of world oil supply. In 2025 drones hit a CPC pumping station, then one of the terminal’s three moorings. When this port stops, Kazakhstan’s exports stop.',
      camera: { lon: 37.75, lat: 44.66, zoom: 8.2, pitch: 45, bearing: 20 },
      marker: [37.72, 44.66],
      pipelines: ['P0646'],
    },
    {
      kicker: 'Route two',
      title: 'The way around',
      body: 'Azerbaijan built the other door. Since 2006, BTC has carried oil from the Azeri–Chirag–Gunashli fields 1,768 km through Georgia to Ceyhan in Turkey. It never touches Russia.',
      camera: { lon: 42.4, lat: 39.9, zoom: 5.2, pitch: 30, bearing: 10 },
      pipelines: ['P0644'],
      marker: [51.098, 40.22],
    },
    {
      kicker: 'Your turn',
      title: 'Explore the basin.',
      body: 'Every field and pipeline here is live on the map. Click anything to see who runs it.',
      camera: { lon: 47.5, lat: 42.5, zoom: 4.6, pitch: 0, bearing: 0 },
      pipelines: ['P0646', 'P0644'],
    },
  ],
};

export const GEV_STORIES: GevStory[] = [CASPIAN_STORY];
