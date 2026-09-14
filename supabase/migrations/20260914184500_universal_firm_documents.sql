-- Universal firm documents registry for every RomyLabs office.
create table if not exists public.romylabs_office_documents (
  id uuid primary key default gen_random_uuid(),
  product_key text not null,
  external_office_id text not null,
  firm_name text,
  name text not null,
  file_path text not null,
  file_size bigint,
  mime_type text not null default 'application/pdf',
  document_kind text not null default 'manual',
  source_envelope_id uuid references public.romylabs_office_signing_documents(id) on delete set null,
  uploaded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists romylabs_office_documents_envelope_kind_uidx
on public.romylabs_office_documents(source_envelope_id,document_kind);

create index if not exists romylabs_office_documents_office_idx
on public.romylabs_office_documents(product_key,external_office_id,created_at desc);

alter table public.romylabs_office_documents enable row level security;

drop policy if exists "platform admins manage universal office documents" on public.romylabs_office_documents;
create policy "platform admins manage universal office documents"
on public.romylabs_office_documents
for all to authenticated
using (public._is_platform_admin())
with check (public._is_platform_admin());

create or replace function public.admin_romylabs_office_documents(
  p_product_key text,
  p_external_office_id text
)
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  select case
    when public._is_platform_admin() then
      coalesce((
        select jsonb_agg(to_jsonb(d) order by d.created_at desc)
        from public.romylabs_office_documents d
        where d.product_key=p_product_key
          and d.external_office_id=p_external_office_id
      ),'[]'::jsonb)
    else jsonb_build_object('error','Not authorized')
  end
$$;

revoke all on function public.admin_romylabs_office_documents(text,text) from public,anon;
grant execute on function public.admin_romylabs_office_documents(text,text) to authenticated,service_role;
