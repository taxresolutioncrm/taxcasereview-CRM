const fs = require('fs')

const kiosk = fs.readFileSync('src/pages/Kiosk.jsx','utf8')
const topbar = fs.readFileSync('src/components/layout/TopBar.jsx','utf8')
const useFirm = fs.readFileSync('src/lib/useFirm.js','utf8')
const migration = fs.readFileSync('supabase/migrations/20261008173500_cloudcpa_contact_branding_cleanup.sql','utf8')

const failures=[]
const need=(src,x,msg)=>{ if(!src.includes(x)) failures.push(msg) }
const forbid=(src,x,msg)=>{ if(src.includes(x)) failures.push(msg) }

need(kiosk,"supabase.rpc('current_tenant_id')",'Kiosk must resolve authenticated tenant')
need(kiosk,"booking_get_public_meta',{p_tenant:tenant}",'Kiosk public metadata must be tenant-scoped')
forbid(kiosk,"const LOGO='/logo.png'",'Kiosk must not fall back to TCR logo')
forbid(kiosk,"e.currentTarget.src=LOGO",'Broken tenant logo must not fall back to TCR')
need(useFirm,"const _cacheByTenant = new Map()", 'Firm branding cache must be tenant-keyed')
forbid(useFirm,"let _cache = null",'Global firm branding cache can bleed tenants')
forbid(topbar,"(888) 334-5052",'Top bar must not fall back to TCR toll-free')
forbid(topbar,"(561) 420-6626",'Top bar must not fall back to TCR fax')
need(migration,"phone = '+15612039464'",'CloudCPA company phone missing')
need(migration,"firm_fax_number = '+15613280029'",'CloudCPA fax missing')
need(migration,"logourl = '/cloudcpa-logo.png'",'CloudCPA logo missing')
need(migration,"ecd3d3ce-016a-4bb4-800e-f090f51e4cae",'Migration must be CloudCPA-only')

if(failures.length){
 console.error('CloudCPA contact/branding regression check FAILED:')
 failures.forEach(x=>console.error(' - '+x))
 process.exit(1)
}
console.log('CloudCPA contact/branding regression check PASS')
