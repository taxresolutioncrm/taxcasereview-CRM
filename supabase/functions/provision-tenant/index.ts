// provision-tenant
// Stands up a new office (tenant) end to end:
//   1. verifies the caller is a TCR *platform* Super Admin (not just any tenant
//      admin) — provisioning new offices is a platform-owner action;
//   2. calls the provision_tenant RPC to create the tenants + settings + admin
//      employee rows atomically;
//   3. mints the admin's Supabase auth login. current_tenant_id() resolves a
//      user's tenant by employees.email = auth.email(), so the login email MUST
//      match the employee email created in step 2.
// Returns a one-time temp password for the new admin. If the login can't be
// created, the just-provisioned tenant is rolled back so nothing is left half
// built. verify_jwt stays ON (default) — this must never be anonymous.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PLATFORM_ADMIN_EMAILS = ['romy@taxcasereview.org', 'romy@taxrescrm.net', 'romy@romylabs.com', 'info@romylabs.com']
const DEPARTMENTS = ['resolution','preparation','bookkeeping','formation','hr'] as const
const HR_FEATURES = ['time_tracking','payroll'] as const

function validateChoices(value: unknown, permitted: readonly string[], allowEmpty: boolean): string[] | null {
  if (!Array.isArray(value) || value.some(x => typeof x !== 'string' || !permitted.includes(x))) return null
  const normalized = permitted.filter(key => value.includes(key))
  if (new Set(value).size !== value.length) return null
  return (allowEmpty || normalized.length > 0) ? normalized : null
}


function genPassword(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  const raw = btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, '')
  return 'Tcr-' + raw.slice(0, 18) + '9!'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

    const url        = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY')!

    // ── verify caller is a TCR platform Super Admin ──
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
    if (!token) return json({ error: 'Missing authorization' }, 401)
    const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user }, error: userErr } = await asCaller.auth.getUser()
    if (userErr || !user?.email) return json({ error: 'Invalid session' }, 401)

    // ── verify caller is THIS platform admin specifically (not any Super Admin) ──
    if (!PLATFORM_ADMIN_EMAILS.includes(user.email.toLowerCase())) return json({ error: 'Not authorized to provision offices' }, 403)
    const admin = createClient(url, serviceKey)

    // ── inputs ──
    const b = await req.json().catch(() => ({}))
    const firm_name   = (b.firm_name || '').trim()
    const tenant_code = (b.tenant_code || '').trim()
    const admin_name  = (b.admin_name || '').trim()
    const admin_email = (b.admin_email || '').trim().toLowerCase()
    if (!firm_name || !tenant_code || !admin_email)
      return json({ error: 'firm_name, tenant_code, and admin_email are required' }, 400)

    // This provisioner belongs only to the TaxRes project. Other products have
    // separate isolated backends and must never be silently provisioned here.
    if (b.product_key && b.product_key !== 'taxres_crm')
      return json({error:'Selected CRM requires its own provisioning connection; no office created'}, 400)

    const tierRates: Record<string, number> = {starter:79,professional:99,enterprise:129}
    const tier = String(b.plan_tier || 'starter').toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(tierRates, tier))
      return json({error:'Invalid plan tier'},400)
    const billingMode = b.billing_mode || 'standard'
    if (!['standard','per_seat','flat'].includes(billingMode))
      return json({error:'Invalid billing mode'},400)
    const seats = Number(b.billing_seats ?? 1)
    const customRate = Number(b.custom_rate)
    const flatRate = Number(b.flat_rate)
    if (!Number.isSafeInteger(seats) || seats < 1 || seats > 100000)
      return json({error:'Seats must be a whole number greater than zero'},400)
    if (billingMode === 'per_seat' && (!Number.isFinite(customRate) || customRate < 0 || customRate > 1000000 || Math.round(customRate * 100) !== customRate * 100))
      return json({error:'Custom seat rate must be a valid non-negative dollar amount'},400)
    if (billingMode === 'flat' && (!Number.isFinite(flatRate) || flatRate < 0 || flatRate > 100000000 || Math.round(flatRate * 100) !== flatRate * 100))
      return json({error:'Flat monthly rate must be a valid non-negative dollar amount'},400)
    const seatRate = billingMode === 'per_seat' ? customRate : tierRates[tier]
    const flatOverride = billingMode === 'flat' ? flatRate : null

    // Validate workspace access before provisioning any tenant or login.
    // Existing provisioning clients that omit these fields retain all features.
    const departments = validateChoices(b.departments ?? [...DEPARTMENTS], DEPARTMENTS, false)
    const hrFeatures = validateChoices(b.hr_features ?? [...HR_FEATURES], HR_FEATURES, true)
    if (!departments || !hrFeatures)
      return json({ error: 'Choose valid, unique departments (at least one), and valid HR features' }, 400)

    // ── provision the DB rows (atomic; checks code + email uniqueness) ──
    const { data: prov, error: provErr } = await admin.rpc('provision_tenant', {
      p_firm_name: firm_name,
      p_tenant_code: tenant_code,
      p_admin_name: admin_name,
      p_admin_email: admin_email,
      p_firm_phone: b.firm_phone || null,
      p_brand_color: b.brand_color || null,
      p_plan_tier: b.plan_tier || 'starter',
    })
    if (provErr) return json({ error: provErr.message }, 400)

    const tid = (prov as { tenant_id?: string } | null)?.tenant_id
    if (!tid) return json({ error: 'Provisioning did not return an office identifier; no login was created' }, 500)

    // Persist the exact selected workspace before the office admin gets a login.
    // Settings and RomyLabs Admin Portal use this same central table.
    const { error: deptError } = await admin.from('tenant_department_config').upsert({
      tenant_id: tid, departments, hr_features: hrFeatures, updated_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id' })
    const { data: stored, error: readError } = deptError
      ? { data: null, error: deptError }
      : await admin.from('tenant_department_config')
        .select('departments,hr_features').eq('tenant_id', tid).single()
    const confirmed = stored &&
      JSON.stringify(stored.departments) === JSON.stringify(departments) &&
      JSON.stringify(stored.hr_features) === JSON.stringify(hrFeatures)
    if (readError || !confirmed) {
      // Fail closed and roll back provisioning rather than creating an office
      // with a broader workspace than the owner selected.
      await admin.from('employees').delete().eq('tenant_id', tid)
      await admin.from('settings').delete().eq('tenant_id', tid)
      const { error: rollbackError } = await admin.from('tenants').delete().eq('id', tid)
      return json({ error: rollbackError
        ? 'Department setup failed and the new office requires administrator cleanup: ' + rollbackError.message
        : 'Department setup could not be verified. Office creation was rolled back; no login issued.' }, 500)
    }

    // Save the contractual rate and purchased seats before creating auth.
    // Fail closed if the values cannot be confirmed; no partial-price office.
    const {error:billingError} = await admin.from('tenants').update({
      per_seat_rate: seatRate,
      monthly_rate: flatOverride,
      billing_seats: seats,
    }).eq('id',tid)
    const {data:pricing, error:pricingReadError} = billingError
      ? {data:null,error:billingError}
      : await admin.from('tenants').select('per_seat_rate,monthly_rate,billing_seats').eq('id',tid).single()
    if (pricingReadError || !pricing || Number(pricing.per_seat_rate)!==seatRate ||
        Number(pricing.billing_seats)!==seats ||
        (flatOverride===null ? pricing.monthly_rate!==null : Number(pricing.monthly_rate)!==flatOverride)) {
      await admin.from('tenant_department_config').delete().eq('tenant_id',tid)
      await admin.from('employees').delete().eq('tenant_id',tid)
      await admin.from('settings').delete().eq('tenant_id',tid)
      const {error:rollbackError}=await admin.from('tenants').delete().eq('id',tid)
      return json({error:rollbackError
        ? 'Billing setup failed; office requires administrator cleanup: '+rollbackError.message
        : 'Billing setup could not be verified. Office creation rolled back.'},500)
    }

    // ── mint the admin login (email must match the employee email) ──
    const password = genPassword()
    const { error: authErr } = await admin.auth.admin.createUser({
      email: admin_email,
      password,
      email_confirm: true,
      user_metadata: { name: admin_name || admin_email.split('@')[0] },
    })
    if (authErr) {
      // roll back so we never leave a tenant that can't be logged into
      if (tid) {
        await admin.from('employees').delete().eq('email', admin_email)
        await admin.from('settings').delete().eq('tenant_id', tid)
        await admin.from('tenants').delete().eq('id', tid)
      }
      return json({ error: 'Login creation failed: ' + authErr.message }, 400)
    }

    return json({ ...(prov as Record<string, unknown>), temp_password: password })
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
