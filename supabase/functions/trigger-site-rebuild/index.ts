// trigger-site-rebuild — fires a Cloudflare Pages rebuild for romylabs.com
// Called by: Supabase DB trigger on romylabs_products INSERT/UPDATE/DELETE.
// Preferred path: CF_PAGES_DEPLOY_HOOK_ROMYLABS.
// Fallback path: Cloudflare Pages REST API when CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID are available in Supabase Edge Function secrets.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

async function triggerViaPagesApi(token: string, accountId: string, target: 'romylabs' | 'admin') {
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`
  const headers = { Authorization: `Bearer ${token}` }

  let projectName = target === 'admin' ? 'taxcasereview-crm' : 'romylabs-site'
  let projectRes = await fetch(`${base}/${projectName}`, { headers })

  if (!projectRes.ok) {
    const listRes = await fetch(base, { headers })
    const listBody = await listRes.json().catch(() => null)
    if (!listRes.ok || !listBody?.success || !Array.isArray(listBody?.result)) {
      return { ok: false, status: listRes.status, error: 'cloudflare_project_lookup_failed' }
    }

    const match = listBody.result.find((p: any) => {
      if (target === 'admin') {
        return p?.name === 'taxcasereview-crm' ||
          p?.source?.config?.repo_name === 'taxcasereview-CRM' ||
          (Array.isArray(p?.domains) && p.domains.some((d: string) => d === 'admin.romylabs.com'))
      }
      return p?.name === 'romylabs-site' ||
        p?.source?.config?.repo_name === 'romylabs-site' ||
        (Array.isArray(p?.domains) && p.domains.some((d: string) => d === 'romylabs.com' || d === 'www.romylabs.com'))
    })
    if (!match?.name) {
      return { ok: false, status: 404, error: target === 'admin' ? 'admin_pages_project_not_found' : 'romylabs_pages_project_not_found' }
    }
    projectName = match.name
  }

  const form = new FormData()
  form.set('branch', 'main')
  form.set('commit_dirty', 'false')

  const deployRes = await fetch(`${base}/${encodeURIComponent(projectName)}/deployments`, {
    method: 'POST',
    headers,
    body: form,
  })
  const deployBody = await deployRes.json().catch(() => null)

  return {
    ok: deployRes.ok && deployBody?.success !== false,
    status: deployRes.status,
    project: projectName,
    deployment_id: deployBody?.result?.id ?? null,
    deployment_url: deployBody?.result?.url ?? null,
    error: deployRes.ok ? null : (deployBody?.errors?.[0]?.message ?? 'cloudflare_deployment_failed'),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const webhookSecret = Deno.env.get('WEBHOOK_SECRET')
    if (webhookSecret) {
      const inbound = req.headers.get('x-webhook-secret')
      if (inbound !== webhookSecret) return json({ error: 'Unauthorized' }, 401)
    }

    const requestBody = await req.json().catch(() => ({}))
    const target = requestBody?.target === 'admin' ? 'admin' : 'romylabs'

    const hookUrl = Deno.env.get('CF_PAGES_DEPLOY_HOOK_ROMYLABS')
    if (target === 'romylabs' && hookUrl) {
      const res = await fetch(hookUrl, { method: 'POST' })
      const body = await res.text()
      console.log(`[trigger-site-rebuild] deploy hook response: ${res.status} ${body.slice(0, 200)}`)
      return json({ ok: res.ok, status: res.status, triggered: true, mode: 'deploy_hook', target })
    }

    const cfToken = Deno.env.get('CLOUDFLARE_API_TOKEN')
    const cfAccount = Deno.env.get('CLOUDFLARE_ACCOUNT_ID')
    if (cfToken && cfAccount) {
      const result = await triggerViaPagesApi(cfToken, cfAccount, target)
      console.log('[trigger-site-rebuild] Pages API result', result)
      return json({ ...result, triggered: result.ok, mode: 'pages_api', target }, result.ok ? 200 : 502)
    }

    console.warn('[trigger-site-rebuild] no Cloudflare deploy credentials configured')
    return json({
      ok: true,
      triggered: false,
      reason: 'cloudflare_credentials_not_configured',
      deploy_hook_present: Boolean(hookUrl),
      api_token_present: Boolean(cfToken),
      account_id_present: Boolean(cfAccount),
    })
  } catch (err) {
    console.error('[trigger-site-rebuild] Error:', err)
    return json({ error: String(err) }, 500)
  }
})
