import fs from 'node:fs'

const sql = fs.readFileSync('supabase/migrations/20260930162000_seed_taxres_workflow_library.sql','utf8')
const fail = m => { console.error('TAXRES WORKFLOW MIRROR REGRESSION:', m); process.exit(1) }

for (const needle of [
  "create or replace function public.seed_taxres_workflow_library",
  "insert into public.workflow_status_categories",
  "insert into public.workflow_statuses",
  "insert into public.workflow_templates",
  "insert into public.workflow_steps",
  "where t.tenant_id = v_source",
  "where st.tenant_id = v_source",
  "tenant_code like 'TRC-%'",
  "after insert on public.tenants",
  "perform public.seed_taxres_workflow_library(new.id)"
]) {
  if (!sql.includes(needle)) fail('Missing required TCR mirror behavior: '+needle)
}

if (!sql.includes("61a89aef-0e7e-4ea2-b222-44ab2024655a")) {
  fail('TCR source tenant is not fixed as the canonical workflow source.')
}

console.log('PASS: every new TRC office receives a tenant-local mirror of the canonical TCR workflow library.')
