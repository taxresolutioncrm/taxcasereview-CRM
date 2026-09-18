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

    const admin = createClient(url, serviceKey)

    // ── inputs ──
    const b = await req.json().catch(() => ({}))
    const action = String(b.action || 'provision_tenant').trim().toLowerCase()

    // Tenant Super Admin / HR manager path: provision a login for an employee
    // that already belongs to the caller's own tenant. This keeps employee
    // creation tenant-scoped and never grants a tenant admin platform powers.
    if (action === 'invite_employee') {
      const { data: tenantId, error: tenantErr } = await asCaller.rpc('current_tenant_id')
      if (tenantErr || !tenantId) return json({ error:'No active office context' }, 403)

      const { data: caller } = await admin.from('employees')
        .select('id,status,perm_hr,access,role')
        .eq('tenant_id', tenantId)
        .ilike('email', user.email)
        .limit(1).maybeSingle()
      const active = caller && String(caller.status || 'Active').toLowerCase() === 'active'
      const canInvite = active && (Number(caller?.perm_hr || 0) >= 2 || String(caller?.access || caller?.role || '').toLowerCase() === 'super admin')
      if (!canInvite) return json({ error:'Employee invite permission denied' }, 403)

      const employeeEmail = String(b.email || '').trim().toLowerCase()
      const employeeName = String(b.name || '').trim()
      if (!employeeEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employeeEmail)) {
        return json({ error:'Valid employee email is required' }, 400)
      }

      const { data: employee } = await admin.from('employees')
        .select('id,email,name,status,tenant_id')
        .eq('tenant_id', tenantId)
        .ilike('email', employeeEmail)
        .limit(1).maybeSingle()
      if (!employee) return json({ error:'Employee must be saved in this office before inviting them' }, 409)
      if (String(employee.status || 'Active').toLowerCase() !== 'active') return json({ error:'Employee is not active' }, 409)

      // Detect an existing Auth account without exposing account metadata to the caller.
      let existingUser:any = null
      for (let page=1; page<=5 && !existingUser; page++) {
        const { data:list, error:listErr } = await admin.auth.admin.listUsers({ page, perPage:200 })
        if (listErr) return json({ error:'Could not verify employee login: '+listErr.message }, 500)
        existingUser = (list?.users || []).find((u:any)=>String(u.email || '').toLowerCase() === employeeEmail) || null
        if ((list?.users || []).length < 200) break
      }

      if (existingUser) {
        return json({ ok:true, already_exists:true, email:employeeEmail, employee_id:employee.id })
      }

      const redirectTo = String(b.redirect_to || '').trim()
      const options:any = { data:{ name:employeeName || employee.name || employeeEmail.split('@')[0] } }
      if (redirectTo) options.redirectTo = redirectTo
      const { data:invite, error:inviteErr } = await admin.auth.admin.inviteUserByEmail(employeeEmail, options)
      if (inviteErr) return json({ error:'Employee invite failed: '+inviteErr.message }, 400)

      return json({ ok:true, invited:true, email:employeeEmail, employee_id:employee.id, auth_user_id:invite?.user?.id || null })
    }

    // New-office provisioning remains platform-owner only.
    if (!PLATFORM_ADMIN_EMAILS.includes(user.email.toLowerCase())) return json({ error: 'Not authorized to provision offices' }, 403)

    const firm_name   = (b.firm_name || '').trim()
    const tenant_code = (b.tenant_code || '').trim()
    const admin_name  = (b.admin_name || '').trim()
    const admin_email = (b.admin_email || '').trim().toLowerCase()
    if (!firm_name || !tenant_code || !admin_email)
      return json({ error: 'firm_name, tenant_code, and admin_email are required' }, 400)

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
      const tid = (prov as any)?.tenant_id
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
