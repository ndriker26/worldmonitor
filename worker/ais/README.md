# AIS Tanker Activity Worker

Long-lived Node process for Grid's Eye View's Tanker Activity layer. Connects
to [aisstream.io](https://aisstream.io) over WebSocket, tracks tanker
docked/arrival/departure state at a handful of oil terminals, and writes
snapshots + events to Supabase. Not part of the Vite/Vercel build — it's a
separate package, deployed separately (Fly.io; see below).

All commands in this file are PowerShell, run from `worker/ais/` unless noted.

## Setup

```powershell
cd worker\ais
npm install
```

`npm install` needs `--legacy-peer-deps`, which is already pinned in
`.npmrc` — you shouldn't need to pass the flag yourself. (Worked around a
npm 10.9.2 arborist bug — `Cannot read properties of null (reading
'edgesOut')` — hit installing vitest's optional peer deps. Unrelated to this
project; if it recurs on a newer npm, `--legacy-peer-deps` is the fix.)

```powershell
npx vitest run    # or: npm test — 19 tests (state machine + pipeline buffering)
npx tsc --noEmit  # typecheck
```

## Env vars

The worker reads the **repo root** `.env` (`..\..\.env` from here), not its
own — set once, shared with the rest of the app:

| Var | Used by |
|---|---|
| `AISSTREAM_API_KEY` | worker (live socket) |
| `SUPABASE_URL` | worker + `/api/tanker-activity` |
| `SUPABASE_SECRET_KEY` | worker only (writes — bypasses RLS) |
| `SUPABASE_PUBLISHABLE_KEY` | `/api/tanker-activity` only (reads) |

The worker never touches `SUPABASE_PUBLISHABLE_KEY`; the edge function never
touches `SUPABASE_SECRET_KEY`. If `SUPABASE_URL`/`SUPABASE_SECRET_KEY` aren't
set, the worker falls back to logging DB writes to stdout instead of
crashing.

## Running the worker locally

```powershell
npm run dev       # live socket, real Supabase writes (or stdout if unconfigured)
```

## Record / replay

```powershell
npm run record                              # live socket + capture to recordings\<timestamp>.ndjson
npm run record -- --record recordings\my-run.ndjson   # explicit path
npm run replay -- --replay recordings\my-run.ndjson   # offline replay, no socket, no Supabase writes
```

`--replay` always logs would-be DB writes to stdout and prints a per-terminal
summary at the end (position counts, tanker MMSIs identified/tracked,
arrivals, departures, final docked/stale counts, and a plain warning if a
terminal saw zero AIS traffic). `recordings\` is gitignored.

**Stopping a long-running worker (`npm run dev` / `npm run record`):**
`Ctrl+C` sends SIGINT, which the worker handles gracefully (closes the
socket, flushes the recording file). If you started it detached or `Ctrl+C`
doesn't reach it, `TaskStop`-style tooling isn't reliable for `npm`-wrapped
processes in this environment — verify and kill the real process:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, CommandLine
Stop-Process -Id <processId> -Force   # both the npm.exe wrapper AND the node runner.ts process
```

## Terminals

`terminals.geojson` — Rotterdam, Houston, Corpus Christi (Fujairah dropped;
aisstream showed zero AIS traffic of any type in a 5-minute capture over a
much larger bbox covering the whole UAE east coast / Gulf of Oman — a
provider coverage gap, not a polygon bug). Edit the polygons, then:

```powershell
cd ..\..
node scripts\gen-tanker-terminals.mjs   # regenerates src\config\tanker-terminals.ts
```

Run this from the repo root after any `terminals.geojson` edit — the
frontend's marker positions come from the generated static list, not the
database, so they render even with zero rows in Supabase.

## Running the migration

The assistant that built this never runs the migration — **you run it
yourself**:

1. Open the Supabase SQL Editor for the project `SUPABASE_URL` points at.
2. Paste the full contents of `migrations\0001_tanker_activity.sql` and run it.
3. Follow `migrations\VERIFY.md` — PowerShell `curl.exe` commands that prove
   the publishable key can read `terminal_snapshot`, is rejected on insert,
   and the secret key can insert. Every command reads `.env` into a local
   variable at run time; none of them print key values.

## /api/tanker-activity — running it locally

`api/tanker-activity.ts` is a standalone Vercel Edge Function (not a Sebuf
RPC route). This repo's `vite dev` only has custom middleware for Sebuf
routes (`/api/{domain}/v1/*`) and a short hand-wired list (`/api/polymarket`,
`/api/rss-proxy`, `/api/youtube/live`, `/api/gpsjam`) — confirmed by
checking `vite.config.ts` directly. A plain file like `tanker-activity.ts`
isn't in either list, so **`npm run dev` / `npm run dev:energy` does not
execute it** — it serves the raw TypeScript source as a JS module instead of
running it as a handler, which is not valid JSON. The frontend's fetch fails
to parse it and falls back to its empty state, which is a real, working code
path, but not proof the handler itself runs correctly end to end.

Two ways to actually exercise the handler:

**1. The verified way — unit tests** (this is what was actually run to
validate the handler; see the stage-4 report):

```powershell
cd ..\..
npm run test:api
```

Imports the handler directly and calls it with a real edge-runtime
`Request`, mocking `fetch` for the Supabase REST calls. Covers normal data,
empty tables, missing-migration, an unrelated Supabase error, missing env
config, method rejection, and OPTIONS preflight.

**2. A real local HTTP server — Vercel's own dev server** (documented, not
run/verified here — needs the Vercel CLI and project linkage, neither set up
in this environment):

```powershell
npx vercel dev
```

Vercel's dev server auto-serves every file under `api/` as a route with no
extra config, unlike `vite dev`. This is the closest thing to how it
actually runs in production.

## Fly.io deploy

Not deployed by any of this — `Dockerfile` and `fly.toml` are written and
the build steps verified locally (`npm ci`, `npm run build`, `node
dist/runner.js` all run and produce correct output), but `docker build`
itself was never run (Docker isn't installed in the environment this was
built in) and nothing has been pushed to Fly. When you're ready:

```powershell
# From worker\ais
flyctl launch --no-deploy    # first time only — creates the app, keep the generated fly.toml or diff against ours
flyctl secrets set AISSTREAM_API_KEY=... SUPABASE_URL=... SUPABASE_SECRET_KEY=...
flyctl deploy
```

The container `CMD` never uses `--env-file` — Fly injects secrets as real
environment variables, and there's no `.env` file in the image at all
(`.dockerignore` excludes it implicitly by only copying `src`/`package*`/
`terminals.geojson` — nothing else). `--env-file` stays in the `npm run dev`
/ `npm run record` scripts only, for local use against the repo-root `.env`.
