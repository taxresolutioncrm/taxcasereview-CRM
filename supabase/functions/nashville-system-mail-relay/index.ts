import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SECRET_KEY='nashville_system_mail_relay_v1'
const NASHVILLE_HOST='ydrvncdedgjtcprczwpu.supabase.co'
const ALLOWED_KINDS=new Set(['esign_request','esign_reminder','esign_signed_copy','esign_internal_notification'])
const safe=(v:any)=>String(v??'').replace(/[\r\n]+/g,' ').trim()
const enc=(s:string)=>!s||/^[\x00-\x7F]*$/.test(s)?s:(()=>{const u=new TextEncoder().encode(s);let b='';u.forEach(x=>b+=String.fromCharCode(x));return '=?UTF-8?B?'+btoa(b)+'?='})()
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}})

async function sendSmtp(opts:any){
  const host=safe(opts.host),port=Number(opts.port||465),ssl=port===465||opts.ssl===true
  let conn:any=ssl?await Deno.connectTls({hostname:host,port}):await Deno.connect({hostname:host,port})
  const en=new TextEncoder(),de=new TextDecoder()
  const read=async()=>{const b=new Uint8Array(32768);const n=await conn.read(b);return de.decode(b.subarray(0,n||0))}
  const write=async(s:string)=>{await conn.write(en.encode(s+'\r\n'))}
  const expect=(r:string,codes:string[],step:string)=>{if(!codes.some(c=>r.startsWith(c)))throw new Error(step+' failed')}
  let r=await read();expect(r,['220'],'SMTP connect')
  await write('EHLO taxrescrm.net');r=await read();expect(r,['250'],'SMTP EHLO')
  if(port===587&&!ssl){await write('STARTTLS');r=await read();expect(r,['220'],'SMTP STARTTLS');conn=await Deno.startTls(conn,{hostname:host});await write('EHLO taxrescrm.net');r=await read();expect(r,['250'],'SMTP EHLO TLS')}
  await write('AUTH LOGIN');await read();await write(btoa(opts.username));await read();await write(btoa(opts.password));r=await read();expect(r,['235'],'SMTP auth')
  const from=safe(opts.fromAddress||opts.username)
  await write('MAIL FROM:<'+from+'>');r=await read();expect(r,['250'],'MAIL FROM')
  await write('RCPT TO:<'+opts.to+'>');r=await read();expect(r,['250','251'],'RCPT TO')
  await write('DATA');r=await read();expect(r,['354'],'DATA')
  const atts=Array.isArray(opts.attachments)?opts.attachments:[]
  let message=''
  if(atts.length){
    const bd='nash_'+crypto.randomUUID()
    const headers=[
      'From: '+enc(opts.fromName)+' <'+from+'>',
      'To: '+opts.to,
      ...(opts.replyTo?['Reply-To: '+opts.replyTo]:[]),
      'Subject: '+enc(opts.subject),
      'Date: '+new Date().toUTCString(),
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="'+bd+'"'
    ].join('\r\n')
    const html='--'+bd+'\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n'+opts.html+'\r\n'
    const parts=atts.map((a:any)=>'--'+bd+'\r\nContent-Type: '+(a.contentType||'application/pdf')+'\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="'+safe(a.filename||'document.pdf')+'"\r\n\r\n'+String(a.b64).match(/.{1,76}/g)?.join('\r\n')+'\r\n').join('')
    message=headers+'\r\n\r\n'+html+parts+'--'+bd+'--'
  } else {
    message=[
      'From: '+enc(opts.fromName)+' <'+from+'>',
      'To: '+opts.to,
      ...(opts.replyTo?['Reply-To: '+opts.replyTo]:[]),
      'Subject: '+enc(opts.subject),
      'Date: '+new Date().toUTCString(),
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset="UTF-8"',
      '',
      opts.html
    ].join('\r\n')
  }
  message=message.replace(/\r?\n\./g,'\r\n..')
  await write(message+'\r\n.');r=await read();expect(r,['250'],'SMTP acceptance')
  await write('QUIT');conn.close()
}

Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({error:'POST only'},405)
  try{
    const url=Deno.env.get('SUPABASE_URL')||'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
    const supplied=req.headers.get('x-nashville-relay-secret')||''
    const {data:secretRow}=await admin.from('platform_internal_secrets').select('secret').eq('key',SECRET_KEY).maybeSingle()
    if(!secretRow?.secret||supplied!==secretRow.secret)return json({error:'Unauthorized'},401)
    const body=await req.json().catch(()=>({}))
    const kind=safe(body.kind)
    if(!ALLOWED_KINDS.has(kind))return json({error:'Unsupported Nashville mail kind'},400)
    const to=safe(body.to).toLowerCase(),subject=safe(body.subject).slice(0,300),html=String(body.html||'')
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)||!subject||!html)return json({error:'Recipient, subject, and html required'},400)
    if(new TextEncoder().encode(html).byteLength>1024*1024)return json({error:'Email body too large'},413)
    const attachments:any[]=[]
    let total=0
    for(const a of (Array.isArray(body.attachments)?body.attachments:[]).slice(0,10)){
      const raw=safe(a?.url);if(!raw)continue
      let u:URL;try{u=new URL(raw)}catch{return json({error:'Invalid attachment URL'},400)}
      if(u.protocol!=='https:'||u.hostname!==NASHVILLE_HOST||!u.pathname.startsWith('/storage/v1/object/'))return json({error:'Attachment host not allowed'},400)
      const rr=await fetch(u.toString());if(!rr.ok)return json({error:'Could not load attachment'},400)
      const bytes=new Uint8Array(await rr.arrayBuffer());total+=bytes.length
      if(total>20*1024*1024)return json({error:'Attachments exceed 20 MB'},413)
      let bin='';for(const x of bytes)bin+=String.fromCharCode(x)
      attachments.push({filename:safe(a.filename||'document.pdf'),contentType:rr.headers.get('content-type')||'application/pdf',b64:btoa(bin)})
    }
    const {data:t}=await admin.rpc('romylabs_stalwart_transport_for_product',{p_product_key:'taxres_crm'})
    if(!t?.ok||!t?.username||!t?.password)return json({error:'TaxRes Stalwart transport unavailable'},503)
    if(body?.dry_run===true) return json({success:true,dry_run:true,delivery:false,via:'taxres_stalwart_relay',kind})
    await sendSmtp({
      host:t.host||'mail.taxrescrm.net',port:Number(t.port||465),ssl:true,
      username:t.username,password:t.password,fromAddress:t.from_address||t.username,
      fromName:'Nashville Tax Solutions via TaxRes CRM',replyTo:'admin@nashvilletaxsolutions.com',
      to,subject,html,attachments
    })
    return json({success:true,via:'taxres_stalwart_relay',kind})
  }catch(e){console.error('[nashville-system-mail-relay]',e);return json({error:e instanceof Error?e.message:String(e)},500)}
})