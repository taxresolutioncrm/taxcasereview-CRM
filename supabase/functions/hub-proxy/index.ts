// hub-proxy — RomyLabs Command Center metrics proxy
//
// Security architecture:
//   Browser → hub-proxy (authenticated via Supabase JWT) → product platform-metrics
//
//   The browser NEVER holds HUB_METRICS_SECRET.
//   hub-proxy verifies the caller's Supabase JWT server-side and confirms
//   platform_admin role before proxying to any product endpoint.
//
//   Product endpoints are in a SERVER-SIDE allowlist — the browser cannot
//   request an arbitrary URL to proxy. Only named product keys are accepted.
//
//   HUB_METRICS_SECRET exists only in this function's Supabase environment.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Allowed origins for the Command Center
// Both domains serve the same CF Pages build (taxcasereview-crm project)
const ALLOWED_ORIGINS = new Set([
  'https://admin.romylabs.com',
  'https://taxrescrm.app',
])

function getCors(req: Request) {
  const origin = req.headers.get('Origin') || ''
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://admin.romylabs.com'
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

// ── Server-side product allowlist ─────────────────────────────────────────
// Only these named products can be fetched via hub-proxy.
// The browser sends a product KEY, never a URL.
// Adding a new product requires a code change and deployment here — not browser config.
const PRODUCT_ENDPOINTS: Record<string, string> = {
  // Keys must match PRODUCT_REGISTRY key values in AdminPortal.jsx
  taxres_crm:        'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/platform-metrics?view=saas',
  tax_case_review:   'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/platform-metrics?view=tcr',
  nashville:         'https://ydrvncdedgjtcprczwpu.supabase.co/functions/v1/platform-metrics',
  cloudcpa:          'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/platform-metrics?view=cloudcpa',
  demo:              'https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/platform-metrics?view=demo',
  camvella:          'https://fjqywulzsyfyzitneazb.supabase.co/functions/v1/platform-metrics',
  arcvena:           'https://wzalqfxovxxszojfbnis.supabase.co/functions/v1/platform-metrics',
  bocasync:          'https://zmejbkttzvaqzzbmjclz.supabase.co/functions/v1/platform-metrics',
  groundivo:         'https://ydhmlphyvjgryefuwzyq.supabase.co/functions/v1/platform-metrics',
  oculivo:           'https://czejdbdwaumbdepiswcu.supabase.co/functions/v1/platform-metrics',
  restore_relay:     'https://yuwxzuybzuqnnldvdenx.supabase.co/functions/v1/platform-metrics',
}

Deno.serve(async (req) => {
  const cors = getCors(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  // ── Step 1: Verify caller has a valid Supabase session ───────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
  const jwt = authHeader.slice(7)

  // ── Step 2: Verify platform_admin role server-side ───────────────────────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  // Verify platform_admin role from app_metadata (server-authoritative, not jwt claim)
  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const { data: authUser } = await serviceClient.auth.admin.getUserById(user.id)
  const role = authUser?.user?.app_metadata?.role
  const email = String(authUser?.user?.email || user.email || '').toLowerCase()
  const ownerEmails = new Set([
    'info@romylabs.com',
    'romy@romylabs.com',
    'romy@taxrescrm.net',
    'romy@taxcasereview.org',
  ])
  if (role !== 'platform_admin' && !ownerEmails.has(email)) {
    return new Response(JSON.stringify({ error: 'Forbidden: RomyLabs platform admin required' }), {
      status: 403, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  // ── Step 3: Parse product key from request body ──────────────────────────
  let body: { product?: string; products?: string[]; action?: string; payload?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  if (body.action === 'onboard_arcvena') {
    const supportSecret = Deno.env.get('ARCVENA_SUPPORT_SECRET')
    if (!supportSecret) {
      return new Response(JSON.stringify({ error: 'Arcvena onboarding is not configured' }), {
        status: 503, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    try {
      const onboardingRes = await fetch(
        'https://wzalqfxovxxszojfbnis.supabase.co/functions/v1/platform-onboard-office',
        {
          method: 'POST',
          headers: {
            'x-arcvena-support-secret': supportSecret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body.payload ?? {}),
        },
      )
      const onboardingData = await onboardingRes.json()
      return new Response(JSON.stringify(onboardingData), {
        status: onboardingRes.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    } catch (err) {
      console.error('hub-proxy: Arcvena onboarding failed', err)
      return new Response(JSON.stringify({ error: 'Arcvena onboarding service unavailable' }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
  }

  // ── Step 4: Proxy product metrics with one authenticated caller check ─────
  const hubSecret = Deno.env.get('HUB_METRICS_SECRET')
  if (!hubSecret) {
    console.error('hub-proxy: HUB_METRICS_SECRET not configured')
    return new Response(JSON.stringify({ error: 'Proxy not configured' }), {
      status: 503, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  async function fetchProductMetrics(productKey: string) {
    const targetUrl = PRODUCT_ENDPOINTS[productKey]
    if (!targetUrl) {
      return { status: 400, data: null, error: `Unknown product: ${productKey}` }
    }

    try {
      const productHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (productKey === 'arcvena') {
        const arcvenaSupportSecret = Deno.env.get('ARCVENA_SUPPORT_SECRET')
        if (!arcvenaSupportSecret) {
          return { status: 503, data: null, error: 'Arcvena proxy credential not configured' }
        }
        productHeaders['x-arcvena-support-secret'] = arcvenaSupportSecret
      } else if (
        productKey === 'camvella' ||
        productKey === 'nashville' ||
        productKey === 'bocasync' ||
        productKey === 'groundivo' ||
        productKey === 'oculivo' ||
        productKey === 'restore_relay'
      ) {
        productHeaders['Authorization'] = `Bearer ${jwt}`
      } else {
        productHeaders['x-hub-secret'] = hubSecret
      }

      const productRes = await fetch(targetUrl, {
        method: 'GET',
        headers: productHeaders,
      })
      const productData = await productRes.json().catch(() => null)
      const productError = productRes.ok && productData?.ok !== false
        ? null
        : (productData?.error || `Metrics request failed (${productRes.status})`)
      return { status: productRes.status, data: productData, error: productError }
    } catch (err) {
      console.error(`hub-proxy: failed to fetch ${productKey}:`, err)
      return { status: 502, data: null, error: 'Product endpoint unavailable' }
    }
  }

  if (body.action === 'metrics_batch') {
    const requested = Array.from(new Set(Array.isArray(body.products) ? body.products : []))
    if (!requested.length || requested.length > 20) {
      return new Response(JSON.stringify({ error: 'Batch requires 1-20 product keys' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }
    const pairs = await Promise.all(requested.map(async productKey => [
      productKey,
      await fetchProductMetrics(productKey),
    ] as const))
    return new Response(JSON.stringify({
      ok: true,
      results: Object.fromEntries(pairs),
    }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const productKey = body.product
  if (!productKey) {
    return new Response(JSON.stringify({ error: 'Missing product key' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const result = await fetchProductMetrics(productKey)
  return new Response(JSON.stringify(result.data ?? { ok: false, error: result.error }), {
    status: result.status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
