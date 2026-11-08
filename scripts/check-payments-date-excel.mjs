import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import XLSX from 'xlsx'
import { paymentDay, paymentView, paymentsExportRows } from '../src/lib/paymentsView.js'
import { exportReportXlsx } from '../src/lib/reportExcelExport.js'

const entries = [
  {id:'a', clientName:'Acme', invNum:'INV-1', amount:'101.25', method:'Check', checkNum:'00991', date:'2026-11-01', created_at:'2026-11-04T02:00:00Z', status:'Cleared', reference:'abc'},
  {id:'b', clientName:'Bravo', invNum:'INV-2', amount:42.50, method:'ACH / Bank Transfer', date:'', created_at:'2026-11-02T23:59:59Z', status:'Pending', reference:'b2'},
  {id:'c', clientName:'Charlie', invNum:'INV-3', amount:50, method:'Credit Card', date:'2026-11-03', status:'Failed'},
  {id:'d', clientName:'Delta', invNum:'INV-4', amount:20, method:'Check', date:'2026-10-31', status:'Paid'},
  {id:'e', clientName:'=INJECT()', invNum:'INV-5', amount:12.12, method:'Check', date:'2026-11-02', status:'Posted'},
]
const baseline = JSON.parse(JSON.stringify(entries))
assert.equal(paymentDay(entries[1]), '2026-11-02', 'created_at fallback')
let result = paymentView(entries, {dateFrom:'2026-11-01',dateTo:'2026-11-02'})
assert.deepEqual(result.sorted.map(x=>x.id),['b','e','a'],'inclusive two-day date bounds with fallback and descending date sort')
assert.equal(result.count,3)
assert.equal(result.failed,0)
assert.equal(result.collected,113.37)
assert.equal(result.pending,42.5)
assert.deepEqual(result.byMethod,{Check:113.37})
assert.deepEqual(paymentView(entries,{dateFrom:'2026-11-03',dateTo:'2026-11-03'}).sorted.map(x=>x.id),['c'],'inclusive same-day range')
assert.deepEqual(paymentView(entries,{dateFrom:'2026-11-03'}).sorted.map(x=>x.id),['c'],'from-only')
assert.deepEqual(paymentView(entries,{dateTo:'2026-10-31'}).sorted.map(x=>x.id),['d'],'to-only')
assert.equal(paymentView(entries,{dateFrom:'2026-11-04',dateTo:'2026-11-01'}).invalidDateRange,true)
assert.equal(paymentView(entries,{dateFrom:'2026-11-04',dateTo:'2026-11-01'}).count,0)
assert.deepEqual(paymentView(entries,{dateFrom:'2026-11-01',dateTo:'2026-11-02',search:'inv-1'}).sorted.map(x=>x.id),['a'])
assert.deepEqual(paymentView(entries,{dateFrom:'2026-11-01',dateTo:'2026-11-02',status:'Pending'}).sorted.map(x=>x.id),['b'])
assert.deepEqual(paymentView(entries,{dateFrom:'2026-11-01',dateTo:'2026-11-02',method:'Check'}).sorted.map(x=>x.id),['e','a'])
assert.deepEqual(paymentView(entries,{dateFrom:'2026-11-01',dateTo:'2026-11-02',method:'Check',status:'Cleared',search:'ac'}).sorted.map(x=>x.id),['a'])
assert.deepEqual(paymentView(entries,{sortCol:'amount',sortDir:'asc'}).sorted.map(x=>x.id),['e','d','b','c','a'],'numerical sort')
assert.deepEqual(entries,baseline,'pure filter and sort must not modify payments')

// SheetJS ESM requires explicit Node fs binding for writeFile; browsers use download APIs.
XLSX.set_fs(fs)
const directory = mkdtempSync(join(tmpdir(),'payments-export-'))
try {
  const filename = join(directory,'payments-filtered.xlsx')
  const selected = paymentView(entries, {dateFrom:'2026-11-01',dateTo:'2026-11-02',method:'Check',sortCol:'amount',sortDir:'desc'}).sorted
  const rows = paymentsExportRows(selected)
  assert.deepEqual(rows.map(r=>r[0]),['Acme','=INJECT()'])
  assert.equal(typeof rows[0][2],'number')
  await exportReportXlsx({
    filename, sheetName:'Payments',
    headers:['Client','Invoice #','Amount','Method','Check #','Date','Status','Reference'],
    rows, moneyColumns:[2],
  })
  const bytes = readFileSync(filename)
  assert.equal(bytes.subarray(0,2).toString(),'PK','must be a ZIP-backed XLSX, not renamed CSV')
  const workbook = XLSX.read(bytes,{type:'buffer',cellNF:true,cellStyles:true})
  assert.deepEqual(workbook.SheetNames,['Payments'])
  const sheet = workbook.Sheets.Payments
  assert.equal(sheet.A1.v,'Client')
  assert.equal(sheet.H1.v,'Reference')
  assert.equal(sheet.C2.t,'n')
  assert.equal(sheet.C2.v,101.25)
  assert.equal(sheet.C2.z,'#,##0.00;[Red](#,##0.00)')
  assert.equal(sheet.A3.t,'s')
  assert.equal(sheet.A3.v,"'=INJECT()",'unsafe formula must stay plain text')
  assert.equal(sheet['!autofilter']?.ref,'A1:H3')
  assert.ok(sheet['!cols']?.length===8,'readable column widths')
  assert.equal(sheet.A4,undefined,'export must contain only filtered records')
  assert.deepEqual(entries,baseline,'export must never mutate payments')
} finally { rmSync(directory,{recursive:true,force:true}) }

const paymentsSource = readFileSync(new URL('../src/pages/Payments.jsx',import.meta.url),'utf8')
assert.ok(paymentsSource.includes("{paymentDay(p)||'—'}"), 'Transaction table must display date fallback used by filtering and export')
for(const phrase of ['Search Payments','Payments start date','Payments end date','Clear Dates','Export to Excel (.xlsx)','exportReportXlsx','paymentView(items','paymentsExportRows(sorted)']) {
  assert.ok(paymentsSource.includes(phrase),'Payments page missing '+phrase)
}
console.log('PASS Payments: inclusive date/filter/sort, totals, real XLSX, formatting, formula safety, no data mutation')
