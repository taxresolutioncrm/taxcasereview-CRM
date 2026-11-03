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

    const faxFrom =
      Deno.env.get(
        'SIGNALWIRE_FAX_FROM',
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
            'Fax permission denied',
        },
        403,
      )
    }

    const payload =
      await req.json()

    const toNumber =
      toE164(payload.to)

    const {data: officeFax, error: faxError} = await admin.from('settings')
      .select('firm_fax_number,fax_number').eq('tenant_id',selectedTenant).maybeSingle()
    if (faxError) return json({error:'Office fax settings unavailable'},403)
    const configuredFrom = selectedTenant === LEGACY_CENTURION_OFFICE
      ? faxFrom : (officeFax?.firm_fax_number || officeFax?.fax_number)
    const fromNumber = configuredFrom ? toE164(configuredFrom) : ''

    const documentUrl =
      String(
        payload.document_url || '',
      ).trim()

    if (!toNumber) {
      return json(
        {
          error:
            'Valid US fax number required',
        },
        400,
      )
    }

    if (!documentUrl) {
      return json(
        {
          error:
            'document_url is required',
        },
        400,
      )
    }

    if (!fromNumber) {
      return json(
        {
          error:
            'Centurion fax number has not been assigned yet',
          code:
            'FAX_NUMBER_NOT_CONFIGURED',
        },
        422,
      )
    }

    let parsedUrl: URL

    try {
      parsedUrl =
        new URL(documentUrl)
    } catch {
      return json(
        {
          error:
            'Invalid document_url',
        },
        400,
      )
    }

    const allowedHost =
      new URL(
        supabaseUrl,
      ).hostname

    if (
      parsedUrl.protocol !==
        'https:' ||
      parsedUrl.hostname !==
        allowedHost
    ) {
      return json(
        {
          error:
            'document_url must use Centurion Supabase storage',
        },
        400,
      )
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
        from:
          fromNumber,
      })
    }

    const basicAuth =
      btoa(
        `${swProjectId}:${swApiToken}`,
      )

    const host =
      swSpaceUrl
        .replace(
          /^https?:\/\//,
          '',
        )
        .replace(/\/$/, '')

    const statusCallback =
      `${supabaseUrl}/functions/v1/receive-fax?outbound=1&tenant=${encodeURIComponent(
        selectedTenant,
      )}`

    const form =
      new URLSearchParams({
        From:
          fromNumber,

        To:
          toNumber,

        MediaUrl:
          parsedUrl.toString(),

        StatusCallback:
          statusCallback,

        StatusCallbackMethod:
          'POST',
      })

    const response =
      await fetch(
        `https://${host}/api/laml/2010-04-01/Accounts/${swProjectId}/Faxes.json`,
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
      return json(
        {
          error:
            providerResult?.message ||
            providerResult?.error ||
            providerResult?.detail ||
            providerResult?.raw ||
            'SignalWire fax failed',

          provider_status:
            response.status,
        },
        400,
      )
    }

    const sid =
      providerResult?.sid ||
      null

    const {
      error: logError,
    } =
      await admin
        .from('fax_logs')
        .insert({
          tenant_id:
            selectedTenant,

          to_number:
            toNumber,

          from_number:
            fromNumber,

          file_url:
            documentUrl,

          signalwire_fax_id:
            sid,

          status:
            providerResult?.status ||
            'Pending',

          sent_by:
            employee.name ||
            user.email,

          sent_at:
            new Date().toISOString(),

          created_at:
            new Date().toISOString(),

          direction:
            'outbound',

          read:
            true,

          is_read:
            true,
        })

    if (logError) {
      console.error(
        '[centurion-send-fax] log failed',
        logError.message,
      )
    }

    return json({
      success:
        true,

      provider:
        'signalwire',

      tenant_id:
        selectedTenant,

      sid,

      status:
        providerResult?.status ||
        'Pending',

      from:
        fromNumber,

      logged:
        !logError,
    })
  } catch (error) {
    console.error(
      '[centurion-send-fax]',
      error,
    )

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Fax send failed',
      },
      500,
    )
  }
})