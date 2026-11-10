import assert from 'node:assert/strict'
import { parseFloridaSunbizText,normalizeFloridaFilingDate,planFloridaSunbizBusinessUpdate } from '../src/lib/flSunbizPdfImport.js'

const floridaPdf=`FLORIDA DEPARTMENT OF STATE
DIVISION OF CORPORATIONS
LIMITED LIABILITY COMPANY NAME: ABC Holdings, LLC
Document Number: L26000012345
Date Filed: 11/10/2026
`
const matched=parseFloridaSunbizText(floridaPdf,'ABC HOLDINGS L.L.C.')
assert.equal(matched.canVerify,true,'Florida named entity should match')
assert.equal(matched.companyName,'ABC Holdings, LLC')
assert.equal(matched.documentNumber,'L26000012345')
assert.equal(matched.filedDate,'11/10/2026')
assert.equal(parseFloridaSunbizText(floridaPdf,'Another Company, LLC').canVerify,false,'Mismatched company must be blocked')
assert.equal(parseFloridaSunbizText(floridaPdf.replace('FLORIDA DEPARTMENT OF STATE','UNVERIFIED').replace('DIVISION OF CORPORATIONS','UNVERIFIED'),'ABC Holdings, LLC').canVerify,false,'No government header must be blocked')
assert.equal(parseFloridaSunbizText('unreadable receipt','ABC Holdings, LLC').canVerify,false,'Unreadable or unlabeled PDF must be blocked')

const fullyLabeled=`FLORIDA DEPARTMENT OF STATE
DIVISION OF CORPORATIONS
ARTICLES OF ORGANIZATION
ENTITY NAME: ABC Holdings, LLC
PRINCIPAL OFFICE ADDRESS: 100 Main Street, Orlando, FL 32801
MAILING ADDRESS: PO Box 567, Orlando, FL 32802
REGISTERED AGENT NAME: Jane R Agent
REGISTERED AGENT ADDRESS: 150 Center Ave, Orlando, FL 32801
EFFECTIVE DATE: 11/15/2026
DOCUMENT NUMBER: L26000012345
DATE FILED: 11/10/2026
`
const parsed=parseFloridaSunbizText(fullyLabeled,'ABC Holdings, LLC')
assert.equal(parsed.canVerify,true)
assert.equal(parsed.entityType,'LLC')
assert.equal(parsed.principalAddress,'100 Main Street, Orlando, FL 32801')
assert.equal(parsed.mailingAddress,'PO Box 567, Orlando, FL 32802')
assert.equal(parsed.registeredAgent,'Jane R Agent')
assert.equal(parsed.registeredAgentAddress,'150 Center Ave, Orlando, FL 32801')
assert.equal(normalizeFloridaFilingDate('11/10/2026'),'2026-11-10')
assert.equal(normalizeFloridaFilingDate('02/30/2026'),'')
const planned=planFloridaSunbizBusinessUpdate(parsed,{
  entity_type:'LLC',registered_agent:'Original Agent',
  state_file_num:'',formation_date:'',
},'Filed Articles')
assert.equal(planned.patch.principal_address,'100 Main Street, Orlando, FL 32801')
assert.equal(planned.patch.state_file_num,'L26000012345')
assert.equal(planned.patch.formation_date,'2026-11-10')
assert.equal(planned.patch.effective_date,'2026-11-15')
assert.equal(planned.patch.registered_agent,undefined,'Existing agent must never be overwritten')
assert.equal(planned.conflicts.some(x=>x.field==='registered_agent'),true)
assert.deepEqual(planFloridaSunbizBusinessUpdate(parsed,{},'Payment Receipt'),{patch:{},conflicts:[]})
assert.throws(()=>planFloridaSunbizBusinessUpdate(parsed,{entity_type:'C-Corp'},'Filed Articles'),/entity type/)

console.log('PASS Florida Sunbiz PDF match, metadata, conflict and payment-receipt checks')
