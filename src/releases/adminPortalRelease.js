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
  version: '3.0.4',
  productionDate: null, // Set only on confirmed production deployment.
  title: 'Restore Relay $399 Stripe Link Ready',
  changes: [
    'Restore Relay presale agreements now prefill the verified live $399 Stripe initial-payment link.',
    'Office e-sign and presale agreement screens both use the same approved one-time checkout URL.',
    'Recipients receive signing and initial-payment links together; six-installment recurring billing still requires separate setup.',
  ],
})

export const ADMIN_PORTAL_HISTORY = Object.freeze([ADMIN_PORTAL_RELEASE, ADMIN_PORTAL_BASELINE])
