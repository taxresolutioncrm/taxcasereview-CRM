// Pure presentation helpers for the TaxRes-family Payments page.
// No database calls and no payment mutation.
export const paymentDay = payment => {
  const value = payment?.date || payment?.created_at || ''
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

export const paymentInRange = (payment, dateFrom = '', dateTo = '') => {
  const day = paymentDay(payment)
  return (!dateFrom || (day && day >= dateFrom)) &&
    (!dateTo || (day && day <= dateTo))
}

export const collectedPayment = payment =>
  ['cleared', 'paid', 'posted', 'completed'].includes(String(payment?.status || '').toLowerCase()) &&
  Number(payment?.amount || 0) > 0

export const pendingPayment = payment =>
  ['pending', 'tbd', 'no status', 'new agmt'].includes(String(payment?.status || '').toLowerCase())

export function paymentView(items, { dateFrom = '', dateTo = '', search = '', status = 'All', method = 'All', sortCol = 'date', sortDir = 'desc' } = {}) {
  const invalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo)
  const dated = invalidDateRange ? [] : items.filter(payment => paymentInRange(payment, dateFrom, dateTo))
  const query = search.trim().toLowerCase()
  const filtered = dated.filter(payment => {
    const text = String(payment.clientName || payment.clientname || '').toLowerCase()
    const invoice = String(payment.invNum || '').toLowerCase()
    return (!query || text.includes(query) || invoice.includes(query)) &&
      (method === 'All' || payment.method === method) &&
      (status === 'All' || payment.status === status)
  })
  const sorted = [...filtered].sort((a, b) => {
    const left = sortCol === 'date' ? paymentDay(a) : a[sortCol]
    const right = sortCol === 'date' ? paymentDay(b) : b[sortCol]
    let av = sortCol === 'amount' ? Number(left || 0) : String(left ?? '').toLowerCase()
    let bv = sortCol === 'amount' ? Number(right || 0) : String(right ?? '').toLowerCase()
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })
  const byMethod = {}
  for (const payment of dated.filter(collectedPayment)) {
    const key = payment.method || 'Other'
    byMethod[key] = (byMethod[key] || 0) + Number(payment.amount || 0)
  }
  return {
    invalidDateRange, dated, filtered, sorted, byMethod,
    collected: dated.filter(collectedPayment).reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    pending: dated.filter(pendingPayment).reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    count: dated.length,
    failed: dated.filter(payment => String(payment.status || '').toLowerCase() === 'failed').length,
  }
}

export const paymentsExportRows = payments => payments.map(payment => [
  String(payment.clientName || payment.clientname || ''),
  String(payment.invNum || ''),
  Number(payment.amount || 0),
  String(payment.method || ''),
  String(payment.checkNum || ''),
  paymentDay(payment),
  String(payment.status || ''),
  String(payment.reference || ''),
])
