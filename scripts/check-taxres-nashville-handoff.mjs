import fs from 'node:fs'

const failures=[]
const read=p=>fs.readFileSync(p,'utf8')
const must=(ok,msg)=>{if(!ok) failures.push(msg)}
const has=(s,n,msg=n)=>must(s.includes(n),msg)
const no=(s,n,msg=n)=>must(!s.includes(n),msg)

const clients=read('src/pages/Clients.jsx')
const sensitive=read('supabase/functions/client-sensitive/index.ts')
const migration=read('supabase/migrations/20261022194000_taxres_client_document_security_handoff.sql')
const transcript=read('src/lib/transcriptPull.js')
const transcriptEdge=read('supabase/functions/transcript-pull/index.ts')
const portal=read('supabase/functions/portal-login/index.ts')
const irsPortal=read('src/pages/IRSPortal.jsx')
const stateForms=read('src/pages/StateForms.jsx')
const irsForms=read('src/pages/IrsForms.jsx')
const irsFiller=read('src/components/IRSFormFiller.jsx')
const pullUi=read('src/components/TranscriptPull.jsx')

// Bulk upload / folders
for(const n of [
  'type="file" multiple',
  'onDrop={e=>',
  "crypto.subtle.digest('SHA-256'",
  "eq('tenant_id',tenantId).eq('client_id',String(clientId))",
  ".eq('docType',form.docType).eq('file_hash',hash)",
  'original_file_name:selectedFile.name',
  'upload_batch_id:batchId',
  'setBatchProgress({done:i+1,total:files.length})',
  "status:'failed'",
  'DOC_FOLDERS.map',
]) has(clients,n,'Clients bulk upload missing: '+n)
has(migration,'documents_client_folder_hash_uidx','DB duplicate guard missing')
has(migration,"public.current_employee_permission('perm_documents') >= 2",'document write permission policy missing')
has(migration,"split_part(name,'/',1) = public.current_tenant_id()::text",'storage tenant prefix missing')
has(migration,'storage_object_belongs_to_current_tenant','legacy storage compatibility missing')

// Contact / office
for(const n of ['Copy Contact Info','Personal Address:','Business Address:','office_label','client_offices']) has(clients,n,'client contact/office missing: '+n)
has(clients,".update({office_label:next||null}).eq('tenant_id',myTenantId).eq('id',c.id)",'office label update must remain in current tenant')
no(clients,'.update({tenant_id:','office selection must never move tenant')

// SSN privacy
has(migration,'create table if not exists public.client_sensitive_fields','protected SSN store missing')
has(migration,'revoke all on public.client_sensitive_fields from public, anon, authenticated','protected SSN table not revoked')
has(migration,'new.ssn := null','ordinary client SSN must be erased')
has(sensitive,"Full SSN access requires Full Admin client permission",'profile full SSN server permission missing')
has(sensitive,"if(irsLevel<2 && level<3)",'IRS SSN operational permission missing')
has(sensitive,"'Cache-Control': 'no-store, max-age=0'",'sensitive endpoint no-store missing')
has(clients,"'ssn','spouseSsn','dependents'",'SSN fields must be excluded from audit diffs')
no(clients,"tags,ssn,archived",'client list must not request SSN')
has(portal,"from('client_sensitive_fields')",'portal login must use protected SSN')
has(irsFiller,'loadIrsSensitiveClient','IRS filler must use protected SSN')
has(irsForms,'loadIrsSensitiveClient','IRS forms must use protected SSN')
has(stateForms,'loadIrsSensitiveClient','state forms must use protected SSN')

// TDS/SOR approved browser/folder workflow
for(const n of [
  'showDirectoryPicker',
  'Connect Download Folder',
  'scanFolder(true)',
  'intakeReturnedPdf',
  'findFiledTranscriptBySha',
  'matchBrowserRequest',
  'fileBrowserTranscripts',
  'setUnmatched',
]) has(pullUi,n,'TDS folder workflow missing: '+n)
has(transcript,"action: 'tin_last4'",'TDS match must use protected TIN lookup')
has(transcript,"action: 'tin_candidates'",'TDS ambiguity check must stay server-side')
no(transcript,"ilike(col,","TDS browser must not scan SSNs from clients")
has(transcript,'findFiledTranscriptBySha','TDS duplicate gate missing')
has(transcript,'browserFilingQueue','TDS concurrent duplicate guard missing')
has(transcript,'needs-review-mismatch','TDS AI mismatch review route missing')
has(transcript,'tenantId}/transcripts/','browser transcript path must be tenant-prefixed')
has(transcriptEdge,'pull.tenant_id}/tds-direct/','direct TDS transcript path must be tenant-prefixed')
no(irsPortal,"select('id,name,ssn,dob,taxYears')",'IRS Portal must not load SSN in client list')

if(failures.length){
  console.error('TaxRes Nashville handoff regression failures:')
  failures.forEach(x=>console.error(' - '+x))
  process.exit(1)
}
console.log('✅ TaxRes Nashville handoff source/security regression passed')
