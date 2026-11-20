/**
 * stalwart-route-repair
 *
 * One-shot edge function that removes the broken
 * `sender_domain == 'romylabs.com'  →  mx` routing rule
 * from Stalwart's live MtaOutboundStrategy singleton.
 *
 * That rule forces direct MX delivery (port 25) which OCI blocks.
 * Removing it makes romylabs.com outbound fall through to the
 * default relay (Oracle Email Delivery, port 587) — the same path
 * every other working domain uses.
 *
 * Also scans for any dedicated MtaRoute named for romylabs that is
 * @type Mx (direct delivery) and destroys it, to prevent the rule
 * from being re-added implicitly.
 *
 * Required Supabase secret:
 *   STALWART_ADMIN_TOKEN   Bearer token for mail.taxrescrm.net management API
 *
 * Protected by:
 *   X-Repair-Secret header  (matches REPAIR_SECRET env var, or any value
 *   when REPAIR_SECRET is unset during the initial diagnostic run)
 *
 * Safe to call multiple times — idempotent.
 * Returns full audit JSON so the result can be verified without SSH.
 */

const STALWART_BASE = 'https://mail.taxrescrm.net'
const USING = ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap']

// ── JMAP helpers ────────────────────────────────────────────────────────────

async function jmapPost(token: string, calls: [string, Record<string, unknown>, string][]) {
  const res = await fetch(`${STALWART_BASE}/jmap/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ using: USING, methodCalls: calls }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Stalwart JMAP ${res.status}: ${text.slice(0, 200)}`)
  }
  return await res.json()
}

function firstResponse(payload: Record<string, unknown>, method: string) {
  const responses = payload?.methodResponses as [string, unknown, string][] | undefined
  return responses?.find(r => r[0] === method)?.[1] as Record<string, unknown> | undefined
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), { status, headers })

  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // ── Auth ─────────────────────────────────────────────────────────────────
  const repairSecret = Deno.env.get('REPAIR_SECRET') || ''
  const supplied = req.headers.get('x-repair-secret') || ''
  if (repairSecret && supplied !== repairSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const adminToken = Deno.env.get('STALWART_ADMIN_TOKEN') || ''
  if (!adminToken) return json({ error: 'STALWART_ADMIN_TOKEN not configured' }, 503)

  const audit: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    stalwart: STALWART_BASE,
  }

  try {
    // ── Step 1: Read the live MtaOutboundStrategy singleton ─────────────────
    const strategyPayload = await jmapPost(adminToken, [
      ['x:MtaOutboundStrategy/get', { ids: ['singleton'] }, 's0'],
    ])
    const strategyResult = firstResponse(strategyPayload, 'x:MtaOutboundStrategy/get')
    if (!strategyResult) {
      return json({ ...audit, error: 'x:MtaOutboundStrategy/get returned no response' }, 500)
    }
    const strategyList = strategyResult.list as Record<string, unknown>[] | undefined
    const strategy = strategyList?.[0]
    audit.strategy_before = strategy

    if (!strategy) {
      return json({ ...audit, error: 'MtaOutboundStrategy singleton not found' }, 500)
    }

    // ── Step 2: Inspect the route expression for the bad rule ────────────────
    // The route field is an Expression object:
    // { "match": { "0": {"if": "sender_domain == 'romylabs.com'", "then": "'mx'"}, ... }, "else": "'mx'" }
    // or the match array form:
    // { "match": [ {"if": "...", "then": "..."}, ... ], "else": "'mx'" }
    const route = strategy.route as Record<string, unknown> | undefined
    audit.route_expression_before = route

    let matchEntries: Array<{ if: string; then: string }> = []
    let matchIsArray = false

    if (Array.isArray(route?.match)) {
      matchIsArray = true
      matchEntries = route.match as Array<{ if: string; then: string }>
    } else if (route?.match && typeof route.match === 'object') {
      // Object form: keys are string indices "0", "1", ...
      matchIsArray = false
      const obj = route.match as Record<string, { if: string; then: string }>
      matchEntries = Object.keys(obj)
        .sort((a, b) => Number(a) - Number(b))
        .map(k => obj[k])
    }

    // Find entries that force mx for romylabs.com
    const badPattern = /sender_domain\s*==\s*['"]romylabs\.com['"]/i
    const badEntries = matchEntries.filter(e => badPattern.test(e?.if || ''))
    audit.bad_entries_found = badEntries
    audit.total_match_entries_before = matchEntries.length

    if (badEntries.length === 0) {
      audit.strategy_action = 'no_change_needed — bad rule not present in live strategy'
      // Still check for orphan Mx routes below
    } else {
      // ── Step 3: Remove bad entries and write back ──────────────────────────
      const cleanEntries = matchEntries.filter(e => !badPattern.test(e?.if || ''))
      audit.total_match_entries_after = cleanEntries.length

      let updatedMatch: unknown
      if (matchIsArray) {
        updatedMatch = cleanEntries
      } else {
        // Rebuild as object with sequential keys
        const obj: Record<string, unknown> = {}
        cleanEntries.forEach((e, i) => { obj[String(i)] = e })
        updatedMatch = obj
      }

      const updatedRoute = { ...route, match: updatedMatch }
      audit.route_expression_after = updatedRoute

      const patchPayload = await jmapPost(adminToken, [
        ['x:MtaOutboundStrategy/set', {
          update: {
            singleton: { route: updatedRoute },
          },
        }, 'p0'],
      ])
      const patchResult = firstResponse(patchPayload, 'x:MtaOutboundStrategy/set')
      audit.strategy_patch_result = patchResult

      const notUpdated = (patchResult as Record<string, unknown> | undefined)?.notUpdated as Record<string, unknown> | undefined
      if (notUpdated?.singleton) {
        return json({ ...audit, error: 'Stalwart rejected strategy update', detail: notUpdated.singleton }, 500)
      }
      audit.strategy_action = 'patched — romylabs.com sender_domain rule removed'
    }

    // ── Step 4: Scan MtaRoute for any romylabs-specific Mx (direct) route ───
    const routeQueryPayload = await jmapPost(adminToken, [
      ['x:MtaRoute/query', { filter: {}, limit: 100 }, 'rq0'],
    ])
    const routeQueryResult = firstResponse(routeQueryPayload, 'x:MtaRoute/query')
    const routeIds = (routeQueryResult?.ids as string[]) || []
    audit.total_routes_found = routeIds.length

    let routesToDestroy: string[] = []
    let routeDetails: Record<string, unknown>[] = []

    if (routeIds.length > 0) {
      const routeGetPayload = await jmapPost(adminToken, [
        ['x:MtaRoute/get', { ids: routeIds, properties: ['name', 'description', '@type'] }, 'rg0'],
      ])
      const routeGetResult = firstResponse(routeGetPayload, 'x:MtaRoute/get')
      routeDetails = (routeGetResult?.list as Record<string, unknown>[]) || []
      audit.all_routes = routeDetails

      // A route is a candidate for destruction if:
      //  - its @type is "Mx" (direct delivery, port 25), AND
      //  - its name or description references romylabs
      const romylabsPattern = /romylabs/i
      routesToDestroy = routeDetails
        .filter(r =>
          String(r['@type'] || '').toLowerCase() === 'mx' &&
          (romylabsPattern.test(String(r.name || '')) ||
            romylabsPattern.test(String(r.description || '')))
        )
        .map(r => String(r.id || ''))
        .filter(Boolean)

      audit.romylabs_mx_routes_found = routesToDestroy
    }

    if (routesToDestroy.length > 0) {
      const destroyPayload = await jmapPost(adminToken, [
        ['x:MtaRoute/set', { destroy: routesToDestroy }, 'rd0'],
      ])
      const destroyResult = firstResponse(destroyPayload, 'x:MtaRoute/set')
      audit.route_destroy_result = destroyResult

      const notDestroyed = (destroyResult as Record<string, unknown> | undefined)?.notDestroyed as Record<string, unknown> | undefined
      if (notDestroyed && Object.keys(notDestroyed).length > 0) {
        audit.route_destroy_warning = 'Some routes could not be destroyed'
        audit.route_destroy_not_destroyed = notDestroyed
      } else {
        audit.route_destroy_action = `destroyed ${routesToDestroy.length} orphan Mx route(s): ${routesToDestroy.join(', ')}`
      }
    } else {
      audit.route_destroy_action = 'no orphan romylabs Mx routes found'
    }

    // ── Step 5: Re-read strategy to confirm the patch took effect ────────────
    const verifyPayload = await jmapPost(adminToken, [
      ['x:MtaOutboundStrategy/get', { ids: ['singleton'] }, 'v0'],
    ])
    const verifyResult = firstResponse(verifyPayload, 'x:MtaOutboundStrategy/get')
    const verifiedStrategy = (verifyResult?.list as Record<string, unknown>[])?.[0]
    audit.strategy_after = verifiedStrategy

    // Check the bad rule is gone in the confirmed live state
    const verifiedRoute = verifiedStrategy?.route as Record<string, unknown> | undefined
    const verifiedMatch = Array.isArray(verifiedRoute?.match)
      ? verifiedRoute.match as Array<{ if: string; then: string }>
      : Object.values((verifiedRoute?.match || {}) as Record<string, { if: string; then: string }>)

    const stillPresent = (verifiedMatch as Array<{ if: string; then: string }>)
      .filter(e => badPattern.test(e?.if || ''))

    audit.verification = {
      bad_rule_still_present: stillPresent.length > 0,
      confirmed_clean: stillPresent.length === 0,
      remaining_match_entries: verifiedMatch.length,
    }

    const success = stillPresent.length === 0
    audit.result = success
      ? 'SUCCESS — romylabs.com outbound now routes through default relay (Oracle Email Delivery port 587)'
      : 'INCOMPLETE — bad rule still detected after patch attempt'

    return json({ ok: success, audit }, success ? 200 : 500)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return json({ ok: false, audit, error: msg }, 500)
  }
})
