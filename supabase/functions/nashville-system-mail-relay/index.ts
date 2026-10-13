import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SECRET_KEY='nashville_system_mail_relay_v1'
const ALLOWED=new Set(['employee_access','esign_request','esign_reminder','esign_signed_copy','esign_internal_notification'])
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type, x-system-mail-secret','Content-Type':'application/json','Cache-Control':'no-store'}
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:cors})
const safe=(v:any)=>String(v??'').replace(/[\r\n]+/g,' ').trim()

async function sendViaStalwartJmap(opts:{host:string,username:string,password:string,fromAddress:string,fromName:string,to:string,subject:string,html:string}){
  const base='https://'+opts.host.replace(/^https?:\/\//,'').replace(/\/$/,'')
  const auth='Basic '+btoa(opts.username+':'+opts.password)
  const sessionRes=await fetch(base+'/.well-known/jmap',{headers:{Authorization:auth,Accept:'application/json'}})
  if(!sessionRes.ok) throw new Error('TaxResCRM mail session failed ('+sessionRes.status+')')
  const session=await sessionRes.json()
  const apiUrl=String(session?.apiUrl||'').replace('{accountId}','')
  const accountId=session?.primaryAccounts?.['urn:ietf:params:jmap:mail']||Object.keys(session?.accounts||{})[0]
  if(!apiUrl||!accountId) throw new Error('TaxResCRM mail session is incomplete')

  const metaRes=await fetch(apiUrl,{
    method:'POST',
    headers:{Authorization:auth,'Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify({
      using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
      methodCalls:[
        ['Identity/get',{accountId},'i0'],
        ['Mailbox/get',{accountId,properties:['id','name','role']},'m0'],
      ],
    }),
  })
  if(!metaRes.ok) throw new Error('TaxResCRM mail metadata failed ('+metaRes.status+')')
  const meta=await metaRes.json()
  const identityList=meta?.methodResponses?.find((x:any)=>x?.[0]==='Identity/get')?.[1]?.list||[]
  const mailboxes=meta?.methodResponses?.find((x:any)=>x?.[0]==='Mailbox/get')?.[1]?.list||[]
  const fromAddress=safe(opts.fromAddress||opts.username).toLowerCase()
  const identity=identityList.find((x:any)=>String(x?.email||'').toLowerCase()===fromAddress)
  const drafts=mailboxes.find((x:any)=>String(x?.role||'').toLowerCase()==='drafts')
  const sent=mailboxes.find((x:any)=>String(x?.role||'').toLowerCase()==='sent')
  if(!identity?.id) throw new Error('TaxResCRM system sender identity is unavailable')
  if(!drafts?.id||!sent?.id) throw new Error('TaxResCRM Drafts/Sent mailbox is unavailable')

  const bodyPartId='body'
  const createEmail={
    from:[{email:fromAddress,name:opts.fromName}],
    to:[{email:opts.to}],
    subject:opts.subject,
    mailboxIds:{[drafts.id]:true},
    keywords:{'$draft':true},
    bodyValues:{[bodyPartId]:{value:opts.html,charset:'utf-8'}},
    htmlBody:[{partId:bodyPartId,type:'text/html'}],
  }
  const sendRes=await fetch(apiUrl,{
    method:'POST',
    headers:{Authorization:auth,'Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify({
      using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
      methodCalls:[
        ['Email/set',{accountId,create:{draft:createEmail}},'e0'],
        ['EmailSubmission/set',{
          accountId,
          create:{sendIt:{emailId:'#draft',identityId:identity.id}},
          onSuccessUpdateEmail:{'#sendIt':{['mailboxIds/'+drafts.id]:null,['mailboxIds/'+sent.id]:true,'keywords/$draft':null}},
        },'s0'],
      ],
    }),
  })
  if(!sendRes.ok) throw new Error('TaxResCRM system mail send failed ('+sendRes.status+')')
  const out=await sendRes.json()
  const submission=out?.methodResponses?.find((x:any)=>x?.[0]==='EmailSubmission/set')?.[1]
  const notCreated=submission?.notCreated?.sendIt
  if(notCreated) throw new Error(notCreated.description||notCreated.type||'TaxResCRM system mail rejected')
  if(!submission?.created?.sendIt?.id) throw new Error('TaxResCRM system mail did not confirm submission')
  return {submissionId:String(submission.created.sendIt.id),from:fromAddress}
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return json({error:'POST only'},405)
  try{
    const supplied=req.headers.get('x-system-mail-secret')||''
    if(!supplied) return json({error:'Unauthorized'},401)

    const url=Deno.env.get('SUPABASE_URL')||''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    if(!url||!service) return json({error:'System mail unavailable'},503)
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})

    const {data:secretRow,error:secretErr}=await admin.from('platform_internal_secrets')
      .select('secret').eq('key',SECRET_KEY).maybeSingle()
    if(secretErr||!secretRow?.secret||String(secretRow.secret)!==supplied) return json({error:'Unauthorized'},401)

    const body=await req.json().catch(()=>({}))
    const kind=safe(body?.kind).toLowerCase()
    const to=safe(body?.to).toLowerCase()
    const subject=safe(body?.subject)
    const html=String(body?.html||'')
    if(!ALLOWED.has(kind)) return json({error:'Unsupported Nashville system mail kind'},400)
    if(!/^\S+@\S+\.\S+$/.test(to)||!subject||!html) return json({error:'Recipient, subject, and html are required'},400)

    if(!html.includes('Nashville Tax Solutions')) return json({error:'Nashville branding required'},400)
    const forbidden=['Tax Case Review','CloudCPA','Cloud CPA']
    if(forbidden.some(x=>html.includes(x)||subject.includes(x))) return json({error:'Foreign brand blocked'},400)
    if(kind==='employee_access'){
      if(!html.includes('https://nashville.taxrescrm.app/nashville-logo.png')) return json({error:'Nashville logo required'},400)
      if(!html.includes('https://nashville.taxrescrm.app/reset-password')) return json({error:'Nashville password link required'},400)
      
    }

    const {data:transport,error:transportErr}=await admin.rpc('romylabs_stalwart_transport_for_product',{p_product_key:'taxres_crm'})
    if(transportErr||!transport?.ok||!transport?.username||!transport?.password) return json({error:'TaxResCRM system sender is unavailable'},503)

    const result=await sendViaStalwartJmap({
      host:safe(transport.host||'mail.taxrescrm.net'),
      username:safe(transport.username),
      password:String(transport.password),
      fromAddress:safe(transport.from_address||transport.username).toLowerCase(),
      fromName:'TaxResCRM',
      to,
      subject,
      html,
    })
    return json({success:true,provider:'taxrescrm_system_mail',from:result.from,submission_id:result.submissionId})
  }catch(e){
    console.error('[nashville-system-mail-relay]',e instanceof Error?e.message:String(e))
    return json({error:'TaxResCRM system mail delivery failed'},502)
  }
})
