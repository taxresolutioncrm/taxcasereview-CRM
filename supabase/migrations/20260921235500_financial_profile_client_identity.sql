-- Financial profiles must be unique by tenant + stable client identity.
-- Multiple legacy rows with NULL client_id remain allowed by PostgreSQL UNIQUE semantics.
create unique index if not exists client_financial_profiles_tenant_client_id_uidx
  on public.client_financial_profiles (tenant_id, client_id);
