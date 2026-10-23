const fs=require('fs');const assert=require('assert');

const migrationFiles=[
 'supabase/migrations/20261023121000_note_edit_audit_history.sql',
 'supabase/migrations/20261023122500_note_edit_rpc_edit_version_fix.sql',
 'supabase/migrations/20261023123500_note_edit_family_portability.sql',
 'supabase/migrations/20261023124500_note_edit_rpc_flag_reset.sql'
];

function read(file){ return fs.readFileSync(file,'utf8') }
function editableNoteUsages(file){
  const source=read(file)
  return [...source.matchAll(/<EditableNote\b[\s\S]*?\/>/g)].map(m=>m[0]).join('\n')
}

// Tenant portability must be evaluated only against the note-editing implementation.
// Clients/Leads contain legitimate office-specific integrations outside note editing
// (for example CloudCPA SMS routing), so scanning entire page files creates false
// deploy failures without protecting the note editor.
const text=[
  ...migrationFiles.map(read),
  read('src/components/EditableNote.jsx'),
  editableNoteUsages('src/pages/Clients.jsx'),
  editableNoteUsages('src/pages/Leads.jsx'),
  editableNoteUsages('src/pages/Cases.jsx')
].join('\n');

for(const id of [
 '61a89aef-0e7e-4ea2-b222-44ab2024655a',
 'a0000000-0000-0000-0000-000000000001',
 'ecd3d3ce-016a-4bb4-800e-f090f51e4cae',
 '8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a',
 '489ace07-1a6b-4864-833a-4f8420568b40'
]) assert(!text.includes(id),'note editing must stay office/tenant generic: '+id);

assert(text.includes("public._note_edit_permission('perm_clients')"),'portable client permission helper missing');
assert(text.includes("public._note_edit_permission('perm_leads')"),'portable lead permission helper missing');
assert(text.includes("public.current_tenant_id()"),'tenant context must resolve dynamically');
assert(text.includes("perform set_config('app.note_edit_rpc','',true)"),'RPC bypass flag must reset');
assert(text.includes('note_edit_audit'),'append-only audit contract missing');
assert((text.match(/<EditableNote\b/g)||[]).length>=3,'client/lead/case EditableNote wiring missing');
console.log('PASS TaxRes-family note editing standard: current + future offices');
