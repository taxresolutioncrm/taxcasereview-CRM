// Source-level invariants; browser viewport/E2E review remains a separate release gate.
import assert from 'node:assert/strict'
import fs from 'node:fs'
const read = name => fs.readFileSync(name, 'utf8')
const app = read('src/App.jsx')
const top = read('src/components/layout/TopBar.jsx')
const search = read('src/components/GlobalSearch.jsx')
const clients = read('src/pages/Clients.jsx')
const dashboard = read('src/pages/Dashboard.jsx')
const mobile = read('src/taxres-mobile.css')
const cards = read('src/tax-office-dashboard-cards.css')
const sidebar = read('src/components/layout/Sidebar.jsx')
const tenants = read('src/lib/mobileParityTenants.js')
const notes = read('src/releaseInfo.js')

for (const id of [
  '61a89aef-0e7e-4ea2-b222-44ab2024655a',
  'a0000000-0000-0000-0000-000000000001',
  '8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a',
]) assert(tenants.includes(id), 'Missing scoped tenant '+id)
assert(!tenants.includes('489ace07-1a6b-4864-833a-4f8420568b40'), 'Nashville must stay excluded')
assert(app.includes('usesMobileParity(myTenantId)') && app.includes('tax-mobile-parity'), 'Mobile parity scope must use resolved office')
for (const text of ['mobile-search-toggle', 'aria-expanded={mobileSearchOpen}', 'mobile-search-open', 'mobileSearchRef', '<GlobalSearch', 'setMobileSearchOpen(false)']) {
  assert(top.includes(text), 'Mobile header: '+text)
}
for (const table of ["from('clients')", "from('cases')", "from('leads')"]) {
  assert(search.includes(table), 'GlobalSearch must retain '+table)
}
for (const dest of ["'/clients/'", "'/cases/'", "'/leads/'"]) {
  assert(search.includes(dest), 'GlobalSearch must retain '+dest)
}
assert(top.includes("usesMobileParity(myTenantId) && <button"), 'Search toggle must be scoped')
assert(top.includes('className="topbar-create-controls"'), 'Search and New must remain grouped at narrow widths')
assert(mobile.includes('.topbar > .topbar-create-controls > .btn.pri'), 'Legacy office mobile New button styling must remain')
assert(mobile.includes('.mobile-search-toggle { display: none; }'), 'Desktop must not show duplicate mobile search')
assert(mobile.includes('flex-wrap: wrap !important;'), 'Narrow header must not clip')
assert(mobile.includes('max-width: none !important;'), 'Search overlay must override desktop width')
assert(mobile.includes('.tax-mobile-parity .topbar .page-title'), 'Unclipped title scope missing')
assert(mobile.includes('.tax-mobile-parity .topbar .topbar-search-wrap.mobile-search-open'), 'Mobile search overlay missing')
assert(mobile.includes('.tax-mobile-parity .page-content .client-quick-actions-grid'), 'Quick Actions grid missing')
assert(clients.includes('className="client-quick-actions-grid"'), 'Must target actual client action component')
assert(clients.includes('repeat(11, minmax(0, 1fr))'), 'Desktop client action grid must stay intact')
assert(cards.includes('.tax-mobile-parity .page-content div:has(> [data-card-idx])'), 'Dashboard scoped KPI grid missing')
assert(cards.includes('repeat(2, minmax(0, 1fr))'), 'Dashboard must be two columns on phone')
assert(dashboard.includes('data-card-idx'), 'Dashboard KPI contract missing')
assert(sidebar.includes("setMobileNavOpen(false)") && sidebar.includes('sidebar-backdrop'), 'Navigation open/close missing')
assert(clients.includes('client-detail-tabs-scroll'), 'Client detail scrollable tabs missing')
assert(notes.includes('MOBILE_UX_CHANGES'), 'Office mobile release notes missing')
console.log('PASS source mobile UX parity: scoped tenants, search, dashboard, client actions, navigation')
