const fs = require('fs')

const app = fs.readFileSync('src/App.jsx','utf8')
const vite = fs.readFileSync('vite.config.js','utf8')
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'))
const prebuild = pkg.scripts?.prebuild || ''
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

assert(app.includes('const TAXRES_FAMILY_BUILD = __TAXRES_BUILD__'), 'App must use generated build ID')
assert(vite.includes('CF_PAGES_COMMIT_SHA'), 'Vite must derive build ID from Cloudflare commit SHA')
assert(vite.includes("writeFileSync('dist/taxres-build.json'"), 'Build must emit fresh taxres-build.json')
assert(prebuild.includes('check-ai-file-picker'), 'AI file-picker guard must run in prebuild')
assert(prebuild.includes('check-email-blast-select-all'), 'Email Blast select-all guard must run in prebuild')
assert(prebuild.includes('check-email-context-menu'), 'Email context-menu guard must run in prebuild')

if (failures.length) {
  console.error('Frontend release-integrity guard FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('PASS  Frontend release integrity')
