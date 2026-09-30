import fs from 'node:fs'

const employees = fs.readFileSync('src/pages/Employees.jsx','utf8')
const ctx = fs.readFileSync('src/context/AppContext.jsx','utf8')
const adminLookup = fs.readFileSync('supabase/migrations/20260927004000_admin_employee_lookup.sql','utf8')
const irs = fs.readFileSync('supabase/functions/submit-to-irs/index.ts','utf8')
const nash = fs.readFileSync('supabase/functions/employee-access-link/index.ts','utf8')
const fail = m => { console.error('TCR EA ROLE REGRESSION:', m); process.exit(1) }

for (const needle of [
  "const TCR_TENANT = '61a89aef-0e7e-4ea2-b222-44ab2024655a'",
  "currentTenantId === TCR_TENANT",
  "'EA':            'EA'",
  "'EA':          { perm_leads:1, perm_clients:3",
]) if (!employees.includes(needle)) fail('Employees.jsx missing '+needle)

if (!ctx.includes("'EA':          { label: 'EA'")) fail('AppContext does not recognize EA')
if (!adminLookup.includes("'EA'")) fail('Admin employee update does not accept EA')
if (!irs.includes("'EA':50")) fail('IRS permission rank does not recognize EA')
if (nash.includes("'EA':50")) fail('Nashville-specific employee access path was changed; EA must remain TCR-only')

console.log('PASS: EA is available for TCR and Nashville role UI/access remains unchanged.')
