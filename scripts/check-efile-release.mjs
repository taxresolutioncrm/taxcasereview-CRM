import fs from 'node:fs'

const failures=[]
const read=p=>fs.existsSync(p)?fs.readFileSync(p,'utf8'):''
const need=(p,n,label=n)=>{const s=read(p);if(!s)failures.push(p+': missing file');else if(!s.includes(n))failures.push(p+': '+label)}
const forbid=(p,n,label=n)=>{const s=read(p);if(s.includes(n))failures.push(p+': forbidden '+label)}

for(const n of [
  'E-file Federal Return',
  'Ready to File',
  'Save the return before e-filing',
  'E-file Return',
]) need('src/pages/TaxReturns.jsx',n,'e-file UI contract')

for(const n of [
  'EFILE_ADAPTER_URL',
  'EFILE_ADAPTER_TOKEN',
  'TRANSMITTER_NOT_CONFIGURED',
  'Your role does not have permission to e-file returns.',
  'acknowledgement_number',
  'efile_submission_id',
]) need('supabase/functions/submit-to-irs/index.ts',n,'e-file server contract')

forbid('supabase/functions/submit-to-irs/index.ts','MeFTransmitterService','fake direct MeF endpoint')
forbid('src/pages/TaxReturns.jsx','No third-party software needed','unsafe EFIN-only filing claim')
need('src/pages/Settings.jsx',"EFIN alone does not create a direct IRS connection.",'EFIN/transmitter guidance')
need('src/pages/Manual.jsx',"E-file through the configured transmitter",'manual e-file workflow')

if(failures.length){
  console.error('E-file release guard FAILED:')
  failures.forEach(x=>console.error(' - '+x))
  process.exit(1)
}
console.log('✅ E-file release guard passed')
