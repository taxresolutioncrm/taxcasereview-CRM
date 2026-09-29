// linkedin-publish v7 — product_id scoped
// All operations are scoped by tenant_id + product_id.
// product_id defaults to 'taxres_crm' for backward compatibility.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, 'Content-Type': 'application/json' }
  })
}

const COMPANY_PRODUCTS = new Set(['taxres_crm','arcvena'])
const COMPANY_MATCH: Record<string, RegExp> = {
  taxres_crm: /tax\s*res|taxres/i,
  arcvena: /arcvena/i,
}

async function resolveCompanyOrganization(accessToken:string, productId:string) {
  const aclRes = await fetch('https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED', {
    headers: { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version':'2.0.0' }
  })
  const acl = await aclRes.json().catch(() => ({}))
  if (!aclRes.ok) return { organizationId:null, organizations:[], error:'Could not read LinkedIn company-page administrator access' }

  const ids = [...new Set((acl?.elements || []).map((x:any) => String(x?.organizationalTarget || '').split(':').pop()).filter(Boolean))]
  const organizations:any[] = []
  for (const id of ids) {
    const orgRes = await fetch(`https://api.linkedin.com/v2/organizations/${id}?projection=(id,localizedName,vanityName)`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version':'2.0.0' }
    })
    const org = await orgRes.json().catch(() => ({}))
    if (orgRes.ok) organizations.push({ id:String(org.id || id), name:String(org.localizedName || ''), vanityName:String(org.vanityName || '') })
  }

  const matcher = COMPANY_MATCH[productId]
  const match = organizations.find(o => matcher?.test(`${o.name} ${o.vanityName}`))
  return { organizationId:match?.id || null, organizations, error:null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ ok: false, error: 'Unauthorized' }, 401)

  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  )
  if (authError || !user) return json({ ok: false, error: 'Unauthorized' }, 401)

  // Resolve tenant — platform admin uses fixed admin tenant
  const PLATFORM_ADMINS = ['romy@taxcasereview.org', 'romy@romylabs.com', 'info@romylabs.com']
  let tenantId: string
  if (PLATFORM_ADMINS.includes(user.email || '')) {
    tenantId = 'a0000000-0000-0000-0000-000000000001'
  } else {
    const { data: emp, error: empError } = await supabase
      .from('employees')
      .select('tenant_id')
      .eq('email', user.email)
      .limit(1)
      .single()
    if (empError || !emp?.tenant_id) return json({ ok: false, error: 'No tenant found' }, 403)
    tenantId = emp.tenant_id
  }

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch (_) {}
  const action = body.action as string
  // product_id is REQUIRED — fail closed if not provided
  const productId: string | undefined = (body.product_id as string) || undefined
  if (!productId) return json({ ok: false, error: 'product_id is required' }, 400)

  if (action === 'oauth_callback') {
    const code         = body.code as string
    const redirect_uri = body.redirect_uri as string
    const clientId     = Deno.env.get('LINKEDIN_CLIENT_ID')!
    const clientSecret = Deno.env.get('LINKEDIN_CLIENT_SECRET')!

    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri,
        client_id: clientId, client_secret: clientSecret,
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      return json({ ok: false, error: 'Token exchange failed', detail: tokenData }, 400)
    }

    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    })
    const profile = await profileRes.json()

    const grantedScopes = String(tokenData.scope || '')
    const isCompanyProduct = COMPANY_PRODUCTS.has(productId)
    if (isCompanyProduct && !grantedScopes.split(/[ ,]+/).includes('w_organization_social')) {
      return json({
        ok: false,
        error: 'This product requires LinkedIn company-page posting permission',
        required_scope: 'w_organization_social',
        product_id: productId,
      }, 403)
    }

    let publishTargetType = 'PERSON'
    let linkedinOrganizationId:string|null = null
    let organizationName:string|null = null
    if (isCompanyProduct) {
      const resolved = await resolveCompanyOrganization(tokenData.access_token, productId)
      if (!resolved.organizationId) {
        return json({
          ok:false,
          error:'No matching LinkedIn company page was found for this product under the connected administrator account',
          product_id:productId,
          available_organizations:resolved.organizations,
          detail:resolved.error,
        }, 409)
      }
      publishTargetType = 'ORGANIZATION'
      linkedinOrganizationId = resolved.organizationId
      organizationName = resolved.organizations.find((o:any)=>o.id===resolved.organizationId)?.name || null
    }

    await supabase.from('linkedin_connections').upsert({
      tenant_id: tenantId,
      product_id: productId,
      linkedin_person_id: profile.sub,
      display_name: profile.name || profile.email || 'LinkedIn Account',
      access_token: tokenData.access_token,
      expires_at: new Date(Date.now() + (tokenData.expires_in || 5184000) * 1000).toISOString(),
      scopes: grantedScopes || (isCompanyProduct ? 'openid,profile,w_organization_social' : 'openid,profile,w_member_social'),
      publish_target_type: publishTargetType,
      linkedin_organization_id: linkedinOrganizationId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,product_id' })

    return json({
      ok: true,
      name: organizationName || profile.name || 'LinkedIn Account',
      member_name: profile.name || null,
      product_id: productId,
      publish_target_type: publishTargetType,
      linkedin_organization_id: linkedinOrganizationId,
    })
  }

  if (action === 'status') {
    const { data, error } = await supabase
      .from('linkedin_connections')
      .select('display_name, expires_at, scopes, publish_target_type, linkedin_organization_id')
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .limit(1)
      .single()

    if (error || !data) return json({ ok: true, connected: false })
    return json({
      ok: true,
      connected: true,
      display_name: data.display_name,
      expires_at: data.expires_at,
      expired: new Date(data.expires_at) < new Date(),
      scopes: data.scopes,
      publish_target_type: data.publish_target_type || 'PERSON',
      linkedin_organization_id: data.linkedin_organization_id || null,
    })
  }

  if (action === 'set_publish_target') {
    const targetType = String(body.publish_target_type || '').toUpperCase()
    const organizationId = body.linkedin_organization_id
      ? String(body.linkedin_organization_id).trim()
      : null

    if (!['PERSON', 'ORGANIZATION'].includes(targetType)) {
      return json({ ok: false, error: 'publish_target_type must be PERSON or ORGANIZATION' }, 400)
    }
    if (targetType === 'ORGANIZATION' && !organizationId) {
      return json({ ok: false, error: 'linkedin_organization_id is required for ORGANIZATION target' }, 400)
    }

    const { error } = await supabase.from('linkedin_connections').update({
      publish_target_type: targetType,
      linkedin_organization_id: targetType === 'ORGANIZATION' ? organizationId : null,
      updated_at: new Date().toISOString(),
    }).eq('tenant_id', tenantId).eq('product_id', productId)

    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true, publish_target_type: targetType, linkedin_organization_id: targetType === 'ORGANIZATION' ? organizationId : null })
  }

  if (action === 'save_draft') {
    const p_body = (body.body as string || '').trim()
    const p_status = (body.status as string) || 'draft'
    const p_scheduled_at = body.scheduled_at as string | null || null
    const p_id = body.id as string | null || null
    const p_title = body.title as string || p_body.slice(0, 60)
    const p_category = body.category as string || 'general'

    if (!p_body) return json({ ok: false, error: 'Post body is required' }, 400)

    if (p_id) {
      const { data: updated, error } = await supabase
        .from('linkedin_posts')
        .update({ body: p_body, status: p_status, scheduled_at: p_scheduled_at,
                  title: p_title, category: p_category, updated_at: new Date().toISOString() })
        .eq('id', p_id).eq('tenant_id', tenantId).select().single()
      if (error) return json({ ok: false, error: error.message }, 500)
      return json({ ok: true, post: updated })
    }

    const { data: inserted, error } = await supabase.from('linkedin_posts').insert({
      tenant_id: tenantId, product_id: productId,
      body: p_body, status: p_status, scheduled_at: p_scheduled_at,
      title: p_title, category: p_category,
    }).select().single()
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true, post: inserted })
  }

  if (action === 'list_posts') {
    const limit = Number(body.limit) || 100
    const { data: posts, error } = await supabase.from('linkedin_posts').select('*')
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .order('created_at', { ascending: false }).limit(limit)
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true, posts: posts || [] })
  }

  if (action === 'delete_post') {
    const post_id = body.post_id as string
    if (!post_id) return json({ ok: false, error: 'post_id required' }, 400)
    await supabase.from('linkedin_posts').delete()
      .eq('id', post_id).eq('tenant_id', tenantId).eq('product_id', productId)
    return json({ ok: true })
  }

  if (action === 'publish') {
    const post_id = body.post_id as string
    if (!post_id) return json({ ok: false, error: 'post_id required' }, 400)

    // Connection MUST be for this product — no fallback to other products
    const { data: conn, error: connError } = await supabase
      .from('linkedin_connections')
      .select('access_token, expires_at, linkedin_person_id, publish_target_type, linkedin_organization_id')
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .limit(1).single()

    if (connError || !conn) return json({ ok: false, error: 'LinkedIn not connected for this product' }, 401)
    if (new Date(conn.expires_at) < new Date()) {
      return json({ ok: false, error: 'LinkedIn token expired — please reconnect' }, 401)
    }

    const targetType = conn.publish_target_type || 'PERSON'
    if (COMPANY_PRODUCTS.has(productId) && targetType !== 'ORGANIZATION') {
      return json({ ok:false, error:'Company-page publishing is required for this product. Reconnect LinkedIn and authorize the product company page.' }, 409)
    }
    const author = targetType === 'ORGANIZATION'
      ? (conn.linkedin_organization_id ? `urn:li:organization:${conn.linkedin_organization_id}` : null)
      : (conn.linkedin_person_id ? `urn:li:person:${conn.linkedin_person_id}` : null)

    if (!author) return json({ ok: false, error: 'LinkedIn publish target is not configured' }, 400)

    const { data: post, error: postError } = await supabase.from('linkedin_posts')
      .select('id, body, status, tenant_id').eq('id', post_id).eq('tenant_id', tenantId).single()

    if (postError || !post) return json({ ok: false, error: 'Post not found' }, 404)
    if (post.status === 'published') return json({ ok: false, error: 'Already published' }, 409)

    await supabase.from('linkedin_posts').update({ status: 'publishing', updated_at: new Date().toISOString() })
      .eq('id', post_id).eq('tenant_id', tenantId)

    const publishRes = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: post.body },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    })

    const publishData = await publishRes.json()
    if (!publishRes.ok) {
      await supabase.from('linkedin_posts').update({
        status: 'failed', error_msg: JSON.stringify(publishData), updated_at: new Date().toISOString(),
      }).eq('id', post_id).eq('tenant_id', tenantId)
      return json({ ok: false, error: 'LinkedIn API error', detail: publishData }, 500)
    }

    const liPostId = publishData.id
    const liUrl = `https://www.linkedin.com/feed/update/${liPostId}`
    await supabase.from('linkedin_posts').update({
      status: 'published', published_at: new Date().toISOString(),
      linkedin_post_id: liPostId, linkedin_url: liUrl,
      error_msg: null, updated_at: new Date().toISOString(),
    }).eq('id', post_id).eq('tenant_id', tenantId)

    return json({ ok: true, post_id: liPostId, url: liUrl, author })
  }

  if (action === 'disconnect') {
    await supabase.from('linkedin_connections').delete()
      .eq('tenant_id', tenantId).eq('product_id', productId)
    return json({ ok: true })
  }

  return json({ ok: false, error: 'Unknown action' }, 400)
})
