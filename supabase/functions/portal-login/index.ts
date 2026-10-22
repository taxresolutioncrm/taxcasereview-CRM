// portal-login
// Verifies a client/lead portal login SERVER-SIDE (email + last-4-of-SSN),
// issues an opaque session token, and rate-limits brute-force attempts.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SESSION_HOURS = 12
const WINDOW_MS = 15 * 60 * 1000
const BLOCK_MS = 30 * 60 * 1000
const ID_MAX_FAILURES = 5
const IP_MAX_FAILURES = 20
const json=(body:unknown,status=200,extra:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json',...extra}})

async function sha256(value:string){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('')
}

async function rateRow(sb:any,scope:string,keyHash:string){
  const {data}=await sb.from('public_auth_rate_limits').select('failures,first_failed_at,blocked_until').eq('scope',scope).eq('key_hash',keyHash).maybeSingle()
  return data||null
}

async function isBlocked(sb:any,scope:string,keyHash:string){
  const row=await rateRow(sb,scope,keyHash)
  return !!row?.blocked_until && new Date(row.blocked_until).getTime()>Date.now()
}

async function recordFailure(sb:any,scope:string,keyHash:string,maxFailures:number){
  const now=Date.now(),row=await rateRow(sb,scope,keyHash)
  const first=row?.first_failed_at?new Date(row.first_failed_at).getTime():0
  const within=first>0 && now-first<WINDOW_MS
  const failures=within?Number(row?.failures||0)+1:1
  const firstFailedAt=within?new Date(first).toISOString():new Date(now).toISOString()
  const blockedUntil=failures>=maxFailures?new Date(now+BLOCK_MS).toISOString():null
  await sb.from('public_auth_rate_limits').upsert({scope,key_hash:keyHash,failures,first_failed_at:firstFailedAt,blocked_until:blockedUntil,updated_at:new Date(now).toISOString()},{onConflict:'scope,key_hash'})
}

async function clearFailure(sb:any,scope:string,keyHash:string){
  await sb.from('public_auth_rate_limits').delete().eq('scope',scope).eq('key_hash',keyHash)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({error:'Method not allowed'},405)
  try {
    const { id, email, pin } = await req.json()
    if (!id || !email || !pin) return json({ error: 'Missing required fields' },400)

    const normalizedId=String(id).trim()
    const normalizedEmail=String(email).trim().toLowerCase()
    const normalizedPin=String(pin).trim()
    if(normalizedId.length>128||normalizedEmail.length>320||normalizedPin.length>16)return json({error:'Invalid request'},400)

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const ip=String(req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim().slice(0,128)
    const idKey=await sha256(`${normalizedId}|${normalizedEmail}`)
    const ipKey=await sha256(ip)
    if(await isBlocked(supabase,'portal_login_id',idKey)||await isBlocked(supabase,'portal_login_ip',ipKey)){
      return json({error:'Too many attempts. Please try again later.'},429,{'Retry-After':'1800'})
    }

    let { data: record } = await supabase.from('clients').select('id,name,email,tenant_id').eq('id', normalizedId).maybeSingle()
    let isLead = false
    if (!record) {
      const { data: l } = await supabase.from('leads').select('id,name,ssn,email,tenant_id').eq('id', normalizedId).maybeSingle()
      if (l) { record = l; isLead = true }
    }

    const fail=async()=>{
      await Promise.all([
        recordFailure(supabase,'portal_login_id',idKey,ID_MAX_FAILURES),
        recordFailure(supabase,'portal_login_ip',ipKey,IP_MAX_FAILURES),
      ])
      return json({ error: "That information doesn't match what we have on file. Contact your representative if you need help accessing your portal." },401)
    }

    if (!record) return await fail()
    let portalSsn = ''
    if (!isLead) {
      const { data: sensitive, error: sensitiveErr } = await supabase.from('client_sensitive_fields')
        .select('ssn')
        .eq('tenant_id', record.tenant_id)
        .eq('client_id', String(record.id))
        .maybeSingle()
      if (sensitiveErr) {
        console.error('[portal-login] protected SSN lookup failed:', sensitiveErr.message)
        return json({ error: 'Portal login failed' },500)
      }
      portalSsn = String(sensitive?.ssn || '')
    } else {
      portalSsn = String(record.ssn || '')
    }
    const last4 = portalSsn.replace(/\D/g, '').slice(-4)
    const emailOnFile = (record.email || '').trim().toLowerCase()
    if (!last4 || !emailOnFile || normalizedEmail !== emailOnFile || normalizedPin !== last4) return await fail()

    await clearFailure(supabase,'portal_login_id',idKey)
    const token = crypto.randomUUID() + '-' + crypto.randomUUID()
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString()
    const { error: sessionErr } = await supabase.from('portal_sessions').insert({
      token, client_id: record.id, is_lead: isLead, client_name: record.name, tenant_id:record.tenant_id, expires_at: expiresAt,
    })
    if (sessionErr) {
      console.error('[portal-login] session insert failed:', sessionErr.message)
      return json({ error: 'Could not start a session — try again.' },500)
    }
    return json({ token, clientName: record.name, isLead })
  } catch (e) {
    console.error('portal-login error:', e)
    return json({ error: 'Portal login failed' },500)
  }
})
