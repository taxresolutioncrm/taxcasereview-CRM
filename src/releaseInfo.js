// TaxRes-family production release manifest.
// Each office keeps an independent semantic version line.
// Shared code does not make Nashville part of a central release.

const IRS_WORKFLOW_CHANGES = [
  'IRS TDS/SOR Portal layout corrected to the established TaxRes practitioner workflow',
  'Duplicate helper/bridge setup clutter removed from the main transcript request screen',
  'IRS TDS/SOR Portal now includes built-in How to Use This Feature guidance',
  'Receive-only SOR Mailbox workflow is available inside the IRS portal',
  'Persistent Unassigned Transcripts inbox retains unmatched IRS documents across refresh and logout',
  'SHA-256 duplicate protection prevents the same IRS document from being processed twice',
  'Uncertain taxpayer matches require explicit employee assignment before filing',
  'Assignment and discard actions retain an audit trail with safe retry behavior',
]

const DEFAULT_RELEASE = {
  version: '3.1.1',
  releasedAt: '2026-10-25',
  title: 'TaxRes CRM 3.1 — IRS TDS/SOR Workflow',
  changes: IRS_WORKFLOW_CHANGES,
}

const OFFICE_RELEASES = {
  // Tax Case Review
  '61a89aef-0e7e-4ea2-b222-44ab2024655a': {
    version: '3.1.1',
    releasedAt: '2026-10-25',
    title: 'Tax Case Review CRM 3.1 — IRS TDS/SOR Workflow',
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
    version: '3.1.1',
    releasedAt: '2026-10-25',
    title: 'CloudCPA CRM 3.1 — IRS TDS/SOR Workflow',
    changes: IRS_WORKFLOW_CHANGES,
  },

  // Centurion Firm
  '8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a': {
    version: '3.1.1',
    releasedAt: '2026-10-25',
    title: 'Centurion Firm CRM 3.1 — IRS TDS/SOR Workflow',
    changes: IRS_WORKFLOW_CHANGES,
  },
}

export function getReleaseInfo(tenantId) {
  return OFFICE_RELEASES[tenantId] || DEFAULT_RELEASE
}

export { DEFAULT_RELEASE, OFFICE_RELEASES }
