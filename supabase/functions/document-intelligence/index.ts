import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'
import JSZip from 'https://esm.sh/jszip@3.10.1'

const CORS={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
}
const SOURCE_PROJECT='mpxgxfqdbquzkrvvejkh'
const AI_CORE_URL='https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/tax-document-ai-core'
const MAX_FILE_BYTES=20*1024*1024
const MAX_EXTRACTED_CHARS=180000
const MAX_IMAGES=12

function jsonResponse(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{...CORS,'Content-Type':'application/json'}})
}
function clamp(n:unknown){
  const v=Number(n)
  return Number.isFinite(v)?Math.max(0,Math.min(1,v)):null
}
function maskDigits(value:string){
  const digits=value.replace(/\D/g,'')
  return digits.length<=4?digits:'••••'+digits.slice(-4)
}
function redactText(input:unknown){
  let text=String(input??'')
  text=text.replace(/\b(\d{3})[- ]?(\d{2})[- ]?(\d{4})\b/g,(_m,_a,_b,last4)=>'***-**-'+last4)
  text=text.replace(/\b(\d{2})[- ]?(\d{7})\b/g,(_m,_a,rest)=>'**-***'+String(rest).slice(-4))
  return text
}
function sanitizeValue(value:unknown,key=''):unknown{
  const sensitive=/(ssn|ein|tin|taxpayer.*id|routing|account.*(number|no|id)|bank.*(number|no|id))/i.test(key)
  if(value==null)return value
  if(sensitive&&(typeof value==='string'||typeof value==='number'))return maskDigits(String(value))
  if(typeof value==='string')return redactText(value)
  if(typeof value==='number'||typeof value==='boolean')return value
  if(Array.isArray(value))return value.map(v=>sanitizeValue(v,key))
  if(typeof value==='object'){
    const out:Record<string,unknown>={}
    for(const[k,v]of Object.entries(value as Record<string,unknown>))out[k]=sanitizeValue(v,k)
    return out
  }
  return redactText(value)
}
function sanitizeIdentifiers(value:unknown){
  const src=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
  const out:Record<string,string>={}
  for(const[k,v]of Object.entries(src)){
    if(v==null)continue
    const d=String(v).replace(/\D/g,'')
    if(d)out[k.toLowerCase().includes('last4')?k:k+'_last4']=d.slice(-4)
  }
  return out
}
function stripXml(xml:string){
  return xml.replace(/<w:tab\s*\/>/g,'\t').replace(/<w:br\s*\/>/g,'\n').replace(/<a:br\s*\/>/g,'\n')
    .replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim()
}
function decodeText(bytes:Uint8Array){return new TextDecoder('utf-8',{fatal:false}).decode(bytes).slice(0,MAX_EXTRACTED_CHARS)}
async function extractOfficeText(bytes:Uint8Array,ext:string){
  if(['xlsx','xlsm','xls'].includes(ext)){
    const workbook=XLSX.read(bytes,{type:'array',dense:true,cellDates:true})
    const chunks:string[]=[]
    for(const sheetName of workbook.SheetNames.slice(0,25)){
      const csv=XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName],{blankrows:false})
      chunks.push('--- SHEET: '+sheetName+' ---\n'+csv)
      if(chunks.join('\n').length>MAX_EXTRACTED_CHARS)break
    }
    return chunks.join('\n').slice(0,MAX_EXTRACTED_CHARS)
  }
  if(ext==='docx'||ext==='pptx'){
    const zip=await JSZip.loadAsync(bytes)
    const names=Object.keys(zip.files).filter(name=>ext==='docx'
      ?name==='word/document.xml'||/^word\/header\d+\.xml$/.test(name)||/^word\/footer\d+\.xml$/.test(name)
      :/^ppt\/slides\/slide\d+\.xml$/.test(name)).sort()
    const chunks:string[]=[]
    for(const name of names.slice(0,200)){
      const xml=await zip.file(name)?.async('string')
      if(!xml)continue
      chunks.push('--- '+name+' ---\n'+stripXml(xml))
      if(chunks.join('\n').length>MAX_EXTRACTED_CHARS)break
    }
    return chunks.join('\n').slice(0,MAX_EXTRACTED_CHARS)
  }
  return decodeText(bytes)
}
function toBase64(bytes:Uint8Array){
  let binary=''
  const chunk=0x8000
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk))
  return btoa(binary)
}
function normalizeFact(f:any,index:number){
  if(f==null)return null
  if(typeof f!=='object')return {category:'other',field_key:'finding_'+(index+1),field_label:'Finding '+(index+1),value:String(f),normalized_text:redactText(f),source_page:null,source_locator:null,source_excerpt:null,confidence:null}
  return {
    category:String(f.category||'other').slice(0,80),
    field_key:String(f.field_key||('finding_'+(index+1))).slice(0,120),
    field_label:f.field_label==null?null:redactText(f.field_label).slice(0,180),
    value:f.value??null,
    normalized_text:f.normalized_text==null?null:redactText(f.normalized_text).slice(0,1000),
    source_page:Number.isInteger(f.source_page)&&f.source_page>0?f.source_page:null,
    source_locator:f.source_locator==null?null:redactText(f.source_locator).slice(0,240),
    source_excerpt:f.source_excerpt==null?null:redactText(f.source_excerpt).slice(0,500),
    confidence:clamp(f.confidence),
  }
}
function normalizeEntity(e:any,index:number){
  if(e==null)return null
  if(typeof e!=='object')return {entity_type:'other',display_name:redactText(e).slice(0,240),relationship:null,identifiers:{},attributes:{},source_page:null,source_locator:null,confidence:null}
  return {
    entity_type:String(e.entity_type||'other').slice(0,80),
    display_name:redactText(e.display_name||('Entity '+(index+1))).slice(0,240),
    relationship:e.relationship==null?null:redactText(e.relationship).slice(0,240),
    identifiers:sanitizeIdentifiers(e.identifiers),
    attributes:sanitizeValue(e.attributes&&typeof e.attributes==='object'?e.attributes:{},'attributes'),
    source_page:Number.isInteger(e.source_page)&&e.source_page>0?e.source_page:null,
    source_locator:e.source_locator==null?null:redactText(e.source_locator).slice(0,240),
    confidence:clamp(e.confidence),
  }
}
function normalizeQuestion(q:any){
  if(q==null)return null
  if(typeof q!=='object')return {question:redactText(q).trim().slice(0,1000),reason:null,priority:'normal'}
  const priority=['low','normal','high','urgent'].includes(String(q.priority))?String(q.priority):'normal'
  return {question:redactText(q.question||'').trim().slice(0,1000),reason:q.reason==null?null:redactText(q.reason).slice(0,1000),priority}
}

serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS})
  if(req.method!=='POST')return jsonResponse({error:'method_not_allowed'},405)
  const authHeader=req.headers.get('Authorization')||''
  if(!authHeader.startsWith('Bearer '))return jsonResponse({error:'unauthorized'},401)

  const supabaseUrl=Deno.env.get('SUPABASE_URL')!
  const anonKey=Deno.env.get('SUPABASE_ANON_KEY')!
  const userClient=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authHeader}}})

  try{
    const body=await req.json().catch(()=>({}))
    const documentId=body?.documentId
    const requestedClientId=body?.clientId
    const providedText=String(body?.extractedText||'').slice(0,MAX_EXTRACTED_CHARS)
    const providedImages=Array.isArray(body?.pageImages)?body.pageImages.slice(0,MAX_IMAGES):[]
    if(!documentId)return jsonResponse({error:'documentId required'},400)

    const{data:userData,error:userErr}=await userClient.auth.getUser()
    if(userErr||!userData?.user)return jsonResponse({error:'unauthorized'},401)

    const{data:doc,error:docErr}=await userClient.from('documents')
      .select('id,tenant_id,client_id,client,clientname,docType,name,file_name,file_url,storage_path')
      .eq('id',documentId).maybeSingle()
    if(docErr||!doc)return jsonResponse({error:'document_not_found'},404)
    const tenantId=doc.tenant_id
    if(!tenantId)return jsonResponse({error:'document_has_no_tenant'},400)

    let effectiveClientId=doc.client_id||null
    if(requestedClientId){
      const{data:requestedClient,error:clientErr}=await userClient.from('clients').select('id,name').eq('id',requestedClientId).maybeSingle()
      if(clientErr||!requestedClient)return jsonResponse({error:'client_not_found'},404)
      if(effectiveClientId&&String(effectiveClientId)!==String(requestedClient.id))return jsonResponse({error:'document_client_mismatch'},403)
      if(!effectiveClientId){
        const legacy=String(doc.client||doc.clientname||'').trim().toLowerCase()
        if(!legacy||legacy!==String(requestedClient.name||'').trim().toLowerCase())return jsonResponse({error:'document_not_linked_to_client'},400)
        effectiveClientId=requestedClient.id
      }
    }
    if(!effectiveClientId)return jsonResponse({error:'document_not_linked_to_client'},400)

    const storagePath=doc.storage_path||(String(doc.file_url||'').startsWith('storage://documents/')?String(doc.file_url).replace('storage://documents/',''):'')
    if(!storagePath)return jsonResponse({error:'document_has_no_storage_path'},400)

    const{data:run,error:runErr}=await userClient.from('document_ai_runs').insert({
      tenant_id:tenantId,client_id:effectiveClientId,document_id:doc.id,status:'processing',vertical:'tax',started_at:new Date().toISOString()
    }).select('id').single()
    if(runErr||!run)return jsonResponse({error:runErr?.message||'could_not_start_run'},500)

    try{
      const{data:fileData,error:downloadErr}=await userClient.storage.from('documents').download(storagePath)
      if(downloadErr||!fileData)throw new Error(downloadErr?.message||'document_download_failed')
      const bytes=new Uint8Array(await fileData.arrayBuffer())
      if(!bytes.length)throw new Error('Document is empty')
      if(bytes.length>MAX_FILE_BYTES)throw new Error('Document exceeds 20 MB AI analysis limit')

      const filename=String(doc.file_name||doc.name||'document')
      const ext=filename.toLowerCase().split('.').pop()||''
      const blobType=String(fileData.type||'')
      let text=providedText
      let images=providedImages.filter((x:any)=>x&&typeof x.data==='string'&&/^image\/(jpeg|png|webp)$/.test(String(x.mediaType||''))).slice(0,MAX_IMAGES)

      if(!text&&!images.length){
        if(['jpg','jpeg','png','webp'].includes(ext)||['image/jpeg','image/png','image/webp'].includes(blobType)){
          const media=blobType&&blobType!=='application/octet-stream'?blobType:(ext==='png'?'image/png':ext==='webp'?'image/webp':'image/jpeg')
          images=[{mediaType:media,data:toBase64(bytes),page:1}]
        }else if(['csv','txt','json','xml','rtf','xlsx','xlsm','xls','docx','pptx'].includes(ext)){
          text=await extractOfficeText(bytes,ext)
        }else if(ext==='pdf'||blobType==='application/pdf'){
          throw new Error('PDF text/image extraction was not supplied by the CRM client')
        }else{
          throw new Error('Unsupported AI file type')
        }
      }

      const coreRes=await fetch(AI_CORE_URL,{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':authHeader},
        body:JSON.stringify({
          sourceProject:SOURCE_PROJECT,
          text,
          images,
          context:'client='+redactText(doc.client||doc.clientname||'unknown')+'; folder='+redactText(doc.docType||'unknown')+'; filename='+redactText(filename),
        }),
      })
      const coreBody=await coreRes.json().catch(()=>({}))
      if(!coreRes.ok||!coreBody?.ok)throw new Error(coreBody?.error||('AI core error '+coreRes.status))
      const parsed=coreBody.result||{}
      const facts=(Array.isArray(parsed.facts)?parsed.facts:[]).map(normalizeFact).filter(Boolean)
      const entities=(Array.isArray(parsed.entities)?parsed.entities:[]).map(normalizeEntity).filter(Boolean)
      const questions=(Array.isArray(parsed.questions)?parsed.questions:[]).map(normalizeQuestion).filter((q:any)=>q?.question)

      if(facts.length){
        const rows=facts.map((f:any)=>({
          tenant_id:tenantId,run_id:run.id,client_id:effectiveClientId,document_id:doc.id,
          category:f.category,field_key:f.field_key,field_label:f.field_label,
          value_json:sanitizeValue(f.value,String(f.field_key||'')),normalized_text:f.normalized_text,
          source_page:f.source_page,source_locator:f.source_locator,source_excerpt:f.source_excerpt,confidence:f.confidence,
        }))
        const{error}=await userClient.from('document_ai_facts').insert(rows);if(error)throw error
      }
      if(entities.length){
        const rows=entities.map((e:any)=>({tenant_id:tenantId,run_id:run.id,client_id:effectiveClientId,document_id:doc.id,...e}))
        const{error}=await userClient.from('document_ai_entities').insert(rows);if(error)throw error
      }
      if(questions.length){
        const rows=questions.map((q:any)=>({tenant_id:tenantId,client_id:effectiveClientId,run_id:run.id,document_id:doc.id,...q}))
        const{error}=await userClient.from('document_ai_questions').insert(rows);if(error)throw error
      }

      const safeSummary=parsed.summary?redactText(parsed.summary).slice(0,2000):null
      const safeType=parsed.document_type?redactText(parsed.document_type).slice(0,160):null
      const taxYear=Number.isInteger(parsed.tax_year)?parsed.tax_year:null
      const{error:finishErr}=await userClient.from('document_ai_runs').update({
        status:'complete',document_type:safeType,tax_year:taxYear,summary:safeSummary,confidence:clamp(parsed.confidence),
        model:String(coreBody.model||'tax-document-ai-core').slice(0,160),completed_at:new Date().toISOString(),updated_at:new Date().toISOString()
      }).eq('id',run.id)
      if(finishErr)throw finishErr
      return jsonResponse({ok:true,runId:run.id,documentType:safeType,taxYear,summary:safeSummary,counts:{facts:facts.length,entities:entities.length,questions:questions.length}})
    }catch(inner:any){
      await userClient.from('document_ai_runs').update({status:'failed',error_message:redactText(inner?.message||inner).slice(0,1000),completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',run.id)
      throw inner
    }
  }catch(err:any){
    console.error('document-intelligence',err)
    return jsonResponse({error:redactText(err?.message||err)},500)
  }
})
