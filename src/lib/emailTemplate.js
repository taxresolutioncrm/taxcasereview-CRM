// Shared branded email wrapper for ALL outgoing TCR emails.
import { FIRM } from './firmBranding'
// Usage: emailHtml({ body: '...inner html...' })
// The logo is pulled from Supabase storage with an onerror fallback to text.
// Pass { firmName, logoUrl, address, phone, email } to override for a
// tenant's own branding — defaults below only apply when omitted, so every
// existing caller keeps working exactly as before.

const LOGO_URL = ''  // replaced by FIRM.logoUrl
const TCR_TENANT = '61a89aef-0e7e-4ea2-b222-44ab2024655a'
const isTcr = () => !FIRM.tenantId || FIRM.tenantId === TCR_TENANT
const FIRM_NAME = 'Tax Case Review'
const FIRM_ADDRESS = FIRM.address || ''
const FIRM_PHONE   = FIRM.phone   || ''
const FIRM_EMAIL = () => FIRM.email || (isTcr() ? 'info@taxcasereview.org' : '')

export function emailHtml({ body, headerBg = 'linear-gradient(135deg,#1e3a8a 0%,#1d4ed8 100%)', firmName, logoUrl, address, phone, email }) {
  // Explicit override → this tenant's live settings (FIRM) → legacy default.
  const fName = firmName || FIRM.name || (isTcr() ? FIRM_NAME : 'Tax Resolution Office')
  const fLogo = logoUrl || FIRM.logoUrl || LOGO_URL
  const fAddr = address || FIRM.address || FIRM_ADDRESS
  const fPhone = phone || FIRM.phone || FIRM_PHONE
  const fEmail = email || FIRM_EMAIL()
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <tr><td style="background:${headerBg};padding:28px 40px;text-align:center">
    <img src="${fLogo}" alt="${fName}" style="max-height:60px;max-width:200px;object-fit:contain;display:block;margin:0 auto 10px" onerror="this.style.display='none'"/>
    <div style="font-size:13px;font-weight:800;color:#93c5fd;letter-spacing:.12em;text-transform:uppercase">${fName}</div>
  </td></tr>
  <tr><td style="padding:36px 40px">
    ${body}
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 40px;text-align:center">
    <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.8">
      ${fName} &nbsp;·&nbsp; ${fAddr}<br>
      📞 ${fPhone} &nbsp;·&nbsp; ✉️ ${fEmail}
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`
}

// Short clickable URL for display — truncates long Stripe/signing URLs
export function shortUrl(url, maxLen = 60) {
  try {
    const u = new URL(url)
    const display = (u.hostname + u.pathname).replace(/^www\./, '')
    return display.length > maxLen ? display.slice(0, maxLen) + '…' : display
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen) + '…' : url
  }
}

// Standard CTA button
export function ctaButton(href, label, color = '#1d4ed8') {
  return `<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 20px">
    <a href="${href}" style="display:inline-block;background:${color};color:#ffffff;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:-.01em">${label}</a>
  </td></tr></table>`
}

// Small fallback link line shown below a button
export function fallbackLink(href) {
  const display = shortUrl(href)
  return `<p style="margin:4px 0 0;font-size:11px;color:#94a3b8;text-align:center">Can't click the button? <a href="${href}" style="color:#3b82f6;text-decoration:none">${display}</a></p>`
}
