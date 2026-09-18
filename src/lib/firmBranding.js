// firmBranding.js — one live source of firm identity for EMAIL + DOCUMENT
// templates.
//
// Many templates are giant inline HTML strings built at call time, so they
// can't easily await a fetch. Instead this module exports a mutable FIRM
// object that is filled once at app start (and refreshed after Settings
// saves). Templates interpolate ${FIRM.name} / ${FIRM.logoUrl} etc. and always
// render the CURRENT tenant's branding.
//
// Every value comes from that tenant's own `settings` row (RLS-scoped), so a
// demo/prospect tenant renders its own firm — never Tax Case Review's.

import { supabase } from './supabase'

const ROMYLABS_ADMIN_HOST = 'admin.romylabs.com'
const ROMYLABS_ADMIN_FAVICON = '/romylabs-favicon.svg?v=20260830-3'

function isRomyLabsAdminHost() {
  try {
    return typeof window !== 'undefined' && window.location.hostname.toLowerCase() === ROMYLABS_ADMIN_HOST
  } catch (_) {
    return false
  }
}

function setBrowserTitle(title) {
  try {
    document.title = isRomyLabsAdminHost() ? 'RomyLabs Admin' : title
  } catch (_) {}
}

// Slug for per-tenant asset folders (blank IRS/state form templates carrying
// that firm's representative details). Derived from the firm name rather than a
// tenant id so it needs no schema change and stays readable on disk.
export function firmSlug(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Pre-populate from localStorage synchronously so the first render shows the
// correct tenant branding with zero flash. The async DB fetch below then
// confirms/updates it in the background.
function _loadCached() {
  try {
    const cached = localStorage.getItem('tcr_firm_branding')
    if (cached) return JSON.parse(cached)
  } catch (_) {}
  return null
}
const _cached = _loadCached()

export const FIRM = {
  name:     _cached?.name     || '',
  slug:     _cached?.slug     || '',
  tenantId: _cached?.tenantId || '',
  logoUrl:  _cached?.logoUrl  || '',
  address:  _cached?.address  || '',
  phone:    _cached?.phone    || '',
  email:    _cached?.email    || '',
  website:  _cached?.website  || '',
  fax:      _cached?.fax      || '',
  loaded:         !!_cached,
  labels:         _cached?.labels         || {},
  paymentProvider: _cached?.paymentProvider || 'stripe',
}
// Apply cached branding immediately (title only) before any async fetch.
// The RomyLabs Admin host is a hard browser-branding boundary and must never
// inherit cached tenant/demo branding.
if (_cached?.name) {
  setBrowserTitle(`${_cached.name} — IRS Resolution CRM`)
}

// Resolve a UI label — falls back to the default if the tenant hasn't overridden it
export function label(key, defaultVal) {
  return (FIRM.labels && FIRM.labels[key]) || defaultVal
}

export async function loadFirmBranding() {
  try {
    // During admin impersonation, RLS on settings always returns TCR's row
    // (romy's JWT never changes). Read branding from sessionStorage instead —
    // it was populated by ImpersonateGate when the token was validated.
    try {
      const imp = sessionStorage.getItem('admin_impersonation')
      if (imp) {
        const { tenant_id, firm_name, logo_url } = JSON.parse(imp)
        if (tenant_id) FIRM.tenantId = tenant_id
        if (firm_name) FIRM.name = firm_name
        if (firm_name) FIRM.slug = firmSlug(firm_name)
        FIRM.logoUrl = logo_url || ''
        FIRM.loaded = true
        setBrowserTitle(`${FIRM.name} — IRS Resolution CRM`)
        setFavicon(FIRM.tenantId, FIRM.name)
        return FIRM
      }
    } catch (_) {}

    const { data: s } = await supabase
      .from('settings')
      .select('tenant_id,name,firmname,logourl,address,firmaddress,city,state,zip,phone,firmphone,email,firmemail,website,firm_fax_number,labels,payment_provider')
      .limit(1).maybeSingle()
    if (!s) return FIRM

    const name = s.name || s.firmname || ''
    // Prefer the structured address parts; fall back to the legacy one-liner.
    const cityLine = [s.city, s.state].filter(Boolean).join(', ')
    const built = [s.address, cityLine, s.zip].filter(Boolean).join(', ')
    const address = built || s.firmaddress || ''

    FIRM.name = name
    FIRM.slug = firmSlug(name)
    FIRM.tenantId = s.tenant_id || ''
    // The browser tab is part of the product's face — a prospect signed into
    // their demo should not see another firm's name above their own CRM. The
    // static index.html title remains the pre-login fallback. Admin Portal is
    // explicitly excluded from tenant browser branding.
    setBrowserTitle(`${name} — IRS Resolution CRM`)
    setFavicon(s.tenant_id, name)
    FIRM.logoUrl = s.logourl || ''
    FIRM.address = address
    FIRM.phone = s.phone || s.firmphone || ''
    FIRM.email = s.email || s.firmemail || ''
    FIRM.website = s.website || ''
    FIRM.fax = s.firm_fax_number || ''
    FIRM.labels = s.labels || {}
    FIRM.paymentProvider = s.payment_provider || 'manual'
    FIRM.loaded = true
    // Cache for instant next-load — eliminates the branding flash on hard refresh
    try {
      localStorage.setItem('tcr_firm_branding', JSON.stringify({
        name: FIRM.name, slug: FIRM.slug, tenantId: FIRM.tenantId,
        logoUrl: FIRM.logoUrl, address: FIRM.address, phone: FIRM.phone,
        email: FIRM.email, website: FIRM.website, fax: FIRM.fax, labels: FIRM.labels,
        paymentProvider: FIRM.paymentProvider
      }))
    } catch (_) {}
  } catch (_) { /* leave whatever we have; templates degrade gracefully */ }
  return FIRM
}

// Footer line used at the bottom of most transactional emails.
// For PUBLIC/anon pages (SignPage, intake + organizer wizards, client portal).
// Anonymous visitors can't read `settings` under RLS, so branding comes from
// the anon-safe booking_get_public_meta RPC instead. Call this on mount of any
// page a logged-out client can reach, or it will render the default firm.
export function clearFirmBrandingCache() {
  try { localStorage.removeItem('tcr_firm_branding') } catch (_) {}
}

export async function loadFirmBrandingPublic(tenantHint) {
  try {
    // Optional tenant hint (uuid as text) → RPC resolves this tenant's row.
    // Without it the RPC falls back to the legacy first-row (TCR) branding.
    const args = tenantHint ? { p_tenant: String(tenantHint) } : {}
    const { data } = await supabase.rpc('booking_get_public_meta', args)
    if (data) {
      if (data.tenant_id) FIRM.tenantId = data.tenant_id
      if (data.firm_name) FIRM.name = data.firm_name
      if (data.logo_url) FIRM.logoUrl = data.logo_url
      if (data.email) FIRM.email = data.email
      if (data.phone) FIRM.phone = data.phone
      FIRM.loaded = true
      setFavicon(FIRM.tenantId, FIRM.name)
      setBrowserTitle(`${FIRM.name} — IRS Resolution CRM`)
    }
  } catch (_) { /* keep defaults */ }
  return FIRM
}

// Dynamically swap the browser favicon to match the current tenant.
// TCR keeps its own favicon; other tenants use their own logo URL as favicon
// (set when the logo is uploaded in Settings). Falls back to taxrescrm favicon.
// SECURITY/BRANDING BOUNDARY: tenant/demo branding must never overwrite the
// RomyLabs Admin browser identity on admin.romylabs.com.
function setFavicon(tenantId, name) {
  try {
    if (isRomyLabsAdminHost()) {
      document.querySelectorAll('link[rel*="icon"]').forEach(el => {
        el.setAttribute('type', 'image/svg+xml')
        el.setAttribute('href', ROMYLABS_ADMIN_FAVICON)
      })
      return
    }

    const BASE = '/'
    const TCR_TENANT = '61a89aef-0e7e-4ea2-b222-44ab2024655a'
    let href
    if (tenantId === TCR_TENANT) {
      href = BASE + 'favicon.png'       // TCR keeps its own branded favicon
    } else if (FIRM.logoUrl) {
      href = FIRM.logoUrl               // tenant's own uploaded logo as favicon
    } else {
      href = BASE + 'taxrescrm-favicon.png' // fallback for tenants without a logo
    }
    document.querySelectorAll('link[rel*="icon"]').forEach(el => {
      el.setAttribute('href', href)
    })
  } catch (_) {}
}

export function firmFooterLine() {
  return [FIRM.name, FIRM.address, FIRM.phone].filter(Boolean).join(' · ')
}
