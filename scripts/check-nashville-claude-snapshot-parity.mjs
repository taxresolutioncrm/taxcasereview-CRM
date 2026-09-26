import fs from 'node:fs'

const failures=[]
const read=p=>fs.readFileSync(p,'utf8')
const same=(a,b,label)=>{ if(read(a)!==read(b)) failures.push(label+' differs') }
const need=(p,s,label)=>{ if(!read(p).includes(s)) failures.push(label+' missing') }

same('src/components/TDSSessionPresence.jsx','validation/nashville-claude/src/components/TDSSessionPresence.jsx','TDSSessionPresence')
same('src/components/TranscriptPull.jsx','validation/nashville-claude/src/components/TranscriptPull.jsx','TranscriptPull')
same('src/lib/transcriptPull.js','validation/nashville-claude/src/lib/transcriptPull.js','transcriptPull')
same('src/pages/IRSPortal.jsx','validation/nashville-claude/src/pages/IRSPortal.jsx','IRSPortal')
same('supabase/functions/transcript-pull/index.ts','validation/nashville-claude/supabase/functions/transcript-pull/index.ts','transcript-pull edge')

need('validation/nashville-claude/supabase/functions/transcript-pull-callback/index.ts',"https://nashville.taxrescrm.app",'Nashville callback origin')
need('validation/nashville-claude/supabase/functions/transcript-pull/index.ts',"IRS_TDS_STUB_MODE",'Nashville Claude stub mode')
need('validation/nashville-claude/src/components/TDSSessionPresence.jsx',"taxres-irs-tds-oauth",'Nashville OAuth callback event')
need('validation/nashville-claude/src/components/TranscriptPull.jsx',"provider: 'irs_a2a'",'Nashville direct provider')
need('validation/nashville-claude/src/components/TranscriptPull.jsx',"Request Transcripts",'Nashville transcript CTA')
need('validation/nashville-claude/src/lib/transcriptPull.js',"storeTranscriptAnalysis",'Nashville auto-file path')

if(failures.length){
 console.error('Nashville Claude snapshot parity failures:')
 failures.forEach(x=>console.error(' - '+x))
 process.exit(1)
}
console.log('PASS: Nashville Claude TDS core is byte-identical to the browser-verified shared flow, with Nashville callback origin preserved')
