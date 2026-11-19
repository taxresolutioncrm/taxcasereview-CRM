// Fixed-term Restore Relay Professional sale. One hosted subscription checkout
// collects the first installment, then bills monthly with signed webhook
// scheduling cancellation at the end of the sixth billing period.
export const RESTORE_RELAY_MONTHLY_CENTS = 39900
export const RESTORE_RELAY_MONTHS = 6
export const RESTORE_RELAY_TOTAL_CENTS = RESTORE_RELAY_MONTHLY_CENTS * RESTORE_RELAY_MONTHS

export function normalizeStripePaymentLink(value) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('A verified $399/month six-payment Stripe link is required.')
  let url
  try { url = new URL(raw) } catch { throw new Error('Enter a valid Stripe Payment Link URL.') }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'buy.stripe.com' ||
      !(url.pathname.startsWith('/') && /^[A-Za-z0-9_-]+$/.test(url.pathname.slice(1))) || url.username || url.password ||
      url.search || url.hash || url.pathname.startsWith('/test_')) {
    throw new Error('Use a live Stripe Payment Link in the format https://buy.stripe.com/… (not a test or temporary Checkout URL).')
  }
  return url.href
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))

export function restoreRelaySigningAndPaymentEmail({signUrl,paymentUrl,recipientName,customerName,title}) {
  const pay=normalizeStripePaymentLink(paymentUrl)
  const safeSign=new URL(String(signUrl))
  if (safeSign.protocol !== 'https:' || !(['/office-sign/','/agreement/'].some(prefix => safeSign.pathname.startsWith(prefix) && /^[a-f0-9]{64}$/i.test(safeSign.pathname.slice(prefix.length))))) throw new Error('Signing link is invalid')
  const name=escapeHtml(recipientName || 'there')
  const customer=escapeHtml(customerName)
  const heading=escapeHtml(title)
  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033"><h2>Restore Relay — Agreement & Subscription</h2>
    <p>Hi ${name},</p><p>Your Restore Relay Professional Plan agreement for <strong>${customer}</strong> is ready.</p>
    <div style="background:#f5f7fb;border-radius:10px;padding:14px 16px;margin:18px 0"><strong>${heading}</strong><br>$399.00 per month · 6 months · $2,394.00 total subscription commitment · Up to 10 users · No automatic renewal</div>
    <p><strong>Step 1: Review and electronically sign your agreement.</strong></p>
    <p><a href="${escapeHtml(safeSign.href)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Review & Sign Agreement</a></p>
    <p><strong>Step 2: Start your $399.00/month six-payment subscription securely through Stripe.</strong></p>
    <p><a href="${escapeHtml(pay)}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Start $399/month Subscription</a></p>
    <p>Stripe securely charges the first $399.00 installment at subscription checkout and schedules five more monthly installments. Billing is automatically scheduled to cancel after the sixth billing period; no seventh monthly charge is due under this fixed-term agreement. Any applicable taxes are disclosed at checkout. Signing the agreement does not itself charge your payment method.</p>
    <p style="font-size:12px;color:#64748b">Your secure signing link expires in 14 days. If you have questions, reply to this email.</p>
    <p>Best regards,<br><strong>RomyLabs</strong> · Restore Relay</p></div>`
}
