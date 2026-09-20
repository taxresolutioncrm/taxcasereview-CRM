import fs from 'node:fs'
import { transformWithEsbuild } from 'vite'

const targets=[
  ['src/lib/transcriptPull.js','js'],
  ['src/components/TranscriptPull.jsx','jsx'],
  ['src/components/TDSSessionPresence.jsx','jsx'],
  ['src/pages/IRSPortal.jsx','jsx'],
  ['supabase/functions/transcript-pull/index.ts','ts'],
  ['supabase/functions/transcript-pull-callback/index.ts','ts'],
]
const failures=[]
for(const [file,loader] of targets){
  try{
    const code=fs.readFileSync(file,'utf8')
    await transformWithEsbuild(code,file,{loader,target:'es2020'})
  }catch(e){
    failures.push(`${file}: ${e?.message||e}`)
  }
}
if(failures.length){
  console.error('TaxRes transcript syntax failures:')
  failures.forEach(x=>console.error(' - '+x))
  process.exit(1)
}
console.log('✅ TaxRes transcript JS/JSX/TS syntax passed')
