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
  version: '3.0.1',
  productionDate: null, // Set only on confirmed production deployment.
  title: 'Search Console Trend Visibility',
  changes: [
    'Google Search Console adds live 7-day, 28-day and 90-day reporting windows.',
    'Search Console KPI cards show previous-period movement instead of only a rolling 90-day total.',
    'Search Console displays the provider data-through date and the most recent refresh time.',
  ],
})

export const ADMIN_PORTAL_HISTORY = Object.freeze([ADMIN_PORTAL_RELEASE, ADMIN_PORTAL_BASELINE])
