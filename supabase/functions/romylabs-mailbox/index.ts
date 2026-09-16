import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY)
const corsHeaders = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
}
const json = (body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}})
const norm=(v:any)=>String(v||'').trim().toLowerCase()

async function requirePlatformAdmin(req:Request){
  const auth=req.headers.get('Authorization')||''
  if(!auth.startsWith('Bearer ')) throw new Error('Not authenticated')
  const userClient=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:auth}}})
  const {data:{user}}=await userClient.auth.getUser()
  if(!user?.email) throw new Error('Not authenticated')
  const {data:isAdmin,error}=await userClient.rpc('_is_platform_admin')
  if(error||!isAdmin) throw new Error('Platform admin required')
  return {userClient,user}
}

async function getTransport(){
  const {data,error}=await svc.rpc('romylabs_stalwart_transport_for_product',{p_product_key:'romylabs'})
  if(error) throw error
  if(!data?.ok||!data?.host||!data?.username||!data?.password) throw new Error(data?.error||'RomyLabs Stalwart credential unavailable')
  return data
}

async function jmapSession(transport:any){
  const base='https://'+String(transport.host).replace(/^https?:\/\//,'').replace(/\/$/,'')
  const auth='Basic '+btoa(String(transport.username)+':'+String(transport.password))
  const res=await fetch(base+'/.well-known/jmap',{headers:{Authorization:auth,Accept:'application/json'}})
  if(!res.ok) throw new Error('Stalwart JMAP session failed ('+res.status+')')
  const session=await res.json()
  const apiUrl=String(session?.apiUrl||'').replace('{accountId}','')
  const accountId=session?.primaryAccounts?.['urn:ietf:params:jmap:mail']||Object.keys(session?.accounts||{})[0]
  if(!apiUrl||!accountId) throw new Error('Stalwart JMAP mail account unavailable')
  return {auth,apiUrl,accountId}
}

async function callJmap(j:any,methodCalls:any[]){
  const res=await fetch(j.apiUrl,{method:'POST',headers:{Authorization:j.auth,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({
    using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail','urn:ietf:params:jmap:submission'],
    methodCalls,
  })})
  if(!res.ok) throw new Error('Stalwart JMAP request failed ('+res.status+')')
  return await res.json()
}

async function routes(){
  const {data,error}=await svc.from('romylabs_mailboxes').select('id,product_id,email_address,outbound_from,display_name,inbox_owner,active').eq('active',true)
  if(error) throw error
  return data||[]
}
function matchRoute(message:any,allRoutes:any[]){
  const addresses=[...(message?.to||[]),...(message?.cc||[])].map((x:any)=>norm(x?.email)).filter(Boolean)
  for(const address of addresses){
    const route=allRoutes.find(r=>norm(r.email_address)===address)
    if(route) return route
  }
  return allRoutes.find(r=>norm(r.email_address)==='info@romylabs.com')||null
}
function firstResponse(payload:any,name:string,tag?:string){
  return payload?.methodResponses?.find((x:any)=>x?.[0]===name&&(!tag||x?.[2]===tag))?.[1]
}
function bodyText(message:any){
  const values=message?.bodyValues||{}
  for(const part of message?.textBody||[]){
    const v=values?.[part.partId]?.value
    if(v) return String(v)
  }
  for(const part of message?.htmlBody||[]){
    const v=values?.[part.partId]?.value
    if(v) return String(v)
  }
  return String(message?.preview||'')
}

async function metadata(j:any){
  const p=await callJmap(j,[
    ['Mailbox/get',{accountId:j.accountId,properties:['id','name','role','totalEmails','unreadEmails']},'m'],
    ['Identity/get',{accountId:j.accountId},'i'],
  ])
  const boxes=firstResponse(p,'Mailbox/get','m')?.list||[]
  const identities=firstResponse(p,'Identity/get','i')?.list||[]
  return {boxes,identities}
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders})
  if(req.method!=='POST') return json({ok:false,error:'Method not allowed'},405)
  try{
    await requirePlatformAdmin(req)
    const body=await req.json().catch(()=>({}))
    const action=String(body?.action||'list')
    const transport=await getTransport()
    const j=await jmapSession(transport)
    const allRoutes=await routes()

    if(action==='list'){
      const meta=await metadata(j)
      const inbox=meta.boxes.find((x:any)=>String(x?.role||'').toLowerCase()==='inbox')
      if(!inbox?.id) throw new Error('Stalwart Inbox mailbox unavailable')
      const q=await callJmap(j,[['Email/query',{
        accountId:j.accountId,
        filter:{inMailbox:inbox.id},
        sort:[{property:'receivedAt',isAscending:false}],
        limit:Math.min(Math.max(Number(body?.limit)||100,1),250),
      },'q']])
      const ids=firstResponse(q,'Email/query','q')?.ids||[]
      if(!ids.length) return json({ok:true,messages:[],identities:meta.identities.map((x:any)=>({id:x.id,name:x.name,email:x.email})),mailboxes:meta.boxes})
      const g=await callJmap(j,[['Email/get',{
        accountId:j.accountId,ids,
        properties:['id','threadId','mailboxIds','keywords','from','to','cc','replyTo','subject','receivedAt','sentAt','messageId','inReplyTo','references','preview','hasAttachment','size'],
      },'g']])
      const list=firstResponse(g,'Email/get','g')?.list||[]
      const messages=list.map((m:any)=>{
        const route=matchRoute(m,allRoutes)
        return {...m,replyFrom:route?.outbound_from||route?.email_address||null,routeId:route?.id||null,productId:route?.product_id||null,brandName:route?.display_name||null}
      })
      return json({ok:true,messages,identities:meta.identities.map((x:any)=>({id:x.id,name:x.name,email:x.email})),mailboxes:meta.boxes})
    }

    if(action==='get'){
      const emailId=String(body?.emailId||'')
      if(!emailId) throw new Error('emailId required')
      const g=await callJmap(j,[['Email/get',{
        accountId:j.accountId,ids:[emailId],
        properties:['id','threadId','mailboxIds','keywords','from','to','cc','bcc','replyTo','subject','receivedAt','sentAt','messageId','inReplyTo','references','preview','textBody','htmlBody','bodyValues','hasAttachment','attachments','size'],
        fetchTextBodyValues:true,fetchHTMLBodyValues:true,maxBodyValueBytes:300000,
      },'g']])
      const m=firstResponse(g,'Email/get','g')?.list?.[0]
      if(!m) throw new Error('Message not found')
      const route=matchRoute(m,allRoutes)
      return json({ok:true,message:{...m,body:bodyText(m),replyFrom:route?.outbound_from||route?.email_address||null,routeId:route?.id||null,productId:route?.product_id||null,brandName:route?.display_name||null}})
    }

    if(action==='reply'){
      const emailId=String(body?.emailId||'')
      const replyBody=String(body?.body||'').trim()
      if(!emailId||!replyBody) throw new Error('Message and reply body required')
      const g=await callJmap(j,[['Email/get',{
        accountId:j.accountId,ids:[emailId],
        properties:['id','threadId','from','to','cc','replyTo','subject','messageId','references'],
      },'g']])
      const original=firstResponse(g,'Email/get','g')?.list?.[0]
      if(!original) throw new Error('Original message not found')
      const route=matchRoute(original,allRoutes)
      if(!route) throw new Error('No RomyLabs mailbox route matches the original recipient')
      const exactFrom=norm(route.outbound_from||route.email_address)
      const recipient=norm(original?.replyTo?.[0]?.email||original?.from?.[0]?.email)
      if(!recipient) throw new Error('Original sender address unavailable')
      const meta=await metadata(j)
      const identity=meta.identities.find((x:any)=>norm(x?.email)===exactFrom)
      if(!identity?.id) throw new Error('Stalwart does not authorize sender identity '+exactFrom)
      const drafts=meta.boxes.find((x:any)=>String(x?.role||'').toLowerCase()==='drafts')
      const sent=meta.boxes.find((x:any)=>String(x?.role||'').toLowerCase()==='sent')
      if(!drafts?.id||!sent?.id) throw new Error('Stalwart Drafts or Sent mailbox unavailable')
      const originalIds=Array.isArray(original?.messageId)?original.messageId.filter(Boolean):[]
      const refs=[...(Array.isArray(original?.references)?original.references:[]),...originalIds].filter(Boolean)
      const subject=/^re:/i.test(String(original.subject||''))?String(original.subject||''):('Re: '+String(original.subject||''))
      const partId='body'
      const draft:any={
        from:[{email:exactFrom,name:route.display_name||undefined}],
        to:[{email:recipient}],
        subject,
        mailboxIds:{[drafts.id]:true},
        keywords:{'$draft':true},
        bodyValues:{[partId]:{value:replyBody,charset:'utf-8'}},
        textBody:[{partId,type:'text/plain'}],
      }
      if(originalIds.length) draft['header:In-Reply-To:asMessageIds']=originalIds
      if(refs.length) draft['header:References:asMessageIds']=refs
      const send=await callJmap(j,[
        ['Email/set',{accountId:j.accountId,create:{draft}},'e'],
        ['EmailSubmission/set',{accountId:j.accountId,create:{sendIt:{emailId:'#draft',identityId:identity.id}},onSuccessUpdateEmail:{'#sendIt':{['mailboxIds/'+drafts.id]:null,['mailboxIds/'+sent.id]:true,'keywords/$draft':null}}},'s'],
      ])
      const e=firstResponse(send,'Email/set','e')
      const s=firstResponse(send,'EmailSubmission/set','s')
      if(e?.notCreated?.draft) throw new Error(e.notCreated.draft.description||e.notCreated.draft.type||'Draft rejected')
      if(s?.notCreated?.sendIt) throw new Error(s.notCreated.sendIt.description||s.notCreated.sendIt.type||'Send rejected')
      if(!s?.created?.sendIt?.id) throw new Error('Stalwart did not confirm submission')
      return json({ok:true,from:exactFrom,to:recipient,submissionId:s.created.sendIt.id})
    }

    return json({ok:false,error:'Unknown action'},400)
  }catch(err){
    console.error('romylabs-mailbox error',err)
    return json({ok:false,error:err instanceof Error?err.message:String(err)},500)
  }
})
