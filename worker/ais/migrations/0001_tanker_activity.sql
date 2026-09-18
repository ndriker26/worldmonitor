-- Tanker Activity layer — Grid's Eye View
--
-- Paste this into the Supabase SQL Editor and run it yourself. This file is
-- never executed by the assistant or by any script in this repo.
--
-- Design notes:
--   - RLS is enabled on both tables with an anon SELECT policy and
--     deliberately NO insert/update/delete policy for any role. With RLS
--     enabled, the absence of a policy for an operation denies it by
--     default for any role subject to RLS (anon, authenticated) — only the
--     secret key (service_role, which bypasses RLS entirely) can write.
--     That's the whole write-access story; nothing else is needed for it.
--   - terminal_hourly is declared security_invoker = true, so when anon
--     queries it, Postgres evaluates the underlying tables' RLS policies as
--     anon (not as the view owner) — it inherits the same anon SELECT
--     policy on vessel_events rather than needing one of its own.
--   - No raw AIS position messages are stored anywhere.

create table if not exists public.terminal_snapshot (
  terminal_id text primary key,
  docked_count integer not null default 0,
  stale_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.vessel_events (
  id bigint generated always as identity primary key,
  terminal_id text not null,
  mmsi bigint not null,
  event_type text not null check (event_type in ('arrival', 'departure')),
  occurred_at timestamptz not null
);

create index if not exists vessel_events_terminal_occurred_idx
  on public.vessel_events (terminal_id, occurred_at);

-- Zero-filled arrival/departure counts per terminal per hour, last 24 hours.
-- Terminals come from terminal_snapshot's distinct terminal_id set, not a
-- hardcoded list, so a new terminal shows up here as soon as the worker
-- writes its first snapshot row.
create or replace view public.terminal_hourly
with (security_invoker = true) as
with hours as (
  select generate_series(
    date_trunc('hour', now()) - interval '23 hours',
    date_trunc('hour', now()),
    interval '1 hour'
  ) as hour_start
),
terminals as (
  select distinct terminal_id from public.terminal_snapshot
),
buckets as (
  select t.terminal_id, h.hour_start
  from terminals t
  cross join hours h
)
select
  b.terminal_id,
  b.hour_start,
  coalesce(count(*) filter (where e.event_type = 'arrival'), 0)::integer as arrivals,
  coalesce(count(*) filter (where e.event_type = 'departure'), 0)::integer as departures
from buckets b
left join public.vessel_events e
  on e.terminal_id = b.terminal_id
  and e.occurred_at >= b.hour_start
  and e.occurred_at < b.hour_start + interval '1 hour'
group by b.terminal_id, b.hour_start
order by b.terminal_id, b.hour_start;

alter table public.terminal_snapshot enable row level security;
alter table public.vessel_events enable row level security;

create policy "terminal_snapshot_anon_select"
  on public.terminal_snapshot
  for select
  to anon
  using (true);

create policy "vessel_events_anon_select"
  on public.vessel_events
  for select
  to anon
  using (true);

-- Deliberately no insert/update/delete policies for anon on either table —
-- see the note at the top of this file. The worker writes with
-- SUPABASE_SECRET_KEY, which bypasses RLS.
