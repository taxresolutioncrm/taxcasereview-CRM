import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')||''
const SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
const ADMIN_TENANT='a0000000-0000-0000-0000-000000000001'
const ADMIN_PRODUCT='romylabs'
const ADMIN_OWNER='Romy Cruz'
const ADMIN_TZ='America/New_York'
const db=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false}})
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})

function norm(v:any){return String(v??'').trim()}
function lower(v:any){return norm(v).toLowerCase()}
function htmlDecode(s:string){return s.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')}
function stripHtml(s:string){return htmlDecode(s.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s+/g,'\n').trim()}
function unfoldIcs(raw:string){return raw.replace(/\r?\n[ \t]/g,'').replace(/\r\n/g,'\n')}
function unescapeIcs(v:string){return v.replace(/\\n/gi,'\n').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\').trim()}
function fnv1a(s:string){
  let h=0x811c9dc5
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}
  return h.toString(16).padStart(8,'0')
}
function findUrls(text:string){
  const cleaned=htmlDecode(text||'')
  return [...new Set((cleaned.match(/https?:\/\/[^\s<>"']+/gi)||[]).map(u=>u.replace(/[),.;]+$/,'')))]
}
function meetingUrl(text:string){
  const urls=findUrls(text)
  const preferred=[
    /teams\.microsoft\.com/i,/meet\.google\.com/i,/zoom\.us/i,/webex\.com/i,
    /gotomeeting\.com/i,/whereby\.com/i,/meet\.jit\.si/i,
  ]
  for(const rx of preferred){const hit=urls.find(u=>rx.test(u));if(hit)return hit}
  return urls[0]||''
}
function mapTz(tzid:string){
  const t=norm(tzid).replace(/^"|"$/g,'')
  const map:Record<string,string>={
    'Eastern Standard Time':'America/New_York',
    'Central Standard Time':'America/Chicago',
    'Mountain Standard Time':'America/Denver',
    'Pacific Standard Time':'America/Los_Angeles',
    'UTC':'UTC','GMT Standard Time':'Europe/London',
  }
  return map[t]||t||ADMIN_TZ
}
function componentsFromIcs(v:string){
  const m=v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/)
  if(!m)return null
  return {y:+m[1],mo:+m[2],d:+m[3],h:+(m[4]||0),mi:+(m[5]||0),s:+(m[6]||0),z:!!m[7],allDay:!m[4]}
}
function partsInZone(date:Date,tz:string){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date)
  const o:any={};for(const p of parts)o[p.type]=p.value
  return {y:+o.year,mo:+o.month,d:+o.day,h:+o.hour,mi:+o.minute,s:+o.second}
}
function zonedToUtc(c:any,tz:string){
  let guess=Date.UTC(c.y,c.mo-1,c.d,c.h,c.mi,c.s)
  for(let i=0;i<3;i++){
    const got=partsInZone(new Date(guess),tz)
    const want=Date.UTC(c.y,c.mo-1,c.d,c.h,c.mi,c.s)
    const have=Date.UTC(got.y,got.mo-1,got.d,got.h,got.mi,got.s)
    guess+=want-have
  }
  return new Date(guess)
}
function parseIcsDate(value:string,tzid:string){
  const c=componentsFromIcs(value.trim())
  if(!c)return null
  if(c.allDay)return {date:`${String(c.y).padStart(4,'0')}-${String(c.mo).padStart(2,'0')}-${String(c.d).padStart(2,'0')}`,time:'00:00',absolute:new Date(Date.UTC(c.y,c.mo-1,c.d,12,0,0)),allDay:true}
  const absolute=c.z?new Date(Date.UTC(c.y,c.mo-1,c.d,c.h,c.mi,c.s)):zonedToUtc(c,mapTz(tzid))
  const p=partsInZone(absolute,ADMIN_TZ)
  return {date:`${String(p.y).padStart(4,'0')}-${String(p.mo).padStart(2,'0')}-${String(p.d).padStart(2,'0')}`,time:`${String(p.h).padStart(2,'0')}:${String(p.mi).padStart(2,'0')}`,absolute,allDay:false}
}
function parseProp(line:string){
  const idx=line.indexOf(':');if(idx<0)return null
  const left=line.slice(0,idx),value=line.slice(idx+1)
  const bits=left.split(';'),name=bits.shift()!.toUpperCase()
  const params:any={}
  for(const b of bits){const i=b.indexOf('=');if(i>0)params[b.slice(0,i).toUpperCase()]=b.slice(i+1)}
  return {name,params,value}
}
function parseIcs(raw:string,extraText=''){
  const lines=unfoldIcs(raw).split('\n')
  let inEvent=false
  const p:any={}
  let method=''
  for(const line0 of lines){
    const line=line0.trimEnd()
    if(/^METHOD:/i.test(line))method=line.slice(line.indexOf(':')+1).trim().toUpperCase()
    if(/^BEGIN:VEVENT/i.test(line)){inEvent=true;continue}
    if(/^END:VEVENT/i.test(line)){break}
    if(!inEvent)continue
    const x=parseProp(line);if(!x)continue
    if(p[x.name]===undefined)p[x.name]=x
  }
  if(!p.DTSTART?.value)return null
  const start=parseIcsDate(p.DTSTART.value,p.DTSTART.params?.TZID||'')
  if(!start)return null
  const end=p.DTEND?.value?parseIcsDate(p.DTEND.value,p.DTEND.params?.TZID||p.DTSTART.params?.TZID||''):null
  let endTime=end?.time||''
  if(!endTime&&!start.allDay){
    const e=new Date(start.absolute.getTime()+60*60*1000),ep=partsInZone(e,ADMIN_TZ)
    endTime=`${String(ep.h).padStart(2,'0')}:${String(ep.mi).padStart(2,'0')}`
  }
  const organizerRaw=p.ORGANIZER?.value||''
  const organizerEmail=organizerRaw.replace(/^mailto:/i,'').trim()
  const organizerName=unescapeIcs(p.ORGANIZER?.params?.CN||'').replace(/^"|"$/g,'')
  const desc=unescapeIcs(p.DESCRIPTION?.value||'')
  const loc=unescapeIcs(p.LOCATION?.value||'')
  const url=unescapeIcs(p.URL?.value||'')||meetingUrl([desc,loc,extraText].join('\n'))
  const uid=unescapeIcs(p.UID?.value||'')||`fallback-${fnv1a([p.SUMMARY?.value,start.date,start.time,organizerEmail].join('|'))}`
  const status=upper(p.STATUS?.value||'')
  const cancelled=method==='CANCEL'||status==='CANCELLED'
  return {
    uid,
    summary:unescapeIcs(p.SUMMARY?.value||'Calendar Invite')||'Calendar Invite',
    start,end,endTime,
    description:desc,location:loc,url,
    organizerEmail,organizerName,
    method:method||'REQUEST',
    sequence:Number(p.SEQUENCE?.value||0)||0,
    cancelled,
  }
}
function upper(v:any){return norm(v).toUpperCase()}
function traversePart(part:any,out:any[]=[]){
  if(!part)return out
  out.push(part)
  for(const c of part.subParts||[])traversePart(c,out)
  return out
}
function googleLink(url:string){
  try{
    const u=new URL(htmlDecode(url))
    if(!/calendar\.google\.com$/i.test(u.hostname)&&!/calendar\.google\.com/i.test(u.hostname))return null
    if(upper(u.searchParams.get('action'))!=='TEMPLATE')return null
    const dates=u.searchParams.get('dates')||'', [a,b]=dates.split('/')
    if(!a)return null
    const start=parseIcsDate(a,'UTC'),end=b?parseIcsDate(b,'UTC'):null
    if(!start)return null
    return {uid:'google-'+fnv1a(url),summary:u.searchParams.get('text')||'Calendar Invite',start,end,endTime:end?.time||'',description:u.searchParams.get('details')||'',location:u.searchParams.get('location')||'',url:meetingUrl((u.searchParams.get('details')||'')+' '+(u.searchParams.get('location')||'')),organizerEmail:'',organizerName:'',method:'REQUEST',sequence:0,cancelled:false}
  }catch{return null}
}
function outlookLink(url:string){
  try{
    const u=new URL(htmlDecode(url))
    if(!/outlook\.(office\.com|live\.com)|outlook\.office365\.com/i.test(u.hostname))return null
    const a=u.searchParams.get('startdt')||u.searchParams.get('start'), b=u.searchParams.get('enddt')||u.searchParams.get('end')
    if(!a)return null
    const da=new Date(a);if(Number.isNaN(da.getTime()))return null
    const dbb=b?new Date(b):new Date(da.getTime()+3600000)
    const sp=partsInZone(da,ADMIN_TZ),ep=partsInZone(dbb,ADMIN_TZ)
    const start={date:`${sp.y}-${String(sp.mo).padStart(2,'0')}-${String(sp.d).padStart(2,'0')}`,time:`${String(sp.h).padStart(2,'0')}:${String(sp.mi).padStart(2,'0')}`,absolute:da,allDay:false}
    const end={date:`${ep.y}-${String(ep.mo).padStart(2,'0')}-${String(ep.d).padStart(2,'0')}`,time:`${String(ep.h).padStart(2,'0')}:${String(ep.mi).padStart(2,'0')}`,absolute:dbb,allDay:false}
    const desc=u.searchParams.get('body')||''
    const loc=u.searchParams.get('location')||''
    return {uid:'outlook-'+fnv1a(url),summary:u.searchParams.get('subject')||'Calendar Invite',start,end,endTime:end.time,description:desc,location:loc,url:meetingUrl(desc+' '+loc),organizerEmail:'',organizerName:'',method:'REQUEST',sequence:0,cancelled:false}
  }catch{return null}
}
async function transport(product:string){
  const {data,error}=await db.rpc('romylabs_stalwart_transport_for_product',{p_product_key:product})
  if(error)throw error
  if(!data?.ok)throw new Error(data?.error||'Stalwart transport unavailable')
  return data
}
async function session(t:any){
  const base='https://'+String(t.host).replace(/^https?:\/\//,'').replace(/\/$/,'')
  const auth='Basic '+btoa(String(t.username)+':'+String(t.password))
  const r=await fetch(base+'/.well-known/jmap',{headers:{Authorization:auth,Accept:'application/json'}})
  if(!r.ok)throw new Error('JMAP session failed '+r.status)
  const s=await r.json()
  const accountId=s?.primaryAccounts?.['urn:ietf:params:jmap:mail']||Object.keys(s?.accounts||{})[0]
  if(!accountId||!s?.apiUrl)throw new Error('JMAP mail account missing')
  return {auth,accountId,apiUrl:String(s.apiUrl).replace('{accountId}',''),downloadUrl:String(s.downloadUrl||'')}
}
async function call(j:any,calls:any[]){
  const r=await fetch(j.apiUrl,{method:'POST',headers:{Authorization:j.auth,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({using:['urn:ietf:params:jmap:core','urn:ietf:params:jmap:mail'],methodCalls:calls})})
  if(!r.ok)throw new Error('JMAP request failed '+r.status)
  return await r.json()
}
function response(p:any,name:string,tag:string){return p?.methodResponses?.find((x:any)=>x?.[0]===name&&x?.[2]===tag)?.[1]}
async function downloadPart(j:any,part:any){
  if(!part?.blobId||!j.downloadUrl)return ''
  const url=j.downloadUrl.replace('{accountId}',encodeURIComponent(j.accountId)).replace('{blobId}',encodeURIComponent(part.blobId)).replace('{name}',encodeURIComponent(part.name||'invite.ics')).replace('{type}',encodeURIComponent(part.type||'text/calendar'))
  const r=await fetch(url,{headers:{Authorization:j.auth}})
  return r.ok?await r.text():''
}
async function extractInvite(j:any,m:any){
  const parts=traversePart(m.bodyStructure)
  const calendarParts=parts.filter((p:any)=>lower(p.type)==='text/calendar'||/\.ics$/i.test(norm(p.name)))
  let ics=''
  for(const part of calendarParts){
    const inline=m.bodyValues?.[part.partId]?.value
    ics=inline?String(inline):await downloadPart(j,part)
    if(/BEGIN:VCALENDAR/i.test(ics))break
  }
  const textParts=[...(m.textBody||[]),...(m.htmlBody||[])].map((p:any)=>String(m.bodyValues?.[p.partId]?.value||'')).filter(Boolean)
  const bodyText=textParts.map((x:string)=>stripHtml(x)).join('\n')
  if(!ics){
    const hit=textParts.join('\n').match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i)
    if(hit)ics=hit[0]
  }
  if(ics){const parsed=parseIcs(ics,bodyText);if(parsed)return parsed}
  for(const url of findUrls(textParts.join('\n'))){
    const x=googleLink(url)||outlookLink(url)
    if(x)return x
  }
  return null
}
async function saveInvite(inv:any,m:any,dryRun:boolean){
  const sender=norm(m.from?.[0]?.email||inv.organizerEmail||'')
  const uid=norm(inv.uid)
  const marker='ICS-UID:'+uid
  const notes=[
    inv.description,
    inv.location?('Location: '+inv.location):'',
    inv.url?('Meeting link: '+inv.url):'',
    marker,
    'ICS-Sequence:'+String(inv.sequence||0),
    inv.sourceProduct?('Mailbox product: '+inv.sourceProduct):'',
  ].filter(Boolean).join('\n')
  const id='ics-'+fnv1a(uid)
  const payload:any={
    id,title:inv.summary||'Calendar Invite',"clientName":inv.organizerName||((inv.organizerEmail||sender||'').split('@')[0]||'').replace(/[._-]+/g,' ').replace(/\b\w/g,(m:string)=>m.toUpperCase())||null,
    date:inv.start.date,time:inv.start.time,'endTime':inv.endTime||'',
    'eventType':inv.cancelled?'Meeting':'Pending',status:inv.cancelled?'cancelled':'pending',
    notes,source:'ics_auto','assignedTo':ADMIN_OWNER,contact_email:inv.organizerEmail||sender||null,
    product_id:inv.sourceProduct||ADMIN_PRODUCT,tenant_id:ADMIN_TENANT,updated_at:new Date().toISOString(),
  }
  if(dryRun)return {action:'dry_run',payload}
  const {data:exact}=await db.from('calevents').select('id,notes,date,title,contact_email').eq('id',id).maybeSingle()
  if(exact){
    const {error}=await db.from('calevents').update(payload).eq('id',id);if(error)throw error
    return {action:'updated',id}
  }
  const {data:byMarker}=await db.from('calevents').select('id').eq('source','ics_auto').ilike('notes','%'+marker.replace(/[%_]/g,'')+'%').limit(1).maybeSingle()
  if(byMarker?.id){
    delete payload.id
    const {error}=await db.from('calevents').update(payload).eq('id',byMarker.id);if(error)throw error
    return {action:'updated_uid',id:byMarker.id}
  }
  const {data:broken}=await db.from('calevents').select('id,date').eq('source','ics_auto').eq('tenant_id',ADMIN_TENANT).eq('title',payload.title).eq('contact_email',payload.contact_email).lt('date','2020-01-01').order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(broken?.id){
    delete payload.id
    const {error}=await db.from('calevents').update(payload).eq('id',broken.id);if(error)throw error
    return {action:'repaired_broken',id:broken.id}
  }
  payload.created_at=new Date().toISOString()
  const {error}=await db.from('calevents').insert(payload);if(error)throw error
  return {action:'inserted',id}
}

Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({ok:false,error:'Method not allowed'},405)
  const serviceAuth=req.headers.get('authorization')===`Bearer ${SERVICE_KEY}`
  const cronToken=req.headers.get('x-internal-cron-token')||''
  let authorized=serviceAuth
  if(!authorized&&cronToken){const {data,error}=await db.rpc('verify_internal_cron_token',{provided:cronToken});authorized=!error&&data===true}
  if(!authorized)return json({ok:false,error:'Unauthorized'},401)
  try{
    const body=await req.json().catch(()=>({}))
    const dryRun=body?.dry_run===true
    const limit=Math.min(Math.max(Number(body?.limit)||40,1),100)
    let products:string[]=[]
    if(Array.isArray(body?.products)&&body.products.length){
      products=[...new Set(body.products.map((x:any)=>String(x)).filter(Boolean))]
    }else{
      const {data:configured,error:configuredError}=await db.from('credential_vault_entries')
        .select('product_id,service')
        .ilike('service','Stalwart')
        .not('product_id','is',null)
      if(configuredError)throw configuredError
      products=[...new Set((configured||[]).map((x:any)=>String(x.product_id||'')).filter(Boolean))]
      if(!products.length)products=['romylabs']
    }
    const allDiagnostics:any[]=[]
    const changes:any[]=[]
    let scanned=0
    const mailboxErrors:any[]=[]
    for(const product of products){
      try{
        const t=await transport(product),j=await session(t)
        const meta=await call(j,[['Mailbox/get',{accountId:j.accountId,properties:['id','role','name']},'m']])
        const inbox=response(meta,'Mailbox/get','m')?.list?.find((x:any)=>lower(x.role)==='inbox')
        if(!inbox?.id)throw new Error('Stalwart Inbox unavailable')
        const q=await call(j,[['Email/query',{accountId:j.accountId,filter:{inMailbox:inbox.id},sort:[{property:'receivedAt',isAscending:false}],limit},'q']])
        const ids=response(q,'Email/query','q')?.ids||[]
        if(!ids.length)continue
        const g=await call(j,[['Email/get',{accountId:j.accountId,ids,properties:['id','threadId','from','to','subject','receivedAt','bodyStructure','textBody','htmlBody','bodyValues'],fetchAllBodyValues:true,maxBodyValueBytes:1000000},'g']])
        const list=response(g,'Email/get','g')?.list||[]
        scanned+=list.length
        if(body?.debug===true){
          allDiagnostics.push(...list.map((m:any)=>({
            product,
            emailId:m.id,
            subject:m.subject,
            receivedAt:m.receivedAt,
            from:m.from?.[0]?.email||'',
            parts:traversePart(m.bodyStructure).map((p:any)=>({partId:p.partId||'',type:p.type||'',name:p.name||'',disposition:p.disposition||'',hasInlineValue:!!m.bodyValues?.[p.partId]?.value,blobId:!!p.blobId})),
            urls:findUrls([...(m.textBody||[]),...(m.htmlBody||[])].map((p:any)=>String(m.bodyValues?.[p.partId]?.value||'')).join('\n')).slice(0,10),
          })))
          continue
        }
        for(const m of list){
          try{
            const inv=await extractInvite(j,m)
            if(!inv)continue
            inv.sourceProduct=product
            const result=await saveInvite(inv,m,dryRun)
            changes.push({product,emailId:m.id,subject:m.subject,receivedAt:m.receivedAt,invite:{uid:inv.uid,summary:inv.summary,date:inv.start.date,time:inv.start.time,endTime:inv.endTime,url:inv.url,cancelled:inv.cancelled},...result})
          }catch(e){changes.push({product,emailId:m.id,subject:m.subject,error:e instanceof Error?e.message:String(e)})}
        }
      }catch(e){mailboxErrors.push({product,error:e instanceof Error?e.message:String(e)})}
    }
    if(body?.debug===true)return json({ok:mailboxErrors.length===0,dryRun:true,debug:true,scanned,diagnostics:allDiagnostics,mailboxErrors})
    return json({ok:mailboxErrors.length===0,dryRun,scanned,candidates:changes.length,changes,mailboxErrors},mailboxErrors.length?207:200)
  }catch(e){
    console.error('stalwart-calendar-sync',e)
    return json({ok:false,error:e instanceof Error?e.message:String(e)},500)
  }
})
