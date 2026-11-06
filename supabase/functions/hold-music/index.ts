import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Public, brand-neutral hold music for SignalWire Compatibility and Calling APIs.
// Composed and synthesized here: no copyrighted recording, paid audio host or
// separate infrastructure. SignalWire fetches GET ?audio=1 as audio/wav and
// receives this LaML document at the standard function URL.
const RATE = 8000
const DURATION = 16
const NOTES = [261.63,329.63,392.00,523.25, 220,261.63,329.63,440,
               196,246.94,293.66,392, 174.61,220,261.63,349.23]
let cachedAudio: Uint8Array | null = null

function makeMusic(): Uint8Array {
  const samples = RATE * DURATION
  const wav = new Uint8Array(44 + samples * 2)
  const view = new DataView(wav.buffer)
  const tag = (offset:number, str:string) => { for(let i=0;i<str.length;i++)wav[offset+i]=str.charCodeAt(i) }
  tag(0,'RIFF');view.setUint32(4,36+samples*2,true);tag(8,'WAVE')
  tag(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true)
  view.setUint16(22,1,true);view.setUint32(24,RATE,true)
  view.setUint32(28,RATE*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true)
  tag(36,'data');view.setUint32(40,samples*2,true)
  // Original, gently arpeggiated four-chord instrumental, designed to loop.
  // Mild attack/release and a continuous soft harmonic bed avoid harsh clicks.
  for(let i=0;i<samples;i++){
    const t=i/RATE
    const step=Math.floor(t*2)%NOTES.length
    const beat=(t*2)%1
    const freq=NOTES[step]
    const env=Math.min(1,beat*9)*Math.exp(-beat*2.8)
    const note=(Math.sin(2*Math.PI*freq*t)+0.24*Math.sin(4*Math.PI*freq*t))*env
    const root=NOTES[Math.floor(step/4)*4]/2
    const bed=0.19*Math.sin(2*Math.PI*root*t)+0.1*Math.sin(2*Math.PI*(root*1.5)*t)
    const fade=Math.min(1,t*3,(DURATION-t)*3)
    const value=Math.max(-1,Math.min(1,(0.19*note+0.16*bed)*Math.max(0,fade)))
    view.setInt16(44+i*2,Math.round(value*32767),true)
  }
  return wav
}

serve(req=>{
  const url=new URL(req.url)
  if(url.searchParams.get('audio')==='1'){
    cachedAudio ||= makeMusic()
    return new Response(cachedAudio.slice(),{
      headers:{'Content-Type':'audio/wav','Cache-Control':'public, max-age=86400',
        'Content-Length':String(cachedAudio.length),'Access-Control-Allow-Origin':'*'}
    })
  }
  const mediaUrl=new URL(req.url)
  mediaUrl.search='?audio=1'
  const xml='<?xml version="1.0" encoding="UTF-8"?><Response><Play loop="0">'+mediaUrl.toString()+'</Play></Response>'
  return new Response(xml,{headers:{'Content-Type':'application/xml','Cache-Control':'no-store'}})
})
