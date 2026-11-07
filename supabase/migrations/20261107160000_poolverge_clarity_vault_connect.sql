-- Store only the PoolVerge Clarity Data Export token in Supabase Vault.
-- This interface is deliberately service-role-only; Admin Portal users cannot
-- query or reveal the token via PostgREST. The authenticated Edge Function
-- verifies the platform administrator and a real Clarity export before saving.
create or replace function public.poolverge_clarity_vault_token(p_new_token text default null)
returns text
language plpgsql security definer
set search_path = pg_catalog, public, vault, pg_temp
as $$
declare
  v_id uuid;
  v_token text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_new_token is not null then
    if length(trim(p_new_token)) < 32 or length(trim(p_new_token)) > 10000
       or p_new_token ~ '[[:space:]]' then
      raise exception 'Invalid Clarity API token';
    end if;
    select id into v_id from vault.secrets
      where name='poolverge_clarity_data_export_token'
      limit 1;
    if v_id is null then
      perform vault.create_secret(
        trim(p_new_token),
        'poolverge_clarity_data_export_token',
        'PoolVerge Clarity Data Export API token (server-only)'
      );
    else
      perform vault.update_secret(v_id,trim(p_new_token));
    end if;
  end if;
  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name='poolverge_clarity_data_export_token'
  limit 1;
  return v_token;
end
$$;
revoke all on function public.poolverge_clarity_vault_token(text)
  from public, anon, authenticated;
grant execute on function public.poolverge_clarity_vault_token(text) to service_role;
