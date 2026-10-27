// TaxRes-family production release manifest.
// Each office keeps an independent semantic version line.
// Shared code does not make Nashville part of a central release.

const IRS_WORKFLOW_CHANGES = [
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

const DEFAULT_RELEASE = {
  version: '3.2.7',
  releasedAt: '2026-10-26',
  title: 'TaxRes CRM 3.2.7 — Responsive Client Quick Actions',
  changes: IRS_WORKFLOW_CHANGES,
}

const OFFICE_RELEASES = {
  // Tax Case Review
  '61a89aef-0e7e-4ea2-b222-44ab2024655a': {
    version: '3.2.7',
    releasedAt: '2026-10-26',
    title: 'Tax Case Review CRM 3.2.7 — Responsive Client Quick Actions',
    changes: IRS_WORKFLOW_CHANGES,
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
    version: '3.2.7',
    releasedAt: '2026-10-26',
    title: 'CloudCPA CRM 3.2.7 — Responsive Client Quick Actions',
    changes: IRS_WORKFLOW_CHANGES,
  },

  // Centurion Firm
  '8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a': {
    version: '3.2.7',
    releasedAt: '2026-10-26',
    title: 'Centurion Firm CRM 3.2.7 — Responsive Client Quick Actions',
    changes: IRS_WORKFLOW_CHANGES,
  },
}

export function getReleaseInfo(tenantId) {
  return OFFICE_RELEASES[tenantId] || DEFAULT_RELEASE
}

export { DEFAULT_RELEASE, OFFICE_RELEASES }
