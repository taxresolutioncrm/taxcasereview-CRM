import fs from 'node:fs'

const source = fs.readFileSync('src/pages/Employees.jsx','utf8')
const fail = msg => { console.error('EMPLOYEE CARD DENSITY REGRESSION:', msg); process.exit(1) }

for (const needle of [
  "maxWidth:1480",
  "minmax(min(300px, 100%), 1fr)",
  "padding: 14",
  "width: 36, height: 36",
  "🔑 Reset",
  "✉️ Invite"
]) {
  if (!source.includes(needle)) fail('Missing Nashville-style employee-card layout invariant: '+needle)
}

if (source.includes("minmax(min(420px, 100%), 1fr)")) {
  fail('Oversized two-column employee-card layout returned.')
}

console.log('PASS: employee directory uses the Nashville-style compact large-team card layout.')
