import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

const LEGACY_CENTURION_OFFICE =
  '8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a'

const safe = (value: unknown) =>
  String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })

async function sendViaStalwart(options: {
  host: string
  username: string
  password: string
  fromAddress: string
  fromName: string
  replyTo?: string
  to: string
  subject: string
  html?: string
  text?: string
}) {
  const base =
    `https://${options.host
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')}`

  const authorization =
    'Basic ' +
    btoa(`${options.username}:${options.password}`)

  const sessionResponse = await fetch(
    `${base}/.well-known/jmap`,
    {
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
      },
    },
  )

  if (!sessionResponse.ok) {
    throw new Error(
      `Stalwart JMAP session failed (${sessionResponse.status})`,
    )
  }

  const session = await sessionResponse.json()

  const apiUrl = String(session?.apiUrl || '')
    .replace('{accountId}', '')

  const accountId =
    session?.primaryAccounts?.[
      'urn:ietf:params:jmap:mail'
    ] ||
    Object.keys(session?.accounts || {})[0]

  if (!apiUrl || !accountId) {
    throw new Error(
      'Stalwart JMAP session missing mail account',
    )
  }

  const metadataResponse = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      using: [
        'urn:ietf:params:jmap:core',
        'urn:ietf:params:jmap:mail',
        'urn:ietf:params:jmap:submission',
      ],
      methodCalls: [
        [
          'Identity/get',
          { accountId },
          'identity',
        ],
        [
          'Mailbox/get',
          {
            accountId,
            properties: ['id', 'name', 'role'],
          },
          'mailboxes',
        ],
      ],
    }),
  })

  if (!metadataResponse.ok) {
    throw new Error(
      `Stalwart metadata failed (${metadataResponse.status})`,
    )
  }

  const metadata = await metadataResponse.json()

  const identities =
    metadata?.methodResponses?.find(
      (item: any) =>
        item?.[0] === 'Identity/get',
    )?.[1]?.list || []

  const mailboxes =
    metadata?.methodResponses?.find(
      (item: any) =>
        item?.[0] === 'Mailbox/get',
    )?.[1]?.list || []

  const fromAddress =
    safe(options.fromAddress).toLowerCase()

  const identity = identities.find(
    (item: any) =>
      String(item?.email || '').toLowerCase() ===
      fromAddress,
  )

  if (!identity?.id) {
    throw new Error(
      `Stalwart does not authorize sender identity ${fromAddress}`,
    )
  }

  const drafts = mailboxes.find(
    (item: any) =>
      String(item?.role || '').toLowerCase() ===
      'drafts',
  )

  const sent = mailboxes.find(
    (item: any) =>
      String(item?.role || '').toLowerCase() ===
      'sent',
  )

  if (!drafts?.id || !sent?.id) {
    throw new Error(
      'Stalwart Drafts or Sent mailbox unavailable',
    )
  }

  const bodyPartId = 'body'

  const email: any = {
    from: [
      {
        email: fromAddress,
        name:
          options.fromName ||
          'Centurion Firm',
      },
    ],

    to: [
      {
        email: options.to,
      },
    ],

    ...(options.replyTo
      ? {
          replyTo: [
            {
              email: options.replyTo,
            },
          ],
        }
      : {}),

    subject: options.subject,

    mailboxIds: {
      [drafts.id]: true,
    },

    keywords: {
      '$draft': true,
    },

    bodyValues: {
      [bodyPartId]: {
        value:
          options.html ||
          options.text ||
          '',
        charset: 'utf-8',
      },
    },
  }

  if (options.html) {
    email.htmlBody = [
      {
        partId: bodyPartId,
        type: 'text/html',
      },
    ]
  } else {
    email.textBody = [
      {
        partId: bodyPartId,
        type: 'text/plain',
      },
    ]
  }

  const sendResponse = await fetch(apiUrl, {
    method: 'POST',

    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },

    body: JSON.stringify({
      using: [
        'urn:ietf:params:jmap:core',
        'urn:ietf:params:jmap:mail',
        'urn:ietf:params:jmap:submission',
      ],

      methodCalls: [
        [
          'Email/set',
          {
            accountId,
            create: {
              draft: email,
            },
          },
          'createEmail',
        ],

        [
          'EmailSubmission/set',
          {
            accountId,

            create: {
              send: {
                emailId: '#draft',
                identityId: identity.id,
              },
            },

            onSuccessUpdateEmail: {
              '#send': {
                [`mailboxIds/${drafts.id}`]:
                  null,

                [`mailboxIds/${sent.id}`]:
                  true,

                'keywords/$draft': null,
              },
            },
          },
          'submit',
        ],
      ],
    }),
  })

  if (!sendResponse.ok) {
    throw new Error(
      `Stalwart send failed (${sendResponse.status})`,
    )
  }

  const result = await sendResponse.json()

  const submission =
    result?.methodResponses?.find(
      (item: any) =>
        item?.[0] === 'EmailSubmission/set',
    )?.[1]

  const rejected =
    submission?.notCreated?.send

  if (rejected) {
    throw new Error(
      rejected.description ||
        rejected.type ||
        'Stalwart rejected email',
    )
  }

  const submissionId =
    submission?.created?.send?.id

  if (!submissionId) {
    throw new Error(
      'Stalwart did not confirm email submission',
    )
  }

  return String(submissionId)
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

    const stalwartHost =
      Deno.env.get(
        'STALWART_HOST',
      ) || ''

    const stalwartUsername =
      Deno.env.get(
        'STALWART_USERNAME',
      ) || ''

    const stalwartPassword =
      Deno.env.get(
        'STALWART_PASSWORD',
      ) || ''

    const stalwartFrom =
      Deno.env.get(
        'STALWART_FROM_ADDRESS',
      ) || 'romy@taxrescrm.net'

    if (
      !supabaseUrl ||
      !serviceRole ||
      !anonKey
    ) {
      return json(
        {
          error:
            'Supabase server configuration missing',
        },
        500,
      )
    }

    if (
      !stalwartHost ||
      !stalwartUsername ||
      !stalwartPassword
    ) {
      return json(
        {
          error:
            'Centurion Stalwart transport is not configured',
        },
        500,
      )
    }

    const authorization =
      req.headers.get('authorization') || ''

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
      data: userResult,
      error: userError,
    } =
      await authClient.auth.getUser(token)

    if (
      userError ||
      !userResult?.user?.email
    ) {
      return json(
        { error: 'Unauthorized' },
        401,
      )
    }

    const user =
      userResult.user

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
          user.email!,
        )
        .limit(1)
        .maybeSingle()

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
            'Email permission denied',
        },
        403,
      )
    }

    const payload =
      await req.json()

    const recipients =
      (
        Array.isArray(payload.to)
          ? payload.to
          : [payload.to]
      )
        .map((item) =>
          safe(item).toLowerCase(),
        )
        .filter(Boolean)
        .slice(0, 25)

    if (!recipients.length) {
      return json(
        {
          error:
            'Recipient email required',
        },
        400,
      )
    }

    const subject =
      safe(payload.subject)

    if (!subject) {
      return json(
        {
          error: 'Subject required',
        },
        400,
      )
    }

    const html =
      payload.html
        ? String(payload.html)
        : undefined

    const text =
      payload.text
        ? String(payload.text)
        : undefined

    if (!html && !text) {
      return json(
        {
          error:
            'Email body required',
        },
        400,
      )
    }

    const {
      data: settings,
    } =
      await admin
        .from('settings')
        .select(
          'name,firmname,email,firmemail',
        )
        .eq(
          'tenant_id',
          selectedTenant,
        )
        .limit(1)
        .maybeSingle()

    const fromName =
      safe(
        payload.from_name ||
        settings?.name ||
        settings?.firmname ||
        'Centurion Firm',
      )

    const officeFrom = selectedTenant === LEGACY_CENTURION_OFFICE
      ? stalwartFrom
      : safe(settings?.firmemail || settings?.email).toLowerCase()
    if (!officeFrom) return json({error:'Office email sender not configured'},422)

    const replyTo =
      safe(
        settings?.email ||
        settings?.firmemail ||
        (selectedTenant === LEGACY_CENTURION_OFFICE ? 'romy.cruz@centurionfirm.com' : ''),
      )

    const deliveries: any[] = []

    for (
      const recipient
      of recipients
    ) {
      const submissionId =
        await sendViaStalwart({
          host: stalwartHost,
          username:
            stalwartUsername,
          password:
            stalwartPassword,

          // Working TaxRes identity.
          fromAddress:
            officeFrom,

          fromName:
            `${fromName} via TaxRes CRM`,

          replyTo,
          to: recipient,
          subject,
          html,
          text,
        })

      deliveries.push({
        recipient,
        submissionId,
      })

      await admin
        .from('emails')
        .insert({
          tenant_id:
            selectedTenant,

          recipient,
          recipients: [recipient],

          subject,

          body:
            text ||
            String(html || '')
              .replace(
                /<[^>]+>/g,
                ' ',
              )
              .replace(
                /\s+/g,
                ' ',
              )
              .trim(),

          body_html:
            html || null,

          triage: 'Sent',
          status: 'Sent',
          direction: 'outbound',
          is_read: true,

          sender:
            stalwartFrom,

          from_address:
            stalwartFrom,

          reply_from:
            replyTo,

          mailbox_owner:
            user.email,

          received_at:
            new Date()
              .toISOString(),

          created_at:
            new Date()
              .toISOString(),

          message_id:
            `stalwart:${submissionId}`,

          received_mailbox:
            stalwartFrom,
        })
    }

    return json({
      success: true,
      provider: 'stalwart',
      tenant_id:
        selectedTenant,
      from:
        stalwartFrom,
      reply_to:
        replyTo,
      submissions:
        deliveries.map(
          (item) =>
            item.submissionId,
        ),
    })
  } catch (error) {
    console.error(
      '[centurion-send-email]',
      error,
    )

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Email send failed',
      },
      500,
    )
  }
})