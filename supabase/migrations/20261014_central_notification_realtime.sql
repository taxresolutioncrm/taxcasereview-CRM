-- Central TaxRes notification Realtime coverage.
-- Guarded by the TCR tenant so this does not apply to Nashville's dedicated DB.

do $$
begin
  if exists (
    select 1
    from public.tenants
    where id = '61a89aef-0e7e-4ea2-b222-44ab2024655a'::uuid
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'calevents'
    ) then
      execute 'alter publication supabase_realtime add table public.calevents';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'esigns'
    ) then
      execute 'alter publication supabase_realtime add table public.esigns';
    end if;
  end if;
end
$$;
