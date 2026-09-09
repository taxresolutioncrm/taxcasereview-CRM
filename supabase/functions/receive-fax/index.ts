// receive-fax
// Receives inbound faxes via SignalWire Compatibility (cXML) API.
// JWT verification is OFF because SignalWire invokes this endpoint directly.
// Tenant routing is fail-closed: the dialed DID must resolve to exactly one tenant.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SELF_URL = 'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/receive-fax'
const digits10 = (value: string) => String(value || '').replace(/\D/g, '').slice(-10)

function xmlResponse(xml: string, status = 200) {
  return new Response(xml, { status, headers: { 'Content-Type': 'text/xml; charset=utf-8' } })
}

async function verifySW(secret:string,url:string,params:Record<string,string>,sig:string){
  if(!secret||!sig)return false
  let s=url
  for(const k of Object.keys(params).sort())s+=k+(params[k]??'')
  const enc=new TextEncoder()
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign'])
  const raw=await crypto.subtle.sign('HMAC',key,enc.encode(s))
  const expected=btoa(String.fromCharCode(...new Uint8Array(raw)))
  if(expected.length!==sig.length)return false
  let d=0
  for(let i=0;i<expected.length;i++)d|=expected.charCodeAt(i)^sig.charCodeAt(i)
  return d===0
}

serve(async (req) => {
  if (req.method !== 'POST') return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 405)
  try {
    const url = new URL(req.url)
    const isDone = url.searchParams.get('done') === '1'
    const text = await req.text()
    const params = new URLSearchParams(text)
    const swSecret=Deno.env.get('SW_SIGNING_SECRET')??''
    const sig=req.headers.get('x-signalwire-signature')??''
    if(swSecret){
      const signedParams:Record<string,string>={}
      for(const[k,v]of params)signedParams[k]=v
      if(!await verifySW(swSecret,req.url,signedParams,sig))return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>',403)
    }else{
      console.warn('[receive-fax] SW_SIGNING_SECRET absent; structural callback validation only')
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Some SignalWire numbers may still have a legacy resource named
    // "Receive Fax - Tax Case Review" assigned for inbound messaging.
    // If the callback is clearly SMS/MMS, hand it to the dedicated SMS
    // parser instead of ever treating it as fax traffic.
    const isSmsCallback = !!(params.get('MessageSid') || params.get('SmsSid')) ||
      (!!params.get('Body') && !params.get('FaxSid'))
    if (isSmsCallback) {
      const handoff = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/receive-sms`, {
        method:'POST',
        headers:{
          'Content-Type':'application/x-www-form-urlencoded',
          'x-romylabs-internal':Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
        },
        body:text
      })
      return new Response(await handoff.text(), {
        status:handoff.status,
        headers:{'Content-Type':'text/xml; charset=utf-8'}
      })
    }

    // Outbound delivery-status callback. The tenant is bound into the callback
    // URL by send-fax; update only the matching provider SID in that tenant.
    if (url.searchParams.get('outbound') === '1') {
      const tenantId = String(url.searchParams.get('tenant') || '').trim()
      const faxSid = String(params.get('FaxSid') || params.get('Sid') || '').trim()
      const rawStatus = String(params.get('FaxStatus') || params.get('Status') || '').trim().toLowerCase()
      if (!tenantId || !faxSid || !rawStatus) return new Response('', { status: 400 })

      const delivered = ['delivered','completed','success','sent'].includes(rawStatus)
      const failed = ['failed','no-answer','busy','canceled','cancelled','error'].includes(rawStatus)
      const nextStatus = delivered ? 'Delivered' : failed ? 'Failed' : 'Pending'
      const errorCode = params.get('ErrorCode') || params.get('ErrorMessage') || null

      const { data: updated, error: updateError } = await supabase
        .from('fax_logs')
        .update({
          status: nextStatus,
          error_msg: failed ? (errorCode || rawStatus) : null,
        })
        .eq('tenant_id', tenantId)
        .eq('signalwire_fax_id', faxSid)
        .select('id')
      if (updateError) {
        console.error('[receive-fax] outbound status update failed:', updateError.message)
        return new Response('', { status: 500 })
      }
      if (!updated?.length) {
        console.warn('[receive-fax] outbound status arrived before log row existed', { tenantId, faxSid, rawStatus })
      }
      return new Response('', { status: 200 })
    }

    const to = params.get('To') || ''
    const toDigits = digits10(to)
    if (toDigits.length !== 10) return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 400)
    const { data: rows, error: settingsError } = await supabase.from('settings').select('tenant_id,sw_inbound_did').not('tenant_id','is',null).not('sw_inbound_did','is',null)
    if (settingsError) throw settingsError
    const matches = (rows || []).filter((r: any) => digits10(r.sw_inbound_did) === toDigits)
    if (matches.length !== 1) {
      console.error('[receive-fax] inbound DID did not resolve uniquely', { toDigits, matches: matches.length })
      return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 403)
    }
    const tenantId = matches[0].tenant_id

    if (isDone) {
      const faxSid = String(params.get('FaxSid') || '').trim()
      if (!faxSid) return new Response('', { status: 400 })
      const status = params.get('FaxStatus') || 'unknown'
      const mediaUrl = String(params.get('MediaUrl') || '').trim()
      const safeMediaUrl = /^https:\/\//i.test(mediaUrl) ? mediaUrl : null
      const { error: insertError } = await supabase.from('fax_logs').insert({
        tenant_id: tenantId,
        from_number: params.get('From') || '',
        to_number: to,
        file_url: safeMediaUrl,
        status: status === 'received' ? 'Received' : 'Failed',
        direction: 'inbound',
        signalwire_fax_id: faxSid,
        error_msg: status !== 'received' ? (params.get('ErrorCode') || null) : null,
        pages: parseInt(params.get('NumPages') || '0') || null,
        created_at: new Date().toISOString(),
      })
      if (insertError && insertError.code !== '23505') {
        console.error('[receive-fax] fax_logs insert FAILED:', insertError.message)
        return new Response('', { status: 500 })
      }
      return new Response('', { status: 200 })
    }

    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Receive action="${SELF_URL}?done=1" storeMedia="true"/>\n</Response>`)
  } catch (err) {
    console.error('receive-fax error:', err)
    return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 500)
  }
})
