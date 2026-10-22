import { supabase } from './supabase'

export async function loadIrsSensitiveClient(client) {
  if (!client?.id) return client || {}
  const { data, error } = await supabase.functions.invoke('client-sensitive', {
    body: { action: 'irs_read', client_id: String(client.id) },
  })
  if (error || data?.error) {
    throw new Error(data?.error || error?.message || 'Sensitive client data is not authorized for this IRS workflow.')
  }
  return {
    ...client,
    ssn: data?.ssn || '',
    spouseSsn: data?.spouse_ssn || '',
  }
}

export async function loadClientTinLast4(clientId) {
  if (!clientId) return ''
  const { data, error } = await supabase.functions.invoke('client-sensitive', {
    body: { action: 'tin_last4', client_id: String(clientId) },
  })
  if (error || data?.error) {
    throw new Error(data?.error || error?.message || 'Client TIN match permission denied.')
  }
  return data?.tin_last4 || ''
}
