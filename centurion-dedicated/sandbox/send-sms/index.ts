import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

const LEGACY_CENTURION_OFFICE =
  '8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })

const digits = (value: unknown) =>
  String(value ?? '').replace(/\D/g, '')

function toE164(value: unknown) {
  const d = digits(value)

  if (d.length === 10) {
    return `+1${d}`
  }

  if (
    d.length === 11 &&
    d.startsWith('1')
  ) {
    return `+${d}`
  }

  return ''
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    })
  }

  if (req.method !== 'POST') {
    return json(
      { error: 'Method not allowed' },
      405,
    )
  }

  try {
    const supabaseUrl =
      Deno.env.get('SUPABASE_URL') || ''

    const serviceRole =
      Deno.env.get(
        'SUPABASE_SERVICE_ROLE_KEY',
      ) || ''

    const anonKey =
      Deno.env.get(
        'SUPABASE_ANON_KEY',
      ) || ''

    const swSpaceUrl =
      Deno.env.get(
        'SIGNALWIRE_SPACE_URL',
      ) || ''

    const swProjectId =
      Deno.env.get(
        'SIGNALWIRE_PROJECT_ID',
      ) || ''

    const swApiToken =
      Deno.env.get(
        'SIGNALWIRE_API_TOKEN',
      ) || ''

    const smsFrom =
      Deno.env.get(
        'SIGNALWIRE_SMS_FROM',
      ) || ''

    if (
      !supabaseUrl ||
      !serviceRole ||
      !anonKey
    ) {
      return json(
        {
          error:
            'Supabase configuration missing',
        },
        500,
      )
    }

    if (
      !swSpaceUrl ||
      !swProjectId ||
      !swApiToken
    ) {
      return json(
        {
          error:
            'SignalWire provider configuration missing',
          code:
            'SIGNALWIRE_PROVIDER_NOT_CONFIGURED',
        },
        500,
      )
    }

    const authorization =
      req.headers.get(
        'authorization',
      ) || ''

    if (
      !authorization
        .toLowerCase()
        .startsWith('bearer ')
    ) {
      return json(
        { error: 'Unauthorized' },
        401,
      )
    }

    const token =
      authorization.slice(7).trim()

    const authClient =
      createClient(
        supabaseUrl,
        anonKey,
        {
          global: {
            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          },
        },
      )

    const {
      data: userData,
      error: userError,
    } =
      await authClient.auth.getUser(
        token,
      )

    const user =
      userData?.user

    if (
      userError ||
      !user?.email
    ) {
      return json(
        { error: 'Unauthorized' },
        401,
      )
    }

    // Tenant identity is derived from the signed-in user's verified membership.
    // No browser supplied tenant ID is ever accepted for authorization.
    const { data: selectedTenant, error: tenantError } =
      await authClient.rpc('current_tenant_id')
    if (tenantError || !selectedTenant) return json({ error: 'Authorized office required' }, 403)

    const admin =
      createClient(
        supabaseUrl,
        serviceRole,
      )

    const {
      data: employee,
      error: employeeError,
    } =
      await admin
        .from('employees')
        .select(
          'id,name,email,status,perm_comms,tenant_id',
        )
        .eq(
          'tenant_id',
          selectedTenant,
        )
        .ilike(
          'email',
          user.email,
        )
        .limit(1)
        .maybeSingle()

    if (employeeError) {
      console.error(
        '[centurion-send-sms] employee lookup failed',
        employeeError.message,
      )

      return json(
        {
          error:
            'Employee lookup failed',
        },
        500,
      )
    }

    if (
      !employee ||
      String(
        employee.status || '',
      ).toLowerCase() !== 'active'
    ) {
      return json(
        {
          error:
            'Active Centurion employee required',
        },
        403,
      )
    }

    if (
      Number(
        employee.perm_comms || 0,
      ) < 2
    ) {
      return json(
        {
          error:
            'SMS permission denied',
        },
        403,
      )
    }

    const payload =
      await req.json()

    const toNumber =
      toE164(payload.to)

    const {data: officePhone, error: phoneError} = await admin.from('tenants')
      .select('signalwire_phone_number').eq('id',selectedTenant).single()
    if (phoneError || !officePhone) return json({error:'Office phone lookup failed'},403)
    const configuredFrom = selectedTenant === LEGACY_CENTURION_OFFICE
      ? smsFrom : officePhone.signalwire_phone_number
    const fromNumber = configuredFrom ? toE164(configuredFrom) : ''

    const message =
      String(
        payload.body || '',
      ).trim()

    if (!toNumber) {
      return json(
        {
          error:
            'Valid US recipient phone number required',
        },
        400,
      )
    }

    if (!message) {
      return json(
        {
          error:
            'SMS body required',
        },
        400,
      )
    }

    if (message.length > 1500) {
      return json(
        {
          error:
            'SMS message is too long',
        },
        400,
      )
    }

    if (!fromNumber) {
      return json(
        {
          error:
            'Centurion SMS number has not been assigned yet',
          code:
            'SMS_NUMBER_NOT_CONFIGURED',
        },
        422,
      )
    }

    let clientName: string | null =
      null

    const clientId =
      payload.client_id
        ? String(payload.client_id)
        : null

    const leadId =
      payload.lead_id
        ? String(payload.lead_id)
        : null

    if (clientId) {
      const {
        data: client,
      } =
        await admin
          .from('clients')
          .select('name')
          .eq(
            'tenant_id',
            selectedTenant,
          )
          .eq(
            'id',
            clientId,
          )
          .maybeSingle()

      clientName =
        client?.name || null
    }

    if (
      !clientName &&
      leadId
    ) {
      const {
        data: lead,
      } =
        await admin
          .from('leads')
          .select('name')
          .eq(
            'tenant_id',
            selectedTenant,
          )
          .eq(
            'id',
            leadId,
          )
          .maybeSingle()

      clientName =
        lead?.name || null
    }

    if (
      payload.qa_certification ===
        true &&
      payload.dry_run === true
    ) {
      return json({
        success: true,
        dry_run: true,
        delivery: false,
        provider:
          'signalwire',
        tenant_id:
          selectedTenant,
        from_number:
          fromNumber,
      })
    }

    const basicAuth =
      btoa(
        `${swProjectId}:${swApiToken}`,
      )

    const baseHost =
      swSpaceUrl
        .replace(
          /^https?:\/\//,
          '',
        )
        .replace(/\/$/, '')

    const form =
      new URLSearchParams({
        From:
          fromNumber,
        To:
          toNumber,
        Body:
          message,
      })

    const response =
      await fetch(
        `https://${baseHost}/api/laml/2010-04-01/Accounts/${swProjectId}/Messages.json`,
        {
          method:
            'POST',

          headers: {
            Authorization:
              `Basic ${basicAuth}`,

            'Content-Type':
              'application/x-www-form-urlencoded',
          },

          body:
            form.toString(),
        },
      )

    const responseText =
      await response.text()

    let providerResult: any =
      null

    try {
      providerResult =
        JSON.parse(
          responseText,
        )
    } catch {
      providerResult = {
        raw:
          responseText,
      }
    }

    if (!response.ok) {
      console.error(
        '[centurion-send-sms]',
        providerResult,
      )

      return json(
        {
          error:
            providerResult?.message ||
            providerResult?.error ||
            providerResult?.detail ||
            'SignalWire SMS failed',

          provider_status:
            response.status,
        },
        400,
      )
    }

    const providerSid =
      providerResult?.sid ||
      null

    const sentBy =
      employee.name ||
      user.email

    const {
      error: logError,
    } =
      await admin
        .from('sms_messages')
        .insert({
          clientName:
            clientName,

          phone:
            toNumber,

          body:
            message,

          status:
            providerResult?.status ||
            'sent',

          direction:
            'outbound',

          signalwire_sms_id:
            providerSid,

          sent_by:
            sentBy,

          tenant_id:
            selectedTenant,

          client_id:
            clientId,

          read:
            true,
        })

    if (logError) {
      console.error(
        '[centurion-send-sms] log failed',
        logError.message,
      )
    }

    if (
      payload.esign_id
    ) {
      await admin
        .from('esigns')
        .update({
          signed_sms_sent_at:
            new Date()
              .toISOString(),
        })
        .eq(
          'tenant_id',
          selectedTenant,
        )
        .eq(
          'id',
          String(
            payload.esign_id,
          ),
        )
    }

    return json({
      success:
        true,

      provider:
        'signalwire',

      tenant_id:
        selectedTenant,

      sid:
        providerSid,

      status:
        providerResult?.status ||
        'sent',

      from_number:
        fromNumber,

      logged:
        !logError,
    })
  } catch (error) {
    console.error(
      '[centurion-send-sms]',
      error,
    )

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'SMS send failed',
      },
      500,
    )
  }
})