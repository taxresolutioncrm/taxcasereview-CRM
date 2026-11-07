import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('supabase/functions/weekly-growth-report/index.ts', 'utf8')
assert(source.includes("if(!(await authorized(req,admin)))"), 'Live owner/cron authorization must remain enforced')
assert(source.includes('verify_internal_cron_token'), 'Internal cron token validation must remain intact')
assert.equal((source.match(/\.eq\('product_id','taxres_crm'\)/g) || []).length, 2, 'Current and prior GA4 queries must use the TaxRes product key')
assert(source.includes("totalRows=ga.filter((r:any)=>r.channel==='__TOTAL__')"), 'Daily total filter must be present')
assert(source.includes("prevTotalRows=prev.filter((r:any)=>r.channel==='__TOTAL__')"), 'Prior daily total filter must be present')
assert(source.includes("sessions=sum(totalRows,'sessions')"), 'Sessions must use daily totals only')
assert(source.includes("prevSessions=sum(prevTotalRows,'sessions')"), 'Previous sessions must use daily totals only')
assert(!source.includes("sessions=sum(ga,'sessions')"), 'Must not double count current channel sessions')
assert(!source.includes("prevSessions=sum(prev,'sessions')"), 'Must not double count prior channel sessions')
console.log('PASS TaxRes GA4 isolation, source alignment and live authorization safeguards')
