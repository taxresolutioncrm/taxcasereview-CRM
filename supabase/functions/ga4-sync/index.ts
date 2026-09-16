import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  let productId = 'taxres_crm'

  try {
    if (req.method !== 'GET') {
      const body = await req.json().catch(() => ({}))
      productId = String(body?.product_id || productId)
    } else {
      productId = new URL(req.url).searchParams.get('product_id') || productId
    }

    const { data: channel, error: channelErr } = await supabase
      .from('product_traffic_channels')
      .select('tracking_id,status')
      .eq('product_id', productId)
      .eq('channel_key', 'ga4')
      .maybeSingle()

    if (channelErr) throw channelErr
    const propertyId = channel?.tracking_id
    if (!propertyId) throw new Error(`No GA4 property configured for ${productId}`)

    const { data: secretData, error: secretErr } = await supabase
      .rpc('get_secret', { secret_name: 'GA4_SERVICE_ACCOUNT_JSON' })
    if (secretErr || !secretData) throw new Error('Could not read GA4 service account from vault')

    const token = await getGoogleAccessToken(JSON.parse(secretData))
    const ranges = [
      { startDate: 'today', endDate: 'today' },
      { startDate: 'yesterday', endDate: 'yesterday' },
      { startDate: '7daysAgo', endDate: 'yesterday' },
      { startDate: '30daysAgo', endDate: 'yesterday' },
    ]

    const [results, totalsReport] = await Promise.all([
      Promise.all(ranges.map(r => fetchGA4Report(token, propertyId, r))),
      fetchGA4Totals(token, propertyId),
    ])
    const trafficByKey = new Map<string, any>()
    for (const result of results) {
      for (const row of result?.rows || []) {
        const dims = row.dimensionValues || []
        const mets = row.metricValues || []
        const date = dims[0]?.value || new Date().toISOString().slice(0,10)
        const channelName = dims[1]?.value || 'Direct'
        trafficByKey.set(`${productId}|${date}|${channelName}`, {
          product_id: productId,
          date,
          channel: channelName,
          sessions: Number(mets[0]?.value || 0),
          users: Number(mets[1]?.value || 0),
          new_users: Number(mets[2]?.value || 0),
          returning_users: Math.max(0, Number(mets[1]?.value || 0) - Number(mets[2]?.value || 0)),
          page_views: Number(mets[3]?.value || 0),
          bounce_rate: Number(mets[4]?.value || 0),
          avg_session_sec: Number(mets[5]?.value || 0),
          pages_per_session: Number(mets[6]?.value || 0),
          synced_at: new Date().toISOString(),
        })
      }
    }

    // Store one authoritative daily property-total row. Headline metrics in the
    // Admin Portal use this row so users, bounce rate, and pages/session are not
    // reconstructed from channel buckets (which can double-count users and skew ratios).
    for (const row of totalsReport?.rows || []) {
      const dims = row.dimensionValues || []
      const mets = row.metricValues || []
      const date = dims[0]?.value || new Date().toISOString().slice(0,10)
      trafficByKey.set(`${productId}|${date}|__TOTAL__`, {
        product_id: productId,
        date,
        channel: '__TOTAL__',
        sessions: Number(mets[0]?.value || 0),
        users: Number(mets[1]?.value || 0),
        new_users: Number(mets[2]?.value || 0),
        returning_users: Math.max(0, Number(mets[1]?.value || 0) - Number(mets[2]?.value || 0)),
        page_views: Number(mets[3]?.value || 0),
        bounce_rate: Number(mets[4]?.value || 0),
        avg_session_sec: Number(mets[5]?.value || 0),
        pages_per_session: Number(mets[6]?.value || 0),
        synced_at: new Date().toISOString(),
      })
    }
    const rows = Array.from(trafficByKey.values())

    if (rows.length) {
      const { error } = await supabase.from('marketing_ga4_traffic').upsert(rows, { onConflict:'product_id,date,channel' })
      if (error) throw error
    }

    const pagesReport = await fetchGA4Pages(token, propertyId)
    const latestReportingDate = (totalsReport?.rows || []).reduce((latest:string, row:any) => {
      const date = row?.dimensionValues?.[0]?.value || ''
      return !latest || date > latest ? date : latest
    }, '') || new Date().toISOString().slice(0,10)
    const pageRows:any[] = []
    for (const row of pagesReport?.rows || []) {
      const dims = row.dimensionValues || []
      const mets = row.metricValues || []
      pageRows.push({
        product_id: productId,
        // This is a 7-day aggregate snapshot; use the property's reporting date
        // instead of UTC so the UI can identify the latest snapshot consistently.
        date: latestReportingDate,
        page_path: dims[0]?.value || '/',
        sessions: Number(mets[0]?.value || 0),
        users: Number(mets[1]?.value || 0),
        bounce_rate: Number(mets[2]?.value || 0),
        avg_time_sec: Number(mets[3]?.value || 0),
        synced_at: new Date().toISOString(),
      })
    }
    if (pageRows.length) {
      const { error } = await supabase.from('marketing_ga4_pages').upsert(pageRows, { onConflict:'product_id,date,page_path' })
      if (error) throw error
    }

    await supabase.from('marketing_sync_log').insert({ product_id:productId, source:'ga4', status:'success', rows_upserted:rows.length + pageRows.length, synced_at:new Date().toISOString() })
    await supabase.from('product_traffic_channels').update({ status:'live', last_verified_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq('product_id', productId).eq('channel_key','ga4')

    return Response.json({ ok:true, product_id:productId, property_id:propertyId, rows:rows.length, pages:pageRows.length }, { headers: corsHeaders })
  } catch (err) {
    console.error('GA4 sync error:', err)
    const errorText = err instanceof Error ? err.message : JSON.stringify(err)
    await supabase.from('marketing_sync_log').insert({ product_id:productId, source:'ga4', status:'error', error_msg:errorText, synced_at:new Date().toISOString() })
    // A configured property that Google currently rejects is not "live".
    // Keep the property ID, but surface the integration as blocked until a
    // successful sync proves access again.
    await supabase.from('product_traffic_channels')
      .update({ status:'blocked', updated_at:new Date().toISOString() })
      .eq('product_id', productId)
      .eq('channel_key','ga4')
    return Response.json({ ok:false, product_id:productId, error:errorText }, { status:500, headers: corsHeaders })
  }
})

async function getGoogleAccessToken(sa:any):Promise<string> {
  const now = Math.floor(Date.now()/1000)
  const header = { alg:'RS256', typ:'JWT' }
  const payload = { iss:sa.client_email, scope:'https://www.googleapis.com/auth/analytics.readonly', aud:'https://oauth2.googleapis.com/token', exp:now+3600, iat:now }
  const enc = (obj:any) => btoa(JSON.stringify(obj)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const sigInput = `${enc(header)}.${enc(payload)}`
  const keyData = sa.private_key.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\s/g,'')
  const keyBytes = Uint8Array.from(atob(keyData), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey('pkcs8', keyBytes, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(sigInput))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const res = await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${sigInput}.${sigB64}` })
  const data = await res.json()
  if (!res.ok || !data.access_token) throw new Error(`Failed to get GA4 access token: ${JSON.stringify(data)}`)
  return data.access_token
}

async function ga4Request(token:string, propertyId:string, body:any) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }, body:JSON.stringify(body) })
  const data = await res.json()
  if (!res.ok) throw new Error(`GA4 ${propertyId} request failed: ${JSON.stringify(data)}`)
  return data
}

function fetchGA4Report(token:string, propertyId:string, range:{startDate:string,endDate:string}) {
  return ga4Request(token, propertyId, {
    dateRanges:[range], dimensions:[{name:'date'},{name:'sessionDefaultChannelGroup'}],
    metrics:[{name:'sessions'},{name:'totalUsers'},{name:'newUsers'},{name:'screenPageViews'},{name:'bounceRate'},{name:'averageSessionDuration'},{name:'screenPageViewsPerSession'}], limit:100
  })
}

function fetchGA4Totals(token:string, propertyId:string) {
  return ga4Request(token, propertyId, {
    dateRanges:[{startDate:'30daysAgo',endDate:'today'}],
    dimensions:[{name:'date'}],
    metrics:[{name:'sessions'},{name:'totalUsers'},{name:'newUsers'},{name:'screenPageViews'},{name:'bounceRate'},{name:'averageSessionDuration'},{name:'screenPageViewsPerSession'}],
    limit:100
  })
}

function fetchGA4Pages(token:string, propertyId:string) {
  return ga4Request(token, propertyId, {
    dateRanges:[{startDate:'7daysAgo',endDate:'today'}], dimensions:[{name:'pagePath'}],
    metrics:[{name:'sessions'},{name:'totalUsers'},{name:'bounceRate'},{name:'averageSessionDuration'}],
    orderBys:[{metric:{metricName:'sessions'},desc:true}], limit:50
  })
}
