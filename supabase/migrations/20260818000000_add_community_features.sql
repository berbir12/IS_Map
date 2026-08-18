-- ============================================================
-- Community features: verification badges, flagging, aliases, jitter
-- ============================================================

-- New columns
alter table public.speed_tests
  add column if not exists is_verified boolean not null default false,
  add column if not exists flag_count  integer  not null default 0 check (flag_count >= 0),
  add column if not exists contributor_alias text,
  add column if not exists jitter_ms   integer  check (jitter_ms is null or jitter_ms >= 0);

-- Auto-verify when sample_count reaches 3
create or replace function public.auto_verify_test()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sample_count >= 3 and not new.is_verified then
    new.is_verified := true;
  end if;
  return new;
end;
$$;

drop trigger if exists auto_verify_test on public.speed_tests;
create trigger auto_verify_test before insert or update on public.speed_tests
for each row execute function public.auto_verify_test();

-- Flag RPC (increment counter, one per session tracked client-side)
create or replace function public.flag_speed_test(p_test_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.speed_tests set flag_count = flag_count + 1 where id = p_test_id;
end;
$$;

revoke all on function public.flag_speed_test(uuid) from public;
grant execute on function public.flag_speed_test(uuid) to anon, authenticated;

-- Extend log_speed_test with jitter + alias (backward-compatible defaults)
drop function if exists public.log_speed_test(
  double precision, double precision, numeric, numeric, integer, text, text, text, text
);

create or replace function public.log_speed_test(
  p_latitude         double precision,
  p_longitude        double precision,
  p_download_mbps    numeric,
  p_upload_mbps      numeric,
  p_ping_ms          integer,
  p_connection_type  text default null,
  p_isp              text default null,
  p_city             text default null,
  p_country          text default null,
  p_jitter_ms        integer default null,
  p_contributor_alias text default null
)
returns public.speed_tests
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.speed_tests;
  saved    public.speed_tests;
begin
  if p_latitude not between -90 and 90
    or p_longitude not between -180 and 180
    or p_download_mbps not between 0 and 100000
    or p_upload_mbps not between 0 and 100000
    or p_ping_ms not between 0 and 60000 then
    raise exception 'Invalid speed-test measurement';
  end if;

  select * into existing
  from public.speed_tests
  where abs(latitude  - p_latitude)  <= 0.0015
    and abs(longitude - p_longitude) <= 0.0015
    and updated_at >= now() - interval '20 minutes'
  order by updated_at desc
  limit 1
  for update;

  if found then
    update public.speed_tests set
      latitude     = p_latitude,
      longitude    = p_longitude,
      download_mbps = round(((download_mbps * sample_count) + p_download_mbps) / (sample_count + 1), 2),
      upload_mbps   = round(((upload_mbps   * sample_count) + p_upload_mbps)   / (sample_count + 1), 2),
      ping_ms       = round(((ping_ms       * sample_count) + p_ping_ms)::numeric / (sample_count + 1))::integer,
      jitter_ms     = case
                        when p_jitter_ms is not null and jitter_ms is not null then
                          round(((jitter_ms * sample_count) + p_jitter_ms)::numeric / (sample_count + 1))::integer
                        else coalesce(p_jitter_ms, jitter_ms)
                      end,
      sample_count  = sample_count + 1,
      connection_type    = coalesce(p_connection_type, connection_type),
      isp                = coalesce(p_isp, isp),
      city               = coalesce(p_city, city),
      country            = coalesce(p_country, country),
      contributor_alias  = coalesce(p_contributor_alias, contributor_alias),
      updated_at         = now()
    where id = existing.id
    returning * into saved;
  else
    insert into public.speed_tests (
      latitude, longitude, download_mbps, upload_mbps, ping_ms,
      connection_type, isp, city, country, sample_count, updated_at,
      jitter_ms, contributor_alias
    ) values (
      p_latitude, p_longitude, p_download_mbps, p_upload_mbps, p_ping_ms,
      p_connection_type, p_isp, p_city, p_country, 1, now(),
      p_jitter_ms, p_contributor_alias
    ) returning * into saved;
  end if;

  return saved;
end;
$$;

revoke all on function public.log_speed_test(double precision,double precision,numeric,numeric,integer,text,text,text,text,integer,text) from public;
grant execute on function public.log_speed_test(double precision,double precision,numeric,numeric,integer,text,text,text,text,integer,text) to anon, authenticated;
