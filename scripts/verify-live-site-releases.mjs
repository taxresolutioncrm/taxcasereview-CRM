import {createHash} from 'node:crypto'
const locations=[
  {id:'Groundivo tracking',url:'https://groundivo.com/analytics.js',expect:['ygv0xf8tea'],forbid:['yguz2tkhnt'],type:'javascript'},
  {id:'Groundivo search page',url:'https://groundivo.com/tree-service-crm/',expect:['Tree Service CRM for Tree Care Companies','TREE CARE CRM BUYER GUIDE'],type:'html'},
  {id:'TaxRes CRM metadata',url:'https://taxrescrm.net/tax-resolution-crm/',expect:['<meta property="og:url" content="https://taxrescrm.net/tax-resolution-crm/">','A CRM built specifically for tax resolution firms.'],forbid:['The only CRM built specifically for tax resolution firms.'],type:'html'},
  {id:'TaxRes software metadata',url:'https://taxrescrm.net/tax-resolution-software/',expect:['<meta property="og:url" content="https://taxrescrm.net/tax-resolution-software/">'],type:'html'},
  {id:'Camvella analytics',url:'https://camvella.com/',expect:['G-H1ZPCP2EE9','y62zna7yna'],type:'camvella'},
  {id:'PoolVerge SEO control',url:'https://poolverge.com/',expect:['G-RPM6TKRCW5','z31rnrvbns'],type:'html'},
]
async function inspect(item){
  const r=await fetch(item.url+'?release_verify=20261107',{redirect:'follow',signal:AbortSignal.timeout(18000),headers:{'Cache-Control':'no-cache','User-Agent':'RomyLabs-ReleaseVerification/1.0'}})
  const raw=await r.text()
  const missing=(item.expect||[]).filter(s=>!raw.includes(s))
  const forbidden=(item.forbid||[]).filter(s=>raw.includes(s))
  const stats={}
  if(item.type==='camvella'){
    const ga4=(raw.match(/<script\b[^>]*src=["'][^"']*googletagmanager\.com\/gtag\/js\?id=G-H1ZPCP2EE9[^"']*["'][^>]*>/gi)||[]).length
    const clarity=(raw.match(/clarity\.ms\/tag\//gi)||[]).length
    stats.ga4Loaders=ga4;stats.clarityInitializers=clarity
    if(ga4!==1)missing.push('exactly one executable GA4 loader (observed '+ga4+')')
    if(clarity!==1)missing.push('exactly one Clarity initializer (observed '+clarity+')')
  }
  let status=(r.status===200&&missing.length===0&&forbidden.length===0)?'PASS':'FAIL'
  return {id:item.id,url:item.url,status,http:r.status,finalUrl:r.url,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex').slice(0,16),missing,forbidden,...stats}
}
const output=await Promise.all(locations.map(x=>inspect(x).catch(e=>({id:x.id,url:x.url,status:'ERROR',message:String(e)}))))
for(const item of output)console.log('PRODUCTION_RELEASE_PROBE '+JSON.stringify(item))
const clean=output.filter(x=>x.status==='PASS').length
console.log('PRODUCTION_RELEASE_SUMMARY '+JSON.stringify({checked:output.length,passed:clean,failed:output.length-clean}))
if(clean!==output.length)process.exitCode=1
