// Client portal email OTP: public endpoint with server-side code verification.
// No client data or service-role key reaches the browser. All queries are
// server-side and scoped to an email confirmed by possession of a code.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json',
  'Cache-Control':'no-store',
  'Referrer-Policy':'no-referrer',
}
const json=(v:any,status=200)=>new Response(JSON.stringify(v),{status,headers:cors})
const safe=(v:unknown)=>String(v??'').replace(/[\r\n]+/g,' ').trim()
const esc=(v:unknown)=>safe(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')

async function sendViaStalwartJmap(opts: { host:string, username:string, password:string, fromAddress?:string, replyTo?:string, fromName:string, to:string, subject:string, html?:string, text?:string }) {
  const base = `https://${opts.host.replace(/^https?:\/\//,'').replace(/\/$/,'')}`
  const auth = 'Basic ' + btoa(`${opts.username}:${opts.password}`)
  const sessionRes = await fetch(`${base}/.well-known/jmap`, { headers:{ Authorization:auth, Accept:'application/json' } })
  if (!sessionRes.ok) throw new Error(`Stalwart JMAP session failed (${sessionRes.status})`)
  const session = await sessionRes.json()
  const apiUrl = String(session?.apiUrl || '').replace('{accountId}','')
  const accountId = session?.primaryAccounts?.['urn:ietf:params:jmap:mail'] || Object.keys(session?.accounts || {})[0]
  if (!apiUrl || !accountId) throw new Error('Stalwart JMAP session missing mail account')

  const metaRes = await fetch(apiUrl, {
    method:'POST',
    headers:{ Authorization:auth, 'Content-Type':'application/json', Accept:'application/json' },
    body:JSON.stringify({
      using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
      methodCalls:[
        ['Identity/get',{accountId},'i0'],
        ['Mailbox/get',{accountId,properties:['id','name','role']},'m0'],
      ],
    }),
  })
  if (!metaRes.ok) throw new Error(`Stalwart JMAP metadata failed (${metaRes.status})`)
  const meta = await metaRes.json()
  const identityList = meta?.methodResponses?.find((x:any)=>x?.[0]==='Identity/get')?.[1]?.list || []
  const mailboxes = meta?.methodResponses?.find((x:any)=>x?.[0]==='Mailbox/get')?.[1]?.list || []
  const fromAddress = safe(opts.fromAddress || opts.username).toLowerCase()
  const identity = identityList.find((x:any)=>String(x?.email||'').toLowerCase()===fromAddress)
  const drafts = mailboxes.find((x:any)=>String(x?.role||'').toLowerCase()==='drafts')
  const sentBox = mailboxes.find((x:any)=>String(x?.role||'').toLowerCase()==='sent')
  if (!identity?.id) throw new Error(`Stalwart does not authorize sender identity ${fromAddress}`)
  if (!drafts?.id || !sentBox?.id) throw new Error('Stalwart Drafts or Sent mailbox unavailable')

  const bodyPartId='body'
  const createEmail:any = {
    from:[{email:fromAddress,name:opts.fromName||undefined}],
    to:[{email:opts.to}],
    ...(opts.replyTo ? {replyTo:[{email:opts.replyTo}]} : {}),
    subject:opts.subject,
    mailboxIds:{[drafts.id]:true},
    keywords:{'$draft':true},
    bodyValues:{[bodyPartId]:{value:opts.html || opts.text || '',charset:'utf-8'}},
  }
  if (opts.html) createEmail.htmlBody=[{partId:bodyPartId,type:'text/html'}]
  else createEmail.textBody=[{partId:bodyPartId,type:'text/plain'}]

  const sendRes = await fetch(apiUrl, {
    method:'POST',
    headers:{ Authorization:auth, 'Content-Type':'application/json', Accept:'application/json' },
    body:JSON.stringify({
      using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
      methodCalls:[
        ['Email/set',{accountId,create:{draft:createEmail}},'e0'],
        ['EmailSubmission/set',{
          accountId,
          create:{sendIt:{emailId:'#draft',identityId:identity.id}},
          onSuccessUpdateEmail:{
            '#sendIt':{
              [`mailboxIds/${drafts.id}`]:null,
              [`mailboxIds/${sentBox.id}`]:true,
              'keywords/$draft':null,
            },
          },
        },'s0'],
      ],
    }),
  })
  if (!sendRes.ok) throw new Error(`Stalwart JMAP send failed (${sendRes.status})`)
  const sent = await sendRes.json()
  const submission = sent?.methodResponses?.find((x:any)=>x?.[0]==='EmailSubmission/set')?.[1]
  const notCreated = submission?.notCreated?.sendIt
  if (notCreated) throw new Error(`Stalwart JMAP rejected send: ${notCreated.description || notCreated.type || 'unknown error'}`)
  if (!submission?.created?.sendIt?.id) throw new Error('Stalwart JMAP did not confirm message submission')
  return { submissionId:String(submission.created.sendIt.id), accountId:String(accountId) }
}


Deno.serve(async (req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  try{
    let body:any
    try{body=await req.json()}catch{return json({error:'Invalid request'},400)}
    const action=String(body?.action||'')
    const clientId=safe(body?.client_id||'')
    const email=safe(body?.email||'').toLowerCase()
    if(!clientId||clientId.length>128||!email||email.length>254)return json({error:'Invalid request'},400)
    if(!['request','verify'].includes(action))return json({error:'Unsupported action'},400)
    const url=Deno.env.get('SUPABASE_URL')||''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    if(!url||!service)return json({error:'Authentication service unavailable'},503)
    const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})

    if(action==='verify'){
      const code=String(body?.code||'').trim()
      if(!/^\d{6}$/.test(code))return json({error:'Invalid verification code'},400)
      const {data,error}=await db.rpc('portal_email_code_verify',{
        p_id:clientId,p_email:email,p_code:code,
      })
      if(error){console.error('[portal-email-login] verify unavailable',{code:error.code});return json({error:'Verification unavailable'},503)}
      if(!data?.token)return json({error:'Incorrect, expired or already-used code. Request a new one.'},401)
      return json({ok:true,token:data.token,client_name:data.client_name,is_lead:data.is_lead})
    }

    // Transport is required even for unknown accounts to avoid revealing who
    // has an active client record through a different error response.
    const {data:transport,error:transportError}=await db.rpc(
      'romylabs_stalwart_transport_for_product',{p_product_key:'taxres_crm'})
    if(transportError||!transport?.ok||!transport?.username||!transport?.password){
      console.error('[portal-email-login] registered mail transport unavailable')
      return json({error:'Email verification temporarily unavailable. Contact your office.'},503)
    }
    const ip=safe(req.headers.get('cf-connecting-ip')||req.headers.get('x-real-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'').slice(0,100)
    const {data:challenge,error:challengeError}=await db.rpc('portal_email_code_request',{
      p_id:clientId,p_email:email,p_ip:ip,
    })
    if(challengeError){
      console.error('[portal-email-login] challenge unavailable',{code:challengeError.code})
      return json({error:'Email verification temporarily unavailable.'},503)
    }
    const generic={ok:true,message:'If this email matches an active portal account, a six-digit code will arrive shortly.'}
    if(!challenge?.challenge_id||!challenge?.code||!challenge?.recipient)return json(generic)

    // Send only to the database-verified email, never to body.to or an arbitrary
    // browser-supplied address. No OTP is returned to the caller or logged.
    try{
      const fromAddress=safe(transport.from_address||transport.username).toLowerCase()
      const brand=safe(challenge.firm_name||'Your Tax Resolution Office').slice(0,90)
      const code=safe(challenge.code)
      const html=`<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px">
        <h2>${esc(brand)} — Secure Client Portal</h2>
        <p>Use this one-time verification code to sign in:</p>
        <div style="font-size:32px;letter-spacing:6px;font-weight:800;margin:18px 0">${esc(code)}</div>
        <p>The code expires in <strong>10 minutes</strong> and can only be used once.</p>
        <p style="font-size:12px;color:#475569">If you didn't request this code, ignore this email.
        Never give the code to anyone, including your tax representative.</p></div>`
      await sendViaStalwartJmap({
        host:safe(transport.host||'mail.taxrescrm.net'),
        username:safe(transport.username),
        password:String(transport.password),
        fromAddress,fromName:brand+' Client Portal',
        to:String(challenge.recipient),subject:'Secure client portal sign-in code',
        html,
      })
      return json(generic)
    }catch(e){
      await db.from('portal_email_login_challenges').delete().eq('id',challenge.challenge_id)
      console.error('[portal-email-login] mail transport failed',{reason:e instanceof Error?e.message:'provider_failure'})
      return json({error:'Could not send the verification code. Contact your office.'},503)
    }
  }catch(e){
    console.error('[portal-email-login] request failed',{reason:e instanceof Error?e.message:'unknown'})
    return json({error:'Authentication service unavailable'},503)
  }
})
