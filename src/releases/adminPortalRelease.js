// Independent RomyLabs Admin Portal release line. Never import a CRM changelog.
const ADMIN_PORTAL_BASELINE = Object.freeze({
  version: '3.0.0',
  productionDate: null,
  title: 'Formal Versioning Baseline',
  changes: [
    'Formal semantic versioning begins with this release baseline.',
    'Independent Admin Portal release history introduced.',
    'What’s New / Release History dialog added to the Admin Portal.',
  ],
})

export const ADMIN_PORTAL_RELEASE = Object.freeze({
  version: '3.0.3',
  productionDate: null, // Set only on confirmed production deployment.
  title: 'Restore Relay Pre-Sale Agreement Composer',
  changes: [
    'CRM Companies now allows preparing a Restore Relay contract before creating the customer office.',
    'Authorized admins can create or select an unprovisioned Restore Relay sales record for the $399 six-month agreement.',
    'The pre-sale contract reuses the existing secure e-sign workflow and sends the $399 Stripe payment link in one email.',
  ],
})

export const ADMIN_PORTAL_HISTORY = Object.freeze([ADMIN_PORTAL_RELEASE, ADMIN_PORTAL_BASELINE])
