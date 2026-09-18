import type { VesselEvent } from './state-machine.js';

export interface TerminalSnapshotWrite {
  terminalId: string;
  dockedCount: number;
  staleCount: number;
  updatedAt: number; // epoch ms
}

export interface DbWriter {
  upsertSnapshot(snapshot: TerminalSnapshotWrite): Promise<void>;
  insertEvent(event: VesselEvent): Promise<void>;
}

/** Used for --replay (always) and for live/--record when Supabase env vars aren't set. Never touches the network. */
export function createLoggingDbWriter(): DbWriter {
  return {
    async upsertSnapshot(snapshot) {
      console.log('[db:snapshot]', JSON.stringify(snapshot));
    },
    async insertEvent(event) {
      console.log('[db:event]', JSON.stringify(event));
    },
  };
}
