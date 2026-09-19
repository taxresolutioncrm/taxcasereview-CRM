import fs from 'node:fs'

const file='src/pages/Settings.jsx'
let src=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')
let changed=false

function replaceFunction(name,replacement,requiredToken){
  if(src.includes(requiredToken)) return
  const start=src.indexOf(`  function ${name}() {`)
  const asyncStart=src.indexOf(`  async function ${name}() {`)
  const a=start>=0?start:asyncStart
  if(a<0) throw new Error(`${name} OAuth function missing`)
  const next=src.indexOf('\n  function ',a+10)
  const nextAsync=src.indexOf('\n  async function ',a+10)
  const candidates=[next,nextAsync].filter(i=>i>=0)
  const b=candidates.length?Math.min(...candidates):src.length
  src=src.slice(0,a)+replacement+src.slice(b)
  changed=true
}

replaceFunction('connectQuickBooks',`  async function connectQuickBooks() {
    if (!myTenantId) { showToast('Still loading your account — try again in a moment'); return }
    if (!firm.qb_client_id) { showToast('Save your QuickBooks Client ID/Secret first'); return }
    const { data, error } = await supabase.functions.invoke('quickbooks-oauth-start', { body: {} })
    if (error || !data?.authorize_url) {
      showToast('Could not start secure QuickBooks connection')
      return
    }
    window.location.href = data.authorize_url
  }
` , "quickbooks-oauth-start")

replaceFunction('connectXero',`  async function connectXero() {
    if (!myTenantId) { showToast('Still loading your account — try again in a moment'); return }
    if (!firm.xero_client_id) { showToast('Save your Xero Client ID/Secret first'); return }
    const { data: state, error } = await supabase.rpc('create_accounting_oauth_state', { p_provider: 'xero' })
    if (error || !state) { showToast('Could not start secure Xero connection'); return }
    const redirectUri = window.location.origin + '/auth/xero-callback'
    const authorizeUrl = \`https://login.xero.com/identity/connect/authorize?response_type=code&client_id=\${encodeURIComponent(firm.xero_client_id)}&redirect_uri=\${encodeURIComponent(redirectUri)}&scope=\${encodeURIComponent('accounting.transactions accounting.contacts offline_access')}&state=\${encodeURIComponent(state)}\`
    window.location.href = authorizeUrl
  }
` , "p_provider: 'xero'")

if(changed) fs.writeFileSync(file,src)

const appFile='src/App.jsx'
let app=fs.readFileSync(appFile,'utf8').replace(/\r\n/g,'\n')
let appChanged=false
if(!app.includes("const XeroCallback")){
  const anchor="const QuickBooksCallback  = lazy(() => import('./pages/QuickBooksCallback'))"
  if(!app.includes(anchor)) throw new Error('QuickBooks callback lazy import missing')
  app=app.replace(anchor, anchor+"\nconst XeroCallback = lazy(() => import('./pages/XeroCallback'))")
  appChanged=true
}
if(!app.includes('path="/auth/xero-callback"')){
  const anchor='<Route path="/auth/quickbooks-callback" element={<QuickBooksCallback />} />'
  if(!app.includes(anchor)) throw new Error('QuickBooks callback route missing')
  app=app.replace(anchor, anchor+'\n      <Route path="/auth/xero-callback" element={<XeroCallback />} />')
  appChanged=true
}
if(appChanged) fs.writeFileSync(appFile,app)
console.log(`✓ Accounting OAuth ${changed||appChanged?'patched':'already current'}: one-time server-side state tokens and both callback routes wired`)
