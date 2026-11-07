// Non-network regression guard for the weekly growth report.
// It intentionally checks source contracts without altering runtime behavior.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('supabase/functions/weekly-growth-report/index.ts', 'utf8')
const section = source.slice(source.indexOf("const [gscRes, ga4Res"), source.indexOf("const gsc      ="))
assert.equal((section.match(/\.eq\('product_id', 'taxres_crm'\)/g) || []).length, 2, 'Current and previous GA4 ranges must remain TaxRes-scoped')
assert.match(source, /const dailyTotals = ga4\.filter\(\(r: any\) => r\.channel === '__TOTAL__'\)/)
assert.match(source, /const priorTotals = ga4prev\.filter\(\(r: any\) => r\.channel === '__TOTAL__'\)/)
assert.match(source, /const sessions = dailyTotals\.reduce/)
assert.match(source, /const sessPrev = priorTotals\.reduce/)
assert.doesNotMatch(source, /const sessions = ga4\.reduce/)
assert.doesNotMatch(source, /const sessPrev = ga4prev\.reduce/)
console.log('PASS weekly report totals isolated and not double counted')
