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
    // Request enough rows to cover 7 major RTOs × 24 hours for accurate aggregation
    const url = `https://api.eia.gov/v2/electricity/rto/region-data/data/?api_key=${apiKey}&frequency=hourly&data[0]=value&facets[respondent][]=PJM&facets[respondent][]=ERCO&facets[respondent][]=CISO&facets[respondent][]=MISO&facets[respondent][]=NYIS&facets[respondent][]=ISNE&facets[respondent][]=SPP&facets[type][]=D&sort[0][column]=period&sort[0][direction]=desc&length=500`;
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
