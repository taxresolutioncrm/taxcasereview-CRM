const fs = require('fs')

const ui = fs.readFileSync('src/pages/PreparedFile.jsx','utf8')
const edge = fs.readFileSync('supabase/functions/document-intelligence/index.ts','utf8')
const parity = fs.readFileSync('src/lib/spanishUiParity.js','utf8')
const copilot = fs.readFileSync('src/components/AIAssistant.jsx','utf8')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

assert(ui.includes("getStoredLanguage"), 'AI Intelligence must read the canonical CRM language')
assert(ui.includes("taxres-language-change"), 'AI Intelligence must listen to the CRM language toggle')
assert(ui.includes("action:'translate_ai_text'"), 'AI Intelligence must request dynamic AI translation')
assert(ui.includes("language:'es'"), 'AI translation request must target Spanish')
assert(ui.includes("const aiText = value =>"), 'AI Intelligence must render through a translated-text helper')
assert(ui.includes("aiText(candidate.summary"), 'Resolution summaries must use translated rendering')
assert(ui.includes("aiText(candidate.practitioner_note)"), 'Practitioner notes must use translated rendering')
assert(ui.includes("aiText(action.text)"), 'Recommended AI actions must use translated rendering')
assert(ui.includes("aiText(askReply)"), 'Ask AI replies must use translated rendering')

assert(edge.includes("translate_ai_text"), 'document-intelligence must expose AI text translation')
assert(edge.includes("Translate each string in INPUT into"), 'AI translation must use an explicit translation-only prompt')
assert(edge.includes("Keep the same array length and order"), 'AI translation must preserve one-to-one mapping')
assert(edge.includes("sourceKey !== 'tcr'"), 'AI translation must remain central-TaxRes-only')


assert(copilot.includes("getStoredLanguage"), 'TaxRes AI copilot must read the canonical CRM language')
assert(copilot.includes("taxres-language-change"), 'TaxRes AI copilot must listen to the CRM language toggle')
assert(copilot.includes("const AI_ES ="), 'TaxRes AI copilot must have explicit Spanish UI parity')
assert(copilot.includes("¿Qué quieres resolver?"), 'TaxRes AI copilot welcome prompt must translate to Spanish')
assert(copilot.includes("¿Qué opciones de resolución funcionan mejor para este cliente?"), 'TaxRes AI copilot suggestions must translate to Spanish')
assert(copilot.includes("Pregunta a TaxRes AI…"), 'TaxRes AI copilot composer placeholder must translate to Spanish')
assert(copilot.includes("Contexto seguro de la oficina"), 'TaxRes AI copilot footer must translate to Spanish')
assert(copilot.includes("Responde completamente en español profesional."), 'TaxRes AI replies must be requested in Spanish while ES is active')

for (const label of ['AI Intelligence','Resolution Analysis','Strong candidate','Possible candidate','Missing information','Next steps','Practitioner review:']) {
  assert(parity.includes(`'${label}'`), `Spanish AI parity dictionary missing ${label}`)
}

if (failures.length) {
  console.error('AI Spanish parity guard FAILED:')
  for (const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('PASS  AI Intelligence Spanish parity guardrails')
