-- Privacy and trust hardening. Public coordinates are deliberately reduced to
-- roughly neighbourhood-level precision before they ever reach the table.
alter table public.speed_tests
  add column if not exists last_flagged_at timestamptz;

alter table public.speed_tests drop constraint if exists speed_tests_alias_length;
alter table public.speed_tests add constraint speed_tests_alias_length
  check (contributor_alias is null or char_length(contributor_alias) between 1 and 20);

alter table public.speed_tests drop constraint if exists speed_tests_isp_length;
alter table public.speed_tests add constraint speed_tests_isp_length
  check (isp is null or char_length(isp) <= 120);

create or replace function public.protect_speed_test_location()
returns trigger language plpgsql set search_path = public as $$
begin
  new.latitude := round(new.latitude::numeric, 2)::double precision;
  new.longitude := round(new.longitude::numeric, 2)::double precision;
  new.contributor_alias := nullif(trim(new.contributor_alias), '');
  return new;
end;
$$;

drop trigger if exists protect_speed_test_location on public.speed_tests;
create trigger protect_speed_test_location
before insert or update of latitude, longitude, contributor_alias on public.speed_tests
for each row execute function public.protect_speed_test_location();

create or replace function public.flag_speed_test(p_test_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.speed_tests
  set flag_count = flag_count + 1, last_flagged_at = now()
  where id = p_test_id
    and (last_flagged_at is null or last_flagged_at < now() - interval '10 seconds');
  if not found then
    raise exception 'This report was flagged recently. Please wait.';
  end if;
end;
$$;

revoke all on function public.flag_speed_test(uuid) from public;
grant execute on function public.flag_speed_test(uuid) to anon, authenticated;

comment on column public.speed_tests.latitude is 'Approximate latitude rounded to two decimal places for privacy.';
comment on column public.speed_tests.longitude is 'Approximate longitude rounded to two decimal places for privacy.';
