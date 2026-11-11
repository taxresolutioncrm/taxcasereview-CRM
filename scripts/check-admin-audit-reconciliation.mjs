import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const ui=readFileSync('src/pages/AdminPortal.jsx','utf8')
assert.ok(!ui.includes('visitorsToday: 247'),'Fabricated visitor count removed')
assert.ok(!ui.includes("path:'/features/irs-workflows', views:84"),'Fabricated page data removed')
assert.ok(ui.includes('marketing: null'),'Marketing must not invent numbers')
assert.equal((ui.match(/function handleGSCConnect\(\)/g)||[]).length,1,'Only nonce-protected GSC OAuth handler remains')
assert.ok(ui.includes("sessionStorage.setItem('romylabs-gsc-oauth'"),'Nonce-bound OAuth state retained')
assert.ok(ui.includes(".select('id,status')"),'Support status change must verify affected row')
assert.ok(ui.includes("statusSaveError && <div role=\"alert\""),'Failed ticket status update is visible')
console.log('PASS audited Admin Portal controls')
