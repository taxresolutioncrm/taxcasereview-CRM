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
  version: '3.0.2',
  productionDate: null, // Set only on confirmed production deployment.
  title: 'Restore Relay Agreement and Initial Stripe Payment',
  changes: [
    'Restore Relay prospect and office agreements include one email with an e-sign link and a verified $399 initial-installment Stripe link.',
    'The six-month agreement is $399 per month ($2,394 total) with no automatic renewal.',
    'Resent e-sign requests and pre-onboarding prospect agreements preserve the original Stripe payment link; unrelated office signing workflows remain unchanged.',
  ],
})

export const ADMIN_PORTAL_HISTORY = Object.freeze([ADMIN_PORTAL_RELEASE, ADMIN_PORTAL_BASELINE])
