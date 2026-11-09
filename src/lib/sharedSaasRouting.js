// TaxRes, TCR and Centurion share one Supabase SaaS Auth project.
// Nashville is a separately deployed application and not part of this mapping.
export const SHARED_SAAS_PROJECT_HOST = 'mpxgxfqdbquzkrvvejkh.supabase.co'
export const CENTURION_CRM_HOST = 'centurionfirm.taxrescrm.app'

// A wrong Cloudflare VITE_SUPABASE_URL must fail closed on Centurion login.
// This is a deployment-mapping check, not a tenant authorization bypass:
// tenant resolution and RLS remain server-side.
export function centurionBackendMismatch(hostname, supabaseUrl) {
  if (String(hostname || '').toLowerCase() !== CENTURION_CRM_HOST) return false
  try {
    const endpoint = new URL(supabaseUrl)
    return endpoint.protocol !== 'https:' || endpoint.hostname !== SHARED_SAAS_PROJECT_HOST
  } catch {
    return true
  }
}
