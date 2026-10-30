// src/lib/productBookingConfig.js
//
// AUTHORITATIVE product booking configuration for the RomyLabs central
// scheduling engine. This file is the ONLY source of product-specific
// branding, appointment types, and email routing for booking pages.
//
// SECURITY: the ?product= URL parameter is validated against this allowlist
// server-side (resolveProductConfig). Unknown values fall back to taxres_crm.
// The browser can never inject arbitrary branding — the config is code, not DB.
//
// EXTENSIBILITY: adding a future product = add one entry here. No other
// booking-system file needs to change. Set inactive:true to configure
// without exposing a public booking URL.
//
// EMAIL ARCHITECTURE:
//   notifyEmail  — internal address that receives "New booking" alerts
//   replyTo      — Reply-To header on customer confirmation emails
//   fromName     — display name in the From: header (physical sender is
//                  always the Gmail OAuth account on TCR Supabase)
//
//   Camvella and Arcvena currently route through info@romylabs.com as a
//   CENTRALIZED FALLBACK. These are marked // CENTRALIZED_FALLBACK so
//   switching to product-specific mailboxes is a config change here only.

export const PRODUCT_BOOKING_CONFIGS = {
  taxres_crm: {
    key:           'taxres_crm',
    name:          'TaxRes CRM',
    logo:          '/taxrescrm-logo.png',
    favicon:       '/taxrescrm-favicon.png',
    logoAlt:       'TaxRes CRM',
    headline:      'Schedule an Appointment',
    types:         ['Free Consultation', 'Product Demo', 'Follow-Up Call'],
    calendarLabel: '[TaxRes CRM]',
    notifyEmail:   'romy@taxcasereview.org',
    replyTo:       'romy@taxcasereview.org',
    fromName:      'TaxRes CRM',
    inactive:      false,
  },
  romylabs: {
    key:           'romylabs',
    name:          'RomyLabs',
    logo:          '/romylabs-logo.png',
    favicon:       '/romylabs-favicon.svg?v=20260903-1',
    logoAlt:       'RomyLabs',
    headline:      'Schedule a Product Demo',
    types:         ['Product Demo', 'Partnership / Business Inquiry', 'Follow-Up Call'],
    calendarLabel: '[RomyLabs]',
    notifyEmail:   'romy@romylabs.com',
    replyTo:       'romy@romylabs.com',
    fromName:      'RomyLabs',
    inactive:      false,
  },
  camvella: {
    key:           'camvella',
    name:          'Camvella',
    logo:          '/camvella-logo.svg',
    favicon:       '/camvella-logo.svg',
    logoAlt:       'Camvella',
    headline:      'Schedule a Camvella Demo',
    types:         ['Product Demo', 'HOA / Community Management Consultation', 'Follow-Up Call'],
    calendarLabel: '[Camvella]',
    notifyEmail:   'romy@camvella.com',
    replyTo:       'romy@camvella.com',
    fromName:      'Camvella',
    inactive:      false,
  },
  arcvena: {
    key:           'arcvena',
    name:          'Arcvena',
    logo:          '/arcvena-logo.png',
    favicon:       '/arcvena-favicon-64.png?v=20260827-1',
    logoAlt:       'Arcvena',
    headline:      'Schedule an Arcvena Demo',
    types:         ['Product Demo', 'Field Service Consultation', 'Follow-Up Call'],
    calendarLabel: '[Arcvena]',
    notifyEmail:   'romy@arcvena.com',
    replyTo:       'romy@arcvena.com',
    fromName:      'Arcvena',
    inactive:      false,
  },
  bocasync: {
    key:           'bocasync',
    name:          'BocaSync',
    logo:          '/bocasync-logo.svg',
    favicon:       '/bocasync-logo.svg?v=1',
    logoAlt:       'BocaSync',
    headline:      'Schedule a BocaSync Demo',
    types:         ['BocaSync Product Demo', 'Dental Practice Consultation', 'BocaSync Follow-Up Call'],
    calendarLabel: '[BocaSync]',
    notifyEmail:   'romy@bocasync.com',
    replyTo:       'romy@bocasync.com',
    fromName:      'BocaSync',
    inactive:      false,
  },
  oculivo: {
    key:           'oculivo',
    name:          'Oculivo',
    logo:          '/oculivo-logo.svg?v=20260907-1',
    favicon:       '/oculivo-logo.svg?v=20260907-1',
    logoAlt:       'Oculivo',
    headline:      'Schedule an Oculivo Demo',
    types:         ['Oculivo Product Demo', 'Eye-Care Practice Consultation', 'Oculivo Follow-Up Call'],
    calendarLabel: '[Oculivo]',
    notifyEmail:   'romy@romylabs.com',
    replyTo:       'romy@romylabs.com',
    fromName:      'Oculivo',
    inactive:      false,
  },
  restore_relay: {
    key:           'restore_relay',
    name:          'Restore Relay CRM',
    logo:          '/restore-relay-logo.svg?v=20260908-1',
    favicon:       '/restore-relay-favicon.svg?v=20260908-1',
    logoAlt:       'Restore Relay CRM',
    headline:      'Schedule a Restore Relay Demo',
    types:         ['Restore Relay Product Demo', 'Restoration / Roofing Operations Consultation', 'Restore Relay Follow-Up Call'],
    calendarLabel: '[Restore Relay]',
    notifyEmail:   'romy@romylabs.com',
    replyTo:       'romy@romylabs.com',
    fromName:      'Restore Relay CRM',
    inactive:      false,
  },
  pool_crm: {
    key: 'pool_crm', name: 'PoolVerge', logo: '', favicon: '', logoAlt: 'PoolVerge',
    headline: 'Schedule a PoolVerge Demo',
    types: ['PoolVerge Product Demo', 'Pool Service Operations Consultation', 'Follow-Up Call'],
    calendarLabel: '[PoolVerge]', notifyEmail: 'romy@romylabs.com',
    replyTo: 'romy@romylabs.com', fromName: 'PoolVerge', inactive: false,
  },
  barbers_salons: {
    key: 'barbers_salons', name: 'Barbers & Salons CRM', logo: '', favicon: '',
    logoAlt: 'Barbers & Salons CRM', headline: 'Schedule a Salon CRM Demo',
    types: ['Product Demo', 'Salon Operations Consultation', 'Follow-Up Call'],
    calendarLabel: '[Barbers & Salons CRM]', notifyEmail: 'romy@romylabs.com',
    replyTo: 'romy@romylabs.com', fromName: 'Barbers & Salons CRM', inactive: false,
  },
  health_insurance: {
    key: 'health_insurance', name: 'Health Insurance Agency CRM', logo: '', favicon: '',
    logoAlt: 'Health Insurance Agency CRM', headline: 'Schedule a Health Insurance CRM Demo',
    types: ['Product Demo', 'Agency Operations Consultation', 'Follow-Up Call'],
    calendarLabel: '[Health Insurance Agency CRM]', notifyEmail: 'romy@romylabs.com',
    replyTo: 'romy@romylabs.com', fromName: 'Health Insurance Agency CRM', inactive: false,
  },
  groundivo: {
    key:           'groundivo',
    name:          'GroundIVO',
    logo:          '/groundivo-logo.svg?v=20260906-1',
    favicon:       '/groundivo-logo.svg?v=20260906-1',
    logoAlt:       'GroundIVO',
    headline:      'Schedule a GroundIVO Demo',
    types:         ['Product Demo', 'Landscaping Operations Consultation', 'Follow-Up Call'],
    calendarLabel: '[GroundIVO]',
    notifyEmail:   'romy@romylabs.com',
    replyTo:       'romy@romylabs.com',
    fromName:      'GroundIVO',
    inactive:      false,
  },
}

/**
 * Resolve a ?product= URL param against the allowlist.
 * Unknown or missing values → taxres_crm (safe fallback, preserves existing behavior).
 * Inactive products → taxres_crm (never expose an inactive product's booking page).
 */
export function resolveProductConfig(productParam) {
  const canonical = productParam === 'aquagrid' || productParam === 'poolverge' ? 'pool_crm' : productParam
  const cfg = PRODUCT_BOOKING_CONFIGS[canonical]
  if (!cfg || cfg.inactive) return PRODUCT_BOOKING_CONFIGS.taxres_crm
  return cfg
}

/**
 * Badge color per product — used in Admin Portal calendar tiles.
 */
export const PRODUCT_BADGE_COLORS = {
  taxres_crm: { bg: '#1e3a5f', text: '#60a5fa', label: 'TaxRes CRM' },
  romylabs:   { bg: '#1a1a1a', text: '#C6FF00', label: 'RomyLabs'   },
  camvella:   { bg: '#0b2748', text: '#55B96A', label: 'Camvella'   },
  arcvena:    { bg: '#1a0a2e', text: '#a78bfa', label: 'Arcvena'    },
  bocasync:   { bg: '#1a2e1a', text: '#34d399', label: 'BocaSync'   },
  groundivo:  { bg: '#17351f', text: '#9bdc34', label: 'GroundIVO'  },
  pool_crm: { bg:'#144c56',text:'#5eead4',label:'PoolVerge' },
  barbers_salons: { bg:'#4a224f',text:'#f0abfc',label:'Barbers & Salons CRM' },
  health_insurance: { bg:'#173452',text:'#93c5fd',label:'Health Insurance Agency CRM' },
  oculivo:     { bg: '#312e81', text: '#67e8f9', label: 'Oculivo'    },
  restore_relay: { bg: '#164e63', text: '#f59e0b', label: 'Restore Relay' },
}

export function getProductBadge(productId) {
  return PRODUCT_BADGE_COLORS[productId] || PRODUCT_BADGE_COLORS.taxres_crm
}
