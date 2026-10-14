const fs = require('fs')

const blast = fs.readFileSync('src/pages/EmailBlast.jsx','utf8')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

assert(blast.includes('const allEligibleSelected = rows.length > 0 && rows.every(row => selected.has(row.id))'), 'Select all must target eligible loaded recipients')
assert(blast.includes('setSelected(new Set(rows.map(row => row.id)))'), 'Select all must select every eligible office recipient')
assert(blast.includes("setRows(scoped.filter(row => emailOk(row?.email) && !suppressed(row)))"), 'eligible recipient list must continue excluding invalid/suppressed addresses')
assert(blast.includes("allEligibleSelected?'Clear all':'Select all'"), 'Email Blast must expose Select all / Clear all control')
assert(blast.includes("allVisibleSelected?'Clear visible':'Select visible'"), 'filtered Select visible control must remain available')

if (failures.length) {
  console.error('Email Blast select-all guard FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('PASS  Email Blast select-all guardrails')
