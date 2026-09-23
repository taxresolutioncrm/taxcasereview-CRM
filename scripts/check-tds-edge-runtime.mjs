// Runtime (not string) check for the TDS edge functions.
//  1. Transpiles each function's TypeScript exactly once and compiles it with V8 — any
//     SyntaxError (e.g. an invalid regular-expression literal) fails the build here instead
//     of as "worker boot error" in Supabase.
//  2. Evaluates each module top-level with stubbed Deno/serve/supabase imports and
//     exercises the captured handler: OPTIONS preflight must return CORS headers.
//  3. Asserts the callback refuses to run while the real IRS flow is not verified.
//  4. Build-time fixture only (never shipped): a transcript-shaped PDF per transcript type is
//     run through the real pdf.js extraction + irsTranscriptParser so the delivery → auto-file
//     → Transcript Analysis pipeline is proven to read PDFs before every build.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transform, build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const fail = m => failures.push(m)

const FUNCTIONS = {
  pull: 'supabase/functions/transcript-pull/index.ts',
  callback: 'supabase/functions/transcript-pull-callback/index.ts',
}

async function loadEdgeModule(rel) {
  const file = path.join(root, rel)
  const src = fs.readFileSync(file, 'utf8')
  let code
  try {
    code = (await transform(src, { loader: 'ts', format: 'cjs', target: 'es2022', sourcefile: rel })).code
  } catch (e) { fail(`${rel}: TypeScript transpile failed: ${e.message}`); return null }
  let script
  try {
    script = new vm.Script(`(function (exports, require, module, Deno) {\n${code}\n})`, { filename: rel })
  } catch (e) { fail(`${rel}: would fail to boot — ${e.name}: ${e.message}`); return null }
  let handler = null
  const stubs = {
    'https://deno.land/std@0.168.0/http/server.ts': { serve: h => { handler = h } },
    'https://esm.sh/@supabase/supabase-js@2': { createClient: () => { throw new Error('createClient must not run at module load') } },
  }
  const req = id => { if (id in stubs) return stubs[id]; throw new Error(`${rel}: unexpected import ${id}`) }
  const Deno = { env: { get: () => undefined } }
  const module = { exports: {} }
  try {
    script.runInThisContext()(module.exports, req, module, Deno)
  } catch (e) { fail(`${rel}: module top-level threw at boot — ${e.name}: ${e.message}`); return null }
  if (typeof handler !== 'function') { fail(`${rel}: serve(handler) was not called at boot`); return null }
  return { handler, exports: module.exports }
}

const pull = await loadEdgeModule(FUNCTIONS.pull)
const callback = await loadEdgeModule(FUNCTIONS.callback)

if (pull) {
  const r = await pull.handler(new Request('https://project.supabase.co/functions/v1/transcript-pull', { method: 'OPTIONS' }))
  const allow = (r.headers.get('access-control-allow-headers') || '').toLowerCase()
  if (r.status !== 200) fail(`transcript-pull: OPTIONS returned ${r.status}`)
  if (r.headers.get('access-control-allow-origin') !== '*') fail('transcript-pull: OPTIONS missing Access-Control-Allow-Origin')
  for (const h of ['authorization', 'apikey', 'content-type', 'x-client-info']) if (!allow.includes(h)) fail(`transcript-pull: OPTIONS does not allow header ${h}`)
  const g = await pull.handler(new Request('https://project.supabase.co/functions/v1/transcript-pull', { method: 'GET' }))
  if (g.status !== 405) fail(`transcript-pull: GET should be 405, got ${g.status}`)
}
if (callback) {
  const p = await callback.handler(new Request('https://project.supabase.co/functions/v1/transcript-pull-callback', { method: 'POST' }))
  if (p.status !== 405) fail(`transcript-pull-callback: POST should be 405, got ${p.status}`)
  const g = await callback.handler(new Request('https://project.supabase.co/functions/v1/transcript-pull-callback?state=x&code=y'))
  const html = await g.text()
  if (!(g.headers.get('content-type') || '').includes('text/html') || !html.includes('taxres-irs-tds-oauth')) fail('transcript-pull-callback: GET did not return the postMessage HTML page')
  if (g.status !== 409) fail(`transcript-pull-callback: must refuse (409) while IRS_TDS_AUTH_FLOW_VERIFIED is unset, got ${g.status}`)
}

function fixturePdf(lines) {
  const esc = v => v.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  const stream = ['BT', '/F1 10 Tf', '72 720 Td', ...lines.flatMap((l, i) => i === 0 ? [`(${esc(l)}) Tj`] : ['0 -16 Td', `(${esc(l)}) Tj`]), 'ET'].join('\n')
  const objects = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n',
    `4 0 obj<</Length ${Buffer.byteLength(stream)}>>stream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n',
  ]
  let pdf = '%PDF-1.4\n'; const offsets = []
  for (const o of objects) { offsets.push(Buffer.byteLength(pdf)); pdf += o }
  const xref = Buffer.byteLength(pdf)
  pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')
  pdf += `trailer<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(pdf, 'latin1'))
}

{
  const legacy = path.join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')
  const worker = pathToFileURL(path.join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')).href
  const out = await build({
    entryPoints: [path.join(root, 'src/lib/irsTranscriptParser.js')], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    plugins: [{ name: 'node-pdfjs', setup(b) {
      b.onResolve({ filter: /^pdfjs-dist$/ }, () => ({ path: legacy, external: true }))
      b.onResolve({ filter: /\?url$/ }, () => ({ path: 'worker', namespace: 'pdfjs-worker' }))
      b.onLoad({ filter: /.*/, namespace: 'pdfjs-worker' }, () => ({ contents: `export default ${JSON.stringify(worker)}`, loader: 'js' }))
    } }],
  })
  const tmp = path.join(root, 'node_modules/.cache/check-tds-edge-runtime.parser.mjs')
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  fs.writeFileSync(tmp, out.outputFiles[0].text)
  const { extractPdfText, parseIrsTranscript } = await import(pathToFileURL(tmp).href)
  const TYPES = ['Account Transcript', 'Wage and Income', 'Record of Account', 'Return Transcript', 'Verification of Non-Filing']
  const origWarn = console.warn
  console.warn = (...a) => { if (!String(a[0]).startsWith('Warning:')) origWarn(...a) }
  for (const type of TYPES) {
    for (const year of ['2021', '2024']) {
      const bytes = fixturePdf([type.toUpperCase(), `TAX PERIOD: Dec. 31, ${year}`, 'ACCOUNT BALANCE: 0.00', 'ACCRUED PENALTY: 0.00', 'ACCRUED INTEREST: 0.00'])
      try {
        const text = await extractPdfText(new File([bytes], 't.pdf', { type: 'application/pdf' }))
        if (!text || text.trim().length < 40) { fail(`transcript PDF fixture (${type} ${year}): no text layer extracted`); continue }
        const a = parseIrsTranscript(text)
        if (a.transcript_type !== type) fail(`transcript PDF fixture (${type} ${year}): parsed type "${a.transcript_type}"`)
        if (a.tax_year !== year) fail(`transcript PDF fixture (${type} ${year}): parsed year "${a.tax_year}"`)
        if (a.account_balance !== 0) fail(`transcript PDF fixture (${type} ${year}): parsed balance ${a.account_balance}`)
      } catch (e) {
        fail(`transcript PDF fixture (${type} ${year}): pdf.js could not open it — ${e.message}`)
      }
    }
  }
  console.warn = origWarn
}

if (failures.length) {
  console.error('TDS edge runtime check failed:')
  failures.forEach(f => console.error(' - ' + f))
  process.exit(1)
}
console.log('✅ TDS edge functions compile, boot, answer CORS preflight, stay gated until IRS flow is verified; transcript PDF pipeline parses all 5 types')
