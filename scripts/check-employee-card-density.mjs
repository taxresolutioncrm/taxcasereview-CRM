import fs from 'node:fs'

const source = fs.readFileSync('src/pages/Employees.jsx','utf8')
const fail = msg => { console.error('EMPLOYEE CARD DENSITY REGRESSION:', msg); process.exit(1) }

for (const needle of [
  "maxWidth:1480",
  "minmax(min(270px, 100%), 1fr)",
  "padding: 12",
  "gridTemplateColumns: '36px minmax(0,1fr)'",
  "width: 36, height: 36"
]) {
  if (!source.includes(needle)) fail('Missing compact employee-card layout invariant: '+needle)
}

if (source.includes("minmax(min(420px, 100%), 1fr)")) {
  fail('Large two-column employee-card layout returned.')
}

console.log('PASS: employee directory uses compact large-team card density.')
