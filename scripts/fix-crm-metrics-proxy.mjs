import fs from 'node:fs'

const path = 'src/pages/AdminPortal.jsx'
let s = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

if (!s.includes('const fetchCrmProductMetrics = React.useCallback')) {
  const old = `  const fetchCrmMetricsUrl = React.useCallback(async (url) => {
    if (!url) return null
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) throw new Error('Admin session unavailable')
    const res = await fetch(url, { headers: { Authorization: \`Bearer \${token}\` } })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body?.ok === false) throw new Error(body?.error || \`Metrics request failed (\${res.status})\`)
    return body
  }, [])`

  const replacement = `  const fetchCrmProductMetrics = React.useCallback(async (productKey) => {
    if (!productKey) return null
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) throw new Error('Admin session unavailable')
    const res = await fetch('https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/hub-proxy', {
      method: 'POST',
      headers: {
        Authorization: \`Bearer \${token}\`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ product: productKey }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body?.ok === false) throw new Error(body?.error || \`Metrics request failed (\${res.status})\`)
    return body
  }, [])`

  if (!s.includes(old)) throw new Error('Admin metrics helper anchor not found')
  s = s.replace(old, replacement)
}

s = s.replaceAll('fetchCrmMetricsUrl(product.metricsUrl)', 'fetchCrmProductMetrics(crmProduct)')
s = s.replaceAll('}, [crmProduct, fetchCrmMetricsUrl])', '}, [crmProduct, fetchCrmProductMetrics])')
s = s.replaceAll('fetchCrmMetricsUrl(tenantProduct.metricsUrl)', 'fetchCrmProductMetrics(key)')
s = s.replaceAll('}, [crmProduct, crmAccount, fetchCrmMetricsUrl])', '}, [crmProduct, crmAccount, fetchCrmProductMetrics])')

const forbidden = [
  'fetchCrmMetricsUrl(product.metricsUrl)',
  'fetchCrmMetricsUrl(tenantProduct.metricsUrl)',
  "if (!product?.metricsUrl)",
  "if (!key || !tenantProduct?.metricsUrl)",
]
for (const needle of forbidden) {
  if (s.includes(needle)) throw new Error(`Unsafe direct metrics fetch remains: ${needle}`)
}
for (const needle of [
  'const fetchCrmProductMetrics = React.useCallback',
  "functions/v1/hub-proxy",
  'fetchCrmProductMetrics(crmProduct)',
  'fetchCrmProductMetrics(key)',
  "brand_color: r.brand_color || '#2563EB'",
  "p.isTenant && String(p.label || '').trim().toLowerCase() === selectedName",
  'activeTenant && crmAccountMetrics?.metrics ? crmAccountMetrics.metrics : null',
  "if (!product) { setCrmRemoteData(null); return }",
  "if (!key || !tenantProduct) return",
]) {
  if (!s.includes(needle)) throw new Error(`Metrics proxy verification failed: ${needle}`)
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

for (const uiNeedle of [
  'const taxResTenantFeeds = [',
  "brand_color: r.brand_color || '#2563EB'",
  "'Transactions'",
  'metrics.total_clients ?? metrics.active_clients',
  'r.billing_seats ?? r.employee_count',
  "'Seats / Staff'",
  'if (!offices.length) {',
]) {
  if (!s.includes(uiNeedle)) throw new Error(`Admin usage accuracy verification failed: ${uiNeedle}`)
}

const usageMigration = fs.readFileSync('supabase/migrations/20260913150000_admin_tenant_usage_accuracy.sql', 'utf8')
for (const migrationNeedle of [
  'public._admin_tenant_storage_bytes',
  "position(p_tenant_id::text in o.name) > 0",
  "'billing_seats',t.billing_seats",
  "'transactions_count'",
]) {
  if (!usageMigration.includes(migrationNeedle)) throw new Error(`Tenant usage migration verification failed: ${migrationNeedle}`)
}

fs.writeFileSync(path, s)
console.log('admin metrics: hub proxy, complete tenant usage, status dots, storage, seats/staff, and billing metrics verified')
