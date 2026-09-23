// Runtime (not string) check for the TDS edge functions.
//  1. Transpiles each function's TypeScript exactly once and compiles it with V8 — any
//     SyntaxError (e.g. an invalid regular-expression literal) fails the build here instead
//     of as "worker boot error" in Supabase.
//  2. Evaluates each module top-level with stubbed Deno/serve/supabase imports and
//     exercises the captured handler: OPTIONS preflight must return CORS headers.
//  3. Builds the CRM Live Test synthetic transcript PDF for every transcript type the UI
//     offers and runs it through the real pdf.js extraction + irsTranscriptParser, asserting
//     type and tax year are detected (the multi-year / multi-type completion depends on it).
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
  if (typeof pull.exports.buildLiveTestTranscriptPdf !== 'function') fail('transcript-pull: buildLiveTestTranscriptPdf export missing')
}
if (callback) {
  const p = await callback.handler(new Request('https://project.supabase.co/functions/v1/transcript-pull-callback', { method: 'POST' }))
  if (p.status !== 405) fail(`transcript-pull-callback: POST should be 405, got ${p.status}`)
  const g = await callback.handler(new Request('https://project.supabase.co/functions/v1/transcript-pull-callback?state=x&code=y'))
  const html = await g.text()
  if (!(g.headers.get('content-type') || '').includes('text/html') || !html.includes('taxres-irs-tds-oauth')) fail('transcript-pull-callback: GET did not return the postMessage HTML page')
}

if (pull?.exports.buildLiveTestTranscriptPdf) {
  // Real browser-side extraction + parser, bundled for Node (pdf.js legacy build).
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
  // Structural PDF validity — pdf.js silently recovers from broken structure, so assert it directly.
  const sample = Buffer.from(pull.exports.buildLiveTestTranscriptPdf('123456789', '2023', 'Account Transcript')).toString('latin1')
  if (!sample.startsWith('%PDF-1.4\n')) fail('live-test PDF: header is not "%PDF-1.4" followed by a real newline')
  if (/\\[nr]/.test(sample)) fail('live-test PDF: contains literal "\\n"/"\\r" escape text (double-escaped source)')
  const sx = sample.match(/startxref\n(\d+)\n%%EOF\n$/)
  if (!sx || !sample.startsWith('xref\n0 6\n', Number(sx[1]))) fail('live-test PDF: startxref does not point at the xref table')
  else {
    const entries = sample.slice(Number(sx[1])).split('\n').slice(2, 8)
    entries.slice(1).forEach((e, i) => {
      const off = Number(e.slice(0, 10))
      if (!/^\d{10} 00000 n $/.test(e) || !sample.startsWith(`${i + 1} 0 obj`, off)) fail(`live-test PDF: xref entry ${i + 1} is wrong ("${e}")`)
    })
  }
  const origWarn = console.warn
  console.warn = (...a) => { if (!String(a[0]).startsWith('Warning:')) origWarn(...a) }   // pdf.js font/recovery notices
  for (const type of TYPES) {
    for (const year of ['2021', '2024']) {
      const bytes = pull.exports.buildLiveTestTranscriptPdf('123456789', year, type)
      try {
        const text = await extractPdfText(new File([bytes], 't.pdf', { type: 'application/pdf' }))
        if (!text || text.trim().length < 40) { fail(`live-test PDF (${type} ${year}): no text layer extracted`); continue }
        const a = parseIrsTranscript(text)
        if (a.transcript_type !== type) fail(`live-test PDF (${type} ${year}): parsed type "${a.transcript_type}"`)
        if (a.tax_year !== year) fail(`live-test PDF (${type} ${year}): parsed year "${a.tax_year}"`)
        if (a.account_balance !== 0) fail(`live-test PDF (${type} ${year}): parsed balance ${a.account_balance}`)
      } catch (e) {
        fail(`live-test PDF (${type} ${year}): pdf.js could not open it — ${e.message}`)
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
console.log('✅ TDS edge functions compile, boot, answer CORS preflight, and the live-test PDF parses for all 5 transcript types')
