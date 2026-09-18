/**
 * GET /api/tanker-activity — public, publishable-key read of the tanker
 * activity worker's Supabase tables (see worker/ais/). No auth gate: the
 * data is already anon-readable by RLS policy (worker/ais/migrations/0001).
 *
 * Uses plain fetch against PostgREST directly rather than @supabase/supabase-js,
 * to avoid adding a new dependency to the main app bundle for two GET queries.
 */

export const config = { runtime: 'edge' };

// @ts-expect-error — JS module, no declaration file
import { getPublicCorsHeaders } from './_cors.js';
// @ts-expect-error — JS module, no declaration file
import { jsonResponse } from './_json-response.js';

const REST_TIMEOUT_MS = 8000;

interface TerminalSnapshotRow {
  terminal_id: string;
  docked_count: number;
  stale_count: number;
  updated_at: string;
}

interface TerminalHourlyRow {
  terminal_id: string;
  hour_start: string;
  arrivals: number;
  departures: number;
}

interface HourlyBucket {
  hour_start: string;
  arrivals: number;
  departures: number;
}

export interface TerminalActivity {
  terminal_id: string;
  docked_count: number;
  stale_count: number;
  updated_at: string;
  arrivals_24h: number;
  departures_24h: number;
  hourly: HourlyBucket[];
}

type TableResult<T> =
  | { ok: true; data: T[] }
  | { ok: false; status: number; missingTable: boolean };

async function fetchTable<T>(baseUrl: string, path: string, apikey: string): Promise<TableResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/rest/v1/${path}`, {
      headers: { apikey, Authorization: `Bearer ${apikey}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      let missingTable = false;
      try {
        const body = await res.json();
        missingTable = typeof body?.message === 'string' && /does not exist|schema cache/i.test(body.message);
      } catch {
        // non-JSON error body — leave missingTable false
      }
      return { ok: false, status: res.status, missingTable };
    }
    const data = (await res.json()) as T[];
    return { ok: true, data };
  } catch {
    return { ok: false, status: 0, missingTable: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Exported for tests: builds the response body from already-fetched rows. */
export function buildTerminalActivity(
  snapshots: TerminalSnapshotRow[],
  hourly: TerminalHourlyRow[],
): TerminalActivity[] {
  const hourlyByTerminal = new Map<string, HourlyBucket[]>();
  for (const row of hourly) {
    const list = hourlyByTerminal.get(row.terminal_id) ?? [];
    list.push({ hour_start: row.hour_start, arrivals: row.arrivals, departures: row.departures });
    hourlyByTerminal.set(row.terminal_id, list);
  }

  return snapshots.map((row): TerminalActivity => {
    const hours = (hourlyByTerminal.get(row.terminal_id) ?? [])
      .slice()
      .sort((a, b) => a.hour_start.localeCompare(b.hour_start));
    const arrivals_24h = hours.reduce((sum, h) => sum + h.arrivals, 0);
    const departures_24h = hours.reduce((sum, h) => sum + h.departures, 0);
    return {
      terminal_id: row.terminal_id,
      docked_count: row.docked_count,
      stale_count: row.stale_count,
      updated_at: row.updated_at,
      arrivals_24h,
      departures_24h,
      hourly: hours,
    };
  });
}

export default async function handler(req: Request): Promise<Response> {
  const cors = getPublicCorsHeaders() as Record<string, string>;

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return jsonResponse({ error: 'Tanker activity backend not configured' }, 503, cors);
  }

  const [snapshots, hourly] = await Promise.all([
    fetchTable<TerminalSnapshotRow>(url, 'terminal_snapshot?select=*', key),
    fetchTable<TerminalHourlyRow>(url, 'terminal_hourly?select=*', key),
  ]);

  if (!snapshots.ok || !hourly.ok) {
    const missingTable = (!snapshots.ok && snapshots.missingTable) || (!hourly.ok && hourly.missingTable);
    if (missingTable) {
      return jsonResponse(
        { available: false, error: 'Tanker activity tables not found — has the migration been run?' },
        503,
        cors,
      );
    }
    return jsonResponse({ error: 'Tanker activity backend error' }, 502, cors);
  }

  const terminals = buildTerminalActivity(snapshots.data, hourly.data);

  return jsonResponse({ terminals }, 200, {
    ...cors,
    'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
  });
}
