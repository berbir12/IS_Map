-- Backfill historical privacy and use true geographic distance for aggregation.
create extension if not exists postgis;

update public.speed_tests
set latitude = round(latitude::numeric, 2)::double precision,
    longitude = round(longitude::numeric, 2)::double precision
where latitude <> round(latitude::numeric, 2)::double precision
   or longitude <> round(longitude::numeric, 2)::double precision;

create index if not exists speed_tests_geography_updated_idx
on public.speed_tests using gist ((st_setsrid(st_makepoint(longitude, latitude), 4326)::geography));

create or replace function public.log_speed_test(
  p_latitude double precision,
  p_longitude double precision,
  p_download_mbps numeric,
  p_upload_mbps numeric,
  p_ping_ms integer,
  p_connection_type text default null,
  p_isp text default null,
  p_city text default null,
  p_country text default null,
  p_jitter_ms integer default null,
  p_contributor_alias text default null
)
returns public.speed_tests
language plpgsql security definer set search_path = public, extensions as $$
declare
  safe_lat double precision := round(p_latitude::numeric, 2)::double precision;
  safe_lon double precision := round(p_longitude::numeric, 2)::double precision;
  existing public.speed_tests;
  saved public.speed_tests;
begin
  if p_latitude not between -90 and 90
    or p_longitude not between -180 and 180
    or p_download_mbps not between 0 and 100000
    or p_upload_mbps not between 0 and 100000
    or p_ping_ms not between 0 and 60000
    or p_jitter_ms is not null and p_jitter_ms not between 0 and 60000
    or p_contributor_alias is not null and char_length(trim(p_contributor_alias)) > 20 then
    raise exception 'Invalid speed-test measurement';
  end if;

  select * into existing from public.speed_tests
  where st_dwithin(
    st_setsrid(st_makepoint(longitude, latitude), 4326)::geography,
    st_setsrid(st_makepoint(safe_lon, safe_lat), 4326)::geography,
    1500
  ) and updated_at >= now() - interval '20 minutes'
  order by updated_at desc limit 1 for update;

  if found then
    update public.speed_tests set
      download_mbps = round(((download_mbps * sample_count) + p_download_mbps) / (sample_count + 1), 2),
      upload_mbps = round(((upload_mbps * sample_count) + p_upload_mbps) / (sample_count + 1), 2),
      ping_ms = round(((ping_ms * sample_count) + p_ping_ms)::numeric / (sample_count + 1))::integer,
      jitter_ms = case when p_jitter_ms is not null and jitter_ms is not null
        then round(((jitter_ms * sample_count) + p_jitter_ms)::numeric / (sample_count + 1))::integer
        else coalesce(p_jitter_ms, jitter_ms) end,
      sample_count = sample_count + 1,
      connection_type = coalesce(p_connection_type, connection_type),
      isp = coalesce(p_isp, isp), city = coalesce(p_city, city), country = coalesce(p_country, country),
      contributor_alias = coalesce(nullif(trim(p_contributor_alias), ''), contributor_alias),
      updated_at = now()
    where id = existing.id returning * into saved;
  else
    insert into public.speed_tests (
      latitude, longitude, download_mbps, upload_mbps, ping_ms, connection_type,
      isp, city, country, sample_count, updated_at, jitter_ms, contributor_alias
    ) values (
      safe_lat, safe_lon, p_download_mbps, p_upload_mbps, p_ping_ms, p_connection_type,
      p_isp, p_city, p_country, 1, now(), p_jitter_ms, nullif(trim(p_contributor_alias), '')
    ) returning * into saved;
  end if;
  return saved;
end;
$$;

revoke all on function public.log_speed_test(double precision,double precision,numeric,numeric,integer,text,text,text,text,integer,text) from public;
grant execute on function public.log_speed_test(double precision,double precision,numeric,numeric,integer,text,text,text,text,integer,text) to anon, authenticated;
