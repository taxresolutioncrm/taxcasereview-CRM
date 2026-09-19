-- Durable TaxRes family auth lookup and cleanup for legacy directly-inserted auth rows.
-- Supabase Auth expects token text columns to be empty strings, not NULL.
update auth.users
set confirmation_token = coalesce(confirmation_token,''),
    recovery_token = coalesce(recovery_token,''),
    email_change_token_new = coalesce(email_change_token_new,''),
    email_change = coalesce(email_change,'')
where confirmation_token is null
   or recovery_token is null
   or email_change_token_new is null
   or email_change is null;

create or replace function public.taxres_auth_user_by_email(target_email text)
returns table (
  id uuid,
  email text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz
)
language sql
security definer
set search_path = pg_catalog, auth
as $$
  select u.id, u.email, u.email_confirmed_at, u.last_sign_in_at
  from auth.users u
  where lower(u.email)=lower(trim(target_email))
    and u.deleted_at is null
  limit 1
$$;

revoke all on function public.taxres_auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.taxres_auth_user_by_email(text) to service_role;
