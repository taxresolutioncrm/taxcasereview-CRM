#!/usr/bin/env node
/**
 * Build a PRIVATE, deterministic, LOCAL staging packet after a passing preflight.
 * Does not call Karbon, Supabase, Stripe, mail, SMS, or any external service.
 * It cannot create users, alter employee profiles, or deploy to production.
 * Supports complete JSON-array/OData authorized export sets only. CSV can be
 * validated with preflight, then normalized to JSON before staging.
 */
import {readFileSync,writeFileSync,existsSync,mkdirSync,mkdtempSync,rmSync,statSync} from 'node:fs'
import {resolve,join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
const sha=value=>createHash('sha256').update(value).digest('hex')
const types=['contacts','work-items','notes','documents','communications']
const keys={
 contacts:['ContactKey','OrganizationKey','ClientGroupKey','ResourcePermaKey','contact_key','id'],
 'work-items':['WorkItemKey','ResourcePermaKey','work_item_key','id'],
 notes:['NoteKey','ResourcePermaKey','note_key','id'],
 documents:['DocumentKey','FileKey','storage_path','id'],
 communications:['CommunicationKey','EmailKey','MessageId','id']
}
const take=(r,fields)=>fields.map(k=>r?.[k]).find(v=>v!==undefined&&v!==null&&String(v).trim()!=='')
const str=v=>String(v??'').trim()
function args(argv){
 const x={};for(let i=0;i<argv.length;i+=2){if(!argv[i]?.startsWith('--')||argv[i+1]===undefined)throw Error('Invalid CLI flags');x[argv[i].slice(2)]=argv[i+1]}
 if(!x.input||!x.tenant||!x['employee-map']||!x.out)throw Error('Required --input --tenant --employee-map --out')
 return x
}
function readArray(file){
 const o=JSON.parse(readFileSync(file,'utf8'));const a=Array.isArray(o)?o:Array.isArray(o?.value)?o.value:o?.items
 if(!Array.isArray(a))throw Error('Expected full JSON array export at '+file)
 return a
}
function main(a){
 const dir=resolve(a.input),out=resolve(a.out),mapFile=resolve(a['employee-map'])
 if(out.startsWith(dir+'/')||out===mapFile)throw Error('Staging packet must be outside source exports and employee map')
 const workdir=mkdtempSync(join(tmpdir(),'karbon-stage-'))
 try{
  const preflightPath=join(workdir,'preflight.json')
  const run=spawnSync(process.execPath,[fileURLToPath(new URL('./preflight.mjs',import.meta.url)),'--input',dir,'--tenant',a.tenant,'--employee-map',mapFile,'--out',preflightPath],{encoding:'utf8'})
  if(run.status!==0)throw Error('Preflight BLOCKED: '+(run.stderr||run.stdout||'Review reconciliation findings').slice(0,400))
  const preflight=JSON.parse(readFileSync(preflightPath,'utf8'))
  if(preflight.decision!=='READY_FOR_SANDBOX_REVIEW'||preflight.blocking_issue_count)throw Error('Preflight did not pass')
  if(types.some(type=>preflight.datasets[type].source_format!=='JSON'))throw Error('Complete JSON export sets required; convert authorized CSV to JSON before staging')
  if(preflight.reconciliation.documents_without_verified_file||preflight.reconciliation.documents_without_provided_sha256)throw Error('Every document requires an existing relative_path and SHA-256 before staging')
  const employeeMap=JSON.parse(readFileSync(mapFile,'utf8'))
  const assignees=Object.fromEntries(Object.entries(employeeMap.employees).map(([email,id])=>[email.toLowerCase().trim(),id]))
  const records={}
  for(const type of types){
   const rows=readArray(join(dir,type+'.json'))
   records[type]=rows.map(r=>{
    const sourceKey=str(take(r,keys[type]))
    const root={source_system:'Karbon',source_key:sourceKey,target_tenant_id:a.tenant,original:r}
    if(type==='work-items'){
     const email=str(take(r,['AssigneeEmailAddress','assignee_email','assigneeEmail'])).toLowerCase()
     root.client_source_key=str(take(r,['ClientKey','ContactKey','OrganizationKey','client_key','contact_key']))||null
     root.existing_employee_profile_id=email?assignees[email]:null
    }
    if(type==='notes'||type==='communications'||type==='documents'){
     root.client_source_key=str(take(r,['ContactKey','ClientKey','contact_key','client_key']))||null
     root.work_source_key=str(take(r,['WorkItemKey','work_item_key']))||null
    }
    if(type==='documents'){
     const rel=str(take(r,['relative_path','RelativePath','local_path']))
     const file=resolve(dir,rel)
     if(!file.startsWith(dir+'/')||!existsSync(file)||!statSync(file).isFile())throw Error('Invalid document file path')
     const data=readFileSync(file)
     root.local_source_file=rel
     root.file_sha256=sha(data)
     root.file_bytes=data.length
     // Document contents never embedded in staging JSON; staging uploader must
     // copy and re-check each file in a nonproduction bucket at import time.
    }
    return root
   })
  }
  const packet={
   schema_version:1,kind:'KARBON_TO_TAXRES_STAGING_PACKET',
   mode:'LOCAL_ONLY_NONPRODUCTION',target_tenant_id:a.tenant,
   side_effects_enabled:false,may_create_auth_users:false,
   may_change_employee_permissions:false,may_send_communications:false,
   production_cutover_authorized:false,
   source_key_fingerprint:preflight.source_key_fingerprint,
   dataset_counts:Object.fromEntries(types.map(t=>[t,records[t].length])),
   records
  }
  const serialized=JSON.stringify(packet,null,2)+'\n'
  mkdirSync(dirname(out),{recursive:true})
  writeFileSync(out,serialized,{mode:0o600})
  console.log(JSON.stringify({mode:packet.mode,counts:packet.dataset_counts,packet_sha256:sha(serialized),output:out,production_cutover_authorized:false}))
 }finally{rmSync(workdir,{recursive:true,force:true})}
}
try{main(args(process.argv.slice(2)))}catch(e){console.error('STAGING REFUSED: '+e.message);process.exitCode=1}
