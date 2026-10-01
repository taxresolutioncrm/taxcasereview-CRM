import { supabase } from './supabase'

// ── Invoice write-back (single source of truth) ──
// A payment cleared or reversed anywhere — the Payments screen or the
// Accounts Receivable screen — updates the linked invoice the same way, so
// the two views can never drift. Invoice-linked rows only: when there's no
// invNum, there's nothing to write back and we leave invoices alone.

async function adjustInvoice(invNum, delta) {
  if (!invNum) return null
  const numericDelta = Number(delta || 0)
  if (!Number.isFinite(numericDelta)) throw new Error('Invalid invoice adjustment amount')
  const { data, error } = await supabase.rpc('invoice_adjust_paid', {
    p_inv_num: invNum,
    p_delta: numericDelta,
  })
  if (error) throw error
  return data || null
}

// Add `amount` to the linked invoice's cumulative paid total.
export async function applyPaymentToInvoice(invNum, amount) {
  return adjustInvoice(invNum, Math.abs(Number(amount || 0)))
}

// Subtract `amount` back off the linked invoice — a mistaken/bounced payment
// reversal. The database function floors at 0 and row-locks the invoice.
export async function reversePaymentFromInvoice(invNum, amount) {
  return adjustInvoice(invNum, -Math.abs(Number(amount || 0)))
}
