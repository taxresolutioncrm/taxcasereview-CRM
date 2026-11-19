// Fixed-term Restore Relay Professional sale. The payment link pays the first
// installment only; recurring charges require a separate Stripe mandate/schedule.
export const RESTORE_RELAY_MONTHLY_CENTS = 39900
export const RESTORE_RELAY_MONTHS = 6
export const RESTORE_RELAY_TOTAL_CENTS = RESTORE_RELAY_MONTHLY_CENTS * RESTORE_RELAY_MONTHS

export function normalizeStripePaymentLink(value) {
  const raw = String(value || '').trim()
  if (!raw) throw new Error('Add the $399.00 Stripe payment link before sending this agreement.')
  let url
  try { url = new URL(raw) } catch { throw new Error('Enter a valid Stripe Payment Link URL.') }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'buy.stripe.com' ||
      !/^\\/[A-Za-z0-9_\\-]+$/.test(url.pathname) || url.username || url.password ||
      url.search || url.hash || url.pathname.startsWith('/test_')) {
    throw new Error('Use a live Stripe Payment Link in the format https://buy.stripe.com/… (not a test or temporary Checkout URL).')
  }
  return url.href
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))

export function restoreRelaySigningAndPaymentEmail({signUrl,paymentUrl,recipientName,customerName,title}) {
  const pay=normalizeStripePaymentLink(paymentUrl)
  const safeSign=new URL(String(signUrl))
  if (safeSign.protocol !== 'https:' || !/^\\/office-sign\\/[a-f0-9]{64}$/i.test(safeSign.pathname)) throw new Error('Signing link is invalid')
  const name=escapeHtml(recipientName || 'there')
  const customer=escapeHtml(customerName)
  const heading=escapeHtml(title)
  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033"><h2>Restore Relay — Agreement & First Payment</h2>
    <p>Hi ${name},</p><p>Your Restore Relay Professional Plan agreement for <strong>${customer}</strong> is ready.</p>
    <div style="background:#f5f7fb;border-radius:10px;padding:14px 16px;margin:18px 0"><strong>${heading}</strong><br>$399.00 per month · 6 months · $2,394.00 total subscription commitment · Up to 10 users · No automatic renewal</div>
    <p><strong>Step 1: Review and electronically sign your agreement.</strong></p>
    <p><a href="${escapeHtml(safeSign.href)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Review & Sign Agreement</a></p>
    <p><strong>Step 2: Pay the first $399.00 monthly installment securely through Stripe.</strong></p>
    <p><a href="${escapeHtml(pay)}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Pay $399.00 with Stripe</a></p>
    <p>The payment link is for the first monthly installment. The five remaining $399.00 installments are due monthly under your agreement; automatic recurring charges apply only if separately authorized and configured. Any applicable taxes are disclosed at checkout. Signing does not itself charge your payment method.</p>
    <p style="font-size:12px;color:#64748b">Your secure signing link expires in 14 days. If you have questions, reply to this email.</p>
    <p>Best regards,<br><strong>RomyLabs</strong> · Restore Relay</p></div>`
}
