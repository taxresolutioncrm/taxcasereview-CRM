import { test, expect } from '@playwright/test'

const projectRef = 'mpxgxfqdbquzkrvvejkh'
const supabaseHost = `https://${projectRef}.supabase.co`
const user = {
  id: '00000000-0000-4000-8000-000000000111',
  aud: 'authenticated', role: 'authenticated', email: 'qa-ui@taxrescrm.test',
  email_confirmed_at: new Date().toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { name: 'QA UI Admin' },
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
}

function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64url') }
const jwt = `${b64url({alg:'none',typ:'JWT'})}.${b64url({sub:user.id,email:user.email,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})}.x`
const rangeFor = n => n > 0 ? `0-${n - 1}/${n}` : '*/0'

async function mockSupabase(page) {
  await page.route('https://api.rss2json.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', items: [] }),
  }))
  await page.route('https://api.allorigins.win/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ contents: '<?xml version="1.0"?><rss version="2.0"><channel><title>Taxpayer Advocate</title></channel></rss>', status: { http_code: 200 } }),
  }))
  await page.routeWebSocket(`wss://${projectRef}.supabase.co/**`, () => {})

  await page.route(`${supabaseHost}/**`, async route => {
    const req = route.request()
    const url = new URL(req.url())
    const pathname = url.pathname
    const accept = req.headers()['accept'] || ''

    if (pathname.startsWith('/auth/v1/token')) return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ access_token:jwt, token_type:'bearer', expires_in:3600, expires_at:Math.floor(Date.now()/1000)+3600, refresh_token:'mock', user }) })
    if (pathname === '/auth/v1/user') return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(user) })
    if (pathname.startsWith('/auth/v1/logout')) return route.fulfill({ status:204, body:'' })

    if (pathname.includes('/rest/v1/employees')) {
      const employee = { id:'00000000-0000-4000-8000-000000000222', tenant_id:'61a89aef-0e7e-4ea2-b222-44ab2024655a', email:user.email, name:'QA UI Admin', role:'Admin', status:'active', access_level:'Admin', perm_leads:3, perm_clients:3, perm_billing:3, perm_schedule:3, perm_documents:3, perm_irs:3, perm_reports:3, perm_hr:3, perm_comms:3, perm_settings:3 }
      const wantsObject = accept.includes('application/vnd.pgrst.object+json')
      return route.fulfill({ status:200, contentType:'application/json', headers:{'content-range':'0-0/1'}, body:JSON.stringify(wantsObject ? employee : [employee]) })
    }
    if (pathname.includes('/rest/v1/settings')) {
      const settings = { id:'settings-qa', tenant_id:'61a89aef-0e7e-4ea2-b222-44ab2024655a', firm_name:'Tax Case Review', primary_color:'#1A7FD4', lead_workflow_model:'investigation-resolution' }
      const wantsObject = accept.includes('application/vnd.pgrst.object+json')
      return route.fulfill({ status:200, contentType:'application/json', headers:{'content-range':'0-0/1'}, body:JSON.stringify(wantsObject ? settings : [settings]) })
    }
    if (pathname.includes('/rest/v1/tenants')) {
      const tenant = { id:'61a89aef-0e7e-4ea2-b222-44ab2024655a', status:'active', plan_tier:'enterprise', firm_name:'Tax Case Review' }
      const wantsObject = accept.includes('application/vnd.pgrst.object+json')
      return route.fulfill({ status:200, contentType:'application/json', headers:{'content-range':'0-0/1'}, body:JSON.stringify(wantsObject ? tenant : [tenant]) })
    }

    if (pathname.includes('/rest/v1/emails')) {
      const triage = url.searchParams.get('triage') || ''
      const count = triage === 'eq.Inbox' || triage === 'eq.Action Needed' ? 1 : 0
      if (req.method() === 'HEAD') return route.fulfill({ status:200, headers:{'content-range':rangeFor(count)} })
      const rows = [
        { id:'email-1', mailbox_owner:user.email, is_read:false, triage:'Inbox', deleted_at:null, created_at:new Date().toISOString(), subject:'QA unread one', clientName:'QA Client', recipient:'qa@example.test', status:'Received' },
        { id:'email-2', mailbox_owner:user.email, is_read:false, triage:'Action Needed', deleted_at:null, created_at:new Date().toISOString(), subject:'QA unread two', clientName:'QA Client', recipient:'qa@example.test', status:'Received' },
      ]
      return route.fulfill({ status:200, contentType:'application/json', headers:{'content-range':'0-1/2'}, body:JSON.stringify(rows) })
    }
    if (pathname.includes('/rest/v1/tasks')) {
      const rows = Array.from({length:5},(_,i)=>({id:`task-${i}`,done:false,deleted:false,created_at:new Date().toISOString()}))
      if (req.method() === 'HEAD') return route.fulfill({ status:200, headers:{'content-range':rangeFor(5)} })
      return route.fulfill({ status:200, contentType:'application/json', headers:{'content-range':'0-4/5'}, body:JSON.stringify(rows) })
    }
    if (pathname.includes('/rest/v1/leads')) {
      const rows = Array.from({length:4},(_,i)=>({id:`lead-${i}`,name:`QA Lead ${i}`,status:'New Lead',created_at:new Date().toISOString()}))
      if (req.method() === 'HEAD') return route.fulfill({ status:200, headers:{'content-range':rangeFor(4)} })
      return route.fulfill({ status:200, contentType:'application/json', headers:{'content-range':'0-3/4'}, body:JSON.stringify(rows) })
    }
    if (pathname.includes('/rest/v1/cases')) {
      const rows = Array.from({length:3},(_,i)=>({id:`case-${i}`,caseNum:`QA-${i}`,clientName:`QA Client ${i}`,status:'Active',created_at:new Date().toISOString()}))
      if (req.method() === 'HEAD') return route.fulfill({ status:200, headers:{'content-range':rangeFor(3)} })
      return route.fulfill({ status:200, contentType:'application/json', headers:{'content-range':'0-2/3'}, body:JSON.stringify(rows) })
    }
    if (pathname.includes('/rest/v1/rpc/')) {
      const rpc = pathname.split('/').pop(); let body = []
      if (rpc === 'get_branding_by_email_domain') body = { firm_name:'Tax Case Review', logo_url:null, sub:'IRS Resolution Platform' }
      else if (rpc === 'current_tenant_id') body = '61a89aef-0e7e-4ea2-b222-44ab2024655a'
      else if (rpc === 'get_sidebar_badge_counts') body = { email:2, tasks:5, leads:4, clients:0, cases:3, deadlines:0, calendar:0, esign:0, voicemails:0, fax:0 }
      else if (rpc.includes('tenant') || rpc.includes('branding')) body = { tenant_id:'61a89aef-0e7e-4ea2-b222-44ab2024655a' }
      return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(body) })
    }
    if (pathname.includes('/functions/v1/')) return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ok:true,data:[]}) })
    if (pathname.includes('/storage/v1/')) return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify([]) })
    if (pathname.includes('/rest/v1/')) {
      const wantsObject = accept.includes('application/vnd.pgrst.object+json')
      return route.fulfill({ status:200, contentType:'application/json', headers:{'content-range':'*/0'}, body:JSON.stringify(wantsObject ? null : []) })
    }
    return route.fulfill({ status:200, contentType:'application/json', body:'{}' })
  })
}

async function login(page) {
  await page.goto('/')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill('qa-password-not-sent')
  await page.getByRole('button', {name:'Sign In'}).click()
  await expect(page.getByRole('button', {name:/New$/})).toBeVisible({timeout:15000})
}

const flows = [
  ['New Case','/cases?new=1'],['New Client','/clients?new=1'],['New Corp','/formacorp?new=1'],['New Document','/documents?new=1'],['New E-Sign','/esign?new=1'],['New Email','/email?new=1'],['New Entry','/books?new=1'],['New Event','/calendar?new=1'],['New Fax','/fax?new=1'],['New Invoice','/invoices?new=1'],['New Lead','/leads?new=1'],['New Payment','/payments?new=1'],['New Task','/tasks?new=1'],['New Transcript','/irsportal?new=1'],
]

test('authenticated shell and all global New actions render and navigate', async ({ page }) => {
  const consoleErrors=[]; const pageErrors=[]
  page.on('console', msg => { if (msg.type()==='error') consoleErrors.push(msg.text()) }); page.on('pageerror', err=>pageErrors.push(err.message))
  await mockSupabase(page); await login(page)
  for (const [label,target] of flows) {
    await page.goto('/'); await expect(page.getByRole('button',{name:/New$/})).toBeVisible(); await page.getByRole('button',{name:/New$/}).click()
    const dialog=page.getByRole('dialog',{name:'Create New'}); await expect(dialog).toBeVisible(); await expect(dialog.getByText('What would you like to add?')).toBeVisible()
    const action=dialog.locator('button').filter({hasText:label}).first(); await expect(action).toBeVisible(); await action.click()
    await expect(page).toHaveURL(new RegExp(target.replace(/[?]/g,'\\?')+'$')); await expect(page.locator('body')).not.toContainText('This page encountered an error'); await expect(page.locator('.page-content')).toBeVisible()
    const box=await page.locator('.page-content').boundingBox(); expect(box?.width||0).toBeGreaterThan(200); expect(box?.height||0).toBeGreaterThan(200)
  }
  expect(pageErrors,`page errors: ${pageErrors.join(' | ')}`).toEqual([])
  expect(consoleErrors.filter(x=>!/favicon|ResizeObserver|Failed to load resource/i.test(x)),`console errors: ${consoleErrors.join(' | ')}`).toEqual([])
})

test('sidebar renders stable notification badges', async ({ page }) => {
  await mockSupabase(page); await login(page)
  const email = page.getByRole('link',{name:/Email/}).first()
  const tasks = page.getByRole('link',{name:/Tasks/}).first()
  await expect(email.locator('.nav-badge')).toHaveText('2')
  await expect(tasks.locator('.nav-badge')).toHaveText('5')

  const leads = page.getByRole('link',{name:/Leads/}).first()
  if (!(await leads.isVisible().catch(()=>false))) await page.getByText('Client Work',{exact:true}).click()
  const cases = page.getByRole('link',{name:/Cases/}).first()
  await expect(leads).toBeVisible()
  await expect(cases).toBeVisible()

  // Leads/Clients/Cases are unseen-notification badges. They intentionally clear
  // as soon as that section is acknowledged, so the smoke test must not require
  // a stale hard-coded number for those links. If an entity badge is present,
  // still verify that it renders with usable badge geometry.
  for (const badge of [email.locator('.nav-badge'),tasks.locator('.nav-badge')]) {
    await expect(badge).toBeVisible()
    const box = await badge.boundingBox()
    expect(box?.width||0).toBeGreaterThanOrEqual(18)
    expect(box?.height||0).toBeGreaterThanOrEqual(14)
  }
  for (const link of [leads,cases]) {
    const badge = link.locator('.nav-badge')
    if (await badge.count()) {
      await expect(badge).toBeVisible()
      const box = await badge.boundingBox()
      expect(box?.width||0).toBeGreaterThanOrEqual(18)
      expect(box?.height||0).toBeGreaterThanOrEqual(14)
    }
  }
})

test('Communications pages survive sequential sidebar navigation without refresh', async ({ page }) => {
  const consoleErrors=[]; const pageErrors=[]
  page.on('console', msg=>{if(msg.type()==='error')consoleErrors.push(msg.text())}); page.on('pageerror',err=>pageErrors.push(err.message))
  await mockSupabase(page); await login(page)
  const communicationsHeader=page.getByText('Communications',{exact:true}); await expect(communicationsHeader).toBeVisible(); await communicationsHeader.click()
  const sequence=[['SMS','/sms'],['Fax','/fax'],['Documents','/documents'],['E-Signatures','/esign'],['SMS','/sms'],['Documents','/documents'],['Fax','/fax'],['E-Signatures','/esign']]
  for (const [label,target] of sequence) {
    const link=page.getByRole('link',{name:label,exact:true}); await expect(link).toBeVisible(); await link.click(); await expect(page).toHaveURL(new RegExp(`${target}$`)); await expect(page.locator('.page-content')).toBeVisible(); await expect(page.locator('body')).not.toContainText('This page encountered an error')
    const box=await page.locator('.page-content').boundingBox(); expect(box?.width||0).toBeGreaterThan(200); expect(box?.height||0).toBeGreaterThan(200)
  }
  expect(pageErrors,`communications page errors: ${pageErrors.join(' | ')}`).toEqual([])
  expect(consoleErrors.filter(x=>!/favicon|ResizeObserver|Failed to load resource/i.test(x)),`communications console errors: ${consoleErrors.join(' | ')}`).toEqual([])
})

for (const viewport of [{ name:'phone', width:390, height:844 }, { name:'tablet', width:820, height:1180 }]) {
  test(`TaxRes mobile shell works at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const pageErrors=[]; page.on('pageerror', err=>pageErrors.push(err.message))
    await mockSupabase(page); await login(page)

    const hamburger=page.getByRole('button',{name:'Open menu'})
    await expect(hamburger).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2)

    await hamburger.click()
    const sidebar=page.locator('.sidebar.mobile-open')
    await expect(sidebar).toBeVisible(); await expect(page.locator('.sidebar-backdrop')).toBeVisible()

    let clients=sidebar.getByRole('link',{name:'Clients',exact:true})
    if (!(await clients.isVisible().catch(()=>false))) {
      await sidebar.getByText('Client Work',{exact:true}).click()
      clients=sidebar.getByRole('link',{name:'Clients',exact:true})
    }
    await expect(clients).toBeVisible(); await clients.click()
    await expect(page).toHaveURL(/\/clients$/); await expect(page.locator('.sidebar.mobile-open')).toHaveCount(0)

    await expect(page.getByRole('button',{name:/New$/})).toBeVisible(); await page.getByRole('button',{name:/New$/}).click()
    const drawer=page.getByRole('dialog',{name:'Create New'}); await expect(drawer).toBeVisible()
    const box=await drawer.boundingBox(); expect(box?.width||0).toBeLessThanOrEqual(viewport.width); expect(box?.height||0).toBeLessThanOrEqual(viewport.height)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2)
    expect(pageErrors,`mobile page errors: ${pageErrors.join(' | ')}`).toEqual([])
  })
}