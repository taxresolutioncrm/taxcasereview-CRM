import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { transform } from 'esbuild'
import { webcrypto } from 'node:crypto'

if (!globalThis.crypto) globalThis.crypto = webcrypto

const root=process.cwd()
const tenant='tenant-e2e'
const user={id:'user-e2e',email:'qa-irs@taxrescrm.test'}
const employee={tenant_id:tenant,perm_irs:3,email:user.email,caf:'123456789',caf_number:'123456789'}
const client={id:'client-e2e',tenant_id:tenant,name:'Claude Edge E2E',ssn:'123-45-6789',ein:null}
const poa={id:'poa-e2e',tenant_id:tenant,status:'On File',form_type:'2848',tax_years:'2024',client_id:client.id}
const pull={
  id:'pull-e2e',tenant_id:tenant,client_id:client.id,client_name:client.name,
  transcript_types:['Account Transcript','Wage and Income'],tax_years:'2024',
  provider:'irs_a2a',status:'Requested',poa_record_id:poa.id,requested_by:'QA IRS Admin',
  provider_result_keys:[],provider_file_paths:[],provider_filed_keys:[],
}
const state={session:null,pull:{...pull},stored:new Map()}

function rowFor(table){
  if(table==='irs_tds_sessions') return state.session ? [state.session] : []
  if(table==='employees') return [employee]
  if(table==='transcript_pull_requests') return [state.pull]
  if(table==='poa_records') return [poa]
  if(table==='clients') return [client]
  if(table==='settings') return [{tenant_id:tenant,caf_number:'123456789'}]
  return []
}

class Query {
  constructor(table){this.table=table;this.filters=[];this.patch=null;this.mode='select'}
  select(){this.mode=this.mode==='update'?'update-select':'select';return this}
  eq(k,v){this.filters.push([k,String(v).toLowerCase()]);return this}
  ilike(k,v){this.filters.push([k,String(v).toLowerCase()]);return this}
  limit(){return this}
  matches(r){return this.filters.every(([k,v])=>String(r?.[k]??'').toLowerCase()===v)}
  rows(){return rowFor(this.table).filter(r=>this.matches(r))}
  async maybeSingle(){
    if(this.mode.startsWith('update')) {
      const rows=this.rows()
      if(rows.length){
        Object.assign(rows[0],this.patch)
        if(this.table==='irs_tds_sessions') state.session=rows[0]
        if(this.table==='transcript_pull_requests') state.pull=rows[0]
      }
      return {data:rows[0]||null,error:null}
    }
    const rows=this.rows()
    return {data:rows[0]||null,error:null}
  }
  async single(){return this.maybeSingle()}
  update(p){this.mode='update';this.patch=p;return this}
  async upsert(p){
    if(this.table==='irs_tds_sessions'){
      state.session={...(state.session||{}),id:state.session?.id||'session-e2e',...p}
      return {data:state.session,error:null}
    }
    return {data:p,error:null}
  }
  then(resolve,reject){
    const run=async()=>{
      if(this.mode==='update'){
        const rows=this.rows()
        rows.forEach(r=>Object.assign(r,this.patch))
        if(this.table==='transcript_pull_requests' && rows.length) state.pull=rows[0]
        if(this.table==='irs_tds_sessions' && rows.length) state.session=rows[0]
        return {data:rows,error:null}
      }
      return {data:this.rows(),error:null}
    }
    return run().then(resolve,reject)
  }
}
function dbClient(){
  return {
    auth:{getUser:async()=>({data:{user},error:null})},
    rpc:async(name)=>name==='current_tenant_id'?{data:tenant,error:null}:{data:null,error:null},
    from:(table)=>new Query(table),
    storage:{from:()=>({
      upload:async(filePath,bytes)=>{state.stored.set(filePath,new Uint8Array(bytes));return {data:{path:filePath},error:null}},
      createSignedUrl:async(filePath)=>({data:{signedUrl:'https://sandbox.invalid/'+encodeURIComponent(filePath)},error:null}),
    })},
  }
}

async function load(rel,env){
  const src=fs.readFileSync(path.join(root,rel),'utf8')
  const code=(await transform(src,{loader:'ts',format:'cjs',target:'es2022',sourcefile:rel})).code
  let handler=null
  const stubs={
    'https://deno.land/std@0.168.0/http/server.ts':{serve:h=>{handler=h}},
    'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>dbClient()},
  }
  const req=id=>{if(stubs[id])return stubs[id];throw new Error('unexpected import '+id)}
  const Deno={env:{get:k=>env[k]}}
  const module={exports:{}}
  new vm.Script('(function(exports,require,module,Deno){'+code+'\n})',{filename:rel}).runInThisContext()(module.exports,req,module,Deno)
  if(typeof handler!=='function')throw new Error(rel+' did not register handler')
  return handler
}

const common={
  IRS_TDS_STUB_MODE:'1',
  IRS_TDS_CLIENT_ID:'stub-client',
  IRS_TDS_JWT_KID:'stub-kid',
  IRS_TDS_JWT_PRIVATE_KEY_PEM:'stub-not-used',
  IRS_TDS_REDIRECT_URI:'https://project.supabase.co/functions/v1/transcript-pull-callback',
  IRS_TDS_REQUEST_URL:'https://stub.invalid/request',
  IRS_TDS_REQUEST_TEMPLATE:'{}',
  IRS_TDS_STATUS_URL_TEMPLATE:'https://stub.invalid/status/{{providerRequestId}}',
  SUPABASE_URL:'https://project.supabase.co',
  SUPABASE_ANON_KEY:'anon',
  SUPABASE_SERVICE_ROLE_KEY:'service-role-test-only',
  IRS_TDS_CRM_ORIGIN:'https://sandbox.taxrescrm.test',
}
const pullHandler=await load('validation/nashville-claude/supabase/functions/transcript-pull/index.ts',common)
const callbackHandler=await load('validation/nashville-claude/supabase/functions/transcript-pull-callback/index.ts',common)
const auth={'Authorization':'Bearer sandbox-user-jwt','Content-Type':'application/json'}
const invoke=async body=>{
  const r=await pullHandler(new Request('https://project.supabase.co/functions/v1/transcript-pull',{method:'POST',headers:auth,body:JSON.stringify(body)}))
  const data=await r.json()
  if(!r.ok)throw new Error('pull '+body.action+' '+r.status+': '+JSON.stringify(data))
  return data
}

let caps=await invoke({action:'capabilities'})
if(!caps.authorizationConfigured||!caps.transcriptContractConfigured||!caps.apiFlowVerified||caps.sessionActive)throw new Error('initial stub capabilities mismatch')

const begin=await invoke({action:'begin-session'})
if(!begin.stub||!begin.authorizationUrl||!state.session?.state)throw new Error('stub begin-session did not create state')
const au=new URL(begin.authorizationUrl)
const cb=await callbackHandler(new Request('https://project.supabase.co/functions/v1/transcript-pull-callback?state='+encodeURIComponent(au.searchParams.get('state')||'')+'&code='+encodeURIComponent(au.searchParams.get('code')||'')))
const cbText=await cb.text()
if(!cb.ok||!cbText.includes('IRS TDS connected (Sandbox)'))throw new Error('stub callback did not establish session: '+cb.status)
if(!state.session?.access_token_ciphertext||!state.session?.refresh_token_ciphertext)throw new Error('stub callback did not persist encrypted tokens')

caps=await invoke({action:'capabilities'})
if(!caps.sessionActive)throw new Error('stub session did not become active after callback')

const submitted=await invoke({action:'submit',requestId:pull.id})
if(!String(submitted.providerRequestId||'').startsWith('stub-txn-'))throw new Error('stub submit did not return transaction id')
if(state.pull.provider_status!=='Submitted'||state.pull.status!=='In Progress')throw new Error('stub submit did not persist request state')

const first=await invoke({action:'status',requestId:pull.id})
if(first.status!=='Delivered'||!first.resultKey||!first.filePath||!first.signedUrl)throw new Error('first stub result was not delivered')
if(state.stored.size!==1)throw new Error('first stub delivery did not store exactly one PDF')

state.pull.provider_filed_keys=[first.resultKey]
const second=await invoke({action:'status',requestId:pull.id})
if(second.status!=='Delivered'||!second.resultKey||second.resultKey===first.resultKey)throw new Error('second requested transcript result was not delivered distinctly')
if(state.stored.size!==2)throw new Error('multi-transcript stub coverage did not store two PDFs')

for(const [filePath,bytes] of state.stored){
  if(bytes.length<100||String.fromCharCode(...bytes.slice(0,5))!=='%PDF-')throw new Error('stored stub result is not a PDF: '+filePath)
}

console.log('PASS: Nashville Claude snapshot Edge lifecycle capabilities -> begin-session -> callback -> submit -> multi-result delivery')
