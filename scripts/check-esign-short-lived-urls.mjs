import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const signers=['src/lib/docUtils.js','src/pages/Leads.jsx','src/pages/Clients.jsx','src/pages/StateForms.jsx','src/components/IRSFormFiller.jsx']
let bounded=0
for(const path of signers){
 const src=readFileSync(path,'utf8')
 assert.ok(!src.includes('94608000'),'multi-year e-sign PDF links must not be produced from '+path)
 const refs=[...src.matchAll(/createSignedUrl\([^\n]*?,\s*([0-9]+)\)/g)]
 assert.ok(refs.length,'missing expected e-sign document signed URLs in '+path)
 for(const [,duration] of refs) {
  assert.ok(Number(duration)<=900,'e-sign temporary document links must expire in at most 15 minutes')
  bounded++
 }
}
const edge=readFileSync('supabase/functions/esign-archive-upload/index.ts','utf8')
const signPage=readFileSync('src/pages/SignPage.jsx','utf8')
assert.ok(edge.includes("if(action==='load')"),'signer token must authorize every attachment load')
assert.ok(edge.includes(".eq('signer_token',token)"),'signer authorization token must be checked')
assert.ok(edge.includes('createSignedUrl(p,900)'), 'signer must receive fresh short-lived document URLs')
assert.ok(signPage.includes("action:'load'")&&signPage.includes('signer_token:signerToken'), 'signer must refresh URL on entry')
console.log('PASS: '+bounded+' signed e-sign preview links expire within 15 minutes, signing refreshes them after checking signer token')
