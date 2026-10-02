import fs from 'node:fs'

const fn = fs.readFileSync('supabase/functions/parse-tax-doc/index.ts','utf8')
const ui = fs.readFileSync('src/components/TaxDocParser.jsx','utf8')
const fail = msg => { console.error('TAX DOC PARSER REGRESSION:', msg); process.exit(1) }

if (!fn.includes("model: 'openai/gpt-oss-120b'")) fail('parse-tax-doc is not using the supported Groq production model.')
if (fn.includes("model: 'llama-3.3-70b-versatile'")) fail('deprecated llama-3.3-70b-versatile returned.')
if (!fn.includes("response_format: { type: 'json_object' }")) fail('JSON object response mode is missing.')
if (!fn.includes("status: 200")) fail('provider failures must return structured JSON instead of a generic invoke failure.')
if (!ui.includes("if (fnData?.error)")) fail('UI no longer surfaces parser provider errors.')
if (ui.includes('Claude will read each document')) fail('stale parser-provider label returned.')

console.log('PASS: TaxRes-family tax document parser uses the supported model and structured error handling.')
