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
assert(!app.includes("window.setInterval(check, 60_000)"), 'Active CRM work must not be auto-reloaded on a timer')
assert(!app.includes("document.addEventListener('visibilitychange', onVisible)"), 'Returning to a Chrome tab must not trigger a build reload')
const appContext = fs.readFileSync('src/context/AppContext.jsx','utf8')
assert(appContext.includes("backgroundedMs < 60_000"), 'Short browser tab switches must bypass full idle recovery')
assert(appContext.includes("those state writes can cause page-level") || appContext.includes("short background interval"), 'Draft-preservation wake guard must remain documented')

assert(prebuild.includes('check-email-blast-select-all'), 'Email Blast select-all guard must run in prebuild')
assert(prebuild.includes('check-email-context-menu'), 'Email context-menu guard must run in prebuild')

if (failures.length) {
  console.error('Frontend release-integrity guard FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('PASS  Frontend release integrity')
