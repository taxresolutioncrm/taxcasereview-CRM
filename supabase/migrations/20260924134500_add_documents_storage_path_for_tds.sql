-- Required by the browser-assisted IRS TDS filing path.
-- Stores the private Storage object path used for signed-URL retrieval/deletion.

alter table public.documents
  add column if not exists storage_path text;
