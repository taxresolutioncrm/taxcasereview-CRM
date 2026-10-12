import { supabase } from './supabase'
import { FIRM } from './firmBranding'
import { emailHtml } from './emailTemplate'
import { PRODUCT_BOOKING_CONFIGS } from './productBookingConfig'

// ── Email helpers for the central booking system ───────────────────────────
// Physical transport: Gmail OAuth on TCR Supabase (romy@taxrescrm.net).
// Display name and Reply-To are product-specific — recipients see product
// branding; physical sender is the OAuth account.
//
// productCfg is passed from BookAppointment.jsx (already resolved by
// resolveProductConfig). Falls back to taxres_crm config for any caller
// that doesn't pass productCfg (BookingWidget, InternalBooking, etc.).

const DEFAULT_CFG = PRODUCT_BOOKING_CONFIGS.taxres_crm

// Tenant branding cache — used when ?t=<uuid> per-office flow overrides branding
const _firmMetaCache = {}
async function getFirmMeta(tenantId) {
  const key = tenantId || 'default'
  if (_firmMetaCache[key]) return _firmMetaCache[key]
  try {
    if (!tenantId) {
      _firmMetaCache[key] = FIRM.loaded && FIRM.name
        ? { firmName: FIRM.name, logoUrl: FIRM.logoUrl || '', email: FIRM.email || '' }
        : {}
      return _firmMetaCache[key]
    }
    const { data } = await supabase.rpc('booking_get_public_meta', { p_tenant: String(tenantId) })
    _firmMetaCache[key] = data && data.firm_name
      ? { firmName: data.firm_name, logoUrl: data.logo_url || '', email: data.email || '' }
      : {}
  } catch (_) {
    _firmMetaCache[key] = {}
  }
  return _firmMetaCache[key]
}

export const fmt12 = (t) => {
  const [h, m] = String(t).split(':').map(Number)
  const ap = h >= 12 ? 'PM' : 'AM'
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ap}`
}

export const whenLong = (date, time) =>
  `${new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} at ${fmt12(time)} (Eastern)`

export const whenShort = (date, time) =>
  `${new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${fmt12(time)}`

// Resolve branding for email:
// If tenantId is present (TaxRes per-office booking), fetch office branding.
// Otherwise use productCfg branding directly.
async function resolveEmailBranding(tenantId, productCfg) {
  const cfg = productCfg || DEFAULT_CFG
  if (tenantId) {
    const firm = await getFirmMeta(tenantId)
    if (firm && firm.firmName) return { firmName: firm.firmName, logoUrl: firm.logoUrl || '' }
  }
  return { firmName: cfg.name, logoUrl: cfg.logo || '' }
}

// Resolve notify/replyTo for a booking notification:
// Uses productCfg.notifyEmail / productCfg.replyTo when available.
// Falls back to FIRM.email → DEFAULT_CFG.notifyEmail (never info@taxcasereview.org for non-TaxRes).
function resolveNotifyEmail(notifyEmail, tenantId, productCfg) {
  const cfg = productCfg || DEFAULT_CFG
  // notifyEmail from booking_create RPC (set from settings.notify_email, TaxRes per-office)
  if (notifyEmail) return notifyEmail
  // product config routing (RomyLabs / Camvella / Arcvena → product inbox)
  if (cfg.notifyEmail) return cfg.notifyEmail
  // last resort: FIRM.email (authenticated staff context)
  return FIRM.email || DEFAULT_CFG.notifyEmail
}

async function resolveReplyTo(tenantId, productCfg) {
  const cfg = productCfg || DEFAULT_CFG
  if (tenantId) {
    const firm = await getFirmMeta(tenantId)
    return firm.email || cfg.replyTo || DEFAULT_CFG.replyTo
  }
  return cfg.replyTo || DEFAULT_CFG.replyTo
}

function resolveFromName(productCfg) {
  return (productCfg || DEFAULT_CFG).fromName || (productCfg || DEFAULT_CFG).name || 'RomyLabs'
}

// ── sendClientConfirmation ─────────────────────────────────────────────────
// Confirmation email to the visitor who just booked.
// Product-branded: logo, name, appointment type, reschedule links.
export function sendClientConfirmation({ name, email, type, date, time, token, tenantId, productCfg }) {
  if (!email) return
  const manage = token ? `${window.location.origin}${import.meta.env.BASE_URL}book/manage/${token}` : null
  ;(async () => {
    const brand = await resolveEmailBranding(tenantId, productCfg)
    const fromName = resolveFromName(productCfg)
    await supabase.functions.invoke('send-email', { body: {
      tenant_id: tenantId || FIRM.tenantId || undefined,
      to: email,
      from_name: fromName,
      subject: `Appointment Confirmed — ${type}, ${whenShort(date, time)}`,
      html: emailHtml({ firmName: brand.firmName, logoUrl: brand.logoUrl, body: `
        <p>Hi <strong>${name}</strong>,</p>
        <p>Your appointment is confirmed:</p>
        <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;width:100%;margin:12px 0">
          <tr><td style="padding:16px 20px;font-size:14px;color:#0f172a;line-height:1.9">
            <strong>${type}</strong><br>${whenLong(date, time)}
          </td></tr>
        </table>
        ${manage ? `<p style="text-align:center;margin:20px 0">
          <a href="${manage}" style="background:#1d4ed8;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;font-size:13.5px;display:inline-block;margin:0 6px">🔁 Reschedule</a>
          <a href="${manage}?cancel=1" style="background:#f1f5f9;color:#b91c1c;border:1px solid #e2e8f0;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;font-size:13.5px;display:inline-block;margin:0 6px">Cancel</a>
        </p>` : `<p>Need to reschedule or cancel? Just reply to this email and we'll take care of it.</p>`}
        <p style="margin-top:20px">Talk soon,<br><strong>${brand.firmName}</strong></p>` }),
    }})
  })().catch(() => {})
}

// ── sendCancelEmails ───────────────────────────────────────────────────────
export function sendCancelEmails({ name, email, type, date, time, notifyEmail, tenantId, productCfg }) {
  ;(async () => {
    const brand = await resolveEmailBranding(tenantId, productCfg)
    const fromName = resolveFromName(productCfg)
    const toNotify = resolveNotifyEmail(notifyEmail, tenantId, productCfg)
    if (email) await supabase.functions.invoke('send-email', { body: {
      tenant_id: tenantId || FIRM.tenantId || undefined,
      to: email, from_name: fromName,
      subject: `Appointment Canceled — ${type}, ${whenShort(date, time)}`,
      html: emailHtml({ firmName: brand.firmName, logoUrl: brand.logoUrl, body: `
        <p>Hi <strong>${name}</strong>,</p>
        <p>Your <strong>${type}</strong> on ${whenLong(date, time)} has been canceled.</p>
        <p>Changed your mind? You can grab a new time any time:</p>
        <p style="text-align:center;margin:20px 0"><a href="${bookUrl(tenantId)}" style="background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;font-size:14px;display:inline-block">📅 Book Again</a></p>
        <p style="margin-top:20px"><strong>${brand.firmName}</strong></p>` }),
    }})
    await supabase.functions.invoke('send-email', { body: {
      tenant_id: tenantId || FIRM.tenantId || undefined,
      to: toNotify, from_name: fromName,
      subject: `❌ Booking canceled: ${name} — ${whenShort(date, time)}`,
      html: emailHtml({ firmName: brand.firmName, logoUrl: brand.logoUrl, body: `<p><strong>${name}</strong> canceled their <strong>${type}</strong> on ${whenLong(date, time)}. The slot is open again.</p>` }),
    }})
  })().catch(() => {})
}

// ── sendRescheduleNotice ───────────────────────────────────────────────────
export function sendRescheduleNotice({ name, type, oldDate, oldTime, date, time, notifyEmail, tenantId, productCfg }) {
  ;(async () => {
    const brand = await resolveEmailBranding(tenantId, productCfg)
    const fromName = resolveFromName(productCfg)
    const toNotify = resolveNotifyEmail(notifyEmail, tenantId, productCfg)
    await supabase.functions.invoke('send-email', { body: {
      tenant_id: tenantId || FIRM.tenantId || undefined,
      to: toNotify, from_name: fromName,
      subject: `🔁 Rescheduled: ${name} — now ${whenShort(date, time)}`,
      html: emailHtml({ firmName: brand.firmName, logoUrl: brand.logoUrl, body: `<p><strong>${name}</strong> moved their <strong>${type}</strong>:</p><p style="line-height:1.9">Was: ${whenLong(oldDate, oldTime)}<br>Now: <strong>${whenLong(date, time)}</strong></p><p>The calendar is already updated.</p>` }),
    }})
  })().catch(() => {})
}

// ── sendFirmNotification ───────────────────────────────────────────────────
// Internal "New booking" alert to the product inbox.
export function sendFirmNotification({ name, email, phone, notes, type, date, time, notifyEmail, bookedBy, tenantId, productCfg }) {
  ;(async () => {
    const brand = await resolveEmailBranding(tenantId, productCfg)
    const fromName = resolveFromName(productCfg)
    const toNotify = resolveNotifyEmail(notifyEmail, tenantId, productCfg)
    const replyTo = await resolveReplyTo(tenantId, productCfg)
    await supabase.functions.invoke('send-email', { body: {
      tenant_id: tenantId || FIRM.tenantId || undefined,
      to: toNotify, from_name: fromName, from_email: replyTo,
      subject: `📅 New booking: ${name} — ${whenShort(date, time)}`,
      html: emailHtml({ firmName: brand.firmName, logoUrl: brand.logoUrl, body: `
        <p><strong>${name}</strong> ${bookedBy ? `was booked by ${bookedBy}` : 'just booked online'}:</p>
        <p style="line-height:1.9"><strong>${type}</strong><br>${whenLong(date, time)}<br>
        Email: ${email || '—'}<br>Phone: ${phone || '—'}${notes ? `<br>Notes: ${notes}` : ''}</p>
        <p>The appointment is on the CRM calendar; a lead was created if they were new.</p>` }),
    }})
  })().catch(() => {})
}

// ── Booking link helpers (TaxRes internal, unchanged) ──────────────────────
export const BOOK_URL = `${window.location.origin}${import.meta.env.BASE_URL}book`

export function bookUrl(tenantId = FIRM.tenantId) {
  return tenantId ? `${BOOK_URL}?t=${tenantId}` : BOOK_URL
}

export async function sendBookingInvite({ name, email, phone }) {
  try {
    const first = (name || '').trim().split(' ')[0] || 'there'
    const q = new URLSearchParams()
    if (FIRM.tenantId) q.set('t', FIRM.tenantId)
    if ((name || '').trim()) q.set('name', name.trim())
    if ((email || '').trim()) q.set('email', email.trim())
    if ((phone || '').trim()) q.set('phone', phone.trim())
    const link = q.toString() ? `${BOOK_URL}?${q.toString()}` : BOOK_URL
    const firm = await getFirmMeta(FIRM.tenantId)
    const fName = firm.firmName || FIRM.name || 'TaxRes CRM'
    const { error } = await supabase.functions.invoke('send-email', { body: {
      tenant_id: tenantId || FIRM.tenantId || undefined,
      to: email,
      subject: `Schedule Your Appointment — ${fName}`,
      html: emailHtml({ firmName: firm.firmName, logoUrl: firm.logoUrl, body: `<p>Hi <strong>${first}</strong>,</p><p>Pick whichever time works best for you — it takes less than a minute:</p><p style="text-align:center;margin:24px 0"><a href="${link}" style="background:#1d4ed8;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px;display:inline-block">📅 Choose a Time</a></p><p>You'll see our live availability and get an instant confirmation. If nothing there works, just reply to this email or give us a call.</p><p style="margin-top:20px">Talk soon,<br><strong>${fName}</strong></p>` }),
    }})
    return !error
  } catch (err) {
    console.error('sendBookingInvite error:', err)
    return false
  }
}
