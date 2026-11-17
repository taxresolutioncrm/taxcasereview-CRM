import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const root=mkdtempSync(join(tmpdir(),'karbon-preflight-test-'))
const input=join(root,'source');mkdirSync(input)
const tenant='11111111-1111-4111-8111-111111111111'
const report=join(root,'report.json')
const mapping=join(root,'employees.json')
const cli=resolve('tools/karbon-migration/preflight.mjs')
const write=(name,value)=>writeFileSync(join(input,name+'.json'),JSON.stringify(value))
const doc='sample document bytes for migration integrity fixture'
const sha=createHash('sha256').update(doc).digest('hex')
writeFileSync(join(input,'sample.pdf'),doc)
writeFileSync(mapping,JSON.stringify({tenant_id:tenant,employees:{'person@example.test':'22222222-2222-4222-8222-222222222222'}}))
write('contacts',[{ContactKey:'contact-a',FirstName:'Demo',LastName:'Example',EmailAddress:'client@example.test'}])
write('work-items',[{WorkItemKey:'work-a',ClientKey:'contact-a',AssigneeEmailAddress:'person@example.test'}])
write('notes',[{NoteKey:'note-a',WorkItemKey:'work-a',Body:'Private source note'}])
write('documents',[{DocumentKey:'doc-a',ContactKey:'contact-a',relative_path:'sample.pdf',sha256:sha}])
write('communications',[{CommunicationKey:'email-a',ContactKey:'contact-a',Subject:'Confidential conversation'}])
const invoke=()=>spawnSync(process.execPath,[cli,'--input',input,'--tenant',tenant,'--employee-map',mapping,'--out',report],{encoding:'utf8'})
try{
 let run=invoke()
 assert.equal(run.status,0,'valid export should pass dry-run preflight '+run.stderr)
 let output=JSON.parse(readFileSync(report,'utf8'))
 assert.equal(output.decision,'READY_FOR_SANDBOX_REVIEW')
 assert.equal(output.production_cutover_authorized,false)
 assert.equal(output.datasets.contacts.count,1)
 assert.equal(output.reconciliation.unapproved_assignees,0)
 assert.ok(!readFileSync(report,'utf8').includes('client@example.test'),'report must never disclose exported emails')
 assert.ok(!readFileSync(report,'utf8').includes('Private source note'),'report must never disclose notes')
 assert.ok(!readFileSync(report,'utf8').includes('person@example.test'),'report must never disclose employee emails')
 write('work-items',[{WorkItemKey:'work-a',ClientKey:'contact-a',AssigneeEmailAddress:'other@example.test'}])
 run=invoke();assert.equal(run.status,2,'unapproved employee map must block')
 output=JSON.parse(readFileSync(report,'utf8'));assert.ok(output.blockers.some(s=>s.includes('unapproved assignee')))
 write('work-items',[{WorkItemKey:'work-a',ClientKey:'missing-contact',AssigneeEmailAddress:'person@example.test'}])
 run=invoke();assert.equal(run.status,2,'broken client link must block')
 write('work-items',[{WorkItemKey:'work-a',ClientKey:'contact-a',AssigneeEmailAddress:'person@example.test'}])
 write('contacts',[{ContactKey:'contact-a'},{ContactKey:'contact-a'}])
 run=invoke();assert.equal(run.status,2,'duplicates must block')
 write('contacts',[{ContactKey:'contact-a'}])
 write('documents',[{DocumentKey:'doc-a',relative_path:'../outside-secret',ContactKey:'contact-a'}])
 run=invoke();assert.equal(run.status,2,'unsafe document traversal must block')
 console.log('PASS: Karbon preflight read-only, identity-safe, duplicate-checked, tenant-guarded, with redacted report')
}finally{rmSync(root,{recursive:true,force:true})}
