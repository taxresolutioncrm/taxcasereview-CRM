export const PLAN_ORDER = Object.freeze({
  starter: 0,
  professional: 1,
  enterprise: 2,
})

export const PLAN_LABELS = Object.freeze({
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
})

export const PLAN_PRICES = Object.freeze({
  starter: 79,
  professional: 99,
  enterprise: 129,
})

export const PLAN_OPTIONS = Object.freeze([
  { value: 'starter', label: 'Starter', price: 79 },
  { value: 'professional', label: 'Professional', price: 99 },
  { value: 'enterprise', label: 'Enterprise', price: 129 },
])

const LEGACY_ALIASES = Object.freeze({
  growth: 'professional',
  pro: 'enterprise',
})

export function normalizePlanTier(value) {
  const raw = String(value || '').trim().toLowerCase()
  const canonical = LEGACY_ALIASES[raw] || raw
  return Object.prototype.hasOwnProperty.call(PLAN_ORDER, canonical) ? canonical : 'starter'
}

export function planLabel(value) {
  return PLAN_LABELS[normalizePlanTier(value)]
}

export function planPrice(value) {
  return PLAN_PRICES[normalizePlanTier(value)]
}

export function planAtLeast(current, required) {
  return PLAN_ORDER[normalizePlanTier(current)] >= PLAN_ORDER[normalizePlanTier(required)]
}

export const ROUTE_PLAN_MINIMUM = Object.freeze({
  workflows: 'professional',
  chat: 'professional',
  reports: 'professional',
})

export const PLAN_FEATURE_MINIMUM = Object.freeze({
  workflow_automation: 'professional',
  team_collaboration: 'professional',
  internal_notes_mentions: 'professional',
  advanced_reporting: 'professional',
  custom_templates: 'professional',
  advanced_user_permissions: 'enterprise',
  multi_office: 'enterprise',
})

export function hasPlanFeature(plan, feature) {
  const required = PLAN_FEATURE_MINIMUM[feature]
  return !required || planAtLeast(plan, required)
}
