// CENTRAL_TAXRES_NASHVILLE_RETIRED
// Nashville runs from its dedicated repository and Supabase project.
// This central-project endpoint is intentionally inert to prevent cross-tenant bleed.
Deno.serve(() => new Response(
  JSON.stringify({ error: 'Retired from central TaxRes project' }),
  { status: 410, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
))
