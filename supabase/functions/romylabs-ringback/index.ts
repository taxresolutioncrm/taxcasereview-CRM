// RomyLabs-only caller ringback while the Admin Portal agent answers.
// An unanswered call must sound like it is ringing, not play hold music.
// Public GET serves only static ringback WAV / safe fixed CXML; no credentials or user data.
const RATE=8000
const CYCLE_SECONDS=6
const generate=()=>{
  const samples=RATE*CYCLE_SECONDS
  const out=new Uint8Array(44+samples*2)
  const view=new DataView(out.buffer)
  const write=(at,str)=>{for(let n=0;n<str.length;n++)out[at+n]=str.charCodeAt(n)}
  write(0,'RIFF');view.setUint32(4,out.length-8,true);write(8,'WAVE')
  write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true)
  view.setUint16(22,1,true);view.setUint32(24,RATE,true)
  view.setUint32(28,RATE*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true)
  write(36,'data');view.setUint32(40,samples*2,true)
  for(let n=0;n<samples;n++){
    const t=n/RATE
    const active=t<2
    // Gentle fades avoid audible pops at the start and end of each ring.
    const fade=Math.min(1,t/.012,(2-t)/.012)
    const amplitude=active?Math.max(0,fade)*0.16:0
    const sample=amplitude*(Math.sin(2*Math.PI*440*t)+Math.sin(2*Math.PI*480*t))/2
    view.setInt16(44+n*2,Math.round(sample*32767),true)
  }
  return out
}
const audio=generate()
Deno.serve(req=>{
  if(req.method!=='GET'&&req.method!=='POST')return new Response('Method not allowed',{status:405,headers:{Allow:'GET, POST'}})
  const url=new URL(req.url)
  if(url.searchParams.get('audio')==='1'){
    return new Response(audio.slice(),{headers:{'Content-Type':'audio/wav','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'}})
  }
  const playUrl=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'')+'/functions/v1/romylabs-ringback?audio=1'
  const cxml='<?xml version="1.0" encoding="UTF-8"?><Response><Play loop="0">'+playUrl+'</Play></Response>'
  return new Response(cxml,{headers:{'Content-Type':'text/xml; charset=utf-8','Cache-Control':'no-store'}})
})
