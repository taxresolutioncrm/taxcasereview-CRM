import { test, expect } from '@playwright/test'
test.use({channel:'chrome'})

const ADMIN = 'https://admin.romylabs.com'
const SUPABASE = 'https://mpxgxfqdbquzkrvvejkh.supabase.co'
const EMAIL = 'romy@romylabs.com'
const UID = '00000000-0000-4000-8000-000000000111'
const user = { id:UID, aud:'authenticated', role:'authenticated', email:EMAIL,
  email_confirmed_at:new Date().toISOString(), app_metadata:{provider:'email',providers:['email']},
  user_metadata:{name:'RomyLabs QA'}, created_at:new Date().toISOString(), updated_at:new Date().toISOString() }
const jwtPart = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const accessToken = `${jwtPart({alg:'none',typ:'JWT'})}.${jwtPart({sub:UID,email:EMAIL,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})}.mock`
const session = { access_token:accessToken,refresh_token:'mock-refresh',token_type:'bearer',
  expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user }

async function setup(page) {
  // Keep the actual portal hostname (the route gate requires it), but load
  // ONLY the locally built PR assets. No production accounts or writes.
  await page.route(`${ADMIN}/**`, async route => {
    const url = new URL(route.request().url())
    const res = await route.fetch({url:`http://127.0.0.1:4173${url.pathname}${url.search}`})
    await route.fulfill({response:res})
  })
  await page.route('https://api.rss2json.com/**', r => r.fulfill({status:200,contentType:'application/json',body:'{"status":"ok","items":[]}'}))
  await page.route('https://api.allorigins.win/**', r => r.fulfill({status:200,contentType:'application/json',body:'{"contents":""}'}))
  await page.routeWebSocket('wss://mpxgxfqdbquzkrvvejkh.supabase.co/**', () => {})
  await page.route(`${SUPABASE}/**`, async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname
    const accept = req.headers().accept || ''
    const object = accept.includes('application/vnd.pgrst.object+json')
    const respond = (body,status=200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(body),
      headers:{'content-range':Array.isArray(body)?`0-${Math.max(0,body.length-1)}/${body.length}`:'0-0/1'}})
    if (path.startsWith('/auth/v1/token')) return respond(session)
    if (path === '/auth/v1/user') return respond(user)
    if (path.startsWith('/auth/v1/logout')) return respond({})
    if (path.includes('/rest/v1/rpc/')) {
      const name = path.split('/').pop()
      if (name === 'set_admin_tenant_override') return respond(true)
      if (name === 'admin_command_center_stats') return respond({today_demos:0,today_schedule:[],recent_lead_notes:[],recent_client_notes:[]})
      if (name === 'admin_tenant_overview' || name === 'list_all_product_tickets') return respond([])
      if (name === 'admin_storage_stats') return respond({bytes:0,files:0})
      if (name === 'admin_taxres_demo_stats') return respond({upcoming:[]})
      if (name === 'admin_monthly_calendar_event_count') return respond(3)
      if (name === 'admin_update_support_ticket_status') return respond(true)
      if (name === 'admin_product_calendar_events') return respond([])
      if (name === 'admin_daily_briefing_status') return respond({ready:false})
      if (name === 'current_tenant_id') return respond('61a89aef-0e7e-4ea2-b222-44ab2024655a')
      if (name === 'list_all_product_tickets') return respond([])
      return respond([])
    }
    if (path.includes('/rest/v1/romylabs_products')) return respond([
      {product_id:'romylabs',name:'RomyLabs',active:true,lifecycle:'live',sort_order:1},
      {product_id:'taxres_crm',name:'TaxRes CRM',active:true,lifecycle:'live',sort_order:2}
    ])
    if (path.includes('/rest/v1/marketing_ga4_traffic')) return respond([
      {product_id:'romylabs',date:'2026-11-08',channel:'__TOTAL__',sessions:10},
      {product_id:'romylabs',date:'2026-11-08',channel:'Organic Search',sessions:2}
    ])
    if (path.includes('/rest/v1/product_traffic_channels')) return respond([])
    if (path.includes('/rest/v1/tenants')) return respond([])
    if (path.includes('/rest/v1/employees')) return respond(object ? {id:UID,email:EMAIL,role:'Super Admin',status:'active',tenant_id:'61a89aef-0e7e-4ea2-b222-44ab2024655a'} : [])
    if (path.includes('/rest/v1/')) return respond(object ? null : [])
    if (path.includes('/functions/v1/romylabs-sms')) return respond({ok:true,messages:[]})
    if (path.includes('/functions/v1/romylabs-mailbox')) return respond({ok:true,mailboxes:[],messages:[]})
    if (path.includes('/functions/v1/romylabs-phone-state')) return respond({ok:true,calls:[]})
    if (path.includes('/functions/v1/')) return respond({ok:true,data:[]})
    if (path.includes('/storage/v1/')) return respond([])
    return respond({})
  })
}

for (const viewport of [
  {name:'desktop',width:1440,height:900},
  {name:'tablet',width:820,height:1180},
  {name:'mobile',width:390,height:844},
]) {
  test(`RomyLabs Admin Portal ${viewport.name} renders and Goals show real metrics`,async ({page}) => {
    await page.setViewportSize({width:viewport.width,height:viewport.height})
    const errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    await setup(page)
    await page.goto(`${ADMIN}/login`)
    await page.getByLabel(/Email/i).fill(EMAIL)
    await page.locator('input[type="password"]').fill('mock-password-never-sent')
    await page.getByRole('button',{name:/Sign In/i}).click()
    await expect(page).toHaveURL(/crm-admin/, {timeout:20000})
    await page.goto(`${ADMIN}/crm-admin/command-center?tab=goals`)
    await expect(page.getByText('Goal status',{exact:true})).toBeVisible({timeout:20000})
    await expect(page.getByText('Organic Search Sessions').first()).toBeVisible()
    await expect(page.getByText('Monthly Demos').first()).toBeVisible()
    await expect(page.getByText('2 / 5,000')).toBeVisible({timeout:12000})
    await expect(page.getByText('3 / 50')).toBeVisible({timeout:12000})
    expect(errors).toEqual([])
    if(viewport.name==='mobile') {
      expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(4)
    }
  })
}

test('System integration controls navigate to actual reporting screens',async ({page}) => {
  await setup(page)
  await page.goto(`${ADMIN}/login`)
  await page.getByLabel(/Email/i).fill(EMAIL)
  await page.locator('input[type="password"]').fill('mock-password-never-sent')
  await page.getByRole('button',{name:/Sign In/i}).click()
  await expect(page).toHaveURL(/crm-admin/, {timeout:20000})
  await page.goto(`${ADMIN}/crm-admin/command-center?tab=system`)
  await expect(page.getByText('Connect APIs')).toBeVisible({timeout:20000})
  const buttons=page.getByRole('button',{name:'View integration'})
  await expect(buttons).toHaveCount(6)
  await buttons.first().click()
  await expect(page).toHaveURL(/tab=marketing/)
})
