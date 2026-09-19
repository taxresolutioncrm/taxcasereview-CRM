// formacorp-bizee
// Server-side adapter for Bizee's partner/distribution API.
// IMPORTANT: This function deliberately does not invent undocumented Bizee endpoint paths.
// Configure the exact Bizee-provided base URL and paths only after partner onboarding.
//
// Required configuration once Bizee approves the integration and confirms
// there is no additional API/integration fee:
//   BIZEE_PARTNER_API_BASE_URL
//   BIZEE_PARTNER_API_TOKEN
//   BIZEE_PARTNER_CREATE_PATH
//   BIZEE_PARTNER_STATUS_PATH
//   BIZEE_PARTNER_DOCUMENTS_PATH
//   BIZEE_PARTNER_AUTH_HEADER
//   BIZEE_PARTNER_AUTH_SCHEME
//   BIZEE_PARTNER_ORDER_ID_FIELD
//   BIZEE_PARTNER_STATUS_FIELD
//   BIZEE_PARTNER_CREATE_FIELD_MAP_JSON
//   BIZEE_PARTNER_DOCUMENTS_ARRAY_FIELD
//   BIZEE_PARTNER_DOCUMENT_URL_FIELD
//   BIZEE_PARTNER_DOCUMENT_ID_FIELD
//   BIZEE_PARTNER_DOCUMENT_NAME_FIELD
//   BIZEE_PARTNER_DOCUMENT_TYPE_FIELD
//   BIZEE_PARTNER_WEBHOOK_SECRET_HEADER
//   BIZEE_PARTNER_WEBHOOK_ORDER_ID_FIELD
//   BIZEE_PARTNER_WEBHOOK_EVENT_ID_FIELD
//   BIZEE_PARTNER_WEBHOOK_EVENT_TYPE_FIELD
//   BIZEE_PARTNER_WEBHOOK_STATUS_FIELD
//   BIZEE_PARTNER_STATUS_MAP_JSON
//   BIZEE_PARTNER_NO_ADDITIONAL_API_FEE_CONFIRMED=true
//
// Optional provider-contract values:
//   BIZEE_PARTNER_CREATE_STATIC_JSON
//   BIZEE_PARTNER_REQUIRED_CANONICAL_FIELDS_JSON
//   BIZEE_PARTNER_STATUS_MAP_JSON          {"provider_status":"CRM status"}
//   BIZEE_PARTNER_TENANT_TOKENS_JSON       {"<tenant_uuid>":"token"}
//   BIZEE_PARTNER_TENANT_STATIC_JSON       {"<tenant_uuid>":{...provider static fields...}}
//
// Optional:
//   BIZEE_PARTNER_TIMEOUT_MS (default 20000)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}
})
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function cfg(){
  const base=(Deno.env.get('BIZEE_PARTNER_API_BASE_URL')||'').replace(/\/$/,'')
  const token=Deno.env.get('BIZEE_PARTNER_API_TOKEN')||''
  const createPath=Deno.env.get('BIZEE_PARTNER_CREATE_PATH')||''
  const statusPath=Deno.env.get('BIZEE_PARTNER_STATUS_PATH')||''
  const documentsPath=Deno.env.get('BIZEE_PARTNER_DOCUMENTS_PATH')||''
  const authHeader=(Deno.env.get('BIZEE_PARTNER_AUTH_HEADER')||'').trim()
  const authScheme=(Deno.env.get('BIZEE_PARTNER_AUTH_SCHEME')||'').trim()
  const orderIdField=(Deno.env.get('BIZEE_PARTNER_ORDER_ID_FIELD')||'').trim()
  const statusField=(Deno.env.get('BIZEE_PARTNER_STATUS_FIELD')||'').trim()
  const createFieldMapJson=(Deno.env.get('BIZEE_PARTNER_CREATE_FIELD_MAP_JSON')||'').trim()
  const documentsArrayField=(Deno.env.get('BIZEE_PARTNER_DOCUMENTS_ARRAY_FIELD')||'').trim()
  const documentUrlField=(Deno.env.get('BIZEE_PARTNER_DOCUMENT_URL_FIELD')||'').trim()
  const documentIdField=(Deno.env.get('BIZEE_PARTNER_DOCUMENT_ID_FIELD')||'').trim()
  const documentNameField=(Deno.env.get('BIZEE_PARTNER_DOCUMENT_NAME_FIELD')||'').trim()
  const documentTypeField=(Deno.env.get('BIZEE_PARTNER_DOCUMENT_TYPE_FIELD')||'').trim()
  const webhookSecret=(Deno.env.get('BIZEE_PARTNER_WEBHOOK_SECRET')||'').trim()
  const webhookSecretHeader=(Deno.env.get('BIZEE_PARTNER_WEBHOOK_SECRET_HEADER')||'').trim()
  const webhookOrderIdField=(Deno.env.get('BIZEE_PARTNER_WEBHOOK_ORDER_ID_FIELD')||'').trim()
  const webhookEventIdField=(Deno.env.get('BIZEE_PARTNER_WEBHOOK_EVENT_ID_FIELD')||'').trim()
  const webhookEventTypeField=(Deno.env.get('BIZEE_PARTNER_WEBHOOK_EVENT_TYPE_FIELD')||'').trim()
  const webhookStatusField=(Deno.env.get('BIZEE_PARTNER_WEBHOOK_STATUS_FIELD')||'').trim()
  const noAdditionalApiFeeConfirmed=(Deno.env.get('BIZEE_PARTNER_NO_ADDITIONAL_API_FEE_CONFIRMED')||'').trim().toLowerCase()==='true'
  const createStaticJson=(Deno.env.get('BIZEE_PARTNER_CREATE_STATIC_JSON')||'{}').trim()
  const requiredCanonicalJson=(Deno.env.get('BIZEE_PARTNER_REQUIRED_CANONICAL_FIELDS_JSON')||'[]').trim()
  const statusMapJson=(Deno.env.get('BIZEE_PARTNER_STATUS_MAP_JSON')||'{}').trim()
  const tenantTokensJson=(Deno.env.get('BIZEE_PARTNER_TENANT_TOKENS_JSON')||'{}').trim()
  const tenantWebhookSecretsJson=(Deno.env.get('BIZEE_PARTNER_TENANT_WEBHOOK_SECRETS_JSON')||'{}').trim()
  const tenantStaticJson=(Deno.env.get('BIZEE_PARTNER_TENANT_STATIC_JSON')||'{}').trim()
  const timeout=Math.max(3000,Math.min(60000,Number(Deno.env.get('BIZEE_PARTNER_TIMEOUT_MS')||20000)))
  return {base,token,createPath,statusPath,documentsPath,authHeader,authScheme,orderIdField,statusField,createFieldMapJson,documentsArrayField,documentUrlField,documentIdField,documentNameField,documentTypeField,webhookSecret,webhookSecretHeader,webhookOrderIdField,webhookEventIdField,webhookEventTypeField,webhookStatusField,noAdditionalApiFeeConfirmed,createStaticJson,requiredCanonicalJson,statusMapJson,tenantTokensJson,tenantWebhookSecretsJson,tenantStaticJson,timeout}
}

function configErrors(c:ReturnType<typeof cfg>,token:string,webhookSecret:string){
  const errors:string[]=[]
  if(!c.base) errors.push('BIZEE_PARTNER_API_BASE_URL')
  else if(!/^https:\/\//i.test(c.base)) errors.push('BIZEE_PARTNER_API_BASE_URL must use HTTPS')
  if(!token) errors.push('BIZEE_PARTNER_API_TOKEN or BIZEE_PARTNER_TENANT_TOKENS_JSON')
  if(!c.createPath) errors.push('BIZEE_PARTNER_CREATE_PATH')
  else if(!c.createPath.startsWith('/')) errors.push('BIZEE_PARTNER_CREATE_PATH must start with /')
  if(!c.statusPath) errors.push('BIZEE_PARTNER_STATUS_PATH')
  else if(!c.statusPath.startsWith('/')||(!c.statusPath.includes('{order_id}')&&!c.statusPath.includes('{id}'))) errors.push('BIZEE_PARTNER_STATUS_PATH must start with / and include {order_id} or {id}')
  if(!c.documentsPath) errors.push('BIZEE_PARTNER_DOCUMENTS_PATH')
  else if(!c.documentsPath.startsWith('/')||(!c.documentsPath.includes('{order_id}')&&!c.documentsPath.includes('{id}'))) errors.push('BIZEE_PARTNER_DOCUMENTS_PATH must start with / and include {order_id} or {id}')
  if(!c.authHeader) errors.push('BIZEE_PARTNER_AUTH_HEADER')
  else if(!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(c.authHeader)) errors.push('BIZEE_PARTNER_AUTH_HEADER is invalid')
  if(!c.orderIdField) errors.push('BIZEE_PARTNER_ORDER_ID_FIELD')
  if(!c.statusField) errors.push('BIZEE_PARTNER_STATUS_FIELD')
  if(!c.noAdditionalApiFeeConfirmed) errors.push('BIZEE_PARTNER_NO_ADDITIONAL_API_FEE_CONFIRMED must be true')
  if(!webhookSecret) errors.push('BIZEE_PARTNER_WEBHOOK_SECRET or BIZEE_PARTNER_TENANT_WEBHOOK_SECRETS_JSON')
  if(!c.webhookSecretHeader) errors.push('BIZEE_PARTNER_WEBHOOK_SECRET_HEADER')
  if(!c.webhookOrderIdField) errors.push('BIZEE_PARTNER_WEBHOOK_ORDER_ID_FIELD')
  if(!c.webhookEventIdField) errors.push('BIZEE_PARTNER_WEBHOOK_EVENT_ID_FIELD')
  if(!c.webhookEventTypeField) errors.push('BIZEE_PARTNER_WEBHOOK_EVENT_TYPE_FIELD')
  if(!c.webhookStatusField) errors.push('BIZEE_PARTNER_WEBHOOK_STATUS_FIELD')
  if(!c.createFieldMapJson) errors.push('BIZEE_PARTNER_CREATE_FIELD_MAP_JSON')
  if(!c.documentsArrayField) errors.push('BIZEE_PARTNER_DOCUMENTS_ARRAY_FIELD')
  if(!c.documentUrlField) errors.push('BIZEE_PARTNER_DOCUMENT_URL_FIELD')
  if(!c.documentIdField) errors.push('BIZEE_PARTNER_DOCUMENT_ID_FIELD')
  if(!c.documentNameField) errors.push('BIZEE_PARTNER_DOCUMENT_NAME_FIELD')
  if(!c.documentTypeField) errors.push('BIZEE_PARTNER_DOCUMENT_TYPE_FIELD')
  else {
    try{
      const map=parseObjectJson(c.createFieldMapJson,'BIZEE_PARTNER_CREATE_FIELD_MAP_JSON')
      if(!Object.keys(map).length) errors.push('BIZEE_PARTNER_CREATE_FIELD_MAP_JSON must not be empty')
    }catch(e:any){ errors.push(e?.message||'Invalid Bizee field map') }
  }
  try{ parseObjectJson(c.createStaticJson,'BIZEE_PARTNER_CREATE_STATIC_JSON') }catch(e:any){ errors.push(e?.message||'Invalid Bizee static JSON') }
  try{ parseArrayJson(c.requiredCanonicalJson,'BIZEE_PARTNER_REQUIRED_CANONICAL_FIELDS_JSON') }catch(e:any){ errors.push(e?.message||'Invalid Bizee required-fields JSON') }
  try{
    const map=parseObjectJson(c.statusMapJson,'BIZEE_PARTNER_STATUS_MAP_JSON')
    const allowed=new Set(['Draft','Ready to Submit','Filing Queue','Submitted to Florida','Under State Review','Action Required','Approved / Active'])
    for(const [providerStatus,crmStatus] of Object.entries(map)){
      if(!providerStatus||!allowed.has(String(crmStatus))) errors.push('BIZEE_PARTNER_STATUS_MAP_JSON contains an invalid CRM status')
    }
  }catch(e:any){ errors.push(e?.message||'Invalid Bizee status map JSON') }
  try{ parseObjectJson(c.tenantTokensJson,'BIZEE_PARTNER_TENANT_TOKENS_JSON') }catch(e:any){ errors.push(e?.message||'Invalid Bizee tenant token JSON') }
  try{ parseObjectJson(c.tenantWebhookSecretsJson,'BIZEE_PARTNER_TENANT_WEBHOOK_SECRETS_JSON') }catch(e:any){ errors.push(e?.message||'Invalid Bizee tenant webhook secrets JSON') }
  try{ parseObjectJson(c.tenantStaticJson,'BIZEE_PARTNER_TENANT_STATIC_JSON') }catch(e:any){ errors.push(e?.message||'Invalid Bizee tenant static JSON') }
  return errors
}

function configured(c:ReturnType<typeof cfg>,token:string,webhookSecret:string){
  return configErrors(c,token,webhookSecret).length===0
}

function readField(value:any,path:string){
  return path.split('.').filter(Boolean).reduce((cur,key)=>cur==null?undefined:cur[key],value)
}

function setField(target:any,path:string,value:any){
  const parts=path.split('.').filter(Boolean)
  if(!parts.length) throw new Error('Provider field map contains an empty destination path')
  let cur=target
  for(let i=0;i<parts.length-1;i++){
    const key=parts[i]
    if(!cur[key]||typeof cur[key]!=='object'||Array.isArray(cur[key])) cur[key]={}
    cur=cur[key]
  }
  cur[parts[parts.length-1]]=value
}

function parseObjectJson(raw:string,label:string){
  let value:any
  try{ value=JSON.parse(raw) }catch{ throw new Error(`${label} is not valid JSON`) }
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error(`${label} must be a JSON object`)
  return value
}

function parseArrayJson(raw:string,label:string){
  let value:any
  try{ value=JSON.parse(raw) }catch{ throw new Error(`${label} is not valid JSON`) }
  if(!Array.isArray(value)) throw new Error(`${label} must be a JSON array`)
  return value.map(v=>String(v)).filter(Boolean)
}

function crmStatusForProvider(c:ReturnType<typeof cfg>,providerStatus:string){
  if(!providerStatus) return ''
  const map=parseObjectJson(c.statusMapJson,'BIZEE_PARTNER_STATUS_MAP_JSON')
  return String(map[providerStatus]||'')
}

async function applyProviderStatusToCase(sb:any,cfgValue:ReturnType<typeof cfg>,caseRow:any,providerStatus:string){
  if(caseRow?.state!=='FL') return
  const crmStatus=crmStatusForProvider(cfgValue,providerStatus)
  if(!crmStatus) return
  const patch:any={fl_filing_status:crmStatus,stage:'State Filing'}
  const now=new Date().toISOString()
  if(crmStatus==='Submitted to Florida') patch.fl_submitted_at=caseRow.fl_submitted_at||now
  if(crmStatus==='Approved / Active'||crmStatus==='Action Required') patch.fl_decision_at=now
  await sb.from('formacorp').update(patch).eq('id',caseRow.id)
}

function tenantProviderConfig(c:ReturnType<typeof cfg>,tenantId:string){
  const tokens=parseObjectJson(c.tenantTokensJson,'BIZEE_PARTNER_TENANT_TOKENS_JSON')
  const webhookSecrets=parseObjectJson(c.tenantWebhookSecretsJson,'BIZEE_PARTNER_TENANT_WEBHOOK_SECRETS_JSON')
  const tenantStatic=parseObjectJson(c.tenantStaticJson,'BIZEE_PARTNER_TENANT_STATIC_JSON')
  const token=String(tokens[tenantId]||c.token||'')
  const webhookSecret=String(webhookSecrets[tenantId]||c.webhookSecret||'')
  const staticFields=tenantStatic[tenantId] && typeof tenantStatic[tenantId]==='object' && !Array.isArray(tenantStatic[tenantId])
    ? tenantStatic[tenantId]
    : {}
  return {token,webhookSecret,staticFields}
}

function canonicalFormation(caseRow:any){
  return {
    case_id:caseRow.id,
    entity:{
      name:caseRow.entity_name||'',
      type:caseRow.entity_type||'',
      state:caseRow.state||'',
      purpose:caseRow.business_purpose||'',
      effective_date:caseRow.effective_date||'',
    },
    client:{
      name:caseRow.client_name||'',
      email:caseRow.correspondence_email||'',
    },
    addresses:{
      principal:caseRow.principal_address||'',
      mailing:caseRow.mailing_address||'',
      registered_agent:caseRow.registered_agent_address||'',
    },
    registered_agent:{
      name:caseRow.registered_agent||'',
      accepted:!!caseRow.registered_agent_accepted,
      signature:caseRow.fl_registered_agent_signature||'',
    },
    signer:{
      name:caseRow.authorized_representative||'',
      title:caseRow.authorized_representative_title||'',
      signature:caseRow.fl_authorized_representative_signature||'',
      filing_authorized:!!caseRow.fl_filing_authorized,
    },
    owners:caseRow.owners||'',
    options:{
      certificate_of_status:!!caseRow.fl_certificate_of_status,
      certified_copy:!!caseRow.fl_certified_copy,
    },
  }
}

function buildProviderPayload(c:ReturnType<typeof cfg>,canonical:any,tenantStatic:any={}){
  const map=parseObjectJson(c.createFieldMapJson,'BIZEE_PARTNER_CREATE_FIELD_MAP_JSON')
  const staticValues={
    ...parseObjectJson(c.createStaticJson,'BIZEE_PARTNER_CREATE_STATIC_JSON'),
    ...(tenantStatic||{}),
  }
  const required=parseArrayJson(c.requiredCanonicalJson,'BIZEE_PARTNER_REQUIRED_CANONICAL_FIELDS_JSON')
  const missing=required.filter(path=>{
    const value=readField(canonical,path)
    return value===undefined||value===null||value===''||value===false
  })
  if(missing.length) throw new Error('Missing required Bizee intake fields: '+missing.join(', '))

  const payload:any=JSON.parse(JSON.stringify(staticValues))
  for(const [providerPath,canonicalPath] of Object.entries(map)){
    const value=readField(canonical,String(canonicalPath))
    if(value!==undefined&&value!==null&&value!=='') setField(payload,providerPath,value)
  }
  return payload
}

function pathWithId(path:string,id:string){
  return path.replaceAll('{order_id}',encodeURIComponent(id)).replaceAll('{id}',encodeURIComponent(id))
}

function safeFileName(value:string){
  const v=String(value||'document').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120)
  return v||'document'
}

async function fetchProviderDocument(c:ReturnType<typeof cfg>,token:string,urlValue:string){
  const raw=String(urlValue||'').trim()
  if(!raw) throw new Error('Bizee document URL is empty')
  const url=raw.startsWith('/') ? c.base+raw : raw
  if(!/^https:\/\//i.test(url)) throw new Error('Bizee document URL must use HTTPS')
  const sameProviderOrigin=(()=>{ try{return new URL(url).origin===new URL(c.base).origin}catch{return false} })()
  const headers:Record<string,string>={}
  if(sameProviderOrigin) headers[c.authHeader]=c.authScheme ? `${c.authScheme} ${token}` : token
  const res=await fetch(url,{headers})
  if(!res.ok) throw new Error(`Bizee document download failed (${res.status})`)
  const contentType=res.headers.get('content-type')||'application/octet-stream'
  const bytes=new Uint8Array(await res.arrayBuffer())
  return {bytes,contentType}
}

async function syncProviderDocuments(sb:any,cfgValue:ReturnType<typeof cfg>,token:string,tenantId:string,caseId:string,orderId:string,data:any){
  const list=readField(data,cfgValue.documentsArrayField)
  if(!Array.isArray(list)) throw new Error('Configured Bizee documents array field did not resolve to an array')

  const admin=createClient(
    Deno.env.get('SUPABASE_URL')||'',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',
    {auth:{persistSession:false}}
  )
  const synced:any[]=[]
  for(const item of list){
    const providerDocumentId=String(readField(item,cfgValue.documentIdField)||'').trim()
    const providerUrl=String(readField(item,cfgValue.documentUrlField)||'').trim()
    const providerName=String(readField(item,cfgValue.documentNameField)||providerDocumentId||'Bizee-document').trim()
    const providerType=String(readField(item,cfgValue.documentTypeField)||'Bizee Formation Document').trim()
    if(!providerDocumentId||!providerUrl) continue

    const {data:existing,error:existingErr}=await admin.from('formacorp_documents')
      .select('id,file_name,storage_path')
      .eq('tenant_id',tenantId)
      .eq('provider','bizee')
      .eq('provider_document_id',providerDocumentId)
      .maybeSingle()
    if(existingErr) throw existingErr
    if(existing){ synced.push({...existing,provider_document_id:providerDocumentId,existing:true}); continue }

    const downloaded=await fetchProviderDocument(cfgValue,token,providerUrl)
    const fileName=safeFileName(providerName)
    const storagePath=`formacorp/${caseId}/bizee/${safeFileName(providerDocumentId)}-${fileName}`
    const {error:uploadErr}=await admin.storage.from('documents').upload(storagePath,downloaded.bytes,{
      upsert:false,contentType:downloaded.contentType
    })
    if(uploadErr) throw uploadErr

    const {data:row,error:insertErr}=await admin.from('formacorp_documents').insert([{
      tenant_id:tenantId,
      case_id:caseId,
      document_type:providerType,
      file_name:fileName,
      storage_path:storagePath,
      source:'Bizee Pro',
      provider:'bizee',
      provider_document_id:providerDocumentId,
      provider_metadata:{order_id:orderId,provider_item:item},
    }]).select().single()
    if(insertErr) throw insertErr
    synced.push({...row,existing:false})
  }
  return synced
}

async function bizeeFetch(c:ReturnType<typeof cfg>, token:string, path:string, init:RequestInit={}){
  if(!path.startsWith('/')) throw new Error('Bizee endpoint path must start with /')
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),c.timeout)
  try{
    const res=await fetch(c.base+path,{
      ...init,
      signal:controller.signal,
      headers:{
        Accept:'application/json',
        'Content-Type':'application/json',
        [c.authHeader]: c.authScheme ? `${c.authScheme} ${token}` : token,
        ...(init.headers||{}),
      }
    })
    const text=await res.text()
    let data:any=null
    try{data=text?JSON.parse(text):null}catch{data={raw:text}}
    if(!res.ok) throw new Error(`Bizee API ${res.status}: ${data?.message||data?.error||res.statusText}`)
    return data
  } finally { clearTimeout(timer) }
}

serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  try{
    const auth=req.headers.get('authorization')||''
    if(!auth) return json({error:'Unauthorized'},401)

    const sb=createClient(
      Deno.env.get('SUPABASE_URL')||'',
      Deno.env.get('SUPABASE_ANON_KEY')||'',
      {global:{headers:{Authorization:auth}},auth:{persistSession:false}}
    )
    const {data:{user},error:userErr}=await sb.auth.getUser()
    if(userErr||!user) return json({error:'Unauthorized'},401)

    const body=await req.json().catch(()=>({}))
    const action=String(body.action||'capabilities')
    const c=cfg()

    const {data:tenantSettings,error:tenantErr}=await sb.from('settings').select('tenant_id').limit(1).maybeSingle()
    if(tenantErr||!tenantSettings?.tenant_id) return json({error:'CRM tenant could not be resolved.'},403)
    const tenantId=String(tenantSettings.tenant_id)
    const tenantCfg=tenantProviderConfig(c,tenantId)

    if(action==='capabilities'){
      return json({
        ok:true,
        provider:'bizee',
        configured:configured(c,tenantCfg.token,tenantCfg.webhookSecret),
        mode:'partner_api',
        missing:configErrors(c,tenantCfg.token,tenantCfg.webhookSecret)
      })
    }

    if(!configured(c,tenantCfg.token,tenantCfg.webhookSecret)) return json({error:'Bizee partner API is not configured for this CRM office.'},422)

    const caseId=String(body.case_id||'')
    if(!UUID_RE.test(caseId)) return json({error:'Valid case_id required'},400)

    const {data:caseRow,error:caseErr}=await sb.from('formacorp').select('*').eq('id',caseId).maybeSingle()
    if(caseErr||!caseRow) return json({error:'FormaCorp case not found'},404)

    if(action==='submit'){
      const {data:requestRow,error:reqErr}=await sb.from('formacorp_service_requests')
        .select('*').eq('case_id',caseId).eq('service_type','Bizee Pro Formation').order('requested_at',{ascending:false}).limit(1).maybeSingle()
      if(reqErr) throw reqErr
      if(!requestRow?.id) return json({error:'Bizee service request not found for this case.'},409)

      if(requestRow.provider_order_id){
        return json({
          ok:true,
          idempotent:true,
          order_id:String(requestRow.provider_order_id),
          status:requestRow.provider_status||requestRow.status||null,
          data:requestRow.provider_payload||null,
        })
      }

      if(requestRow.provider!=='bizee'){
        const {error:providerErr}=await sb.from('formacorp_service_requests').update({
          provider:'bizee',
          provider_status:requestRow.provider_status||'ready_for_provider_mapping',
          provider_error:null,
        }).eq('id',requestRow.id)
        if(providerErr) throw providerErr
      }

      const canonical=canonicalFormation(caseRow)
      const payload=buildProviderPayload(c,canonical,tenantCfg.staticFields)

      const data=await bizeeFetch(c,tenantCfg.token,c.createPath,{method:'POST',body:JSON.stringify(payload)})
      const orderId=String(readField(data,c.orderIdField)||'')
      const providerStatus=String(readField(data,c.statusField)||'')
      if(!orderId) return json({error:'Bizee response did not include the configured order identifier.',provider_response:data},502)

      if(requestRow?.id){
        const {error:updateErr}=await sb.from('formacorp_service_requests').update({
          provider_order_id:orderId,
          provider_status:providerStatus||'submitted',
          provider_payload:data,
          provider_last_synced_at:new Date().toISOString(),
          provider_error:null,
          status:'Submitted',
          submitted_at:new Date().toISOString(),
          submission_reference:orderId,
        }).eq('id',requestRow.id)
        if(updateErr) throw updateErr
      }

      return json({ok:true,order_id:orderId,status:providerStatus||null,data})
    }

    const orderId=String(body.order_id||'')
    if(!orderId) return json({error:'order_id required'},400)

    if(action==='status'){
      const data=await bizeeFetch(c,tenantCfg.token,pathWithId(c.statusPath,orderId),{method:'GET'})
      const providerStatus=String(readField(data,c.statusField)||'')
      await sb.from('formacorp_service_requests').update({
        provider_status:providerStatus,
        provider_payload:data,
        provider_last_synced_at:new Date().toISOString(),
        provider_error:null,
      }).eq('case_id',caseId).eq('provider','bizee').eq('provider_order_id',orderId)
      await applyProviderStatusToCase(sb,c,caseRow,providerStatus)
      return json({ok:true,status:providerStatus,data})
    }

    if(action==='documents'){
      const data=await bizeeFetch(c,tenantCfg.token,pathWithId(c.documentsPath,orderId),{method:'GET'})
      const documents=await syncProviderDocuments(sb,c,tenantCfg.token,tenantId,caseId,orderId,data)
      return json({ok:true,count:documents.length,documents})
    }

    return json({error:'Unsupported action'},400)
  }catch(err:any){
    console.error('formacorp-bizee error',err)
    return json({error:err?.message||'Bizee integration error'},500)
  }
})
