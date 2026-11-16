import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const ui=readFileSync('src/pages/AdminPortal.jsx','utf8')
for(const needle of [
  "status:String(product.lifecycle||'').toLowerCase()==='live'?'CRM Live'",
  "String(product.lifecycle||'').toLowerCase()==='building'?'In Development'",
  "plan_tier:'Product'",
  "metric_coverage:coverage",
  "coverage.known < coverage.total",
  "metricsWarnings.length>0",
  "Unknown counts are not zero.",
  "effective_monthly:billing",
  ": null,\n      billing_seats:billing?.billing_seats",
]){
  assert.ok(ui.includes(needle),'Portfolio reporting contract missing '+needle)
}
assert.ok(!ui.includes("status:'active',\n      plan_tier:'Main CRM'"),'Synthetic product rows cannot be marked as active operating offices')
assert.ok(ui.includes("counts_as_office:false"),'Product headers cannot count as additional offices')
console.log('PASS honest portfolio product status and partial office metric coverage')
