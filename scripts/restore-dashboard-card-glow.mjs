import fs from 'node:fs'

const dashPath = 'src/pages/Dashboard.jsx'
const d = fs.readFileSync(dashPath, 'utf8')

// Build-time guard only. Dashboard styling must already be committed in source.
// Never mutate tracked files during prebuild; source:verify-current intentionally
// fails any build that does so.
const required = [
  "background: '#10283f'",
  "border: '1px solid #24435f'",
  "padding: '16px 14px'",
  "minHeight: 100",
  "fontSize: 'clamp(22px, 1.55vw, 28px)'",
  "opacity: .15",
  "data-card-idx={idx}",
]

const legacy = [
  'radial-gradient(circle at 82% -8%',
  '0 16px 38px rgba(0,0,0,.30)',
  'drop-shadow(0 0 8px',
]

const missing = required.filter(token => !d.includes(token))
const presentLegacy = legacy.filter(token => d.includes(token))

if (missing.length || presentLegacy.length) {
  console.error('Dashboard card baseline mismatch.')
  if (missing.length) console.error('Missing:', missing.join(' | '))
  if (presentLegacy.length) console.error('Legacy styling still present:', presentLegacy.join(' | '))
  process.exit(1)
}

console.log('Dashboard card baseline matches Nashville; no source mutation required.')
