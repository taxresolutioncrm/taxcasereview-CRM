#!/usr/bin/env node
/**
 * Karbon -> TaxRes read-only preflight. NEVER connects to Supabase or Karbon;
 * NEVER writes client data, creates accounts, sends messages or modifies an office.
 * Input consists of operator-authorized JSON/CSV exports saved locally.
 * Output is an aggregate reconciliation report without names, emails or record bodies.
 *
 * Usage:
 * node tools/karbon-migration/preflight.mjs --input /secure/export \
 *   --employee-map /secure/approved-employee-map.json \
 *   --tenant 11111111-1111-4111-8111-111111111111 --out /secure/preflight-report.json
 */
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs'
import {resolve,join,dirname,extname} from 'node:path'
import {createHash} from 'node:crypto'
const expected=['contacts','work-items','notes','documents','communications']
const idKeys={
 contacts:['ContactKey','OrganizationKey','ClientGroupKey','ResourcePermaKey','contact_key','id'],
 'work-items':['WorkItemKey','ResourcePermaKey','work_item_key','id'],
 notes:['NoteKey','ResourcePermaKey','note_key','id'],
 documents:['DocumentKey','FileKey','storage_path','id'],
 communications:['CommunicationKey','EmailKey','MessageId','id'],
}
const first=(record,keys)=>keys.map(key=>record?.[key]).find(v=>v!==null&&v!==undefined&&String(v).trim()!=='')
const str=v=>String(v??'').trim()
const normalizeEmail=v=>str(v).toLowerCase()
const hash=s=>createHash('sha256').update(s).digest('hex')
function csvParse(s){
 s=s.replace(/^\uFEFF/,'')
 const rows=[];let row=[],cell='',quoted=false
 for(let i=0;i<s.length;i++){
  const c=s[i];if(quoted){if(c==='"'&&s[i+1]==='"'){cell+='"';i++}else if(c==='"')quoted=false;else cell+=c}
  else if(c==='"')quoted=true
  else if(c===','){row.push(cell);cell=''}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&s[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell=''}
  else cell+=c
 }
 if(quoted)throw Error('Invalid CSV: unterminated quoted field')
 row.push(cell);if(row.some(v=>v!==''))rows.push(row)
 if(!rows.length)return []
 const headers=rows.shift().map(s=>s.trim())
 if(new Set(headers).size!==headers.length)throw Error('CSV contains duplicate column headers')
 return rows.map((values,i)=>{
  if(values.length!==headers.length)throw Error('CSV row '+(i+2)+' has different column count')
  return Object.fromEntries(headers.map((h,j)=>[h,values[j]]))
 })
}
function load(dir,name){
 for(const ext of ['.json','.csv']){
  const path=join(dir,name+ext)
  if(!existsSync(path))continue
  const raw=readFileSync(path,'utf8')
  if(ext==='.csv')return {rows:csvParse(raw),format:'CSV'}
  const data=JSON.parse(raw)
  // Accept JSON-array or OData paging export that was already fully collected.
  const rows=Array.isArray(data)?data:Array.isArray(data?.value)?data.value:Array.isArray(data?.items)?data.items:null
  if(!rows)throw Error(name+': expected JSON array or value/items array')
  return {rows,format:'JSON'}
 }
 return {rows:[],format:'MISSING'}
}
function argsFrom(argv){
 const args={}
 for(let i=0;i<argv.length;i+=2){if(!argv[i]?.startsWith('--')||argv[i+1]===undefined)throw Error('Arguments must be --name value');args[argv[i].slice(2)]=argv[i+1]}
 if(!args.input||!args.tenant||!args['employee-map']||!args.out)throw Error('Required: --input --employee-map --tenant --out')
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(args.tenant))throw Error('Invalid target tenant UUID')
 return args
}
function preflight(a){
 const input=resolve(a.input),mapPath=resolve(a['employee-map']),out=resolve(a.out)
 if(out===mapPath||out.startsWith(input+'/'))throw Error('Report must be outside source export directory')
 const mapping=JSON.parse(readFileSync(mapPath,'utf8'))
 // No credentials, auth-user replacement or user creation in this file.
 if(mapping.tenant_id!==a.tenant||typeof mapping.employees!=='object'||!mapping.employees||Array.isArray(mapping.employees))throw Error('Employee approval mapping must match target tenant')
 const approved=new Set(Object.keys(mapping.employees).map(normalizeEmail))
 const badMappings=Object.entries(mapping.employees).filter(([email,id])=>!email.includes('@')||!/^[0-9a-f-]{36}$/i.test(str(id)))
 if(badMappings.length)throw Error('Employee mapping contains invalid identities')
 const data=Object.fromEntries(expected.map(k=>[k,load(input,k)]))
 const blockers=[],warnings=[],sets={}
 for(const type of expected){
  const {rows,format}=data[type]
  if(format==='MISSING')warnings.push(type+': no source export supplied; completeness cannot be certified')
  const keys=new Set()
  rows.forEach((r,index)=>{
   if(!r||typeof r!=='object'||Array.isArray(r)){blockers.push(type+': row '+(index+1)+' is not an object');return}
   const key=str(first(r,idKeys[type]))
   if(!key){blockers.push(type+': missing stable source key at row '+(index+1));return}
   if(keys.has(key))blockers.push(type+': duplicate source key at row '+(index+1))
   keys.add(key)
  })
  sets[type]=keys
 }
 const people=sets.contacts,work=sets['work-items']
 let unresolvedClients=0,unresolvedWork=0,unresolvedAssignees=0,filesMissing=0,missingDocumentHashes=0
 for(const [index,w] of data['work-items'].rows.entries()){
  const client=str(first(w,['ClientKey','ContactKey','OrganizationKey','client_key','contact_key']))
  if(client&&!people.has(client)){unresolvedClients++;blockers.push('work-items: missing client linkage at row '+(index+1))}
  const email=normalizeEmail(first(w,['AssigneeEmailAddress','assignee_email','assigneeEmail']))
  if(email&&!approved.has(email)){unresolvedAssignees++;blockers.push('work-items: unapproved assignee mapping at row '+(index+1))}
 }
 for(const type of ['notes','documents','communications']){
  for(const [index,r] of data[type].rows.entries()){
   const contact=str(first(r,['ContactKey','ClientKey','contact_key','client_key']))
   const item=str(first(r,['WorkItemKey','work_item_key']))
   if(contact&&!people.has(contact)){unresolvedClients++;blockers.push(type+': missing client linkage at row '+(index+1))}
   if(item&&!work.has(item)){unresolvedWork++;blockers.push(type+': missing work-item linkage at row '+(index+1))}
   if(type==='documents'){
    const file=str(first(r,['relative_path','RelativePath','local_path']))
    if(!file){filesMissing++;warnings.push('documents: row '+(index+1)+' has no local file path to verify')}
    else {
     const absolute=resolve(input,file)
     if(!absolute.startsWith(input+'/')||!existsSync(absolute)){filesMissing++;blockers.push('documents: missing or unsafe local file at row '+(index+1))}
     else{
      const desired=str(first(r,['sha256','SHA256']))
      if(!desired)missingDocumentHashes++
      else if(!/^[0-9a-f]{64}$/i.test(desired)||hash(readFileSync(absolute))!==desired.toLowerCase())blockers.push('documents: checksum mismatch at row '+(index+1))
     }
    }
   }
  }
 }
 if(data.communications.format==='MISSING')warnings.push('Communication history unverified: do not claim email/SMS preservation')
 if(data.documents.format==='MISSING')warnings.push('Document bytes unverified: a record-only export is not a migration')
 if(!data.contacts.rows.length)blockers.push('No contacts: cannot approve even a pilot mapping')
 if(!data['work-items'].rows.length)warnings.push('No work items: verify whether export scope omitted active tasks')
 const allKeys=expected.map(type=>[type,[...sets[type]].sort()])
 const report={
  schema_version:1,source:'Karbon authorized export',mode:'READ_ONLY_PREFLIGHT',production_cutover_authorized:false,
  tenant_fingerprint:hash(a.tenant).slice(0,16),generated_at:new Date().toISOString(),
  datasets:Object.fromEntries(expected.map(type=>[type,{count:data[type].rows.length,source_format:data[type].format,unique_source_keys:sets[type].size}])),
  reconciliation:{unresolved_client_links:unresolvedClients,unresolved_work_links:unresolvedWork,unapproved_assignees:unresolvedAssignees,documents_without_verified_file:filesMissing,documents_without_provided_sha256:missingDocumentHashes,approved_employee_mapping_count:approved.size},
  source_key_fingerprint:hash(JSON.stringify(allKeys)),blocking_issue_count:blockers.length,
  blockers,warnings,decision:blockers.length?'BLOCKED':'READY_FOR_SANDBOX_REVIEW',
  required_next_gates:['Confirm source export scope and completeness','Approve employee mapping against existing TaxRes Auth IDs and profiles','Sandbox import with triggers and outbound communications disabled','Reconcile record counts and relationships with source','Signed authorization and restore-tested rollback before any production cutover']
 }
 mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n',{mode:0o600})
 return report
}
try{
 const a=argsFrom(process.argv.slice(2));const report=preflight(a)
 console.log(JSON.stringify({decision:report.decision,counts:report.datasets,blocking_issue_count:report.blocking_issue_count,warnings:report.warnings.length,report:a.out}))
 if(report.blocking_issue_count)process.exitCode=2
}catch(e){console.error('PREFLIGHT FAILED: '+e.message);process.exitCode=1}
