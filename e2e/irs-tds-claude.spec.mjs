import { test, expect } from '@playwright/test'

const projectRef = 'mpxgxfqdbquzkrvvejkh'
const sb = 'https://' + projectRef + '.supabase.co'
const tenant = '61a89aef-0e7e-4ea2-b222-44ab2024655a'
const client = { id:'00000000-0000-4000-8000-000000000301', tenant_id:tenant, name:'Claude E2E Client', ssn:'123-45-6789', dob:'1980-01-02', taxYears:'2024' }
const poa = { id:'00000000-0000-4000-8000-000000000401', tenant_id:tenant, client_id:client.id, client_name:client.name, status:'On File', form_type:'2848', tax_years:'2024' }
const user = { id:'00000000-0000-4000-8000-000000000111', aud:'authenticated', role:'authenticated', email:'qa-irs@taxrescrm.test', email_confirmed_at:new Date().toISOString(), app_metadata:{provider:'email',providers:['email']}, user_metadata:{name:'QA IRS Admin'}, created_at:new Date().toISOString(), updated_at:new Date().toISOString() }
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = b64({alg:'none',typ:'JWT'}) + '.' + b64({sub:user.id,email:user.email,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600}) + '.x'

function fixturePdf(lines) {
  const esc = v => v.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')
  const cmds = ['BT','/F1 10 Tf','72 720 Td']
  lines.forEach((line,i) => { if(i) cmds.push('0 -16 Td'); cmds.push('(' + esc(line) + ') Tj') })
  cmds.push('ET')
  const stream = cmds.join('\n')
  const objects = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n',
    '4 0 obj<</Length ' + Buffer.byteLength(stream) + '>>stream\n' + stream + '\nendstream\nendobj\n',
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n',
  ]
  let pdf='%PDF-1.4\n'; const offsets=[]
  for(const o of objects){ offsets.push(Buffer.byteLength(pdf)); pdf += o }
  const xref=Buffer.byteLength(pdf)
  pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')
  pdf += 'trailer<</Size 6/Root 1 0 R>>\nstartxref\n' + xref + '\n%%EOF\n'
  return Buffer.from(pdf,'latin1')
}

async function installMocks(page) {
  const state={sessionActive:false,requests:[],analyses:[],documents:[],submitCount:0,statusCount:0}
  const accountPdf=fixturePdf(['ACCOUNT TRANSCRIPT','TAX PERIOD: Dec. 31, 2024','ACCOUNT BALANCE: 0.00','ACCRUED PENALTY: 0.00','ACCRUED INTEREST: 0.00'])
  const wagePdf=fixturePdf(['WAGE AND INCOME','TAX PERIOD: Dec. 31, 2024','ACCOUNT BALANCE: 0.00','ACCRUED PENALTY: 0.00','ACCRUED INTEREST: 0.00'])

  await page.route('http://127.0.0.1:4173/mock-irs-callback**', async route => {
    state.sessionActive=true
    await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><script>window.opener.postMessage({type:"taxres-irs-tds-oauth",ok:true,message:"stub ok"},location.origin);setTimeout(()=>window.close(),100)</script>'})
  })
  await page.route('http://127.0.0.1:4173/mock-transcript-account.pdf', route => route.fulfill({status:200,contentType:'application/pdf',body:accountPdf}))
  await page.route('http://127.0.0.1:4173/mock-transcript-wage.pdf', route => route.fulfill({status:200,contentType:'application/pdf',body:wagePdf}))
  await page.route('https://api.rss2json.com/**', route => route.fulfill({status:200,contentType:'application/json',body:'{"status":"ok","items":[]}'}))
  await page.route('https://api.allorigins.win/**', route => route.fulfill({status:200,contentType:'application/json',body:'{"contents":"","status":{"http_code":200}}'}))
  await page.routeWebSocket('wss://' + projectRef + '.supabase.co/**', () => {})

  await page.route(sb + '/**', async route => {
    const req=route.request(), url=new URL(req.url()), path=url.pathname, method=req.method(), accept=req.headers()['accept']||''
    const json=(body,status=200,headers={})=>route.fulfill({status,contentType:'application/json',headers,body:JSON.stringify(body)})
    if(path.startsWith('/auth/v1/token')) return json({access_token:jwt,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'mock',user})
    if(path==='/auth/v1/user') return json(user)
    if(path.startsWith('/auth/v1/logout')) return route.fulfill({status:204,body:''})
    if(path==='/functions/v1/transcript-pull') {
      const body=JSON.parse(req.postData()||'{}')
      if(body.action==='capabilities') return json({authorizationConfigured:true,transcriptContractConfigured:true,apiFlowVerified:true,sessionActive:state.sessionActive,missingAuthorizationConfig:[],missingContractConfig:[],organizationName:state.sessionActive?'IRS Stub / Sandbox':null})
      if(body.action==='begin-session') return json({ok:true,authorizationUrl:'http://127.0.0.1:4173/mock-irs-callback?code=stub-code-e2e&state=stub-state',redirectUri:'http://127.0.0.1:4173/mock-irs-callback',stub:true})
      if(body.action==='submit') {
        state.submitCount++
        const row=state.requests.find(r=>r.id===body.requestId)
        if(row) Object.assign(row,{provider_request_id:'stub-txn-e2e',provider_status:'Submitted',status:'In Progress'})
        return json({ok:true,providerRequestId:'stub-txn-e2e',status:'Submitted',stub:true})
      }
      if(body.action==='status') {
        state.statusCount++
        const wage=state.statusCount>1
        return json({ok:true,status:'Delivered',resultKey:wage?'stub-result-2024-wage':'stub-result-2024-account',filePath:'tds-direct/'+tenant+'/'+body.requestId+'/'+(wage?'wage.pdf':'account.pdf'),signedUrl:wage?'http://127.0.0.1:4173/mock-transcript-wage.pdf':'http://127.0.0.1:4173/mock-transcript-account.pdf',deliveredCount:wage?2:1,stub:true})
      }
      if(body.action==='end-session'){state.sessionActive=false;return json({ok:true})}
      return json({error:'unknown action'},400)
    }
    if(path.includes('/rest/v1/rpc/')) {
      const rpc=path.split('/').pop()
      if(rpc==='current_tenant_id') return json(tenant)
      if(rpc==='get_branding_by_email_domain') return json({firm_name:'Tax Case Review',logo_url:null,sub:'IRS Resolution Platform'})
      if(rpc==='get_sidebar_badge_counts') return json({email:0,tasks:0,leads:0,clients:0,cases:0,deadlines:0,calendar:0,esign:0,voicemails:0,fax:0})
      return json(null)
    }
    if(path.includes('/rest/v1/employees')) {
      const row={id:'00000000-0000-4000-8000-000000000222',tenant_id:tenant,email:user.email,name:'QA IRS Admin',role:'Admin',status:'active',access_level:'Admin',caf:'123456789',caf_number:'123456789',perm_leads:3,perm_clients:3,perm_billing:3,perm_schedule:3,perm_documents:3,perm_irs:3,perm_reports:3,perm_hr:3,perm_comms:3,perm_settings:3}
      return json(accept.includes('application/vnd.pgrst.object+json')?row:[row],200,{'content-range':'0-0/1'})
    }
    if(path.includes('/rest/v1/settings')) {
      const row={id:'settings-qa',tenant_id:tenant,firm_name:'Tax Case Review',caf_number:'123456789',primary_color:'#1A7FD4'}
      return json(accept.includes('application/vnd.pgrst.object+json')?row:[row],200,{'content-range':'0-0/1'})
    }
    if(path.includes('/rest/v1/tenants')) return json(accept.includes('application/vnd.pgrst.object+json')?{id:tenant,status:'active',plan_tier:'enterprise',firm_name:'Tax Case Review'}:[{id:tenant,status:'active',plan_tier:'enterprise',firm_name:'Tax Case Review'}])
    if(path.includes('/rest/v1/clients')) return json([client],200,{'content-range':'0-0/1'})
    if(path.includes('/rest/v1/poa_records')) return json([poa],200,{'content-range':'0-0/1'})
    if(path.includes('/rest/v1/transcripts')) {
      if(method==='HEAD') return route.fulfill({status:200,headers:{'content-range':'*/0'}})
      return json([])
    }
    if(path.includes('/rest/v1/transcript_pull_requests')) {
      if(method==='POST') {
        const payload=JSON.parse(req.postData()||'[]'), list=Array.isArray(payload)?payload:[payload]
        for(const row of list) state.requests.unshift({...row,tenant_id:tenant,requested_at:new Date().toISOString(),result_analysis_ids:[],provider_filed_keys:[]})
        return json(list)
      }
      if(method==='PATCH') {
        const patch=JSON.parse(req.postData()||'{}'), id=(url.searchParams.get('id')||'').replace(/^eq\./,'')
        const row=state.requests.find(r=>r.id===id); if(row) Object.assign(row,patch)
        return json(row?[row]:[])
      }
      const id=(url.searchParams.get('id')||'').replace(/^eq\./,'')
      const rows=id?state.requests.filter(r=>r.id===id):state.requests
      return json(accept.includes('application/vnd.pgrst.object+json')?(rows[0]||null):rows,200,{'content-range':rows.length?'0-'+(rows.length-1)+'/'+rows.length:'*/0'})
    }
    if(path.includes('/rest/v1/transcript_analyses')) {
      if(method==='POST') {
        const payload=JSON.parse(req.postData()||'{}'), row=Array.isArray(payload)?payload[0]:payload
        const saved={...row,id:'analysis-e2e-1',created_at:new Date().toISOString()}
        state.analyses.unshift(saved)
        return json(accept.includes('application/vnd.pgrst.object+json')?{id:saved.id}:[{id:saved.id}])
      }
      let rows=state.analyses
      const idq=url.searchParams.get('id')||''
      if(idq.startsWith('in.(')) {
        const ids=idq.slice(4,-1).split(',')
        rows=rows.filter(r=>ids.includes(r.id))
      }
      if((url.searchParams.get('select')||'').includes('id,tax_year,transcript_type')) rows=rows.map(r=>({id:r.id,tax_year:r.tax_year,transcript_type:r.transcript_type}))
      return json(accept.includes('application/vnd.pgrst.object+json')?(rows[0]||null):rows)
    }
    if(path.includes('/rest/v1/documents')) {
      if(method==='POST') {
        const payload=JSON.parse(req.postData()||'[]'), list=Array.isArray(payload)?payload:[payload]
        state.documents.push(...list); return json(list)
      }
      return json(state.documents)
    }
    if(path.includes('/storage/v1/')) return json([])
    if(path.includes('/rest/v1/')) {
      if(method==='HEAD') return route.fulfill({status:200,headers:{'content-range':'*/0'}})
      return json(accept.includes('application/vnd.pgrst.object+json')?null:[])
    }
    return json({})
  })
  return state
}

async function login(page) {
  await page.goto('/')
  await page.getByLabel('Email').fill(user.email)
  await page.locator('#tcr-password').fill('qa-password-not-sent')
  await page.getByRole('button',{name:'Sign In'}).click()
  await expect(page.getByRole('button',{name:/New$/})).toBeVisible({timeout:15000})
}

test('Claude native IRS TDS workflow reaches filed transcript and analysis in one CRM session', async ({page}) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(() => {
    const nativeSetInterval=window.setInterval.bind(window)
    window.setInterval=(fn,ms,...args)=>nativeSetInterval(fn,ms===30000?150:ms,...args)
  })
  const state=await installMocks(page)
  await login(page)
  await page.goto('/irsportal')
  await expect(page.getByText('IRS Transcript Delivery',{exact:true})).toBeVisible()

  const popupPromise=page.waitForEvent('popup')
  await page.getByRole('button',{name:'Sign in to IRS',exact:true}).click()
  const popup=await popupPromise
  await popup.waitForLoadState('domcontentloaded').catch(()=>{})
  await expect(page.getByText('✓ IRS session active — transcript requests will be delivered directly to the CRM.')).toBeVisible({timeout:10000})

  await page.getByTestId('transcript-client-search').fill(client.name)
  await page.getByTestId('transcript-client-option-'+client.id).click()
  await page.locator('select').filter({hasText:'Add a tax year'}).selectOption('2024')
  await expect(page.getByText(/Years valid/)).toBeVisible()

  const request=page.getByRole('button',{name:'Request Transcripts',exact:true})
  await expect(request).toBeEnabled()
  await request.click()
  await expect(page.getByText(/Transcript request sent to IRS/)).toBeVisible({timeout:10000})

  await expect.poll(()=>state.submitCount,{timeout:10000}).toBe(1)
  await expect.poll(()=>state.statusCount,{timeout:10000}).toBeGreaterThan(0)
  await expect.poll(()=>state.analyses.length,{timeout:15000}).toBe(2)
  await expect.poll(()=>state.documents.length,{timeout:15000}).toBe(2)
  await expect.poll(()=>state.requests[0]?.status,{timeout:15000}).toBe('Completed')
  expect(state.analyses.every(a=>a.client_id===client.id)).toBeTruthy()
  expect(state.analyses.every(a=>a.tax_year==='2024')).toBeTruthy()
  expect(new Set(state.analyses.map(a=>a.transcript_type))).toEqual(new Set(['Account Transcript','Wage and Income']))
  expect(state.documents.every(d=>d.client_id===client.id)).toBeTruthy()
  expect(state.documents.every(d=>d.docType==='Transcripts')).toBeTruthy()

  const analysisTab=page.getByRole('button',{name:/Transcript Analysis/i})
  if(await analysisTab.count()) await analysisTab.click()
  await expect(page.getByText('Claude E2E Client',{exact:true})).toBeVisible({timeout:10000})
  expect(errors).toEqual([])
})
