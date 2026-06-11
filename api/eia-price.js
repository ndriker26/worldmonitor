export const config = { runtime: 'edge' };

export default async function handler(req) {
  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'No EIA_API_KEY configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  }
  try {
    const url = `https://api.eia.gov/v2/electricity/retail-sales/data/?api_key=${apiKey}&frequency=monthly&data[0]=price&facets[sectorid][]=RES&facets[stateid][]=US&sort[0][column]=period&sort[0][direction]=desc&length=13`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=1800',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
