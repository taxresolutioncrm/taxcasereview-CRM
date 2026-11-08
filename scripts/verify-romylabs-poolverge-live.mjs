const sites=[
 {url:'https://romylabs.com/',expected:'<strong>PoolVerge</strong><span>CRM Live →</span>',absent:'<strong>PoolVerge</strong><span>Website Live · CRM In Development →</span>'},
 {url:'https://romylabs.com/solutions/pool-service-crm/',expected:'PoolVerge — pool service CRM is live.',absent:'PoolVerge — website live, CRM in development.'},
 {url:'https://romylabs.com/products/',expected:'PoolVerge CRM is live; SettleLift and ChairStyle websites are live',absent:'All three newest websites are live while their CRMs are in development.'},
 {url:'https://romylabs.com/industries/',expected:'Live pool service CRM for recurring service plans',absent:'Website live; CRM in development for recurring service plans'},
 {url:'https://romylabs.com/product-sync.js',expected:"p.product_id==='pool_crm' ? 'Live'",absent:"['pool_crm','settlelift','barbers_salons'].includes(p.product_id) ? 'Website Live · CRM In Development'"},
 {url:'https://romylabs.com/llms.txt',expected:'PoolVerge (pool service CRM live)',absent:'PoolVerge (website live, CRM in development)'}
]
const out=await Promise.all(sites.map(async x=>{
 try{
  const r=await fetch(x.url+'?public_release_probe=20261107',{redirect:'follow',headers:{'Cache-Control':'no-cache','User-Agent':'RomyLabs-PoolVerge-Release-QA/1.0'},signal:AbortSignal.timeout(14000)})
  const s=await r.text(),ok=r.status===200&&s.includes(x.expected)&&!s.includes(x.absent)
  return {url:x.url,status:ok?'PASS':'FAIL',http:r.status,expectedFound:s.includes(x.expected),staleFound:s.includes(x.absent),chars:s.length}
 }catch(e){return {url:x.url,status:'ERROR',error:String(e)}}
}))
for(const x of out)console.log('POOLVERGE_RELEASE '+JSON.stringify(x))
console.log('POOLVERGE_SUMMARY '+JSON.stringify({checked:out.length,passed:out.filter(x=>x.status==='PASS').length}))
if(out.some(x=>x.status!=='PASS'))process.exitCode=1
