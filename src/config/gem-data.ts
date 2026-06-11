// Async loader for GEM (Global Energy Monitor) pipeline and field data.
// Data lives in public/data/ as JSON — NOT bundled into the JS chunk.
// Call loadGemData() once at startup; use getGemData() anywhere for sync access.
import type { GlobalPipeline, GlobalOilGasField } from '@/types';

interface GemData {
  pipelines: GlobalPipeline[];
  fields: GlobalOilGasField[];
}

const _empty: GemData = { pipelines: [], fields: [] };
let _cache: GemData | null = null;
let _pending: Promise<GemData> | null = null;

export function getGemData(): GemData {
  return _cache ?? _empty;
}

export async function loadGemData(): Promise<GemData> {
  if (_cache) return _cache;
  if (_pending) return _pending;

  _pending = Promise.all([
    fetch('/data/gem-pipelines.json').then(r => r.ok ? r.json() as Promise<GlobalPipeline[]> : []),
    fetch('/data/gem-fields.json').then(r => r.ok ? r.json() as Promise<GlobalOilGasField[]> : []),
  ]).then(([pipelines, fields]) => {
    _cache = { pipelines, fields };
    _pending = null;
    return _cache;
  }).catch(() => {
    _pending = null;
    return _empty;
  });

  return _pending;
}
