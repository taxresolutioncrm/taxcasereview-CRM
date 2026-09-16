-- Prevent legacy calendar-email parsers from reintroducing corrupt dates
-- such as Microsoft's FILETIME epoch (1601-01-01). The canonical Stalwart
-- calendar sync writes normalized dates >= 2020.

create or replace function public.guard_invalid_ics_auto_calevent()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.source = 'ics_auto'
     and nullif(new.date,'') is not null
     and new.date::date < date '2020-01-01' then
    if tg_op = 'INSERT' then
      return null;
    end if;
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_invalid_ics_auto_calevent on public.calevents;
create trigger trg_guard_invalid_ics_auto_calevent
before insert or update on public.calevents
for each row execute function public.guard_invalid_ics_auto_calevent();
