// Browser-local, per tenant + employee history of OPENED clients.
// No claim of cross-device sync; no tax identifiers or sensitive fields.
export const RECENT_CLIENTS_EVENT = 'taxres-recent-clients-changed'
export const MAX_RECENT_CLIENTS = 10

export function recentClientsKey(tenantId, employeeIdentity) {
  const tenant = String(tenantId || '').trim()
  const employee = String(employeeIdentity || '').trim().toLowerCase()
  return tenant && employee ? 'taxres-recent-clients:' + tenant + ':' + employee : null
}

export function getRecentClients(tenantId, employeeIdentity) {
  const key = recentClientsKey(tenantId, employeeIdentity)
  if (!key) return []
  try {
    const rows = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(rows) ? rows.filter(row => row && row.id && row.name).slice(0, MAX_RECENT_CLIENTS) : []
  } catch { return [] }
}

export function rememberRecentClient(tenantId, employeeIdentity, client) {
  const key = recentClientsKey(tenantId, employeeIdentity)
  if (!key || !client?.id || !client?.name) return
  try {
    const entry = { id:String(client.id),name:String(client.name),number:String(client.custnum || client.clientNum || client.clientNumber || '') }
    const rows = [entry,...getRecentClients(tenantId,employeeIdentity).filter(row => row.id !== entry.id)]
      .slice(0,MAX_RECENT_CLIENTS)
    localStorage.setItem(key,JSON.stringify(rows))
    window.dispatchEvent(new CustomEvent(RECENT_CLIENTS_EVENT,{detail:{key}}))
  } catch { /* storage disabled must never block client navigation */ }
}
