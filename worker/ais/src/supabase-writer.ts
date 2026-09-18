import { createClient } from '@supabase/supabase-js';
import type { DbWriter, TerminalSnapshotWrite } from './db-writer.js';
import type { VesselEvent } from './state-machine.js';

/**
 * Real writer for live/--record mode. Never used by --replay (see db-writer.ts).
 * Write failures (e.g. the migration hasn't been applied yet) are logged and
 * swallowed — a DB hiccup should never take the socket connection down.
 */
export function createSupabaseDbWriter(): DbWriter {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must both be set to use the Supabase writer');
  }
  const client = createClient(url, key);

  return {
    async upsertSnapshot(snapshot: TerminalSnapshotWrite) {
      const { error } = await client.from('terminal_snapshot').upsert({
        terminal_id: snapshot.terminalId,
        docked_count: snapshot.dockedCount,
        stale_count: snapshot.staleCount,
        updated_at: new Date(snapshot.updatedAt).toISOString(),
      });
      if (error) console.error('[supabase] upsert terminal_snapshot failed:', error.message);
    },
    async insertEvent(event: VesselEvent) {
      const { error } = await client.from('vessel_events').insert({
        terminal_id: event.terminalId,
        mmsi: event.mmsi,
        event_type: event.type,
        occurred_at: new Date(event.occurredAt).toISOString(),
      });
      if (error) console.error('[supabase] insert vessel_events failed:', error.message);
    },
  };
}
