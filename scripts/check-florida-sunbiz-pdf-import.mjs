import assert from 'node:assert/strict'
import { parseFloridaSunbizText } from '../src/lib/flSunbizPdfImport.js'

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
console.log('PASS Florida Sunbiz PDF name and filing metadata checks')
