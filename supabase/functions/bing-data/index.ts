import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BING_BASE = 'https://api.bing.com/webmaster/api'

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
      return new Response(JSON.stringify({ error: 'no_key', message: 'Bing API key not configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const body = await req.json().catch(() => ({}))
    const productKey = String(body?.product_key || 'taxres_crm').trim().toLowerCase()
    const apiKey = settings.bing_api_key
    const siteUrl = PRODUCT_SITES[productKey] || (productKey === 'taxres_crm' ? (settings.bing_site_url || PRODUCT_SITES.taxres_crm) : '')

    if (!siteUrl) {
      return new Response(JSON.stringify({
        error: 'unsupported_product',
        connected: false,
        product_key: productKey,
        message: 'No Bing site mapping is configured for this product.'
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const headers = {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': 'application/json',
    }

    const today = new Date()
    const endDate = today.toISOString().slice(0, 10)
    const startDate = new Date(today.getTime() - 28 * 86400000).toISOString().slice(0, 10)

    // Bing Webmaster v3 REST API
    const [statsRes, pagesRes, keywordsRes] = await Promise.all([
      fetch(`${BING_BASE}/GetQueryStats?siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}`, { headers }),
      fetch(`${BING_BASE}/GetPageStats?siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}`, { headers }),
      fetch(`${BING_BASE}/GetKeywordStats?siteUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}`, { headers }),
    ])

    const [statsData, pagesData, keywordsData] = await Promise.all([
      statsRes.json().catch(() => ({})),
      pagesRes.json().catch(() => ({})),
      keywordsRes.json().catch(() => ({})),
    ])

    if (!statsRes.ok || !pagesRes.ok || !keywordsRes.ok) {
      return new Response(JSON.stringify({
        connected: false,
        product_key: productKey,
        siteUrl,
        error: 'bing_site_unavailable',
        message: 'Bing Webmaster Tools did not return verified data for this product site.',
        upstream_status: {
          stats: statsRes.status,
          pages: pagesRes.status,
          keywords: keywordsRes.status,
        },
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Aggregate totals
    const stats = Array.isArray(statsData) ? statsData : (statsData.value || [])
    const pages = Array.isArray(pagesData) ? pagesData : (pagesData.value || [])
    const keywords = Array.isArray(keywordsData) ? keywordsData : (keywordsData.value || [])

    const totalClicks = stats.reduce((s: number, r: any) => s + (r.Clicks || r.clicks || 0), 0)
    const totalImpressions = stats.reduce((s: number, r: any) => s + (r.Impressions || r.impressions || 0), 0)
    const avgCtr = totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 10000) / 100 : 0
    const avgPos = stats.length > 0 ? Math.round(stats.reduce((s: number, r: any) => s + (r.AveragePosition || r.avgPosition || 0), 0) / stats.length * 10) / 10 : 0

    return new Response(JSON.stringify({
      clicks: totalClicks,
      impressions: totalImpressions,
      ctr: avgCtr,
      avgPosition: avgPos,
      topPages: pages.slice(0, 10).map((p: any) => ({
        url: p.Url || p.url,
        clicks: p.Clicks || p.clicks || 0,
        impressions: p.Impressions || p.impressions || 0,
      })),
      topKeywords: keywords.slice(0, 10).map((k: any) => ({
        query: k.Query || k.query,
        clicks: k.Clicks || k.clicks || 0,
        impressions: k.Impressions || k.impressions || 0,
        avgPosition: Math.round((k.AveragePosition || k.avgPosition || 0) * 10) / 10,
      })),
      siteUrl,
      dateRange: { start: startDate, end: endDate },
      raw: { statsStatus: statsRes.status, pagesStatus: pagesRes.status },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('bing-data error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
