import fs from 'node:fs'

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1 }
const need = (s,n,m) => { if (!s.includes(n)) fail(m || ('missing '+n)) }
const read = p => fs.readFileSync(p,'utf8')

for (const p of [
  'tools/irs-sor-bridge/manifest.json',
  'tools/irs-sor-bridge/irs-sor.js',
  'tools/irs-sor-bridge/crm-bridge.js',
  'src/components/TranscriptPull.jsx',
  'src/lib/transcriptPull.js',
  'src/lib/irsTranscriptParser.js',
]) if (!fs.existsSync(p)) fail('missing '+p)

if (!process.exitCode) {
  const manifest=read('tools/irs-sor-bridge/manifest.json')
  const irs=read('tools/irs-sor-bridge/irs-sor.js')
  const bridge=read('tools/irs-sor-bridge/crm-bridge.js')
  const ui=read('src/components/TranscriptPull.jsx')
  const lib=read('src/lib/transcriptPull.js')
  const parser=read('src/lib/irsTranscriptParser.js')

  need(manifest,'https://la.www4.irs.gov/*','SOR extension lacks IRS host permission')
  need(manifest,'https://*.taxrescrm.app/*','SOR extension lacks TaxRes family host permission')
  need(irs,"source: 'irs-sor'",'SOR capture payload missing source')
  need(irs,'tinLast4','SOR capture missing TIN last-4 metadata')
  need(irs,'taxYear','SOR capture missing tax-year metadata')
  need(irs,"contentEncoding = 'base64'",'binary PDF capture missing')
  need(irs,'response.arrayBuffer()','SOR PDF capture does not preserve binary bytes')
  need(bridge,'TAXRES_SOR_BRIDGE_READY','bridge ready event missing')
  need(bridge,'TAXRES_SOR_DELIVERY','bridge delivery event missing')
  need(bridge,'TAXRES_SOR_ACK','bridge acknowledgement handling missing')

  need(ui,"msg.source !== 'taxres-sor-bridge-extension'",'CRM does not authenticate bridge message source')
  need(ui,"msg.type !== 'TAXRES_SOR_DELIVERY'",'CRM does not receive SOR deliveries')
  need(ui,"type: 'TAXRES_SOR_ACK'",'CRM does not acknowledge filed SOR deliveries')
  need(ui,'tinLast4','CRM does not use SOR TIN metadata for client/request routing')
  need(ui,"delivery.contentEncoding === 'base64'",'CRM does not decode binary SOR deliveries')
  need(ui,'atob(content)','CRM base64 decode path missing')
  need(ui,'parseYearSpec(r.tax_years)','CRM does not use request-year coverage for SOR routing')
  need(ui,'SOR bridge connected','CRM does not expose bridge connection state')
  need(ui,'storeTranscriptAnalysis(file, exactReq.client_name','SOR delivery does not file through canonical transcript storage path')

  need(lib,"extractTranscriptText","transcript import path does not support SOR HTML")
  need(parser,'export async function extractHtmlText','HTML transcript extractor missing')
  need(parser,'export async function extractTranscriptText','generic transcript extractor missing')
}

if (process.exitCode) process.exit(process.exitCode)
console.log('PASS: IRS TDS/SOR browser handoff contract')
