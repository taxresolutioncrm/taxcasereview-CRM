import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const s=readFileSync('src/pages/Calendar.jsx','utf8')
const detail=s.slice(s.indexOf('// ── EVENT DETAIL PANEL ──'),s.indexOf("  return (\n    <div style={{ display: 'flex', position: 'absolute', inset: 0",s.indexOf('// ── EVENT DETAIL PANEL ──')))
assert.ok(detail.includes('onClick={() => setConfirmDel(selectedEvent.id)}'),'Detail delete opens confirmation')
assert.ok(detail.includes('<DeleteConfirmModal open={!!confirmDel}'),'Confirmation must render in event detail return branch')
assert.ok(s.includes(".delete().eq('id', id).select('id')"),'Non-admin delete verifies returning row')
assert.ok(s.includes("const deleted = isRomyLabsAdmin ? data === true : Array.isArray(data)"),'Only successful deletion removes calendar item')
assert.ok(!detail.includes("await supabase.from('calevents').delete().eq('id', selectedEvent.id)"),'Decline must share confirmation and authorized deletion')
console.log('PASS Calendar detail delete confirm reachable; verified deletion for admin and tenant')
