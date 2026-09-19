import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const settled=new Set(['paid','posted','cleared','succeeded','success','completed','processing'])
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...corsHeaders,'Content-Type':'application/json'}})
const isHistorical=(source:any)=>/(import|reconciliation)/i.test(String(source||''))

async function qboFetch(url:string,token:string,init:RequestInit={}){
  const res=await fetch(url,{...init,headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json',...(init.headers||{})}})
  const data=await res.json().catch(()=>({}))
  return {res,data}
}
async function listEntity(base:string,token:string,entity:string){
  const rows:any[]=[]
  for(let start=1;start<=3001;start+=1000){
    const q=encodeURIComponent(`select Id, DisplayName, Name, Type, Active from ${entity} startposition ${start} maxresults 1000`)
    const {res,data}=await qboFetch(`${base}/query?query=${q}&minorversion=75`,token)
    if(!res.ok) throw new Error(`${entity} query failed (${res.status})`)
    const batch=data?.QueryResponse?.[entity]||[]
    rows.push(...batch)
    if(batch.length<1000) break
  }
  return rows
}
async function ensureCustomer(base:string,token:string,name:string,cache:Map<string,any>){
  const key=name.trim().toLowerCase()
  if(cache.has(key)) return cache.get(key)
  const {res,data}=await qboFetch(`${base}/customer?minorversion=75`,token,{method:'POST',body:JSON.stringify({DisplayName:name})})
  if(!res.ok) throw new Error(data?.Fault?.Error?.[0]?.Message||`Customer create failed (${res.status})`)
  const customer=data?.Customer
  if(!customer?.Id) throw new Error('QuickBooks customer ID missing after create')
  cache.set(key,customer)
  return customer
}

serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders})
  if(req.method!=='POST') return json({error:'POST only'},405)
  try{
    const supaUrl=Deno.env.get('SUPABASE_URL')||''
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    const anonKey=Deno.env.get('SUPABASE_ANON_KEY')||''
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'')
    if(!token) return json({error:'Missing authorization'},401)

    const caller=createClient(supaUrl,anonKey,{global:{headers:{Authorization:`Bearer ${token}`}}})
    const {data:{user},error:userErr}=await caller.auth.getUser()
    if(userErr||!user?.email) return json({error:'Invalid session'},401)

    const admin=createClient(supaUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:emp}=await admin.from('employees').select('tenant_id,role,access,status').ilike('email',user.email).maybeSingle()
    if(!emp?.tenant_id||String(emp.status||'').toLowerCase()!=='active') return json({error:'No active office access for this user'},403)
    if(!['super admin','admin'].includes(String(emp.access||emp.role||'').toLowerCase())) return json({error:'Admin access required'},403)
    const tenantId=emp.tenant_id

    const body=await req.json().catch(()=>({}))
    const dryRun=body?.dry_run===true
    const maxRecords=Math.max(1,Math.min(Number(body?.max_records||50),100))

    const {data:conn}=await admin.from('accounting_connections').select('*').eq('tenant_id',tenantId).eq('provider','quickbooks').maybeSingle()
    if(!conn?.refresh_token) return json({error:'QuickBooks needs to be connected for this office',reconnect_required:true},400)

    const {data:settings}=await admin.from('settings').select('qb_client_id,qb_client_secret').eq('tenant_id',tenantId).maybeSingle()
    if(!settings?.qb_client_id||!settings?.qb_client_secret) return json({error:'QuickBooks credentials missing'},400)

    let accessToken=conn.access_token
    const expiresAt=conn.token_expires_at?new Date(conn.token_expires_at).getTime():0
    if(!accessToken||Date.now()>expiresAt-2*60*1000||conn.status!=='connected'){
      const refreshRes=await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',{
        method:'POST',
        headers:{Authorization:`Basic ${btoa(`${settings.qb_client_id}:${settings.qb_client_secret}`)}`,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
        body:new URLSearchParams({grant_type:'refresh_token',refresh_token:conn.refresh_token})
      })
      const refreshData=await refreshRes.json().catch(()=>({}))
      if(!refreshRes.ok||!refreshData.access_token){
        await admin.from('accounting_connections').update({status:'reconnect_required',last_sync_result:{ok:false,stage:'refresh',status:refreshRes.status}}).eq('id',conn.id)
        return json({error:'QuickBooks authorization must be renewed. Reconnect QuickBooks in Settings.',reconnect_required:true},400)
      }
      accessToken=refreshData.access_token
      await admin.from('accounting_connections').update({
        access_token:accessToken,
        refresh_token:refreshData.refresh_token||conn.refresh_token,
        token_expires_at:new Date(Date.now()+Number(refreshData.expires_in||3600)*1000).toISOString()
      }).eq('id',conn.id)
    }

    const realmId=String(conn.external_company_id||'')
    if(!realmId) return json({error:'QuickBooks company ID is missing. Reconnect QuickBooks.',reconnect_required:true},400)
    const base=`https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(realmId)}`

    const health=await qboFetch(`${base}/companyinfo/${encodeURIComponent(realmId)}?minorversion=75`,accessToken)
    if(!health.res.ok){
      await admin.from('accounting_connections').update({status:'reconnect_required',last_sync_result:{ok:false,stage:'company_health',status:health.res.status}}).eq('id',conn.id)
      return json({error:'QuickBooks company access is not authorized. Reconnect QuickBooks and select the Nashville company.',reconnect_required:true,company_status:health.res.status},400)
    }
    const companyName=health.data?.CompanyInfo?.CompanyName||conn.external_company_name||null

    const [{data:allInvoices},{data:allPayments}]=await Promise.all([
      admin.from('invoices').select('*').eq('tenant_id',tenantId).is('qb_synced_at',null).limit(maxRecords),
      admin.from('payments').select('*').eq('tenant_id',tenantId).is('qb_synced_at',null).limit(Math.max(maxRecords*10,1000))
    ])
    const invoices=(allInvoices||[]).slice(0,maxRecords)
    const allUnsyncedPayments=allPayments||[]
    const historicalSkipped=allUnsyncedPayments.filter((p:any)=>isHistorical(p.source)).length
    const payments=allUnsyncedPayments.filter((p:any)=>!isHistorical(p.source)&&settled.has(String(p.payment_status||p.status||'').toLowerCase())).slice(0,maxRecords)

    if(dryRun){
      const result={ok:true,dry_run:true,company_id:realmId,company_name:companyName,eligible_invoices:invoices.length,eligible_payments:payments.length,skipped_historical_imports:historicalSkipped}
      await admin.from('accounting_connections').update({status:'connected',external_company_name:companyName,last_sync_result:result}).eq('id',conn.id)
      return json(result)
    }

    const customers=await listEntity(base,accessToken,'Customer')
    const customerCache=new Map(customers.map((c:any)=>[String(c.DisplayName||'').trim().toLowerCase(),c]))
    const items=await listEntity(base,accessToken,'Item')
    const serviceItem=items.find((i:any)=>i.Active!==false&&['Service','NonInventory'].includes(String(i.Type||'')))||items.find((i:any)=>i.Active!==false)
    if(invoices.length&&!serviceItem?.Id) return json({error:'QuickBooks has no active product/service item available for invoice sync.'},400)

    let syncedInvoices=0,syncedPayments=0
    const errors:string[]=[]

    for(const inv of invoices){
      try{
        const name=String(inv.clientName||inv.clientname||'').trim()
        if(!name){errors.push(`Invoice ${inv.id}: client name missing`);continue}
        const cust=await ensureCustomer(base,accessToken,name,customerCache)
        const amount=Number(inv.total||inv.amount||0)
        if(!Number.isFinite(amount)||amount<=0){errors.push(`Invoice ${inv.id}: amount is invalid`);continue}
        const payload:any={
          CustomerRef:{value:String(cust.Id),name:cust.DisplayName||name},
          Line:[{Amount:amount,DetailType:'SalesItemLineDetail',Description:inv.description||'Services',SalesItemLineDetail:{ItemRef:{value:String(serviceItem.Id),name:serviceItem.Name||'Services'}}}],
          PrivateNote:`TaxRes CRM invoice ${inv.id}`
        }
        if(inv.invNum) payload.DocNumber=String(inv.invNum)
        const {res,data}=await qboFetch(`${base}/invoice?minorversion=75`,accessToken,{method:'POST',body:JSON.stringify(payload)})
        if(!res.ok){errors.push(`Invoice ${inv.id}: ${data?.Fault?.Error?.[0]?.Message||res.status}`);continue}
        const qbId=data?.Invoice?.Id
        if(!qbId){errors.push(`Invoice ${inv.id}: QuickBooks ID missing`);continue}
        await admin.from('invoices').update({qb_synced_at:new Date().toISOString(),qb_id:String(qbId)}).eq('id',inv.id).eq('tenant_id',tenantId).is('qb_synced_at',null)
        syncedInvoices++
      }catch(e){errors.push(`Invoice ${inv.id}: ${e instanceof Error?e.message:String(e)}`)}
    }

    for(const pay of payments){
      try{
        const name=String(pay.clientName||pay.clientname||'').trim()
        if(!name){errors.push(`Payment ${pay.id}: client name missing`);continue}
        const cust=await ensureCustomer(base,accessToken,name,customerCache)
        const amount=Number(pay.amount||0)
        if(!Number.isFinite(amount)||amount<=0){errors.push(`Payment ${pay.id}: amount is invalid`);continue}
        const payload:any={TotalAmt:amount,CustomerRef:{value:String(cust.Id),name:cust.DisplayName||name},PrivateNote:`TaxRes CRM payment ${pay.id}`}
        const txnDate=String(pay.scheduled_date||pay.date||'').slice(0,10)
        if(/^\d{4}-\d{2}-\d{2}$/.test(txnDate)) payload.TxnDate=txnDate
        const {res,data}=await qboFetch(`${base}/payment?minorversion=75`,accessToken,{method:'POST',body:JSON.stringify(payload)})
        if(!res.ok){errors.push(`Payment ${pay.id}: ${data?.Fault?.Error?.[0]?.Message||res.status}`);continue}
        const qbId=data?.Payment?.Id
        if(!qbId){errors.push(`Payment ${pay.id}: QuickBooks ID missing`);continue}
        await admin.from('payments').update({qb_synced_at:new Date().toISOString(),qb_id:String(qbId)}).eq('id',pay.id).eq('tenant_id',tenantId).is('qb_synced_at',null)
        syncedPayments++
      }catch(e){errors.push(`Payment ${pay.id}: ${e instanceof Error?e.message:String(e)}`)}
    }

    const result={ok:errors.length===0,synced_invoices:syncedInvoices,synced_payments:syncedPayments,skipped_historical_imports:historicalSkipped,errors}
    await admin.from('accounting_connections').update({status:errors.length?'connected':'connected',external_company_name:companyName,last_synced_at:new Date().toISOString(),last_sync_result:result}).eq('id',conn.id)
    return json(result)
  }catch(e){
    console.error('[quickbooks-sync]',e)
    return json({error:e instanceof Error?e.message:String(e)},500)
  }
})