const fs = require('node:fs')
const assert = require('node:assert/strict')
const source = fs.readFileSync('src/pages/Clients.jsx','utf8')
const shared = fs.readFileSync('supabase/migrations/20261106160000_taxres_tcr_client_document_folder_management.sql','utf8')
const centurion = fs.readFileSync('centurion-dedicated/migrations/20261106160000_centurion_client_document_folder_management.sql','utf8')
const component = source.split('export function ClientDocs(')[1]?.split('export default function Clients()')[0] || ''
assert(component,'ClientDocs component must exist')
for (const needle of [
  'setResolvedFolderClientId', "from('clients').select('id,name')",
  "eq('tenant_id',tenantId)", "clientRows.length!==1",
  "rpc('create_client_document_folder'", "rpc('rename_client_document_folder'",
  "rpc('delete_empty_client_document_folder'",'Rename custom folder',
  'Delete empty custom folder','role="alertdialog"', 'Folder contains documents',
  "can('edit','documents')", 'setCustomClientFolders([])',
  'docLoadRequestRef.current', 'await loadDocs()', 'DOC_FOLDERS.map',
  'selectPreview(', 'downloadPreview(', 'analyzeClientDocument(', "setFaxIntent("
]) {
  assert(component.includes(needle) || (needle==='Folder contains documents' && shared.includes(needle)),
    'Missing client Documents requirement: '+needle)
}
assert(component.includes('!/[\\x00-\\x1f\\x7f]/.test(name)'), 'Folder name must reject actual ASCII control characters')
assert(!component.includes('!/[\\\\x00-\\\\x1f\\\\x7f]/.test(name)'), 'Folder validation must not be double escaped')
assert(component.includes('customClientFolders.map(item=>item.name)'), 'Custom folders must be upload destinations')
assert(component.includes('existingFolderNames(item.id)'), 'Rename must prevent duplicate folder labels')
assert(!component.includes('window.confirm('), 'Folder deletion must not use native browser dialogs')
assert(component.includes('setConfirmDeleteFolder(item)'), 'Delete requires an explicit in-app confirmation')
assert(component.includes('resolvedFolderClientId'), 'Create must use resolved canonical client ID')
assert(!/storage\.from\('documents'\)\.remove\(/.test(component.split('async function deleteClientFolder')[1].split('async function loadDocs')[0]),
  'Folder deletion must never delete storage documents')
for (const [name,sql] of [['TaxRes/TCR',shared],['Centurion',centurion]]) {
  assert(!sql.includes('489ace07-1a6b-4864-833a-4f8420568b40'), name+' migration must not contain Nashville tenant ID')
  assert(!sql.includes('mpxgxfqdbquzkrvvejkh')&&!sql.includes('rkniemzmivnuhpdwkduc'), name+' migration must be project-independent')
  for (const needle of [
    'create table if not exists public.client_document_folders',
    'unique_folded', 'lower(name)',
    'enable row level security',
    'public.current_tenant_id()',
    "lower(e.email)=lower(coalesce(auth.jwt()->>'email',auth.email(),''))",
    "lower(coalesce(e.status,''))='active'",
    'public._client_folder_can(tenant_id,1)',
    'public._client_folder_can(v_tenant,2)',
    'public._client_folder_validate_name',
    'create_client_document_folder', 'rename_client_document_folder',
    'delete_empty_client_document_folder',
    'for update',
    'pg_advisory_xact_lock',
    'client_folder_document_write_lock',
    'update public.documents set "docType"=v_name',
    'Legacy documents have no verified client ID',
    'Move them to another folder before deleting',
    'client_document_folder_audit',
    "revoke all on public.client_document_folders from PUBLIC,anon,authenticated",
    "grant execute on function public.rename_client_document_folder(uuid,text) to authenticated"
  ]) assert(sql.includes(needle),name+' SQL missing '+needle)
  const deleteBody=sql.split('create or replace function public.delete_empty_client_document_folder')[1]
  assert(deleteBody && !deleteBody.includes('delete from public.documents'),name+' delete must never remove documents')
  assert(!/delete\s+from\s+storage\./i.test(sql),name+' must never delete storage objects')
}
assert(shared===centurion,'Shared and dedicated project SQL must be schema-compatible but applied separately')
console.log('PASS: TaxRes/TCR/Centurion custom client folder source, security, isolation and preservation invariants')
