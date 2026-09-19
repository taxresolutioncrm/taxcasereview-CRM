import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FAMILY_PASSWORD_PAGE='https://taxrescrm.app/family-password'
const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
}
const safe=(v:unknown)=>String(v??'').trim()
const esc=(v:unknown)=>safe(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')

async function findAuthUser(admin:any,email:string){
  for(let page=1;page<=20;page++){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000})
    if(error) throw error
    const hit=(data?.users||[]).find((u:any)=>safe(u.email).toLowerCase()===email)
    if(hit) return hit
    if((data?.users||[]).length<1000) break
  }
  return null
}

function accessEmailHtml(opts:{name:string,firmName:string,link:string,kind:'invite'|'recovery'}){
  const heading=opts.kind==='invite'?'Set up your TaxRes CRM password':'Reset your TaxRes CRM password'
  const intro=opts.kind==='invite'
    ? `Your ${esc(opts.firmName)} CRM access is ready. Use the secure button below to create your TaxRes family password.`
    : `Use the secure button below to reset your TaxRes family password for ${esc(opts.firmName)}.`
  const button=opts.kind==='invite'?'Set Up Password':'Reset Password'
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#162235">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e4eaf1;border-radius:14px;overflow:hidden">
<tr><td style="background:#0b2136;padding:26px 32px;text-align:center;color:#fff;font-size:20px;font-weight:800">${esc(opts.firmName)}</td></tr>
<tr><td style="padding:34px 36px 10px"><div style="font-size:22px;font-weight:700;color:#10243a;margin-bottom:14px">${heading}</div>
<div style="font-size:15px;line-height:1.65;color:#4b5f73">Hi ${esc(opts.name||'there')},</div>
<div style="font-size:15px;line-height:1.65;color:#4b5f73;margin-top:8px">${intro}</div></td></tr>
<tr><td style="padding:20px 36px 24px;text-align:center"><a href="${esc(opts.link)}" style="display:inline-block;background:#1A7FD4;color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 24px;border-radius:8px">${button}</a></td></tr>
<tr><td style="padding:0 36px 28px"><div style="font-size:13px;line-height:1.6;color:#718096">The same password works anywhere in the TaxRes CRM family where your employee account is authorized. Office data and permissions remain separate.</div>
<div style="font-size:12px;line-height:1.55;color:#94a3b8;margin-top:18px">If the button does not open, copy and paste this link into your browser:<br><span style="word-break:break-all;color:#5c6f82">${esc(opts.link)}</span></div></td></tr>
</table></td></tr></table></body></html>`
}

serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders})
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}})
  if(req.method!=='POST') return json({error:'POST only'},405)

  try{
    const url=Deno.env.get('SUPABASE_URL')||''
    const anon=Deno.env.get('SUPABASE_ANON_KEY')||''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    if(!url||!anon||!service) return json({error:'Server configuration missing'},500)

    const authHeader=req.headers.get('Authorization')||''
    if(!authHeader.toLowerCase().startsWith('bearer ')) return json({error:'Missing authorization'},401)
    const caller=createClient(url,anon,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false,autoRefreshToken:false}})
    const token=authHeader.replace(/^Bearer\s+/i,'')
    const {data:{user},error:userErr}=await caller.auth.getUser(token)
    if(userErr||!user?.email) return json({error:'Invalid session'},401)

    const {data:tenantId,error:tenantErr}=await caller.rpc('current_tenant_id')
    if(tenantErr||!tenantId) return json({error:'No active office context'},403)

    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
    let isPlatformAdmin=false
    try {
      const {data:platformAdmin,error:platformErr}=await caller.rpc('_is_platform_admin')
      if(!platformErr) isPlatformAdmin=!!platformAdmin
    } catch (_) {
      isPlatformAdmin=false
    }
    const {data:callerEmployee}=await admin.from('employees')
      .select('id,status,perm_hr,role,access')
      .eq('tenant_id',tenantId)
      .ilike('email',user.email)
      .limit(1).maybeSingle()

    const active=callerEmployee&&safe(callerEmployee.status||'Active').toLowerCase()==='active'
    const superAdmin=safe(callerEmployee?.access||callerEmployee?.role).toLowerCase()==='super admin'
    if(!isPlatformAdmin && (!active||(!superAdmin&&Number(callerEmployee?.perm_hr||0)<2))) return json({error:'Employee invite permission denied'},403)

    const body=await req.json().catch(()=>({}))
    const email=safe(body.email).toLowerCase()
    const requestedName=safe(body.name)
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({error:'Valid employee email is required'},400)

    const {data:employee}=await admin.from('employees')
      .select('id,email,name,status,tenant_id')
      .eq('tenant_id',tenantId)
      .ilike('email',email)
      .limit(1).maybeSingle()
    if(!employee) return json({error:'Employee must exist in this office before an invite can be sent'},409)
    if(safe(employee.status||'Active').toLowerCase()!=='active') return json({error:'Employee is not active'},409)

    const {data:otherEmployee}=await admin.from('employees')
      .select('tenant_id')
      .ilike('email',email)
      .neq('tenant_id',tenantId)
      .limit(1).maybeSingle()
    if(otherEmployee) return json({error:'This email already belongs to another office'},409)

    const {data:tenant}=await admin.from('tenants').select('tenant_code,firm_name').eq('id',tenantId).maybeSingle()
    const {data:settings}=await admin.from('settings').select('name,firmname').eq('tenant_id',tenantId).maybeSingle()
    const firmName=safe(settings?.name||settings?.firmname||tenant?.firm_name||'TaxRes CRM')
    const existing=await findAuthUser(admin,email)
    const kind:'invite'|'recovery'=existing?'recovery':'invite'

    if(existing&&!existing.email_confirmed_at){
      const {error:confirmErr}=await admin.auth.admin.updateUserById(existing.id,{email_confirm:true})
      if(confirmErr) return json({error:'Could not prepare existing employee login: '+confirmErr.message},500)
    }

    const linkArgs:any = kind === 'invite'
      ? { type:'invite', email, options:{ data:{ name:requestedName||employee.name||email.split('@')[0] } } }
      : { type:'recovery', email }
    const {data:linkData,error:linkErr}=await admin.auth.admin.generateLink(linkArgs)
    if(linkErr) return json({error:'Could not prepare employee access: '+linkErr.message},400)
    const tokenHash=linkData?.properties?.hashed_token||linkData?.properties?.hashedToken||''
    if(!tokenHash) return json({error:'Could not prepare employee access token'},500)

    const office=tenant?.tenant_code==='TRC-003'?'cloudcpa':tenant?.tenant_code==='DEMO'?'demo':'tcr'
    const accessLink=`${FAMILY_PASSWORD_PAGE}?token_hash=${encodeURIComponent(tokenHash)}&type=${kind}&office=${encodeURIComponent(office)}`
    const html=accessEmailHtml({name:requestedName||employee.name||'',firmName,link:accessLink,kind})
    const emailRes=await fetch(`${url}/functions/v1/send-email`,{
      method:'POST',
      headers:{Authorization:authHeader,apikey:anon,'Content-Type':'application/json'},
      body:JSON.stringify({
        to:email,
        subject:kind==='invite'?`Set up your ${firmName} CRM password`:`Reset your ${firmName} CRM password`,
        from_name:firmName,
        html
      })
    })
    const emailBody=await emailRes.json().catch(()=>({}))
    if(!emailRes.ok||!emailBody?.success){
      console.error('[invite-employee] delivery failed',emailRes.status,emailBody?.error||'unknown')
      return json({
        ok:true,
        invited:kind==='invite',
        already_exists:!!existing,
        mode:kind,
        delivery:'manual',
        access_link:accessLink,
        email,
        employee_id:employee.id,
        warning:emailBody?.error||'Email transport unavailable'
      })
    }

    return json({
      ok:true,
      invited:kind==='invite',
      already_exists:!!existing,
      reset_sent:kind==='recovery',
      mode:kind,
      delivery:'email',
      email,
      employee_id:employee.id,
      auth_user_id:existing?.id||linkData?.user?.id||null
    })
  }catch(e){
    console.error('[invite-employee]',e)
    return json({error:String((e as Error)?.message||e)},500)
  }
})
