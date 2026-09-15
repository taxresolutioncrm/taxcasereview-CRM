// save-email-account — encrypts the password server-side before persisting.
// The encryption key NEVER reaches the browser — it lives only in this
// edge function's environment variables.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!
const ENCRYPT_KEY  = Deno.env.get('EMAIL_ENCRYPT_KEY')

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok:false, error:'Method not allowed' }), { status:405, headers:{...corsHeaders,'Content-Type':'application/json'} })

  try {
    if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY || !ENCRYPT_KEY) throw new Error('Server email encryption is not configured')

    // Get the calling user from their JWT
    const authHeader = req.headers.get('Authorization') || ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY,
      { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user?.email) throw new Error('Not authenticated')

    const svc = createClient(SUPABASE_URL, SERVICE_KEY)
    const { data: currentTenantId } = await userClient.rpc('current_tenant_id')
    const { data: isPlatformAdmin } = await userClient.rpc('_is_platform_admin')

    const { email_address, display_name, imap_host, imap_port, smtp_host, smtp_port, use_ssl, password } = await req.json()
    const address = String(email_address || '').trim().toLowerCase()
    const isRomyLabsMailbox = address.endsWith('@romylabs.com')

    // RomyLabs platform owners may securely connect the RomyLabs mailbox even
    // when they are not a normal employee row in a tenant CRM. That mailbox is
    // always stored under the fixed RomyLabs admin tenant.
    const ROMYLABS_ADMIN_TENANT = 'a0000000-0000-0000-0000-000000000001'
    const tenantId = isPlatformAdmin && isRomyLabsMailbox ? ROMYLABS_ADMIN_TENANT : currentTenantId
    if (!tenantId) throw new Error('No active office context')

    if (!(isPlatformAdmin && isRomyLabsMailbox)) {
      const { data: employee } = await svc.from('employees')
        .select('id,status,perm_comms,tenant_id')
        .eq('tenant_id', tenantId)
        .ilike('email', user.email)
        .limit(1)
        .maybeSingle()
      const active = employee && String(employee.status || 'Active').toLowerCase() === 'active'
      if (!active || Number(employee?.perm_comms || 0) < 2) throw new Error('Email permission denied')
    }

    if (!email_address || !password) throw new Error('email_address and password are required')

    // Encrypt via the server-side RPC (key never leaves the server)
    const { data: encrypted, error: encErr } = await svc
      .rpc('encrypt_email_password', { p_plain: password, p_key: ENCRYPT_KEY })
    if (encErr || !encrypted) throw new Error('Encryption failed: ' + encErr?.message)

    // Upsert within the authorized tenant resolved above.
    const { data, error } = await svc.from('email_accounts').upsert({
      tenant_id:          tenantId,
      employee_email:     user.email,
      email_address:      address,
      display_name:       display_name || address,
      imap_host:          imap_host || 'mail.taxrescrm.net',
      imap_port:          imap_port || 993,
      smtp_host:          smtp_host || 'mail.taxrescrm.net',
      smtp_port:          smtp_port || 587,
      use_ssl:            use_ssl ?? true,
      encrypted_password: encrypted,
      is_active:          true,
      sync_status:        'pending',
    }, { onConflict: 'employee_email,email_address' }).select('id').single()

    if (error) throw error

    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    const message=(err as Error).message
    const status = message==='Not authenticated' ? 401 : message==='Email permission denied' || message==='No active office context' ? 403 : 400
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})