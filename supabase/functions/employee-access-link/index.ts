import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TENANT='489ace07-1a6b-4864-833a-4f8420568b40'
const FAMILY_INVITE_URL='https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/taxres-family-admin-invite'
const FAMILY_RESET_URL='https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/taxres-family-password-reset'
const LOGO_URL='https://mpxgxfqdbquzkrvvejkh.supabase.co/storage/v1/object/public/firm-assets/logo-489ace07-1a6b-4864-833a-4f8420568b40.png'
const SYSTEM_MAIL_RELAY='https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/nashville-system-mail-relay'
const SYSTEM_MAIL_SECRET_KEY='nashville_system_mail_relay_v1'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'content-type':'application/json','Cache-Control':'no-store'}})
const RANK:Record<string,number>={'Super Admin':100,'Admin':80,'Manager':60,'Tax Advisor':50,'Tax Associate':40,'Associate':40,'Para':40,'Sales Rep':30,'View Only':10}
const SELF_MESSAGE='If that email belongs to an active TaxRes family account, a password reset email will be sent.'

function escapeHtml(v:string){return String(v||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch))}
async function sha256(v:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,'0')).join('')}
function clientIp(req:Request){return req.headers.get('cf-connecting-ip')||req.headers.get('x-real-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown'}

function accessEmailHtml(name:string,accessLink:string,kind:'invite'|'recovery'){
  const safeName=escapeHtml(name||'there')
  const safeLink=escapeHtml(accessLink)
  const first=kind==='invite'
  const heading=first?'Set up your TaxRes CRM password':'Reset your TaxRes CRM password'
  const intro=first
    ? 'Your Nashville Tax Solutions CRM account is ready. Use the secure link below to create your TaxRes family password. The same password works anywhere in the TaxRes CRM family where your account is authorized.'
    : 'Use the secure link below to reset your TaxRes family password. The new password will work anywhere in the TaxRes CRM family where your account is authorized.'
  const button=first?'Set Up Password':'Reset Password'
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#162235"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e4eaf1;border-radius:14px;overflow:hidden;box-shadow:0 8px 28px rgba(18,42,66,.08)"><tr><td style="background:#0b2136;padding:26px 32px;text-align:center"><img src="${LOGO_URL}" alt="Nashville Tax Solutions" style="max-width:220px;max-height:72px;width:auto;height:auto;display:inline-block"></td></tr><tr><td style="padding:34px 36px 10px"><div style="font-size:22px;font-weight:700;line-height:1.3;color:#10243a;margin:0 0 14px">${heading}</div><div style="font-size:15px;line-height:1.65;color:#4b5f73">Hi ${safeName},</div><div style="font-size:15px;line-height:1.65;color:#4b5f73;margin-top:8px">${intro}</div></td></tr><tr><td style="padding:20px 36px 24px;text-align:center"><a href="${safeLink}" style="display:inline-block;background:#1A7FD4;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 24px;border-radius:8px">${button}</a></td></tr><tr><td style="padding:0 36px 28px"><div style="font-size:13px;line-height:1.6;color:#718096">For your security, use the button above to choose your password. Office access remains permission-based and isolated.</div><div style="font-size:12px;line-height:1.55;color:#94a3b8;margin-top:18px">If the button does not open, copy and paste this link into your browser:<br><span style="word-break:break-all;color:#5c6f82">${safeLink}</span></div></td></tr><tr><td style="border-top:1px solid #e9eef4;padding:18px 36px 22px;text-align:center"><div style="font-size:12px;color:#8795a5">Nashville Tax Solutions · TaxRes CRM Family Access</div><div style="font-size:11px;color:#a4afbb;margin-top:5px">This is an automated security email. Please do not forward it.</div></td></tr></table></td></tr></table></body></html>`
}

async function familyAccess(authHeader:string,target:string,action:'link'|'status'='link'){
  const res=await fetch(FAMILY_INVITE_URL,{
    method:'POST',
    headers:{Authorization:authHeader,'Content-Type':'application/json'},
    body:JSON.stringify({email:target,action})
  })
  const body=await res.json().catch(()=>({}))
  if(!res.ok||body?.error) throw new Error(body?.error||'Could not prepare TaxRes family access')
  return body
}

async function sendBrandedAccess(admin:any,target:string,name:string,kind:'invite'|'recovery',accessLink:string){
  const {data:secretRow,error:secretErr}=await admin.from('platform_internal_secrets')
    .select('secret').eq('key',SYSTEM_MAIL_SECRET_KEY).maybeSingle()
  if(secretErr||!secretRow?.secret) throw new Error('Nashville system mail relay is unavailable')
  const res=await fetch(SYSTEM_MAIL_RELAY,{
    method:'POST',
    headers:{'x-nashville-relay-secret':String(secretRow.secret),'Content-Type':'application/json'},
    body:JSON.stringify({
      kind:'employee_access',
      to:target,
      subject:kind==='invite'?'Set up your Nashville Tax Solutions CRM password':'Reset your Nashville Tax Solutions CRM password',
      html:accessEmailHtml(name,accessLink,kind)
    })
  })
  const body=await res.json().catch(()=>({}))
  if(!res.ok || !body?.success) throw new Error(body?.error || 'Could not send access email')
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return json({error:'POST only'},405)

  try{
    const url=Deno.env.get('SUPABASE_URL')!
    const anonKey=Deno.env.get('SUPABASE_ANON_KEY')!
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin=createClient(url,service)
    const body=await req.json().catch(()=>({}))
    const mode=String(body?.mode||'admin')
    const target=String(body?.email||'').trim().toLowerCase()

    // Public self-service stays enumeration-safe and only forwards a reset
    // request for an active Nashville employee into the shared TaxRes identity.
    if(mode==='self'){
      const generic=()=>json({success:true,mode:'self',message:SELF_MESSAGE})
      if(!/^\S+@\S+\.\S+$/.test(target)) return generic()

      const now=new Date()
      const windowStart=new Date(now.getTime()-15*60_000).toISOString()
      const pruneBefore=new Date(now.getTime()-24*60*60_000).toISOString()
      const ipHash=await sha256(`${service}:employee-reset:ip:${clientIp(req)}`)
      const subjectHash=await sha256(`${service}:employee-reset:email:${target}`)
      await admin.from('public_edge_rate_events').delete().eq('endpoint','employee-reset').lt('requested_at',pruneBefore)

      const [ipCount,subjectCount]=await Promise.all([
        admin.from('public_edge_rate_events').select('id',{count:'exact',head:true}).eq('endpoint','employee-reset').eq('ip_hash',ipHash).gte('requested_at',windowStart),
        admin.from('public_edge_rate_events').select('id',{count:'exact',head:true}).eq('endpoint','employee-reset').eq('subject_hash',subjectHash).gte('requested_at',windowStart),
      ])
      if(ipCount.error||subjectCount.error) return generic()
      if((ipCount.count||0)>=20||(subjectCount.count||0)>=5) return generic()

      await admin.from('public_edge_rate_events').insert({endpoint:'employee-reset',ip_hash:ipHash,subject_hash:subjectHash,requested_at:now.toISOString()})
      const {data:last}=await admin.from('employee_password_reset_requests').select('requested_at').eq('email',target).maybeSingle()
      const lastMs=last?.requested_at ? new Date(last.requested_at).getTime() : 0
      if(lastMs && Date.now()-lastMs < 60_000) return generic()
      await admin.from('employee_password_reset_requests').upsert({email:target,requested_at:new Date().toISOString()},{onConflict:'email'})

      const {data:emp}=await admin.from('employees').select('id,email').ilike('email',target).eq('tenant_id',TENANT).eq('status','Active').maybeSingle()
      if(!emp) return generic()

      try{
        await fetch(FAMILY_RESET_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:target})})
      }catch(e){console.error('[employee-access-link] family self reset failed',e)}
      return generic()
    }

    // All administrative invite/readiness operations require an authenticated
    // Nashville Admin/Super Admin. The central family service independently
    // re-verifies this same Nashville JWT through taxres-family-admin-proof.
    const authHeader=req.headers.get('Authorization')||''
    const token=authHeader.replace(/^Bearer\s+/i,'')
    if(!token) return json({error:'Missing authorization'},401)
    const caller=createClient(url,anonKey,{global:{headers:{Authorization:`Bearer ${token}`}}})
    const {data:{user},error:userErr}=await caller.auth.getUser()
    if(userErr||!user?.email) return json({error:'Invalid session'},401)

    const {data:actor}=await admin.from('employees').select('id,email,status,access,tenant_id').ilike('email',user.email).eq('tenant_id',TENANT).eq('status','Active').maybeSingle()
    if(!actor||!['Super Admin','Admin'].includes(actor.access||'')) return json({error:'Nashville Admin access required'},403)
    const actorRank=RANK[actor.access||'']||0

    if(mode==='readiness'){
      const {data:staff,error:staffErr}=await admin.from('employees')
        .select('id,name,email,status,tenant_id,access')
        .eq('tenant_id',TENANT).eq('status','Active').order('name',{ascending:true})
      if(staffErr) return json({error:'Could not load active Nashville employees'},500)

      const counts=new Map<string,number>()
      for(const emp of (staff||[])){
        const email=String(emp.email||'').trim().toLowerCase()
        if(email) counts.set(email,(counts.get(email)||0)+1)
      }

      const [{data:lineRows},{data:m365Rows}]=await Promise.all([
        admin.from('verizon_onetalk_lines').select('employee_id,phone_line,status,is_primary').eq('tenant_id',TENANT).eq('status','ACTIVE'),
        admin.from('employee_m365_accounts').select('employee_email,m365_email,m365_refresh_token,m365_last_sync_at,m365_last_error').eq('tenant_id',TENANT)
      ])
      const lineMap=new Map<string,any[]>()
      for(const row of (lineRows||[])){
        const key=String(row.employee_id||'');if(!key)continue
        const arr=lineMap.get(key)||[];arr.push(row);lineMap.set(key,arr)
      }
      const m365Map=new Map<string,any>()
      for(const row of (m365Rows||[])){
        const key=String(row.employee_email||'').trim().toLowerCase();if(key)m365Map.set(key,row)
      }

      const results:any[]=[]
      for(const emp of (staff||[]).slice(0,100)){
        const email=String(emp.email||'').trim().toLowerCase()
        const lines=lineMap.get(String(emp.id))||[]
        const primaryLines=lines.filter((l:any)=>l.is_primary)
        const m365=email?m365Map.get(email)||null:null
        let status='invite_ready',reason='',family:any=null

        if(!email || !/^\S+@\S+\.\S+$/.test(email)){status='blocked';reason='invalid_email'}
        else if((counts.get(email)||0)>1){status='blocked';reason='duplicate_employee_email'}
        else{
          try{
            family=await familyAccess(authHeader,email,'status')
            if(family?.last_sign_in_at) status='already_ready'
            else if(family?.exists) status='setup_ready'
          }catch(e){status='error';reason=e instanceof Error?e.message:String(e)}
        }

        results.push({
          id:emp.id,name:emp.name,email:email||null,access:emp.access||null,status,reason,
          family_account_exists:!!family?.exists,
          family_last_sign_in_at:family?.last_sign_in_at||null,
          email_confirmed:!!family?.email_confirmed,
          last_sign_in_at:family?.last_sign_in_at||null,
          verizon_active_lines:lines.length,
          verizon_primary_lines:primaryLines.length,
          verizon_primary_phone:primaryLines[0]?.phone_line||null,
          verizon_mapping_status:lines.length===0?'no_line':primaryLines.length===1?'ready':primaryLines.length===0?'no_primary':'multiple_primary',
          m365_connected:!!m365?.m365_refresh_token,
          m365_email:m365?.m365_email||null,
          m365_last_sync_at:m365?.m365_last_sync_at||null,
          m365_last_error:m365?.m365_last_error||null,
        })
      }

      return json({
        success:results.every(r=>r.status!=='error'),
        total:results.length,
        already_ready:results.filter(r=>r.status==='already_ready').length,
        invite_ready:results.filter(r=>r.status==='invite_ready').length,
        setup_ready:results.filter(r=>r.status==='setup_ready').length,
        blocked:results.filter(r=>r.status==='blocked').length,
        errors:results.filter(r=>r.status==='error').length,
        results
      })
    }

    if(mode==='prepare'){
      const {data:staff,error:staffErr}=await admin.from('employees')
        .select('id,name,email,status,tenant_id,access')
        .eq('tenant_id',TENANT).eq('status','Active').order('name',{ascending:true})
      if(staffErr) return json({error:'Could not load active Nashville employees'},500)

      const counts=new Map<string,number>()
      for(const emp of (staff||[])){
        const email=String(emp.email||'').trim().toLowerCase()
        if(email) counts.set(email,(counts.get(email)||0)+1)
      }

      const results:any[]=[]
      for(const emp of (staff||[]).slice(0,100)){
        const email=String(emp.email||'').trim().toLowerCase()
        if(!email || !/^\S+@\S+\.\S+$/.test(email)){results.push({id:emp.id,name:emp.name,email,status:'blocked',reason:'invalid_email'});continue}
        if((counts.get(email)||0)>1){results.push({id:emp.id,name:emp.name,email,status:'blocked',reason:'duplicate_employee_email'});continue}
        const targetRank=RANK[emp.access||'']||0
        if(actor.access!=='Super Admin' && targetRank>=actorRank && email!==String(actor.email||'').toLowerCase()){
          results.push({id:emp.id,name:emp.name,email,status:'blocked',reason:'protected_access'});continue
        }
        try{
          const status=await familyAccess(authHeader,email,'status')
          if(status?.last_sign_in_at){
            results.push({id:emp.id,name:emp.name,email,status:'already_ready',last_sign_in_at:status.last_sign_in_at})
            continue
          }
          const family=await familyAccess(authHeader,email,'link')
          results.push({id:emp.id,name:emp.name,email,status:'prepared',kind:family.mode||'invite',access_link:family.access_link})
        }catch(e){
          results.push({id:emp.id,name:emp.name,email,status:'error',reason:e instanceof Error?e.message:String(e)})
        }
      }

      return json({
        success:results.every(r=>r.status!=='error'),
        prepared:results.filter(r=>r.status==='prepared').length,
        already_ready:results.filter(r=>r.status==='already_ready').length,
        blocked:results.filter(r=>r.status==='blocked').length,
        errors:results.filter(r=>r.status==='error').length,
        results
      })
    }

    if(mode==='prepare_one'){
      if(!/^\S+@\S+\.\S+$/.test(target)) return json({error:'Employee email is required'},400)
      const {data:emp}=await admin.from('employees').select('id,name,email,phone,status,tenant_id,access').ilike('email',target).eq('tenant_id',TENANT).eq('status','Active').maybeSingle()
      if(!emp) return json({error:'Active Nashville employee record not found'},404)
      const targetRank=RANK[emp.access||'']||0
      const isSelf=String(actor.email||'').toLowerCase()===target
      if(!isSelf && actor.access!=='Super Admin' && targetRank>=actorRank) return json({error:'Cannot prepare access for an equal or higher access account'},403)
      try{
        const family=await familyAccess(authHeader,target,'link')
        return json({success:true,mode:family.mode||'invite',delivery:'prepared',access_link:family.access_link,phone:emp.phone||null,name:emp.name||''})
      }catch(e){return json({error:e instanceof Error?e.message:String(e)},502)}
    }

    if(mode==='onboard' || mode==='bulk'){
      return json({error:'Legacy email-dependent bulk onboarding is disabled. Use readiness and prepare modes.'},409)
    }

    if(!/^\S+@\S+\.\S+$/.test(target)) return json({error:'Employee email is required'},400)
    const {data:emp}=await admin.from('employees').select('id,name,email,status,tenant_id,access').ilike('email',target).eq('tenant_id',TENANT).eq('status','Active').maybeSingle()
    if(!emp) return json({error:'Active Nashville employee record not found'},404)

    const targetRank=RANK[emp.access||'']||0
    const isSelf=String(actor.email||'').toLowerCase()===target
    if(!isSelf && actor.access!=='Super Admin' && targetRank>=actorRank) return json({error:'Cannot reset an equal or higher access account'},403)

    try{
      const family=await familyAccess(authHeader,target,'link')
      const kind:'invite'|'recovery'=family.mode==='invite'?'invite':'recovery'
      const accessLink=String(family.access_link||'')
      if(!accessLink) throw new Error('TaxRes family access link was not returned')
      try{
        await sendBrandedAccess(admin,target,emp.name||'',kind,accessLink)
        return json({
          success:true,mode:kind,delivery:'email',access_link:accessLink,
          message:kind==='invite'
            ?'TaxRes family CRM setup email sent.'
            :'TaxRes family password reset email sent.'
        })
      }catch(sendError){
        console.error('[employee-access-link] email delivery failed; returning family link',sendError)
        return json({
          success:true,mode:kind,delivery:'manual',access_link:accessLink,
          message:'Secure TaxRes family access link prepared. Email transport is unavailable, so send the link to the employee securely.'
        })
      }
    }catch(e){return json({error:e instanceof Error?e.message:String(e)},502)}
  }catch(e){
    return json({error:e instanceof Error?e.message:String(e)},500)
  }
})
