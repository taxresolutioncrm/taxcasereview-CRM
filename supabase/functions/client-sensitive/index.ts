import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store, max-age=0',
}
const json = (body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})
const cleanSsn=(v:unknown)=>String(v||'').replace(/\D/g,'').slice(0,9)
const formatSsn=(digits:string)=>digits.length===9?digits.replace(/(\d{3})(\d{2})(\d{4})/,'$1-$2-$3'):''
const masked=(v:unknown)=>{const d=cleanSsn(v);return d.length===9?`***-**-${d.slice(-4)}`:''}

serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return json({error:'Method not allowed'},405)

  const url=Deno.env.get('SUPABASE_URL')||''
  const anon=Deno.env.get('SUPABASE_ANON_KEY')||''
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
  const auth=req.headers.get('authorization')||''
  if(!url||!anon||!service||!auth.toLowerCase().startsWith('bearer ')) return json({error:'Unauthorized'},401)

  const token=auth.slice(7).trim()
  const userDb=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`}}})
  const admin=createClient(url,service)
  const {data:userData,error:userErr}=await userDb.auth.getUser(token)
  if(userErr||!userData?.user?.email) return json({error:'Unauthorized'},401)

  const {data:tenantId,error:tenantErr}=await userDb.rpc('current_tenant_id')
  if(tenantErr||!tenantId) return json({error:'Office tenant could not be resolved'},403)

  const {data:employee,error:empErr}=await admin.from('employees')
    .select('id,name,email,status,perm_clients,tenant_id')
    .eq('tenant_id',tenantId)
    .ilike('email',userData.user.email)
    .maybeSingle()
  if(empErr||!employee||String(employee.status||'').toLowerCase()!=='active') return json({error:'Active employee required'},403)

  const {data:permission}=await userDb.rpc('current_employee_permission',{permission_name:'perm_clients'})
  const level=Number(permission ?? employee.perm_clients ?? 0)
  if(level<1) return json({error:'Client access denied'},403)

  let body:any={}
  try{body=await req.json()}catch{return json({error:'Invalid JSON'},400)}
  const action=String(body.action||'capability')
  const clientId=String(body.client_id||'').trim()
  if(!clientId) return json({error:'client_id is required'},400)

  const {data:client,error:clientErr}=await admin.from('clients')
    .select('id,tenant_id')
    .eq('tenant_id',tenantId)
    .eq('id',clientId)
    .maybeSingle()
  if(clientErr||!client) return json({error:'Client not found in this office'},404)

  const {data:sensitive,error:sensitiveErr}=await admin.from('client_sensitive_fields')
    .select('ssn,spouse_ssn')
    .eq('tenant_id',tenantId)
    .eq('client_id',clientId)
    .maybeSingle()
  if(sensitiveErr) return json({error:'Sensitive client record could not be read'},500)

  if(action==='capability'){
    return json({
      can_reveal: level>=3,
      ssn_masked: masked(sensitive?.ssn),
      spouse_ssn_masked: masked(sensitive?.spouse_ssn),
    })
  }

  if(level<3) return json({error:'Full SSN access requires Full Admin client permission'},403)

  if(action==='read'){
    return json({
      ssn: formatSsn(cleanSsn(sensitive?.ssn)),
      spouse_ssn: formatSsn(cleanSsn(sensitive?.spouse_ssn)),
    })
  }

  if(action==='write'){
    const nextSsn=body.ssn===null||body.ssn===''?null:formatSsn(cleanSsn(body.ssn))
    const nextSpouse=body.spouse_ssn===null||body.spouse_ssn===''?null:formatSsn(cleanSsn(body.spouse_ssn))
    if(body.ssn && !nextSsn) return json({error:'SSN must contain exactly 9 digits'},400)
    if(body.spouse_ssn && !nextSpouse) return json({error:'Spouse SSN must contain exactly 9 digits'},400)
    const {error}=await admin.from('client_sensitive_fields').upsert({
      tenant_id:tenantId,client_id:clientId,ssn:nextSsn,spouse_ssn:nextSpouse,updated_at:new Date().toISOString()
    },{onConflict:'tenant_id,client_id'})
    if(error) return json({error:'Sensitive client record could not be saved'},500)
    return json({success:true,ssn_masked:masked(nextSsn),spouse_ssn_masked:masked(nextSpouse)})
  }

  return json({error:'Unsupported action'},400)
})
