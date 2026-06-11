// Energy news edge function — fetches real RSS articles server-side (no CORS issues).
import { getCorsHeaders } from './_cors.js';
export const config = { runtime: 'edge' };

const FEEDS = [
  { url: 'https://www.eia.gov/todayinenergy/rss.xml', source: 'EIA' },
  { url: 'https://www.utilitydive.com/feeds/news/', source: 'Utility Dive' },
  { url: 'https://oilprice.com/rss/main', source: 'OilPrice' },
];

const RSS_HEADERS = {
  'User-Agent': 'GridsEyeView/1.0 (energy infrastructure dashboard)',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
};

const FALLBACK = [
  { title: 'EIA: US renewable generation surpasses coal for third consecutive month', source: 'EIA', url: 'https://www.eia.gov/todayinenergy/', publishedAt: null, isFallback: true },
  { title: 'Henry Hub natural gas futures rise on summer cooling demand outlook', source: 'EIA', url: 'https://www.eia.gov/naturalgas/', publishedAt: null, isFallback: true },
  { title: 'PJM Interconnection approves $3.2B grid expansion plan', source: 'EIA', url: 'https://www.eia.gov/electricity/', publishedAt: null, isFallback: true },
  { title: 'Tengiz oil field reaches record output after expansion completion', source: 'EIA', url: 'https://www.eia.gov/petroleum/', publishedAt: null, isFallback: true },
  { title: 'ERCOT calls for conservation as Texas temperatures exceed 105°F', source: 'EIA', url: 'https://www.eia.gov/electricity/', publishedAt: null, isFallback: true },
  { title: 'Permian Basin production exceeds 6 million barrels per day milestone', source: 'EIA', url: 'https://www.eia.gov/petroleum/', publishedAt: null, isFallback: true },
  { title: 'Colonial Pipeline reports record throughput on summer driving surge', source: 'EIA', url: 'https://www.eia.gov/petroleum/', publishedAt: null, isFallback: true },
  { title: 'European gas storage hits 72% ahead of winter heating season', source: 'EIA', url: 'https://www.eia.gov/naturalgas/', publishedAt: null, isFallback: true },
];

function parseRSS(xml, source) {
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const content = m[1];

    // Title: CDATA or plain text
    const titleM = content.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)
      || content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

    // Link: plain <link>, CDATA-wrapped, atom href attr, or <guid isPermaLink>
    const linkM = content.match(/<link[^>]*><!\[CDATA\[(https?:\/\/[^\]]+)\]\]><\/link>/i)
      || content.match(/<link[^>]*>(https?:\/\/[^\s<]+)<\/link>/i)
      || content.match(/<link[^>]+href="(https?:\/\/[^"]+)"/i)
      || content.match(/<guid[^>]*isPermaLink="true"[^>]*>(https?:\/\/[^\s<]+)<\/guid>/i)
      || content.match(/<guid[^>]*>(https?:\/\/[^\s<]+)<\/guid>/i);

    const dateM = content.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);

    const rawTitle = titleM?.[1]?.trim() ?? '';
    const title = rawTitle
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    const url = linkM?.[1]?.trim() ?? '';
    if (!title || !url) continue;

    let publishedAt = null;
    if (dateM?.[1]) {
      try { publishedAt = new Date(dateM[1].trim()).toISOString(); } catch { /* ignore */ }
    }
    items.push({ title, source, url, publishedAt, isFallback: false });
  }
  return items;
}

async function fetchFeed({ url, source }) {
  const res = await fetch(url, { headers: RSS_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const xml = await res.text();
  const items = parseRSS(xml, source);
  return { source, url, status: res.status, items: items.length, data: items };
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const reqUrl = new URL(req.url);
  const debug = reqUrl.searchParams.get('debug') === '1';

  const attempts = [];
  const allItems = [];

  await Promise.allSettled(
    FEEDS.map(async (feed) => {
      try {
        const result = await fetchFeed(feed);
        attempts.push({ source: feed.source, url: feed.url, status: result.status, items: result.items });
        allItems.push(...result.data);
      } catch (err) {
        console.error(`RSS fetch failed for ${feed.source}:`, err.message);
        attempts.push({ source: feed.source, url: feed.url, error: err.message });
      }
    })
  );

  if (debug) {
    return new Response(JSON.stringify({ debug: true, attempts }, null, 2), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  if (allItems.length === 0) {
    return Response.json(FALLBACK, {
      headers: { ...cors, 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
    });
  }

  const sorted = allItems
    .sort((a, b) => {
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    })
    .slice(0, 15);

  return Response.json(sorted, {
    headers: {
      ...cors,
      'Cache-Control': 'public, max-age=900, s-maxage=900, stale-while-revalidate=300',
    },
  });
}
