import { createReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { parseFrameTimestamp, type AisFrame } from './ais-types.js';
import { createLoggingDbWriter } from './db-writer.js';
import { loadTerminals, type Terminal } from './geo.js';
import { Pipeline } from './pipeline.js';
import { connectAisStream } from './socket.js';
import { ShipTypeRegistry } from './static-registry.js';
import { createSupabaseDbWriter } from './supabase-writer.js';

const STALE_SWEEP_INTERVAL_MS = 60_000;
const SNAPSHOT_SWEEP_INTERVAL_MS = 60_000;

function defaultRecordPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `recordings/${stamp}.ndjson`;
}

function parseArgs(argv: string[]): { recordPath: string | null; replayPath: string | null } {
  const recordIdx = argv.indexOf('--record');
  const replayIdx = argv.indexOf('--replay');

  let recordPath: string | null = null;
  if (recordIdx !== -1) {
    const next = argv[recordIdx + 1];
    recordPath = next && !next.startsWith('--') ? next : defaultRecordPath();
  }

  let replayPath: string | null = null;
  if (replayIdx !== -1) {
    const next = argv[replayIdx + 1];
    if (!next) throw new Error('--replay requires a file path');
    replayPath = next;
  }

  return { recordPath, replayPath };
}

function printSummary(pipeline: Pipeline, terminals: Terminal[]): void {
  console.log('Per-terminal summary:');
  console.log('-'.repeat(72));
  for (const t of terminals) {
    const stats = pipeline.getStats().find((s) => s.terminalId === t.id)!;
    const { docked, stale } = pipeline.getCurrentDockedAndStale(t.id);
    console.log(`${t.name} [${t.id}]`);
    console.log(`  total AIS position reports in bbox: ${stats.totalPositionReports}`);
    console.log(`  tanker position reports:            ${stats.tankerPositionReports}`);
    console.log(`  distinct tanker MMSIs tracked:       ${stats.tankerMmsiSeen.size}`);
    console.log(`  arrivals confirmed:                  ${stats.arrivals}`);
    console.log(`  departures confirmed:                ${stats.departures}`);
    console.log(`  final docked count:                  ${docked}`);
    console.log(`  final stale count:                   ${stale}`);
    if (stats.totalPositionReports === 0) {
      console.log('  >>> NO AIS COVERAGE for this terminal in this window.');
    } else if (stats.tankerPositionReports === 0) {
      console.log('  >>> AIS traffic present but no tanker-type vessels observed.');
    }
    console.log('');
  }
}

async function runReplay(replayPath: string): Promise<void> {
  const terminals = loadTerminals();
  const registry = new ShipTypeRegistry();
  const pipeline = new Pipeline(terminals, registry, createLoggingDbWriter());

  const rl = createInterface({ input: createReadStream(replayPath) });
  let lineCount = 0;
  let clock = Date.now();

  for await (const line of rl) {
    if (!line.trim()) continue;
    lineCount += 1;
    let frame: AisFrame;
    try {
      frame = JSON.parse(line) as AisFrame;
    } catch {
      continue; // malformed line — skip
    }
    if (frame.MessageType === 'SubscriptionConfirmation') continue;
    clock = parseFrameTimestamp(frame, clock);
    await pipeline.handleFrame(frame, clock);
  }

  pipeline.sweepStale(clock);
  await pipeline.flushAllSnapshots(clock);

  console.log(`\nReplayed ${lineCount} frames from ${replayPath}\n`);
  printSummary(pipeline, terminals);
}

function runLive(recordPath: string | null): void {
  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) throw new Error('AISSTREAM_API_KEY is not set');

  const terminals = loadTerminals();
  const registry = new ShipTypeRegistry();

  const dbWriter = process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
    ? createSupabaseDbWriter()
    : (() => {
        console.warn('[runner] SUPABASE_URL/SUPABASE_SECRET_KEY not set — writing to stdout instead of Supabase');
        return createLoggingDbWriter();
      })();

  const pipeline = new Pipeline(terminals, registry, dbWriter);

  // Every terminal gets a row immediately, even one with zero tankers —
  // otherwise a quiet terminal never gets a snapshot row at all, since
  // writes are otherwise only triggered by actual tanker position reports.
  void pipeline.flushAllSnapshots(Date.now());

  let recordStream: ReturnType<typeof createWriteStream> | null = null;
  if (recordPath) {
    mkdirSync(dirname(recordPath), { recursive: true });
    recordStream = createWriteStream(recordPath, { flags: 'a' });
    console.log(`[runner] recording raw frames to ${recordPath}`);
  }

  const handle = connectAisStream({
    apiKey,
    terminals,
    onStatus: (status) => console.log(`[socket] ${status}`),
    onFrame: (frame, raw) => {
      recordStream?.write(raw + '\n');
      void pipeline.handleFrame(frame, Date.now());
    },
  });

  const sweepInterval = setInterval(() => pipeline.sweepStale(Date.now()), STALE_SWEEP_INTERVAL_MS);
  // Heartbeat: at least every 60s per terminal, even with zero tanker
  // activity, so updated_at never goes stale past the frontend's 30-minute
  // threshold just because a terminal is quiet. Reuses the same 30s
  // per-terminal throttle as event-driven writes — see Pipeline.sweepSnapshots.
  const snapshotSweepInterval = setInterval(() => { void pipeline.sweepSnapshots(Date.now()); }, SNAPSHOT_SWEEP_INTERVAL_MS);

  const shutdown = () => {
    console.log('[runner] shutting down');
    clearInterval(sweepInterval);
    clearInterval(snapshotSweepInterval);
    handle.close();
    recordStream?.end();
    setTimeout(() => process.exit(0), 200); // let the record stream flush
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main(): Promise<void> {
  const { recordPath, replayPath } = parseArgs(process.argv.slice(2));
  if (replayPath) {
    await runReplay(replayPath);
  } else {
    runLive(recordPath);
  }
}

void main();
