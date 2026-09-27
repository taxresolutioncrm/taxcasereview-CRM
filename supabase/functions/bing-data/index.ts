import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BING_JSON_BASE = 'https://ssl.bing.com/webmaster/api.svc/json'

const PRODUCT_SITES: Record<string,string> = {
  taxres_crm: 'https://taxrescrm.net/',
  camvella: 'https://camvella.com/',
  arcvena: 'https://arcvena.com/',
  bocasync: 'https://bocasync.com/',
  groundivo: 'https://groundivo.com/',
  oculivo: 'https://oculivo.com/',
  restore_relay: 'https://restorerelay.com/',
  romylabs: 'https://romylabs.com/',
}

function host(value:string){
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./,'') } catch { return '' }
}

function rows(payload:any){
  return Array.isArray(payload?.d) ? payload.d : []
}

function xmlLocs(xml:string){ return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(m=>m[1].trim()) }
function countUrlEntries(xml:string){ return (xml.match(/<url(?:\s|>)/gi) || []).length }
async function sitemapSummary(siteUrl:string){
  const root = new URL(siteUrl)
  const candidates = [new URL('/sitemap.xml',root).toString(), new URL('/sitemap-index.xml',root).toString(), new URL('/sitemap_index.xml',root).toString()]
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate,{headers:{'Accept':'application/xml,text/xml,*/*'}})
      if (!res.ok) continue
      const xml = await res.text()
      if (/<sitemapindex(?:\s|>)/i.test(xml)) {
        const children = xmlLocs(xml).filter(x=>/^https?:\/\//i.test(x)).slice(0,50)
        let urls = 0; const childSitemaps:any[] = []
        for (const child of children) {
          try { const cr=await fetch(child,{headers:{'Accept':'application/xml,text/xml,*/*'}}); if(!cr.ok){childSitemaps.push({url:child,ok:false,status:cr.status,urls:0});continue}; const cx=await cr.text(); const n=countUrlEntries(cx); urls+=n; childSitemaps.push({url:child,ok:true,status:cr.status,urls:n}) }
          catch { childSitemaps.push({url:child,ok:false,urls:0}) }
        }
        return {ok:true,sitemapUrl:candidate,type:'sitemap_index',urlsDiscovered:urls,childSitemaps}
      }
      if (/<urlset(?:\s|>)/i.test(xml)) return {ok:true,sitemapUrl:candidate,type:'urlset',urlsDiscovered:countUrlEntries(xml),childSitemaps:[]}
    } catch {}
  }
  return {ok:false,sitemapUrl:null,type:null,urlsDiscovered:0,childSitemaps:[]}
}

function aggregateBy(items:any[], labelKeys:string[]){
  const map = new Map<string,{label:string,clicks:number,impressions:number,posNum:number,posDen:number}>()
  for (const item of items) {
    const label = labelKeys.map(k=>String(item?.[k]||'').trim()).find(Boolean) || ''
    if (!label) continue
    const clicks = Number(item?.Clicks || item?.clicks || 0)
    const impressions = Number(item?.Impressions || item?.impressions || 0)
    const pos = Number(item?.AvgImpressionPosition ?? item?.AveragePosition ?? item?.avgPosition ?? 0)
    const cur = map.get(label) || {label,clicks:0,impressions:0,posNum:0,posDen:0}
    cur.clicks += clicks
    cur.impressions += impressions
    if (Number.isFinite(pos) && pos > 0) {
      const weight = Math.max(impressions,1)
      cur.posNum += pos * weight
      cur.posDen += weight
    }
    map.set(label,cur)
  }
  return [...map.values()].map(x=>({
    label:x.label,
    clicks:x.clicks,
    impressions:x.impressions,
    avgPosition:x.posDen ? Math.round((x.posNum/x.posDen)*10)/10 : 0,
  })).sort((a,b)=>b.impressions-a.impressions || b.clicks-a.clicks)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: settings } = await supabase.from('settings')
      .select('bing_api_key, bing_site_url')
      .eq('tenant_id', 'a0000000-0000-0000-0000-000000000001')
      .maybeSingle()

    if (!settings?.bing_api_key) {
      return new Response(JSON.stringify({ connected:false,error:'no_key',message:'Bing API key not configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const body = await req.json().catch(() => ({}))
    const productKey = String(body?.product_key || 'taxres_crm').trim().toLowerCase()
    const requestedSite = PRODUCT_SITES[productKey] || (productKey === 'taxres_crm' ? (settings.bing_site_url || PRODUCT_SITES.taxres_crm) : '')
    if (!requestedSite) {
      return new Response(JSON.stringify({ connected:false,error:'unsupported_product',product_key:productKey }), {
        status:400, headers:{...corsHeaders,'Content-Type':'application/json'}
      })
    }

    const apiKey = String(settings.bing_api_key)
    const sitesUrl = `${BING_JSON_BASE}/GetUserSites?apikey=${encodeURIComponent(apiKey)}`
    const sitesRes = await fetch(sitesUrl, { headers:{'Content-Type':'application/json; charset=utf-8'} })
    const sitesJson = await sitesRes.json().catch(() => ({}))
    if (!sitesRes.ok) {
      return new Response(JSON.stringify({
        connected:false, product_key:productKey, siteUrl:requestedSite,
        error:'bing_api_error', upstream_status:{sites:sitesRes.status}
      }), { headers:{...corsHeaders,'Content-Type':'application/json'} })
    }

    const requestedHost = host(requestedSite)
    const verifiedSites = rows(sitesJson).filter((s:any)=>s?.IsVerified === true)
    const matched = verifiedSites.find((s:any)=>host(String(s?.Url||''))===requestedHost)
    if (!matched?.Url) {
      return new Response(JSON.stringify({
        connected:false, product_key:productKey, siteUrl:requestedSite,
        error:'bing_site_not_verified',
        message:'This product domain is not verified in the connected Bing Webmaster account.'
      }), { headers:{...corsHeaders,'Content-Type':'application/json'} })
    }

    const siteUrl = String(matched.Url)
    const endpoint = (method:string) =>
      `${BING_JSON_BASE}/${method}?siteUrl=${encodeURIComponent(siteUrl)}&apikey=${encodeURIComponent(apiKey)}`

    const [trafficRes, queryRes, pageRes, sitemap] = await Promise.all([
      fetch(endpoint('GetRankAndTrafficStats'), { headers:{'Content-Type':'application/json; charset=utf-8'} }),
      fetch(endpoint('GetQueryStats'), { headers:{'Content-Type':'application/json; charset=utf-8'} }),
      fetch(endpoint('GetPageStats'), { headers:{'Content-Type':'application/json; charset=utf-8'} }),
      sitemapSummary(siteUrl),
    ])

    const [trafficJson, queryJson, pageJson] = await Promise.all([
      trafficRes.json().catch(() => ({})),
      queryRes.json().catch(() => ({})),
      pageRes.json().catch(() => ({})),
    ])

    if (!trafficRes.ok || !queryRes.ok || !pageRes.ok) {
      return new Response(JSON.stringify({
        connected:false, product_key:productKey, siteUrl,
        error:'bing_data_unavailable',
        upstream_status:{traffic:trafficRes.status,queries:queryRes.status,pages:pageRes.status}
      }), { headers:{...corsHeaders,'Content-Type':'application/json'} })
    }

    const traffic = rows(trafficJson)
    const queryAgg = aggregateBy(rows(queryJson), ['Query','query'])
    const pageAgg = aggregateBy(rows(pageJson), ['Query','Url','url'])

    const clicks = traffic.reduce((s:number,r:any)=>s+Number(r?.Clicks||0),0)
    const impressions = traffic.reduce((s:number,r:any)=>s+Number(r?.Impressions||0),0)
    const ctr = impressions > 0 ? Math.round((clicks/impressions)*10000)/100 : 0
    const weightedQueries = queryAgg.filter(q=>q.avgPosition>0)
    const posDen = weightedQueries.reduce((s,q)=>s+Math.max(q.impressions,1),0)
    const avgPosition = posDen
      ? Math.round((weightedQueries.reduce((s,q)=>s+q.avgPosition*Math.max(q.impressions,1),0)/posDen)*10)/10
      : 0

    return new Response(JSON.stringify({
      connected:true,
      product_key:productKey,
      siteUrl,
      clicks,
      impressions,
      ctr,
      avgPosition,
      topPages:pageAgg.slice(0,10).map(p=>({url:p.label,clicks:p.clicks,impressions:p.impressions,avgPosition:p.avgPosition})),
      topKeywords:queryAgg.slice(0,10).map(q=>({query:q.label,clicks:q.clicks,impressions:q.impressions,avgPosition:q.avgPosition})),
      sitemap,
      raw:{trafficStatus:trafficRes.status,queryStatus:queryRes.status,pageStatus:pageRes.status},
    }), { headers:{...corsHeaders,'Content-Type':'application/json'} })
  } catch (err) {
    console.error('bing-data error:', err)
    return new Response(JSON.stringify({ connected:false,error:String((err as Error)?.message || err) }), {
      status:500, headers:{...corsHeaders,'Content-Type':'application/json'}
    })
  }
})
