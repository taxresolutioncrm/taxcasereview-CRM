import fs from 'node:fs'

const src=fs.readFileSync('src/lib/transcriptPull.js','utf8')
const start=src.indexOf('export function parseYearSpec')
const end=src.indexOf('export function nameKey')
if(start<0||end<0||end<=start) throw new Error('Could not isolate transcript coverage helpers')
const pure=src.slice(start,end).replace(/export /g,'')
const { parseYearSpec, requestCoverageSatisfied }=(new Function(pure+';return {parseYearSpec,requestCoverageSatisfied};'))()

const failures=[]
const ok=(label,v)=>{if(!v)failures.push(label)}

const req={tax_years:'2021-2022',transcript_types:['Account Transcript','Wage and Income']}
ok('complete requested year/type matrix',requestCoverageSatisfied(req,[
  {tax_year:'2021',transcript_type:'Account Transcript'},
  {tax_year:'2021',transcript_type:'Wage & Income'},
  {tax_year:'2022',transcript_type:'Account Transcript'},
  {tax_year:'2022',transcript_type:'Wage and Income'},
]))
ok('missing type does not falsely complete',!requestCoverageSatisfied(req,[
  {tax_year:'2021',transcript_type:'Account Transcript'},
  {tax_year:'2022',transcript_type:'Account Transcript'},
]))
ok('year range expansion',JSON.stringify([...parseYearSpec('2019-2021, 2023')])===JSON.stringify(['2019','2020','2021','2023']))
ok('Tax Return alias',requestCoverageSatisfied(
  {tax_years:'2024',transcript_types:['Return Transcript']},
  [{tax_year:'2024',transcript_type:'Tax Return Transcript'}],
))

if(failures.length){
  console.error('Transcript coverage fixture failures:')
  failures.forEach(x=>console.error(' - '+x))
  process.exit(1)
}
console.log('✅ Transcript coverage fixtures passed')
