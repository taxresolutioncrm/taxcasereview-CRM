import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=readFileSync('src/pages/Dashboard.jsx','utf8')
const light=readFileSync('src/taxres-light-polish.css','utf8')
const global=readFileSync('src/main.jsx','utf8')
const checks=[
  ['light stylesheet loaded',global.includes("import './taxres-light-polish.css'")],
  ['news rail semantic hook',source.includes('className="tax-dashboard-news-rail"')],
  ['rail full-width child',source.includes("width: '100%', minWidth: 0")],
  ['rail box-sizing retained',source.includes("boxSizing: 'border-box'")],
  ['light mode scoped rail surface',light.includes('html.light .tax-dashboard-news-rail {')],
  ['light rail background',/html\.light \.tax-dashboard-news-rail \{[^}]*background:\s*#ffffff\s*!important/s.test(light)],
  ['light rail headings',light.includes('html.light .tax-dashboard-news-rail .tax-dashboard-widget-title')],
  ['light article contrast',light.includes('html.light .tax-dashboard-news-rail .tax-dashboard-tas-entry')],
  ['light tips contrast',light.includes('html.light .tax-dashboard-news-rail .tax-dashboard-tip-panel')],
  ['dark mode unmodified',!light.includes('html.dark .tax-dashboard-news-rail')],
  ['articles still linked',source.includes('tasFeeds.map((item, i)')],
  ['tips navigation intact',source.includes('setTipIdx(i =>')],
  ['tip navigation is accessible',source.includes('aria-label="CRM tip navigation"') && source.includes('Previous CRM tip') && source.includes('Next CRM tip')],
  ['tip counter shown',source.includes('{tipIdx + 1} of {CRM_TIPS.length}')],
  ['dozens of dots removed',!source.includes('tax-dashboard-tip-dot is-active')],
  ['rail uses live theme tokens',source.includes("background: 'var(--sf)', color: 'var(--tx)', border: '1px solid var(--br)'")],
  ['titles use theme tokens',source.includes(`color: 'var(--tx)' }}>Taxpayer Advocate`) && source.includes(`color: 'var(--tx)' }}>CRM Tips`)],
]
assert(light.includes('html.light .tax-dashboard-theme-root > div:last-child,'),'Fallback light rail selector absent for cached lazy Dashboard chunks')
for(const [name,pass]of checks)assert(pass,name)
console.log('PASS shared tax office light dashboard news rail and dark parity ('+checks.length+' checks)')
