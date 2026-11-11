import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source=readFileSync(new URL('../src/pages/IrsForms.jsx',import.meta.url),'utf8')
const form4506=/\{\s*num:\s*'4506',\s*label:\s*'Request for Copy of Tax Return',\s*url:\s*'https:\/\/www\.irs\.gov\/pub\/irs-pdf\/f4506\.pdf',\s*blankOnly:\s*true\s*\}/
assert(form4506.test(source),'Official Form 4506 must use PDF-only XFA route')
assert.equal((source.match(/num:\s*'4506'/g)||[]).length,1,'Duplicate Form 4506 catalog item')
assert.equal((source.match(/num:\s*'4506-T'/g)||[]).length,1,'4506-T transcript must remain separate')
assert(source.includes("num: '4506-T', label: 'Request for Transcript'"),'Transcript catalog label was changed')
assert(source.includes("formType: '4506t'"),'Existing 4506-T prefill was removed')
assert(source.includes("disabled={!selectedClientId || !!f.blankOnly}"),'XFA prefill button must be disabled')
assert(source.includes("if (!c || f.blankOnly) return"),'XFA generic fallback must be blocked')
assert(source.includes("f.blankOnly ? 'Official PDF only' : '✏️ Pre-fill'"),'Unsupported XFA UI guidance missing')
assert(source.includes("'911', '4506', '4506-T'"),'Form 4506 must be in the tracking dropdown')
assert(source.includes("setFaxForm({clientId:c.id,clientName:c.name,subject:'IRS Form '+f.num"),'Existing fax workflow changed')
assert(source.includes("href={f.url}"),'Official PDF link removed')
console.log('PASS shared IRS Form 4506 official PDF, XFA guard, tracker, fax and 4506-T parity')
