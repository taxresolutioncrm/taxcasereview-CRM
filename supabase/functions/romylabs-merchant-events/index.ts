// RomyLabs SaaS payment event receiver — deliberately fail-closed until ledger mapping is certified.
// Helcim webhook delivery URL must NOT contain "Helcim" (provider requirement).
const json=(o:unknown,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}})
const encoder=new TextEncoder()
function parseSignatures(value:string){return value.split(/\s+/).map(s=>s.trim().split(',')).filter(a=>a.length===2&&a[0]==='v1').map(a=>a[1])}
function equal(a:Uint8Array,b:Uint8Array){let x=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)x|=(a[i]||0)^(b[i]||0);return x===0}
function fromBase64(value:string){try{return Uint8Array.from(atob(value),c=>c.charCodeAt(0))}catch{return null}}
Deno.serve(async req=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  const token=Deno.env.get('HELCIM_WEBHOOK_VERIFIER_TOKEN')
  const apiToken=Deno.env.get('HELCIM_API_TOKEN')
  if(!token||!apiToken)return json({error:'Webhook not configured'},503)
  const id=req.headers.get('webhook-id')||'',ts=req.headers.get('webhook-timestamp')||'',sig=req.headers.get('webhook-signature')||''
  if(!/^msg_[a-zA-Z0-9_-]{8,120}$/.test(id)||!/^\d{10,13}$/.test(ts))return json({error:'Invalid webhook metadata'},401)
  const seconds=Number(ts),t=seconds>1e12?seconds/1000:seconds
  if(!Number.isFinite(t)||Math.abs(Date.now()/1000-t)>300)return json({error:'Expired webhook'},401)
  const raw=await req.text()
  if(raw.length>32768)return json({error:'Payload too large'},413)
  const key=fromBase64(token);if(!key||key.length<16)return json({error:'Webhook configuration invalid'},503)
  const cryptoKey=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const expected=new Uint8Array(await crypto.subtle.sign('HMAC',cryptoKey,encoder.encode(`${id}.${ts}.${raw}`)))
  const verified=parseSignatures(sig).some(s=>{const b=fromBase64(s);return b!==null&&equal(b,expected)})
  if(!verified)return json({error:'Invalid signature'},401)
  let event:any;try{event=JSON.parse(raw)}catch{return json({error:'Invalid JSON'},400)}
  if(event?.type!=='cardTransaction'||!/^[0-9]{1,18}$/.test(String(event.id||'')))return json({error:'Unsupported event'},422)
  // Never trust webhook data for payment status: fetch provider's source-of-truth transaction.
  const response=await fetch('https://api.helcim.com/v2/card-transactions/'+encodeURIComponent(String(event.id)),{headers:{'api-token':apiToken,'accept':'application/json'},signal:AbortSignal.timeout(9000)}).catch(()=>null)
  if(!response||!response.ok)return json({error:'Provider transaction verification unavailable'},503)
  // No ledger mutation until the Helcim invoice mapping, idempotency and authorized settlement
  // adapter are implemented and tested. 503 requests retry rather than silently lose payments.
  return json({error:'Verified event, ledger adapter not yet enabled'},503)
})
