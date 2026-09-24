-- Replace second-resolution text id defaults with collision-proof UUID-backed ids.
-- Existing ids are untouched; only future inserts use the safer defaults.

alter table public.calevents   alter column id set default ('ce'  || replace(gen_random_uuid()::text,'-',''));
alter table public.cases       alter column id set default ('cs'  || replace(gen_random_uuid()::text,'-',''));
alter table public.clients     alter column id set default ('c'   || replace(gen_random_uuid()::text,'-',''));
alter table public.deadlines   alter column id set default ('dl'  || replace(gen_random_uuid()::text,'-',''));
alter table public.documents   alter column id set default ('doc' || replace(gen_random_uuid()::text,'-',''));
alter table public.employees   alter column id set default ('emp' || replace(gen_random_uuid()::text,'-',''));
alter table public.estimates   alter column id set default ('est' || replace(gen_random_uuid()::text,'-',''));
alter table public.invoices    alter column id set default ('inv' || replace(gen_random_uuid()::text,'-',''));
alter table public.irsforms    alter column id set default ('if'  || replace(gen_random_uuid()::text,'-',''));
alter table public.leads       alter column id set default ('l'   || replace(gen_random_uuid()::text,'-',''));
alter table public.payments    alter column id set default ('pay' || replace(gen_random_uuid()::text,'-',''));
alter table public.payrollruns alter column id set default ('pr'  || replace(gen_random_uuid()::text,'-',''));
alter table public.timeentries alter column id set default ('te'  || replace(gen_random_uuid()::text,'-',''));
alter table public.transcripts alter column id set default ('tr'  || replace(gen_random_uuid()::text,'-',''));
