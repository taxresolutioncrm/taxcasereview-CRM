const fs=require('fs');const assert=require('assert');
const admin=fs.readFileSync('src/pages/AdminPortal.jsx','utf8');
const migration=fs.readFileSync('supabase/migrations/20261023133500_admin_executive_metrics_accuracy.sql','utf8');

assert(admin.includes("supabase.rpc('admin_executive_metrics')"),'Overview must use canonical executive metrics RPC');
assert(admin.includes("supabase.rpc('admin_capture_executive_snapshot')"),'Overview must capture one real KPI snapshot per day');
assert(admin.includes("label:'Total Revenue'"),'Total Revenue KPI missing');
assert(admin.includes("label:'MRR'"),'MRR KPI missing');
assert(admin.includes("label:'Active Seats'"),'Active Seats KPI missing');
assert(admin.includes("label:'Occupancy'"),'Occupancy KPI missing');
assert(admin.includes("label:'Products'"),'Products KPI missing');
assert(admin.includes("label:'Companies'"),'Companies KPI missing');
assert(admin.includes("label:'Demo Tenants'"),'Demo Tenants KPI missing');
assert(admin.includes("capacity known for"),'Incomplete occupancy coverage must be disclosed');
assert(admin.includes("unclassified office"),'Data quality warning must expose unclassified offices');
assert(!admin.includes("const totalMRR     = operatingStats.reduce"),'Overview must not locally re-sum MRR');
assert(!admin.includes("const totalSeats   = operatingStats.reduce"),'Overview must not locally re-sum executive seat KPI');

assert(migration.includes("romylabs_subscription_payments"),'Revenue must use RomyLabs subscription payments');
assert(migration.includes("romylabs_billing_accounts"),'MRR must use RomyLabs billing accounts');
assert(migration.includes("partition by office_id"),'Office metrics must dedupe by office id');
assert(migration.includes("when product_key='taxres_crm' then 2 else 1"),'Specific office feeds must outrank aggregate TaxRes duplicates');
assert(migration.includes("is_demo"),'Demo classification missing');
assert(migration.includes("is_internal"),'Internal classification missing');
assert(migration.includes("unclassified_offices"),'Unclassified office guard missing');
assert(migration.includes("health_insurance_crm")&&migration.includes("health_insurance"),'Legacy demo product alias must normalize');
assert(migration.includes("occupancy_complete"),'Occupancy completeness flag missing');
assert(migration.includes("'mrr_pct',null"),'Unsupported historical MRR growth must not be fabricated');
assert(migration.includes("'active_seats_pct',null"),'Unsupported historical seat growth must not be fabricated');
assert(migration.includes("romylabs_executive_metric_snapshots"),'Real KPI snapshot history table missing');
assert(migration.includes("enable row level security"),'Snapshot history must have RLS enabled');
assert(migration.includes("revoke all on public.romylabs_executive_metric_snapshots"),'Snapshot table must not be directly exposed');
assert(migration.includes("public._is_platform_admin()"),'Executive reporting must be platform-admin gated');
assert(migration.includes("historical_mrr','[]'::jsonb"),'Historical MRR chart must stay empty until real history exists');

console.log('PASS Admin executive reporting accuracy contract');
