const fs=require('fs');const assert=require('assert');
const m=fs.readFileSync('supabase/migrations/20261023121000_note_edit_audit_history.sql','utf8');
const c=fs.readFileSync('src/components/EditableNote.jsx','utf8');
for(const s of ['current_tenant_id()','current_employee_permission','edit_employee_note','note_edit_audit']) assert(m.includes(s),'missing '+s);
assert(!m.includes('489ace07-1a6b-4864-833a-4f8420568b40'),'Nashville tenant must not be hardcoded');
assert(!m.includes('61a89aef-0e7e-4ea2-b222-44ab2024655a'),'TCR tenant must not be hardcoded in TaxRes note feature');
assert(!m.includes('a0000000-0000-0000-0000-000000000001'),'TaxRes ADMIN tenant must resolve from authenticated context, not hardcode');
assert(c.includes("kind"),'shared note editor missing tenant-neutral kind contract');
console.log('PASS TaxRes note edit tenant-boundary checks');
