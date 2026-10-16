-- Client assignment addendum: explicit Admin ownership on each client file.
-- Existing Associate stays in clients."assignedTo"; seller stays in clients."salesRep".
alter table public.clients
  add column if not exists "clientAdmin" text;
