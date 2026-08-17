create extension if not exists pgcrypto;

create table if not exists public.speed_tests (
  id uuid primary key default gen_random_uuid(),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  download_mbps numeric(9, 2) not null check (download_mbps >= 0),
  upload_mbps numeric(9, 2) not null check (upload_mbps >= 0),
  ping_ms integer not null check (ping_ms >= 0),
  connection_type text,
  created_at timestamptz not null default now()
);

create index if not exists speed_tests_created_at_idx on public.speed_tests (created_at desc);
create index if not exists speed_tests_location_idx on public.speed_tests (latitude, longitude);

alter table public.speed_tests enable row level security;

create policy "Anyone can view community speed tests"
on public.speed_tests for select to anon, authenticated using (true);

create policy "Anyone can submit a valid speed test"
on public.speed_tests for insert to anon, authenticated
with check (download_mbps between 0 and 100000 and upload_mbps between 0 and 100000 and ping_ms between 0 and 60000);

comment on table public.speed_tests is 'Anonymous community internet speed measurements with browser-provided coordinates.';

alter publication supabase_realtime add table public.speed_tests;
