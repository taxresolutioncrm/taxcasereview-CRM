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
//   fromName     — display name in the From: header
//
// TaxRes uses the proven taxrescrm.net mailbox identity. Product-specific
// RomyLabs apps use their configured product/fallback inboxes below.

export const PRODUCT_BOOKING_CONFIGS = {
  taxres_crm: {
    key:           'taxres_crm',
    name:          'TaxRes CRM',
    logo:          'https://taxrescrm.app/taxrescrm-logo.png',
    favicon:       '/taxrescrm-favicon.png',
    logoAlt:       'TaxRes CRM',
    headline:      'Schedule an Appointment',
    types:         ['Free Consultation', 'Product Demo', 'Follow-Up Call'],
    calendarLabel: '[TaxRes CRM]',
    notifyEmail:   'romy@taxrescrm.net',
    replyTo:       'romy@taxrescrm.net',
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
    notifyEmail:   'info@romylabs.com',
    replyTo:       'info@romylabs.com',
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
    notifyEmail:   'info@romylabs.com',
    replyTo:       'info@romylabs.com',
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
    notifyEmail:   'info@romylabs.com',
    replyTo:       'info@romylabs.com',
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
    notifyEmail:   'info@romylabs.com',
    replyTo:       'info@romylabs.com',
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
    notifyEmail:   'info@romylabs.com',
    replyTo:       'info@romylabs.com',
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
    notifyEmail:   'info@romylabs.com',
    replyTo:       'info@romylabs.com',
    fromName:      'Restore Relay CRM',
    inactive:      false,
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
    notifyEmail:   'info@romylabs.com',
    replyTo:       'info@romylabs.com',
    fromName:      'GroundIVO',
    inactive:      false,
  },
}

export function resolveProductConfig(productParam) {
  const cfg = PRODUCT_BOOKING_CONFIGS[productParam]
  if (!cfg || cfg.inactive) return PRODUCT_BOOKING_CONFIGS.taxres_crm
  return cfg
}

export const PRODUCT_BADGE_COLORS = {
  taxres_crm: { bg: '#1e3a5f', text: '#60a5fa', label: 'TaxRes CRM' },
  romylabs:   { bg: '#1a1a1a', text: '#C6FF00', label: 'RomyLabs'   },
  camvella:   { bg: '#0b2748', text: '#55B96A', label: 'Camvella'   },
  arcvena:    { bg: '#1a0a2e', text: '#a78bfa', label: 'Arcvena'    },
  bocasync:   { bg: '#1a2e1a', text: '#34d399', label: 'BocaSync'   },
  groundivo:  { bg: '#17351f', text: '#9bdc34', label: 'GroundIVO'  },
  oculivo:    { bg: '#312e81', text: '#67e8f9', label: 'Oculivo'    },
  restore_relay: { bg: '#164e63', text: '#f59e0b', label: 'Restore Relay' },
}

export function getProductBadge(productId) {
  return PRODUCT_BADGE_COLORS[productId] || PRODUCT_BADGE_COLORS.taxres_crm
}
