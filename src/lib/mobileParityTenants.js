// Scope Nashville v3.1.80-inspired mobile presentation to these three CRMs only.
// This is UI-only; it must not change access controls or tenant routing.
export const MOBILE_PARITY_TENANTS = Object.freeze(new Set([
  '61a89aef-0e7e-4ea2-b222-44ab2024655a', // Tax Case Review
  'a0000000-0000-0000-0000-000000000001', // TaxRes administration
  '8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a', // Centurion dedicated
]))
export const usesMobileParity = tenantId => MOBILE_PARITY_TENANTS.has(tenantId)
