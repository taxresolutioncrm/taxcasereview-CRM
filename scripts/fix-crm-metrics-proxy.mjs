import fs from 'node:fs'

const adminPath = 'src/pages/AdminPortal.jsx'
const s = fs.readFileSync(adminPath, 'utf8').replace(/\r\n/g, '\n')

// This prebuild step is a verifier only. It must not rewrite current Admin Portal
// source or require the retired registry-tenant metrics path.
for (const forbidden of [
  'fetchCrmMetricsUrl(product.metricsUrl)',
  'fetchCrmMetricsUrl(tenantProduct.metricsUrl)',
  "if (!product?.metricsUrl)",
  "if (!key || !tenantProduct?.metricsUrl)",
]) {
  if (s.includes(forbidden)) throw new Error(`Unsafe direct metrics fetch remains: ${forbidden}`)
}

for (const required of [
  'const fetchCrmProductMetrics = React.useCallback',
  "functions/v1/hub-proxy",
  'fetchCrmProductMetrics(crmProduct)',
  "supabase.rpc('admin_taxres_crm_scope_metrics'",
  'const [taxresScopeData, setTaxresScopeData] = useState(null)',
  'const taxresMetrics = taxresScopeData?.metrics || {}',
  "const crmTenants = crmProduct === 'taxres_crm' ? localTaxRes : remoteOffices",
  "String(t.tenant_code || '').toUpperCase() !== 'DEMO'",
  "crmProduct==='taxres_crm' ? (taxresMetrics.clients ?? '—')",
  "crmProduct==='taxres_crm' && taxresScopeError",
]) {
  if (!s.includes(required)) throw new Error(`Admin metrics contract missing: ${required}`)
}

const metricsFn = fs.readFileSync('supabase/functions/platform-metrics/index.ts', 'utf8').replace(/\r\n/g, '\n')
for (const forbiddenMetricFragment of [
  ".eq('status','pending')",
  ".eq('is_active',true)",
]) {
  if (metricsFn.includes(forbiddenMetricFragment)) {
    throw new Error(`Stale TaxRes metrics schema reference remains: ${forbiddenMetricFragment}`)
  }
}
for (const requiredMetricFragment of [
  ".eq('done',false)",
  ".ilike('status','active')",
  "supabase.from('cases').select('*',{count:'exact',head:true})",
  "supabase.rpc('_admin_tenant_storage_bytes',{p_tenant_id:tenantId})",
  'const computedMrr=',
  'total_clients:totalClientCount||0',
  'active_clients:activeClientCount||0',
  'active_staff:staffCount',
  'open_jobs:caseCount||0',
]) {
  if (!metricsFn.includes(requiredMetricFragment)) {
    throw new Error(`TaxRes metrics accuracy verification failed: ${requiredMetricFragment}`)
  }
}

const scopeMigration = fs.readFileSync('supabase/migrations/20260916193000_admin_taxres_crm_scope_metrics.sql', 'utf8')
for (const required of [
  'admin_taxres_crm_scope_metrics',
  "upper(coalesce(t.tenant_code,'')) not in ('ADMIN','DEMO')",
  "'pending_esigns'",
  "'demos_today'",
  "'storage_bytes'",
  "'upcoming_demos'",
  "'upcoming_deadlines'",
]) {
  if (!scopeMigration.includes(required)) throw new Error(`TaxRes scoped metrics migration verification failed: ${required}`)
}

console.log('Admin CRM metrics contracts verified without mutating source')
