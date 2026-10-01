/**
 * useFirm — shared hook that loads firm branding from Supabase settings.
 * Used by all document generators and the sidebar so that when the firm
 * updates their name, logo, or address in Settings everything updates.
 *
 * Multi-tenant: settings is RLS-scoped by current_tenant_id(), so each login
 * automatically gets its OWN tenant's branding here — no overlay needed.
 */
import { useState, useEffect } from 'react'
import { supabase } from './supabase'

const BUCKET = 'firm-assets'

const _cacheByTenant = new Map() // tenant-keyed only; never reuse one office's branding for another

async function loadFirmData() {
  // During impersonation use the explicitly selected tenant identity. Cache by
  // tenant id, never by module/session globally, so switching offices cannot
  // retain CloudCPA/TCR/Nashville branding from the previous view.
  try {
    const imp = sessionStorage.getItem('admin_impersonation')
    if (imp) {
      const { tenant_id, firm_name, logo_url } = JSON.parse(imp)
      const key = tenant_id ? 'tenant:' + tenant_id : null
      if (key && _cacheByTenant.has(key)) return _cacheByTenant.get(key)
      const data = { cacheKey: key, firm: { tenant_id, name: firm_name, logourl: logo_url }, logoUrl: logo_url || '/logo.png' }
      if (key) _cacheByTenant.set(key, data)
      return data
    }
  } catch (_) {}

  const { data: tenantId } = await supabase.rpc('current_tenant_id')
  if (!tenantId) return { cacheKey: null, firm: {}, logoUrl: '/logo.png' }
  const key = 'tenant:' + tenantId
  if (_cacheByTenant.has(key)) return _cacheByTenant.get(key)

  const { data: settings } = await supabase.from('settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const logo = settings?.logourl || '/logo.png'
  const data = { cacheKey: key, firm: settings || {}, logoUrl: logo }
  _cacheByTenant.set(key, data)
  return data
}

export function useFirm() {
  const [firm, setFirm]     = useState(null)
  const [logoUrl, setLogo]  = useState('')
  const [loading, setLoading] = useState(true)
  const [cacheKey, setCacheKey] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadFirmData().then(data => {
      if (cancelled) return
      setCacheKey(data.cacheKey || null)
      setFirm(data.firm)
      setLogo(data.logoUrl)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  function refresh() {
    if (cacheKey) _cacheByTenant.delete(cacheKey)
    setLoading(true)
    loadFirmData().then(data => {
      setCacheKey(data.cacheKey || null)
      setFirm(data.firm)
      setLogo(data.logoUrl)
      setLoading(false)
    })
  }

  const name      = firm?.name     || 'Tax Case Review'
  const tagline   = firm?.tagline  || 'IRS Resolution Services'
  const address   = [firm?.address, firm?.city, firm?.state, firm?.zip].filter(Boolean).join(', ')
  const phone     = firm?.phone    || ''
  const email     = firm?.email    || ''
  const website   = firm?.website  || ''

  function letterhead(subtitle = '') {
    return `
      <div style="display:flex;align-items:center;gap:16px;border-bottom:3px solid #1A7FD4;padding-bottom:14px;margin-bottom:20px">
        ${logoUrl
          ? `<img src="${logoUrl}" style="height:64px;width:auto;object-fit:contain;flex-shrink:0" alt="${name} logo"/>`
          : `<div style="width:64px;height:64px;background:#1A7FD4;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:900;flex-shrink:0">${name[0]}</div>`
        }
        <div>
          <div style="font-size:22px;font-weight:900;color:#1A7FD4;line-height:1.1">${name}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">${tagline}</div>
          ${subtitle ? `<div style="font-size:13px;font-weight:700;color:#0f172a;margin-top:4px">${subtitle}</div>` : ''}
        </div>
        <div style="margin-left:auto;text-align:right;font-size:11px;color:#64748b;line-height:1.7">
          ${address ? address + '<br/>' : ''}
          ${phone ? phone + '<br/>' : ''}
          ${email ? email + '<br/>' : ''}
          ${website || ''}
        </div>
      </div>`
  }

  function footer() {
    return `${name} · ${address || ''} · ${email || ''} · Not a law firm`
  }

  return { firm, logoUrl, loading, refresh, name, tagline, address, phone, email, website, letterhead, footer }
}
