import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = file => readFileSync(file, 'utf8')
const clients = read('src/pages/Clients.jsx')
const portal = read('src/pages/ClientPortal.jsx')

function has(label, value) { assert.ok(value, label); console.log('PASS', label) }

has('single editable card', (clients.match(/aria-label=\{c\.internal_note \? 'Edit staff note' : 'Add staff note'\}/g) || []).length === 1)
has('card preserves pin, amber fill, border, heading', clients.includes('📌 Staff Note') && clients.includes("background:'rgba(245,158,11,.12)'") && clients.includes("border:'1.5px solid #f59e0b'"))
has('keyboard button is usable', clients.includes('<button type="button" aria-label={c.internal_note'))
has('editor shows full note', clients.includes('value={staffNoteEditor.draft}') && clients.includes('rows={8}'))
has('empty-note add affordance', clients.includes("'Add a staff note'"))
has('editor scopes save by tenant', clients.includes(".eq('tenant_id', myTenantId)\n        .eq('id', editor.clientId)"))
has('editor updates only internal_note', clients.includes(".update({ internal_note: editor.draft || null })"))
has('concurrency guard for null and non-null notes', clients.includes("query.is('internal_note', null)") && clients.includes("query.eq('internal_note', editor.original)"))
has('permission checks before opening/saving', clients.includes("if (!can('edit', 'clients') || !myTenantId") && clients.includes("!can('edit', 'clients') ||\n        !myTenantId"))
has('explicit server-error handling for zero updated records', clients.includes("if (!data) throw new Error('This note changed"))
has('no duplicate saves', clients.includes('staffNoteSavingRef.current = true') && clients.includes('if (!editor || staffNoteSavingRef.current'))
has('immediate in-memory update', clients.includes('setDetail(prev =>') && clients.includes('setClients(prev => prev.map(client =>'))
has('save success and error feedback', clients.includes("showToast('✅ Staff note saved')") && clients.includes("showToast('Staff note not saved:"))
has('cancel and unsaved confirmation', clients.includes("setStaffNoteDiscardConfirm(true)") && clients.includes('onClick={discardStaffNoteChanges}') && !clients.includes('window.confirm('))
has('existing activity log reused', clients.includes("action: 'staff_note_updated'"))
has('modal uses existing CRM shell', clients.includes('className="modal-bg open"') && clients.includes('role="dialog" aria-modal="true" aria-labelledby="staff-note-title"'))
has('no note rendering in client portal', !portal.includes('internal_note') && !portal.includes('staffNoteEditor'))
console.log('Staff Note source invariants passed (static only; not browser or tenant-auth tests).')
