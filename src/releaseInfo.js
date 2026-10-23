// TaxRes-family production release manifest.
// The visible CRM version MUST only change when that office's production release ships.
// Shared code can carry different office versions through tenant-specific entries.

const DEFAULT_RELEASE = {
  version: '3.2.0',
  releasedAt: '2026-10-23',
  title: 'TaxRes CRM 3.2',
  changes: [
    'Employee note editing with permanent audit history',
    'Note editor performance optimization',
    'Case-note relationship correction',
    'Tenant and permission hardening',
  ],
}

const OFFICE_RELEASES = {
  // Tax Case Review
  '61a89aef-0e7e-4ea2-b222-44ab2024655a': {
    ...DEFAULT_RELEASE,
    title: 'Tax Case Review CRM 3.2',
    changes: [
      ...DEFAULT_RELEASE.changes,
      'TCR dashboard reporting accuracy corrections',
    ],
  },

  // TaxRes office
  'a0000000-0000-0000-0000-000000000001': {
    ...DEFAULT_RELEASE,
    title: 'TaxRes CRM 3.2',
  },

  // CloudCPA
  'ecd3d3ce-016a-4bb4-800e-f090f51e4cae': {
    ...DEFAULT_RELEASE,
    title: 'CloudCPA CRM 3.2',
  },

  // Centurion Firm
  '8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a': {
    ...DEFAULT_RELEASE,
    title: 'Centurion Firm CRM 3.2',
  },
}

export function getReleaseInfo(tenantId) {
  return OFFICE_RELEASES[tenantId] || DEFAULT_RELEASE
}

export { DEFAULT_RELEASE, OFFICE_RELEASES }
