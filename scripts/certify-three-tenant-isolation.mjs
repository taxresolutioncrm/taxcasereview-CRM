import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const SUPABASE_URL = process.env.CERT_SUPABASE_URL
const ANON_KEY = process.env.CERT_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.CERT_SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('Missing production Supabase certification credentials')
  process.exit(2)
}

const TENANTS = [
  { id:'61a89aef-0e7e-4ea2-b222-44ab2024655a', code:'TRC-001', name:'Tax Case Review' },
  { id:'489ace07-1a6b-4864-833a-4f8420568b40', code:'TRC-002', name:'Nashville Tax Solutions' },
]
const TABLES = [
  { table:'clients', make:(tenant,run)=>({id:`${run}_${tenant.code}_client`,name:`QA Isolation ${tenant.code}`,email:`${run}.${tenant.code}.client@example.com`,phone:'0000000000',status:'Active',tenant_id:tenant.id,notes:`TEMP QA ISOLATION ${run}`}) },
  { table:'leads', make:(tenant,run)=>({id:`${run}_${tenant.code}_lead`,name:`QA Isolation ${tenant.code}`,email:`${run}.${tenant.code}.lead@example.com`,phone:'0000000000',status:'New Lead',tenant_id:tenant.id,notes:`TEMP QA ISOLATION ${run}`}) },
  { table:'tasks', make:(tenant,run)=>({id:`${run}_${tenant.code}_task`,title:`QA Isolation ${tenant.code}`,priority:'Normal',tenant_id:tenant.id,notes:`TEMP QA ISOLATION ${run}`}) },
  { table:'chat_messages', make:(tenant,run)=>({channel:'general',sender:`QA Isolation ${tenant.code}`,text:`[QA ISOLATION ${run}] ${tenant.code}`,tenant_id:tenant.id,source:'qa_isolation'}) },
]

const runId=process.env.CERT_ISOLATION_RUN_ID || `qa_iso_${Date.now()}_${Math.random().toString(36).slice(2,7)}`
const password=`QaIso!${Math.random().toString(36).slice(2)}A9#`
const admin=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const createdUsers=[]
const createdRows=[]
const sessions=[]
const checks=[]
let fatal=null

function userClient(){ return createClient(SUPABASE_URL,ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}) }
function assert(ok,label,detail=''){
  checks.push({label,ok,detail})
  if(!ok) throw new Error(`${label}${detail?`: ${detail}`:''}`)
}

async function provision(){
  for(const tenant of TENANTS){
    const email=`${runId}.${tenant.code.toLowerCase()}@example.com`
    const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{qa_isolation:true,qa_run:runId,tenant_id:tenant.id}})
    if(error) throw error
    createdUsers.push(data.user.id)
    const employeeId=`${runId}_${tenant.code}_employee`
    const row={id:employeeId,name:`QA Isolation ${tenant.name}`,email,status:'Active',tenant_id:tenant.id,access:'Super Admin',role:'Super Admin',title:'QA Isolation',team:'QA Certification',employee_id:employeeId,notes:`TEMP QA ISOLATION ${runId}`,perm_leads:3,perm_clients:3,perm_billing:3,perm_schedule:3,perm_documents:3,perm_irs:3,perm_comms:3,perm_reports:3,perm_hr:3,perm_settings:3}
    const ins=await admin.from('employees').insert(row)
    if(ins.error) throw new Error(`${tenant.code} employee seed: ${ins.error.message}`)
    createdRows.push({table:'employees',id:employeeId})
    const client=userClient()
    const login=await client.auth.signInWithPassword({email,password})
    if(login.error) throw new Error(`${tenant.code} login: ${login.error.message}`)
    sessions.push({tenant,client})
  }

  for(const def of TABLES){
    for(const tenant of TENANTS){
      const row=def.make(tenant,runId)
      const ins=await admin.from(def.table).insert(row).select('id').maybeSingle()
      if(ins.error) throw new Error(`${def.table}/${tenant.code} seed: ${ins.error.message}`)
      const id=ins.data?.id ?? row.id
      if(id) createdRows.push({table:def.table,id})
    }
  }
}

async function verify(){
  for(const {tenant,client} of sessions){
    const resolved=await client.rpc('current_tenant_id')
    assert(!resolved.error,`${tenant.code} current_tenant_id RPC`,resolved.error?.message||'')
    assert(resolved.data===tenant.id,`${tenant.code} resolves its own tenant`,String(resolved.data))

    for(const def of TABLES){
      const seeded=createdRows.filter(r=>r.table===def.table).map(r=>r.id).filter(Boolean)
      if(!seeded.length) continue
      const q=await client.from(def.table).select('id,tenant_id').in('id',seeded)
      assert(!q.error,`${tenant.code} ${def.table} read`,q.error?.message||'')
      const rows=Array.isArray(q.data)?q.data:[]
      const foreign=rows.filter(r=>r.tenant_id!==tenant.id)
      assert(foreign.length===0,`${tenant.code} ${def.table} zero foreign rows`,JSON.stringify(foreign))
      const own=rows.filter(r=>r.tenant_id===tenant.id)
      assert(own.length===1,`${tenant.code} ${def.table} own row visible`,`count=${own.length}`)
    }

    const foreignTenant=TENANTS.find(t=>t.id!==tenant.id)
    const foreignWrite={id:`${runId}_${tenant.code}_foreign_write`,name:'QA CROSS TENANT WRITE MUST FAIL',status:'Active',tenant_id:foreignTenant.id,notes:`TEMP QA ISOLATION ${runId}`}
    const w=await client.from('clients').insert(foreignWrite).select('id').maybeSingle()
    if(!w.error && w.data?.id) createdRows.push({table:'clients',id:w.data.id})
    assert(Boolean(w.error),`${tenant.code} cross-tenant client write denied`,w.error?.message||'unexpected success')
  }
}

async function cleanup(){
  const order=['chat_messages','tasks','leads','clients','employees']
  for(const table of order){
    const ids=createdRows.filter(r=>r.table===table).map(r=>r.id).filter(Boolean)
    if(ids.length){
      try { await admin.from(table).delete().in('id',ids) } catch {}
    }
  }
  try { await admin.from('chat_messages').delete().eq('source','qa_isolation').like('text',`%${runId}%`) } catch {}
  for(const id of createdUsers){
    try { await admin.auth.admin.deleteUser(id) } catch {}
  }
}

try{
  await provision()
  await verify()
}catch(e){
  fatal=e?.message||String(e)
  console.error(`ISOLATION CERT FAIL: ${fatal}`)
}finally{
  await cleanup()
}

const evidence={runId,generatedAt:new Date().toISOString(),tenants:TENANTS.map(({id,code,name})=>({id,code,name})),tables:TABLES.map(t=>t.table),checks,passed:!fatal&&checks.every(c=>c.ok),fatal}
fs.mkdirSync('artifacts',{recursive:true})
fs.writeFileSync('artifacts/three-tenant-isolation-certification.json',JSON.stringify(evidence,null,2))
console.log(JSON.stringify({passed:evidence.passed,checks:checks.length,tenants:TENANTS.map(t=>t.name)},null,2))
if(!evidence.passed) process.exit(1)
