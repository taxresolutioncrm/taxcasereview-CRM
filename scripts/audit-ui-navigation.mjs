import fs from 'node:fs'

const app = fs.readFileSync('src/App.jsx','utf8')
const sidebar = fs.readFileSync('src/components/layout/Sidebar.jsx','utf8')
const topbar = fs.readFileSync('src/components/layout/TopBar.jsx','utf8')

const routePaths = new Set([...app.matchAll(/<Route\s+path="([^"]+)"/g)].map(m => m[1]))
const sidebarPaths = new Set([...sidebar.matchAll(/\{\s*path:\s*'([^']+)'/g)].map(m => m[1]))
const newItems = [...topbar.matchAll(/label:\s*'([^']+)'[^\n]*path:\s*'([^']+)'/g)].map(m => ({label:m[1],path:m[2]}))

const failures = []
for (const p of sidebarPaths) {
  if (!routePaths.has(p)) failures.push(`Sidebar path has no exact App route: ${p}`)
}
for (const {label,path} of newItems) {
  if (!routePaths.has(path)) failures.push(`Global New item ${label} targets missing App route: ${path}`)
}

const expectedNew = {
  'New Case': ['/cases','src/pages/Cases.jsx',"get('new') === '1'"],
  'New Client': ['/clients','src/pages/Clients.jsx',"get('new') === '1'"],
  'New Corp': ['/formacorp','src/pages/FormaCorpLegacy.jsx',"get('new') === '1'"],
  'New Document': ['/documents','src/pages/Documents.jsx',"get('new') === '1'"],
  'New E-Sign': ['/esign','src/pages/Esign.jsx',"get('new') === '1'"],
  'New Email': ['/email','src/pages/Email.jsx',"get('new') === '1'"],
  'New Entry': ['/books','src/pages/Books.jsx',"get('new') === '1'"],
  'New Event': ['/calendar','src/pages/Calendar.jsx',"get('new') === '1'"],
  'New Fax': ['/fax','src/pages/Fax.jsx',"get('new') === '1'"],
  'New Invoice': ['/invoices','src/pages/Invoices.jsx',"get('new') === '1'"],
  'New Lead': ['/leads','src/pages/Leads.jsx',"get('new') === '1'"],
  'New Payment': ['/payments','src/pages/Payments.jsx',"get('new') === '1'"],
  'New Task': ['/tasks','src/pages/Tasks.jsx',"get('new') === '1'"],
  'New Transcript': ['/irsportal','src/pages/IRSPortal.jsx',"get('new') === '1'"],
}

for (const [label,[expectedPath,file,needle]] of Object.entries(expectedNew)) {
  const item = newItems.find(x => x.label === label)
  if (!item) { failures.push(`Missing global New item: ${label}`); continue }
  if (item.path !== expectedPath) failures.push(`${label} targets ${item.path}; expected ${expectedPath}`)
  const source = fs.readFileSync(file,'utf8')
  if (!source.includes(needle)) failures.push(`${label} target does not consume quick-create intent: ${file}`)
}

if (!topbar.includes("createPortal(")) failures.push('Global New drawer is not portal-rendered')
if (!topbar.includes('role="dialog"')) failures.push('Global New drawer lacks dialog semantics')

if (failures.length) {
  console.error('UI NAVIGATION AUDIT FAILED')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log(`UI navigation audit passed: ${sidebarPaths.size} sidebar routes, ${newItems.length} global New actions, all quick-create handlers present.`)
