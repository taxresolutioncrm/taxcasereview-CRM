import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-qa-certification'}
const digits=(v:any)=>String(v||'').replace(/\D/g,'')
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}})

serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
 if(req.method!=='POST')return json({error:'Method not allowed'},405)
 try{
  const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!
  if(!url||!service||!anon)return json({error:'Server configuration missing'},500)
  const admin=createClient(url,service),payload=await req.json();let {to,body,lead_id,client_id,employee_portal_token,phoneContext}=payload
  const ROMYLABS_TENANT='a0000000-0000-0000-0000-000000000001'
  const SIGNALWIRE_SOURCE_TENANT='61a89aef-0e7e-4ea2-b222-44ab2024655a'
  let tenantId:string|null=null,sentBy='CRM',employeeName:string|null=null,esignIdToMark:string|null=null
  let isPlatformAdmin=false,romylabsContext=false
  let authenticatedUser:any=null,authClient:any=null
  const auth=req.headers.get('authorization')||''
  if(auth.startsWith('Bearer ')){
    const jwt=auth.slice(7);authClient=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${jwt}`}}});const{data:u}=await authClient.auth.getUser(jwt)
    if(u?.user){
      authenticatedUser=u.user
      const{data:isAdmin}=await authClient.rpc('_is_platform_admin');isPlatformAdmin=isAdmin===true
      romylabsContext=phoneContext==='romylabs'&&isPlatformAdmin
      if(romylabsContext)tenantId=ROMYLABS_TENANT
      else {const{data:t}=await authClient.rpc('current_tenant_id');tenantId=t||null}
      sentBy=u.user.email||'CRM'
    }
  }
  if(authenticatedUser){
    if(!tenantId)return json({error:'No active office context'},403)
    const{data:emp}=await admin.from('employees').select('id,status,perm_comms,tenant_id').eq('tenant_id',tenantId).ilike('email',authenticatedUser.email||'').limit(1).maybeSingle()
    const active=emp&&String(emp.status||'Active').toLowerCase()==='active'
    if(!isPlatformAdmin&&(!active||Number(emp?.perm_comms||0)<2))return json({error:'SMS permission denied'},403)
  }
  if(!tenantId&&employee_portal_token){
    if(!client_id)return json({error:'client_id is required for employee portal SMS'},403)
    const{data:s}=await admin.from('employee_portal_sessions').select('employee_id,employee_name,tenant_id,expires_at').eq('token',String(employee_portal_token)).gt('expires_at',new Date().toISOString()).maybeSingle()
    if(s){tenantId=s.tenant_id;employeeName=s.employee_name;sentBy=s.employee_name||'Employee Portal';const{data:c}=await admin.from('clients').select('id,name,phone,phone2,assignedto,assignedTo,taxAssociate,tenant_id').eq('id',String(client_id)).eq('tenant_id',tenantId).maybeSingle();if(!c||(c.assignedto!==employeeName&&c.assignedTo!==employeeName&&c.taxAssociate!==employeeName)||digits(c.phone||c.phone2).slice(-10)!==digits(to).slice(-10))return json({error:'Client is not assigned to this employee'},403)}
  }
  if(!tenantId&&payload.kind==='esign_signed_receipt'&&payload.esign_id){
    const{data:e}=await admin.from('esigns').select('id,status,client_phone,client_name,doc_type,tenant_id,signed_sms_sent_at').eq('id',String(payload.esign_id)).maybeSingle()
    if(!e||e.status!=='Signed')return json({error:'Invalid signing request'},403)
    if(e.signed_sms_sent_at)return json({success:true,already_sent:true})
    if(!e.client_phone)return json({error:'Signing request has no phone'},422)
    tenantId=e.tenant_id;to=e.client_phone;body=`Your signature on ${e.doc_type||'your document'} was received and a copy has been saved to your file.`;sentBy='E-Sign';esignIdToMark=e.id
  }
  if(!tenantId)return json({error:'Unauthorized'},401)
  const toDigits=digits(to),toNumber=toDigits.length===10?`+1${toDigits}`:(toDigits.length===11&&toDigits.startsWith('1')?`+${toDigits}`:'')
  if(!toNumber||!String(body||'').trim())return json({error:'valid to and body are required'},400)
  if(String(body).length>1600)return json({error:'Message is too long'},400)
  let{data:settings}=await admin.from('settings').select('name,firmname,sw_space_url,sw_project_id,sw_api_token,sw_inbound_did,sw_outbound_did').eq('tenant_id',tenantId).maybeSingle()
  let fromNumber=settings?.sw_outbound_did||settings?.sw_inbound_did||''
  if(romylabsContext){
    const[{data:source},{data:adminPhone}]=await Promise.all([
      admin.from('settings').select('sw_space_url,sw_project_id,sw_api_token').eq('tenant_id',SIGNALWIRE_SOURCE_TENANT).limit(1).maybeSingle(),
      admin.from('settings').select('sw_inbound_did').eq('tenant_id',ROMYLABS_TENANT).limit(1).maybeSingle()
    ])
    settings={...settings,...source}
    fromNumber=String(adminPhone?.sw_inbound_did||'')
  }
  if(esignIdToMark)body=`${settings?.name||settings?.firmname||'TaxRes CRM'}: ${body}`
  if(!settings?.sw_space_url||!settings?.sw_project_id||!settings?.sw_api_token)return json({error:'SignalWire not configured'},422)
  if(!fromNumber)return json({error:'SMS sending number not configured'},422)

  // Explicit certification path: all production auth/tenant/permission/provider
  // checks above must pass, but no provider request or delivery log occurs.
  if(authenticatedUser&&payload.qa_certification===true&&payload.dry_run===true){
    return json({success:true,dry_run:true,delivery:false,provider:'signalwire',tenant_id:tenantId,phone_context:romylabsContext?'romylabs':'taxres',from_number:fromNumber})
  }

  const authHeader=btoa(`${settings.sw_project_id}:${settings.sw_api_token}`),form=new URLSearchParams({From:fromNumber,To:toNumber,Body:String(body).trim()})
  const swRes=await fetch(`https://${String(settings.sw_space_url).replace(/^https?:\/\//,'')}/api/laml/2010-04-01/Accounts/${settings.sw_project_id}/Messages.json`,{method:'POST',headers:{Authorization:`Basic ${authHeader}`,'Content-Type':'application/x-www-form-urlencoded'},body:form.toString()});const sw=await swRes.json()
  if(!swRes.ok)return json({error:sw.message||'SignalWire error'},400)
  let clientName:string|null=null;if(client_id){const{data:c}=await admin.from('clients').select('name').eq('id',String(client_id)).eq('tenant_id',tenantId).maybeSingle();clientName=c?.name||null}
  const{error:logErr}=await admin.from('sms_messages').insert({clientName,phone:toNumber,body:String(body).trim(),status:sw.status||'sent',direction:'outbound',signalwire_sms_id:sw.sid||null,sent_by:sentBy,tenant_id:tenantId,client_id:client_id?String(client_id):null,read:true});if(logErr)console.error('[send-sms] log failed',logErr.message)
  if(esignIdToMark)await admin.from('esigns').update({signed_sms_sent_at:new Date().toISOString()}).eq('id',esignIdToMark)
  return json({success:true,sid:sw.sid})
 }catch(e){console.error('[send-sms]',e);return json({error:e?.message||'Send failed'},500)}
})
