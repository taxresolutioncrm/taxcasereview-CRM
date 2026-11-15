import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const code = readFileSync('src/pages/Employees.jsx', 'utf8')
assert.ok(code.includes("...(portalPin ? { portal_pin: portalPin } : {}),"), 'Only explicit new PIN changes may update portal_pin')
assert.ok(code.includes("portalPin:        '', // Never populate"), 'Stored PINs/hashes must never be rehydrated into the form')
assert.ok(code.includes('leave blank to keep existing PIN'), 'Employee editor must explain blank means keep existing')
assert.ok(!code.includes("portal_pin:        form.portalPin || null"), 'Blank employee edits must not clear a PIN')
console.log('PASS: employee editor never reads back or wipes stored portal PINs')
