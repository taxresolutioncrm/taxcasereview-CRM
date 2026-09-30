import fs from 'node:fs'

const employees = fs.readFileSync('src/pages/Employees.jsx','utf8')
const ctx = fs.readFileSync('src/context/AppContext.jsx','utf8')
const workflows = fs.readFileSync('src/pages/Workflows.jsx','utf8')
const adminLookup = fs.readFileSync('supabase/migrations/20260927004000_admin_employee_lookup.sql','utf8')
const irs = fs.readFileSync('supabase/functions/submit-to-irs/index.ts','utf8')
const nash = fs.readFileSync('supabase/functions/employee-access-link/index.ts','utf8')
const familyAdmin = fs.readFileSync('supabase/functions/taxres-family-admin-proof/index.ts','utf8')
const fail = m => { console.error('TAXRES EA ROLE REGRESSION:', m); process.exit(1) }

for (const needle of [
  "const ACCESS_LEVELS = ['Super Admin', 'Admin', 'Manager', 'EA',",
  "'EA':            'EA'",
  "'EA':          { perm_leads:1, perm_clients:3",
]) if (!employees.includes(needle)) fail('Employees.jsx missing '+needle)

if (!ctx.includes("'EA':          { label: 'EA'")) fail('AppContext does not recognize EA')
if (!ctx.includes("'EA': {")) fail('EA role defaults are missing')
if (!workflows.includes("'EA'")) fail('Workflow assignment list does not include EA')
if (!adminLookup.includes("'EA'")) fail('Admin employee update does not accept EA')
if (!irs.includes("'EA':50")) fail('IRS permission rank does not recognize EA')
if (!nash.includes("'EA':50")) fail('Nashville employee access does not recognize EA')
if (!familyAdmin.includes("'EA':50")) fail('TaxRes family admin role ranking does not recognize EA')

console.log('PASS: EA is available across the TaxRes family, including TCR and Nashville.')
