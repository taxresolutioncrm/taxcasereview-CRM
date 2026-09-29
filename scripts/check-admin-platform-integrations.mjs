import fs from 'node:fs'

const read = p => fs.readFileSync(p,'utf8')
const admin = read('src/pages/AdminPortal.jsx')
const hub = read('supabase/functions/hub-proxy/index.ts')
const content = read('supabase/functions/content-generator/index.ts')
const bing = read('supabase/functions/bing-data/index.ts')
const linkedin = read('supabase/functions/linkedin-publish/index.ts')
const scheduler = read('supabase/functions/linkedin-scheduler/index.ts')
const migration = read('supabase/migrations/20260929123000_linkedin_company_page_autopilot_closeout.sql')

const checks = [
  ['portfolio uses live metrics batch', admin.includes("action:'metrics_batch'") && admin.includes('portfolioCrmStatus')],
  ['portfolio no longer trusts static connection counts', admin.includes("const statusFor = p => portfolioCrmStatus[p.key]?.status")],
  ['content generator handles browser preflight', content.includes("req.method==='OPTIONS'") && content.includes("'Access-Control-Allow-Origin':'https://admin.romylabs.com'")],
  ['content generator permits force regenerate header', content.includes('x-force-regenerate')],
  ['hub proxy uses product service credentials', ['CAMVELLA_SUPPORT_SECRET','ARCVENA_SUPPORT_SECRET','GROUNDIVO_SUPPORT_SECRET','OCULIVO_SUPPORT_SECRET','RESTORE_RELAY_SUPPORT_SECRET'].every(x=>hub.includes(x))],
  ['boca metrics use hub secret', hub.includes("productKey === 'bocasync'") && hub.includes("productHeaders['x-hub-secret'] = hubSecret")],
  ['bing source reconciles actual Bing verification', bing.includes('VerifySite') && bing.includes('AddSite') && bing.includes("status:'configured'") && bing.includes("status:'live'")],
  ['TaxRes and Arcvena request organization scope', admin.includes("['taxres_crm','arcvena'].includes(selectedPid)") && admin.includes('w_organization_social')],
  ['LinkedIn publisher discovers company pages', linkedin.includes('organizationalEntityAcls') && linkedin.includes('resolveCompanyOrganization')],
  ['LinkedIn publisher blocks personal targets for product brands', linkedin.includes("COMPANY_PRODUCTS.has(productId) && targetType !== 'ORGANIZATION'")],
  ['LinkedIn scheduler is product-aware and company-page gated', scheduler.includes("pid===TAXRES_PRODUCT||pid===ARCVENA_PRODUCT") && scheduler.includes('company_page_target_not_verified')],
  ['LinkedIn autopilot cron uses product scheduler', migration.includes("'linkedin-product-autopilot'") && migration.includes('/functions/v1/linkedin-scheduler')],
  ['DB publisher fails closed on personal targets', migration.includes("v_post.product_id in ('taxres_crm','arcvena')") && migration.includes('company_page_authorization_required')],
]
const failed=checks.filter(([,ok])=>!ok)
for(const [name,ok] of checks) console.log(`${ok?'PASS':'FAIL'}: ${name}`)
if(failed.length){ process.exitCode=1 }
