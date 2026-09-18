import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { buildTerminalActivity } from './tanker-activity';

function req(method = 'GET'): Request {
  return new Request('https://gridseyeview.com/api/tanker-activity', { method });
}

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>): void {
  let call = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    const r = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }));
}

describe('buildTerminalActivity (pure)', () => {
  it('sums 24h arrivals/departures and sorts hourly buckets', () => {
    const result = buildTerminalActivity(
      [{ terminal_id: 'rotterdam', docked_count: 5, stale_count: 1, updated_at: '2026-01-01T00:00:00Z' }],
      [
        { terminal_id: 'rotterdam', hour_start: '2026-01-01T01:00:00Z', arrivals: 1, departures: 0 },
        { terminal_id: 'rotterdam', hour_start: '2026-01-01T00:00:00Z', arrivals: 2, departures: 1 },
      ],
    );
    expect(result).toEqual([{
      terminal_id: 'rotterdam',
      docked_count: 5,
      stale_count: 1,
      updated_at: '2026-01-01T00:00:00Z',
      arrivals_24h: 3,
      departures_24h: 1,
      hourly: [
        { hour_start: '2026-01-01T00:00:00Z', arrivals: 2, departures: 1 },
        { hour_start: '2026-01-01T01:00:00Z', arrivals: 1, departures: 0 },
      ],
    }]);
  });

  it('a terminal with no hourly rows gets an empty bucket list and zero sums', () => {
    const result = buildTerminalActivity(
      [{ terminal_id: 'houston', docked_count: 0, stale_count: 0, updated_at: '2026-01-01T00:00:00Z' }],
      [],
    );
    expect(result).toEqual([{
      terminal_id: 'houston',
      docked_count: 0,
      stale_count: 0,
      updated_at: '2026-01-01T00:00:00Z',
      arrivals_24h: 0,
      departures_24h: 0,
      hourly: [],
    }]);
  });
});

describe('GET /api/tanker-activity handler', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns normal data for multiple terminals with a 60s cache header', async () => {
    mockFetchSequence([
      {
        status: 200,
        body: [
          { terminal_id: 'rotterdam', docked_count: 51, stale_count: 0, updated_at: '2026-01-01T00:00:00Z' },
          { terminal_id: 'houston', docked_count: 3, stale_count: 0, updated_at: '2026-01-01T00:00:00Z' },
        ],
      },
      {
        status: 200,
        body: [
          { terminal_id: 'rotterdam', hour_start: '2026-01-01T00:00:00Z', arrivals: 1, departures: 0 },
        ],
      },
    ]);

    const res = await handler(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('max-age=60');
    const body = await res.json();
    expect(body.terminals).toHaveLength(2);
    expect(body.terminals.find((t: { terminal_id: string }) => t.terminal_id === 'rotterdam').arrivals_24h).toBe(1);
    expect(body.terminals.find((t: { terminal_id: string }) => t.terminal_id === 'houston').hourly).toEqual([]);
  });

  it('returns an empty terminals array when the tables exist but have no rows', async () => {
    mockFetchSequence([{ status: 200, body: [] }, { status: 200, body: [] }]);
    const res = await handler(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.terminals).toEqual([]);
  });

  it('returns a clean 503 (not a crash) when the migration has not been run', async () => {
    mockFetchSequence([
      { status: 404, body: { message: 'relation "public.terminal_snapshot" does not exist' } },
      { status: 404, body: { message: 'relation "public.terminal_hourly" does not exist' } },
    ]);
    const res = await handler(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.error).toMatch(/migration/i);
  });

  it('returns a clean 502 (not a crash) on an unrelated Supabase error', async () => {
    mockFetchSequence([
      { status: 500, body: { message: 'internal server error' } },
      { status: 500, body: { message: 'internal server error' } },
    ]);
    const res = await handler(req());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 503 when Supabase env vars are not configured', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    const res = await handler(req());
    expect(res.status).toBe(503);
  });

  it('rejects non-GET methods', async () => {
    const res = await handler(req('POST'));
    expect(res.status).toBe(405);
  });

  it('handles OPTIONS preflight', async () => {
    const res = await handler(req('OPTIONS'));
    expect(res.status).toBe(204);
  });
});
