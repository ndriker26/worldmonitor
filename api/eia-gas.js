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
    const url = `https://api.eia.gov/v2/natural-gas/pri/fut/data/?api_key=${apiKey}&frequency=daily&data[0]=value&facets[series][]=RNGWHHD&sort[0][column]=period&sort[0][direction]=desc&length=30`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=900',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
