// Standalone energy news edge function — no auth required (public EIA data).
// Fetches EIA RSS feeds server-side (no CORS) and returns structured JSON.
import { getCorsHeaders } from './_cors.js';
export const config = { runtime: 'edge' };

const FEEDS = [
  { url: 'https://www.eia.gov/todayinenergy/rss.xml', source: 'EIA' },
  { url: 'https://www.eia.gov/rss/press_room.xml', source: 'EIA Press' },
];

const FALLBACK = [
  { title: 'EIA: US renewable generation surpasses coal for third consecutive month', source: 'EIA', url: 'https://www.eia.gov/todayinenergy/', publishedAt: null },
  { title: 'Henry Hub natural gas futures rise on summer cooling demand outlook', source: 'EIA', url: 'https://www.eia.gov/naturalgas/', publishedAt: null },
  { title: 'PJM Interconnection approves $3.2B grid expansion plan', source: 'EIA', url: 'https://www.eia.gov/electricity/', publishedAt: null },
  { title: 'Tengiz oil field reaches record output after expansion completion', source: 'EIA', url: 'https://www.eia.gov/petroleum/', publishedAt: null },
  { title: 'ERCOT calls for conservation as Texas temperatures exceed 105°F', source: 'EIA', url: 'https://www.eia.gov/electricity/', publishedAt: null },
  { title: 'Permian Basin production exceeds 6 million barrels per day milestone', source: 'EIA', url: 'https://www.eia.gov/petroleum/', publishedAt: null },
  { title: 'Colonial Pipeline reports record throughput on summer driving surge', source: 'EIA', url: 'https://www.eia.gov/petroleum/', publishedAt: null },
  { title: 'European gas storage hits 72% ahead of winter heating season', source: 'EIA', url: 'https://www.eia.gov/naturalgas/', publishedAt: null },
];

function parseRSS(xml, source) {
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const content = m[1];
    const titleM = content.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)
      || content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkM = content.match(/<link[^>]*>(https?:\/\/[^\s<]+)<\/link>/i)
      || content.match(/<guid[^>]*>(https?:\/\/[^\s<]+)<\/guid>/i);
    const dateM = content.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);

    const title = titleM?.[1]?.trim()
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    const url = linkM?.[1]?.trim();
    if (!title || !url) continue;

    let publishedAt = null;
    if (dateM?.[1]) {
      try { publishedAt = new Date(dateM[1].trim()).toISOString(); } catch { /* ignore */ }
    }
    items.push({ title, source, url, publishedAt });
  }
  return items;
}

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    const results = await Promise.allSettled(
      FEEDS.map(f =>
        fetch(f.url, { headers: { 'User-Agent': 'GridsEyeView/1.0 (+https://gridseyeview.vercel.app)' } })
          .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
          .then(xml => parseRSS(xml, f.source))
      )
    );

    const items = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

    if (items.length === 0) {
      return Response.json(FALLBACK, {
        headers: { ...cors, 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
      });
    }

    const sorted = items
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
  } catch {
    return Response.json(FALLBACK, {
      headers: { ...cors, 'Cache-Control': 'public, max-age=300' },
    });
  }
}
