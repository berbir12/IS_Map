alter table public.speed_tests
  add column if not exists sample_count integer not null default 1 check (sample_count > 0),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists speed_tests_location_updated_idx
on public.speed_tests (latitude, longitude, updated_at desc);

create or replace function public.log_speed_test(
  p_latitude double precision,
  p_longitude double precision,
  p_download_mbps numeric,
  p_upload_mbps numeric,
  p_ping_ms integer,
  p_connection_type text default null,
  p_isp text default null,
  p_city text default null,
  p_country text default null
)
returns public.speed_tests
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.speed_tests;
  saved public.speed_tests;
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
  where abs(latitude - p_latitude) <= 0.0015
    and abs(longitude - p_longitude) <= 0.0015
    and updated_at >= now() - interval '20 minutes'
  order by updated_at desc
  limit 1
  for update;

  if found then
    update public.speed_tests set
      latitude = p_latitude,
      longitude = p_longitude,
      download_mbps = round(((download_mbps * sample_count) + p_download_mbps) / (sample_count + 1), 2),
      upload_mbps = round(((upload_mbps * sample_count) + p_upload_mbps) / (sample_count + 1), 2),
      ping_ms = round(((ping_ms * sample_count) + p_ping_ms)::numeric / (sample_count + 1))::integer,
      sample_count = sample_count + 1,
      connection_type = coalesce(p_connection_type, connection_type),
      isp = coalesce(p_isp, isp),
      city = coalesce(p_city, city),
      country = coalesce(p_country, country),
      updated_at = now()
    where id = existing.id
    returning * into saved;
  else
    insert into public.speed_tests (
      latitude, longitude, download_mbps, upload_mbps, ping_ms,
      connection_type, isp, city, country, sample_count, updated_at
    ) values (
      p_latitude, p_longitude, p_download_mbps, p_upload_mbps, p_ping_ms,
      p_connection_type, p_isp, p_city, p_country, 1, now()
    ) returning * into saved;
  end if;

  return saved;
end;
$$;

revoke all on function public.log_speed_test(double precision,double precision,numeric,numeric,integer,text,text,text,text) from public;
grant execute on function public.log_speed_test(double precision,double precision,numeric,numeric,integer,text,text,text,text) to anon, authenticated;
