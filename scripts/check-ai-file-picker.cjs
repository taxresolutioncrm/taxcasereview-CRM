const fs = require('fs')

const prepared = fs.readFileSync('src/pages/PreparedFile.jsx','utf8')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

assert(prepared.includes('disabled={landingUploadBusy}'), 'AI landing file picker must remain usable before client selection')
assert(!prepared.includes('disabled={!selectedClientId || landingUploadBusy}'), 'AI landing file picker must not depend on client selection')
assert(prepared.includes('disabled={landingUploadBusy || !selectedClientId || !landingUploadFile}'), 'Upload & Analyze must require both selected client and file')
assert(prepared.includes("if (!selectedClientId) { setError('Select a client first.'); return }"), 'upload handler must enforce selected client')
assert(prepared.includes("if (!landingUploadFile) { setError('Choose a document to upload.'); return }"), 'upload handler must enforce selected file')
assert(prepared.includes("setSelectedClientId('');setClientSearch('');setClientSearchOpen(false)"), 'changing client must not clear the selected file')

if (failures.length) {
  console.error('AI landing file-picker guard FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('PASS  AI landing file-picker guardrails')
