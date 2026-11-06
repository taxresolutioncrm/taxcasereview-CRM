const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const src = fs.readFileSync('src/pages/Clients.jsx','utf8')
const start = src.indexOf('  const validFolderName = input => {')
const end = src.indexOf('  const existingFolderNames =',start)
assert(start >= 0 && end > start,'Shared folder-name validator must exist')
const fn = vm.runInNewContext(src.slice(start,end).trim() + '\nvalidFolderName')
assert.equal(typeof fn,'function')
for(const name of ['CAP','test','A','Tax','Rebecca','2025 Returns','IRS & State','Client Records']) {
  assert.equal(fn(name),name,'Expected valid name: '+name)
}
assert.equal(fn(' A '),'A','Outer spaces may be trimmed')
assert.equal(fn('X'.repeat(80)),'X'.repeat(80),'80 chars must be valid')
for(const name of ['', '    ', 'X'.repeat(81), 'CAP\n', '\tCAP','bad\nname','bad\tname','bad\x00name','bad\x7fname']) {
  assert.equal(fn(name),'','Expected invalid name: '+JSON.stringify(name))
}
const create=src.split('async function createClientFolder()')[1]?.split('async function renameClientFolder')[0]
const rename=src.split('async function renameClientFolder(')[1]?.split('async function deleteClientFolder')[0]
assert(create && rename,'Create and rename workflows must exist')
assert(create.includes('validFolderName(newFolderName)'),'Creation must use the tested validator')
assert(rename.includes('validFolderName(editingFolderName)'),'Rename must use the tested validator')
assert(create.includes('existingFolderNames().includes(name.toLowerCase())'),'Create duplicate check missing')
assert(rename.includes('existingFolderNames(item.id).includes(name.toLowerCase())'),'Rename duplicate check missing')
const fragment=src.slice(start,end)
const escaped=String.fromCharCode(92)
const good='/'+'['+escaped+'x00-'+escaped+'x1f'+escaped+'x7f'+']'+'/'
const bad='/'+'['+escaped+escaped+'x00-'+escaped+escaped+'x1f'+escaped+escaped+'x7f'+']'+'/'
assert(fragment.includes(good),'Correct JavaScript control character regex missing')
assert(!fragment.includes(bad),'Double-escaped CAP-rejecting regex detected')
for(const path of ['supabase/migrations/20261106160000_taxres_tcr_client_document_folder_management.sql','centurion-dedicated/migrations/20261106160000_centurion_client_document_folder_management.sql']) {
  const sql=fs.readFileSync(path,'utf8')
  assert(sql.includes("name !~ '[[:cntrl:]]'"),path+' SQL name constraint missing')
  assert(sql.includes("v_name ~ '[[:cntrl:]]'"),path+' RPC control validation missing')
  assert(sql.includes('char_length(v_name)>80'),path+' RPC name length validation missing')
  assert(sql.includes('tenant_id,client_id,lower(name)'),path+' unique index must scope tenant and client')
  assert(sql.includes('and f.client_id=v_client and lower(f.name)=lower(v_name)'),path+' create duplicate check missing')
  assert(sql.includes('and f.id<>p_folder_id and lower(f.name)=lower(v_name)'),path+' rename duplicate check missing')
}
console.log('PASS: CAP/ordinary folder names, create/rename shared validator, control characters, and SQL tenant/client uniqueness')
