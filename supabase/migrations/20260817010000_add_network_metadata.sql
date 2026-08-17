alter table public.speed_tests
  add column if not exists isp text,
  add column if not exists city text,
  add column if not exists country text;

create index if not exists speed_tests_isp_idx on public.speed_tests (isp);

create or replace function public.limit_speed_test_submissions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.speed_tests
      where latitude = new.latitude and longitude = new.longitude
      and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Too many tests from this area. Please try again shortly.';
  end if;
  return new;
end;
$$;

drop trigger if exists limit_speed_test_submissions on public.speed_tests;
create trigger limit_speed_test_submissions before insert on public.speed_tests
for each row execute function public.limit_speed_test_submissions();
