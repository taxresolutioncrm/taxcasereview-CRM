const fs=require('fs')

const migration=fs.readFileSync('supabase/migrations/20260920002500_taxres_disk_io_guardrails.sql','utf8')

const checks=[
  ['operational history prune function exists',migration.includes('create or replace function public.prune_taxres_operational_history()')],
  ['pg_net response retention is bounded',migration.includes("created < now() - interval '12 hours'")],
  ['pg_cron history retention is bounded',migration.includes("start_time < now() - interval '7 days'")],
  ['cleanup job repeats every six hours',migration.includes("'taxres-io-history-prune'")&&migration.includes("'17 */6 * * *'")],
  ['net history gets a recurring vacuum',migration.includes("'taxres-io-vacuum-net'")&&migration.includes("vacuum (analyze) net._http_response")],
  ['cron history gets a recurring vacuum',migration.includes("'taxres-io-vacuum-cron'")&&migration.includes("vacuum (analyze) cron.job_run_details")],
  ['rollout reclaims cron history immediately',migration.includes('truncate table cron.job_run_details')],
  ['pg_net reclaim preserves pending LinkedIn publishes',migration.includes("status='publishing'")&&migration.includes('truncate table net._http_response')],
  ['all advisor-reported FK gaps are indexed',[
    'idx_formacorp_lifecycle_case_id',
    'idx_product_traffic_channels_channel_key',
    'idx_prospects_tenant_id_fk',
    'idx_romylabs_esign_events_recipient_id',
    'idx_romylabs_esign_token_aliases_recipient_id',
    'idx_romylabs_sales_agreement_events_agreement_id',
    'idx_romylabs_sales_agreements_office_agreement_id',
    'idx_romylabs_sales_agreements_prospect_id',
    'idx_romylabs_sales_agreements_template_id',
    'idx_romylabs_sales_agreements_tenant_id_fk',
  ].every(x=>migration.includes(x))],
  ['hot employee/settings tenant policies use init-plan form',migration.includes('tenant_id = (select public.current_tenant_id())')],
  ['employee QA visibility auth JWT uses init-plan form',migration.includes("(select auth.jwt()->>'email')")],
]

let failed=0
for(const [name,ok] of checks){
  console.log(`${ok?'PASS':'FAIL'}  ${name}`)
  if(!ok) failed++
}
if(failed){
  console.error(`Supabase Disk IO guardrail contract failed: ${failed} check(s)`)
  process.exit(1)
}
console.log('PASS  Supabase Disk IO guardrails')
