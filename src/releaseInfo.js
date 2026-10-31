// TaxRes-family production release manifest.
// Each office keeps an independent semantic version line.
// Shared code does not make Nashville part of a central release.

const IRS_WORKFLOW_CHANGES = [
  'All RomyLabs public demo bookings now create durable central Admin Portal alerts, independent of email delivery',
  'Business demo owner alerts use the registered RomyLabs Stalwart sender with audited submission and visible failures',
  'Booking identity includes all 11 active products and legacy PoolVerge URL alias',
  'Product demos are calendar-branded by their requested business instead of the TaxRes scheduling tenant',
  'TaxRes Biz company-page OAuth and verification added as a separate destination from the personal LinkedIn profile',
  'Arcvena LinkedIn organization authorization requests identity and page-admin scopes',
  'LinkedIn OAuth now uses separate registered applications for TaxRes and Arcvena',
  'LinkedIn callback authorization is processed by the signed-in Admin Portal, with state validation',
  'TaxRes LinkedIn personal-profile scheduling and queue readiness restored',
  'Arcvena company-page publishing remains gated until LinkedIn grants w_organization_social',
  'POA file upload in IRS portal now generates a secure signed URL for the private documents bucket instead of an always-broken public URL',
  'LinkedIn OAuth callback route on admin.romylabs.com fixed to redirect through AdminPortalGuard instead of the CRM bridge, preventing infinite OAuth loop',
  'LinkedIn personal-profile publishing restored for TaxRes CRM using w_member_social scope',
  'LinkedIn scope corrected for Arcvena company-page: r_organization_admin (rw_organization_admin is not a valid LinkedIn v2 scope)',
  'LinkedIn Admin Portal connection badge shows Profile Connected for personal-profile products and Company Page Connected for org products',
  'Camvella metrics batch timeout extended to 11 seconds to accommodate multi-query response time and prevent false Partial status',
  'LinkedIn company-page admin verification updated for versioned REST API and organizationTarget results',
  'Release accountability finalized for IRS/state Fax Document actions, inline client fax, SignalWire callback updates and sales/client dashboard cards',
  'IRS and State form cards support inline SignalWire Fax Document actions with the selected client and accurate form descriptions',
  'Client document fax composer stays over the active client record and validates office/document ownership',
  'Dashboard displays Recent Leads to authorized sales staff and Recent Clients to non-sales roles',
  'Training invitation panel polish, responsive join link, Copy Link and Email Invite controls',
  'Training host screen-share canvas prioritizes presentation with floating cameras and browser fullscreen',
  'All eleven Quick Actions remain in original order and fit the client-file width without clipping or a forced minimum row width',
  'Quick Actions restored to their original eleven-button order on one horizontally scrollable row, with readable compact labels',
  'Client Quick Actions now fit available width with readable labels and compact responsive tiles while preserving all eleven actions',
  'Client-file tab arrows replaced by a mouse/touch-friendly horizontal slider matching each office’s active theme',
  'Client file tabs have visible left/right scrolling arrows and keep Tax Organizer fully accessible on smaller screens',
  'Fax existing stored client documents from the client Documents preview using the existing outbound fax provider and composer',
  'Reuse private client document storage without downloading or uploading a duplicate file',
  'Client document previews and Open support historic private Supabase file links using fresh short-lived signed URLs',
  'LinkedIn OAuth callback routing restored across TaxRes and RomyLabs Admin Portal',
  'LinkedIn authorization opens separately and preserves the active workspace and draft',
  'IRS TDS request form inputs, tax-year selector, transcript choices, spacing and responsive layouts match Nashville practitioner form styling',
  'IRS TDS portal sign-in presentation and transcript/POA navigation counts polished toward Nashville parity',
  'Production build release-version verification corrected to read Git revision history accurately',
  'Client Documents now retain an inline three-column folder, file list and preview workspace with optional expanded viewing',
  'Document loading includes deterministic pagination and protection against stale responses when switching clients',
  'Client files have an independent Active / Not Active status selector',
  'Outgoing Gmail email composition supports multiple attachments, removal and validated sizes for supported mailboxes',
  'IRS TDS/SOR workflow retains local-file cleanup safeguards and in-app instructions',
]

const TRAINING_RELEASE_CHANGES = [
  'Training Center adds eight self-paced lessons, knowledge checks, and browser-local employee progress tracking',
  'Live training restores floating participant camera tiles over screen sharing while preserving session controls',
  ...IRS_WORKFLOW_CHANGES,
]

const EMAIL_PARITY_CHANGES = [
  'Gmail compose, reply and forward messages have independent browser-local draft recovery per employee and office',
  'Email reading links directly to the client profile when a unique exact email address matches',
  'Client Overview Log Time shortcut appears directly below IRS / State status and opens existing Time & Billing',
  ...TRAINING_RELEASE_CHANGES,
]

const FORMACORP_SAFE_FILING_CHANGES = [
  'FormaCorp saves Florida formation intake and filing preparation in the existing case without automatically charging or submitting',
  'Standard Florida filing requires an explicit official Sunbiz submission with receipt reconciliation; prepaid fax remains separate',
  'Duplicate payment attempts or recorded funds block new standard filing preparation until reconciled',
  ...EMAIL_PARITY_CHANGES,
]

const DEFAULT_RELEASE = {
  version: '3.2.22',
  releasedAt: '2026-10-30',
  title: 'TaxRes CRM 3.2.22 — FormaCorp Filing Preparation & Payment Safety',
  changes: FORMACORP_SAFE_FILING_CHANGES,
}

const OFFICE_RELEASES = {
  // Tax Case Review
  '61a89aef-0e7e-4ea2-b222-44ab2024655a': {
    version: '3.2.22',
    releasedAt: '2026-10-30',
    title: 'Tax Case Review CRM 3.2.22 — FormaCorp Filing Preparation & Payment Safety',
    changes: FORMACORP_SAFE_FILING_CHANGES,
  },

  // TaxRes administrative/default office
  'a0000000-0000-0000-0000-000000000001': {
    ...DEFAULT_RELEASE,
  },

  // Nashville Tax Solutions remains on its independently deployed release line.
  '489ace07-1a6b-4864-833a-4f8420568b40': {
    version: '3.0.0',
    releasedAt: '2026-10-23',
    title: 'Nashville Tax Solutions CRM 3.0 — Formal Versioning Baseline',
    changes: [
      'Formal semantic versioning begins with this release baseline',
      'Release notes dialog opens above CRM page content without overlap',
    ],
  },

  // CloudCPA
  'ecd3d3ce-016a-4bb4-800e-f090f51e4cae': {
    version: '3.2.19',
    releasedAt: '2026-10-30',
    title: 'CloudCPA CRM 3.2.19 — Training Center & Floating Video Tiles',
    changes: TRAINING_RELEASE_CHANGES,
  },

  // Centurion Firm
  '8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a': {
    version: '3.2.22',
    releasedAt: '2026-10-30',
    title: 'Centurion Firm CRM 3.2.22 — FormaCorp Filing Preparation & Payment Safety',
    changes: FORMACORP_SAFE_FILING_CHANGES,
  },
}

export function getReleaseInfo(tenantId) {
  return OFFICE_RELEASES[tenantId] || DEFAULT_RELEASE
}

export { DEFAULT_RELEASE, OFFICE_RELEASES }
