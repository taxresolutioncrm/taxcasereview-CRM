// Read-only, externally executed live portfolio audit. No site writes or credentials.
import fs from 'node:fs'
const sites=[
  ['PoolVerge','poolverge.com','G-RPM6TKRCW5','z31rnrvbns'],
  ['TaxRes','taxrescrm.net','G-M6J80B65LG','xyck7g2mfl'],
  ['Oculivo','oculivo.com','G-WR6GGVYLXX','yguz2tkhnt'],
  ['Groundivo','groundivo.com','G-BBHLF92295','ygv0xf8tea'],
  ['Restore Relay','restorerelay.com','G-SB2HLZHTPS','ygv6hce600'],
  ['BocaSync','bocasync.com','G-1K0FEZF916','yguw0uq4km'],
  ['RomyLabs','romylabs.com','G-2MSNYF9XBE','y54zqoj6c2'],
  ['Arcvena','arcvena.com',null,'y6ou1vr1q0'],
  ['Camvella','camvella.com','G-H1ZPCP2EE9','y62zna7yna'],
  ['SettleLift','settlelift.com',null,null],
  ['ChairStyle','chairstyle.net',null,null],
  ['Lakeside Pools','lakesidepoolsfl.com',null,null],
]
const limitedFetch=async(url)=>{
  let last=''
  for(let attempt=0;attempt<2;attempt++){
    try{
      const r=await fetch(url,{redirect:'follow',headers:{'User-Agent':'RomyLabs-Site-QA/1.0 (+public read-only website audit)','Accept':'text/html,application/xml,text/plain,*/*'},signal:AbortSignal.timeout(12500)})
      const body=(await r.text()).slice(0,250000)
      return {status:r.status,url:r.url,body,contentType:r.headers.get('content-type')||'',error:''}
    }catch(e){last=String(e?.message||e)}
  }
  return {status:0,url,body:'',contentType:'',error:last}
}
const find=(s,rx)=>s.match(rx)?.[1]?.trim()||''
const count=(s,rx)=>(s.match(rx)||[]).length
const parseMeta=(s)=>{
  const title=find(s,/<title[^>]*>([\s\S]*?)<\/title>/i).replace(/\s+/g,' ')
  const description=find(s,/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)/i)
    ||find(s,/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i)
  const canonical=find(s,/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i)
    ||find(s,/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)
  const robots=find(s,/<meta[^>]*name=["']robots["'][^>]*content=["']([^"']+)/i)
  return {title,description,canonical,robots,h1:count(s,/<h1\b/gi),jsonLD:count(s,/type=["']application\/ld\+json["']/gi)}
}
async function check([name,domain,ga4,clarity]){
  const root='https://'+domain
  const [home,robots,sitemap]=await Promise.all([
    limitedFetch(root+'/'),limitedFetch(root+'/robots.txt'),limitedFetch(root+'/sitemap.xml')
  ])
  const meta=parseMeta(home.body)
  const robotRules=robots.body.split(/\r?\n/).map(line=>line.trim()).filter(line=>/^(user-agent|allow|disallow|sitemap):/i.test(line)).slice(0,35)
  const headScripts=[...home.body.matchAll(/<script[^>]*>/gi)].map(m=>m[0]).filter(x=>/clarity|googletagmanager|analytics|config/i.test(x)).slice(0,8)
  let code=home.body
  const external=[...home.body.matchAll(/<script[^>]+src=["']([^"']+\.js(?:\?[^"']*)?)["']/gi)].map(m=>m[1])
    .filter(x=>x.includes('analytics')||x.includes('tracking')).slice(0,2)
  for(const path of external){
    try{const u=new URL(path,root);if(u.host===domain||u.host==='www.'+domain){code+=' '+(await limitedFetch(u.href)).body}}catch{}
  }
  const issues=[],notes=[]
  if(home.status!==200)issues.push('Homepage HTTP '+home.status+(home.error?' ('+home.error+')':''))
  if(robots.status!==200)issues.push('robots.txt HTTP '+robots.status)
  if(sitemap.status!==200)issues.push('sitemap.xml HTTP '+sitemap.status)
  if(home.status===200){
    if(!meta.title)issues.push('Homepage title missing')
    if(!meta.description)issues.push('Homepage meta description missing')
    if(meta.h1!==1)issues.push('Homepage H1 count '+meta.h1)
    if(!meta.canonical)issues.push('Homepage canonical missing')
    else {
      try{const p=new URL(meta.canonical);if(p.hostname!==domain||!['','/'].includes(p.pathname))issues.push('Homepage canonical unexpected '+meta.canonical)}
      catch{issues.push('Invalid homepage canonical')}
    }
    if(/\bnoindex\b/i.test(meta.robots))issues.push('Homepage meta noindex')
    if(!meta.jsonLD)notes.push('No JSON-LD visible in raw HTML (may be injected later)')
  }
  if(robots.status===200){
    if(/(?:^|\n)\s*Disallow:\s*\/\s*(?:\n|$)/im.test(robots.body))issues.push('robots.txt disallows entire site')
    if(!/sitemap\s*:/i.test(robots.body))notes.push('robots.txt has no sitemap directive')
  }
  if(sitemap.status===200){
    if(!/<(?:urlset|sitemapindex)\b/i.test(sitemap.body))issues.push('Sitemap is not XML urlset or sitemapindex')
    if(!sitemap.body.includes(domain))issues.push('Sitemap appears to reference another domain')
  }
  if(ga4&&!code.includes(ga4))issues.push('Expected GA4 measurement ID absent in homepage and local analytics JS: '+ga4)
  if(clarity&&!code.includes(clarity))issues.push('Expected Clarity ID absent in homepage and local analytics JS: '+clarity)
  const ids=[...new Set(code.match(/G-[A-Z0-9]{7,}/g)||[])]
  const clids=[...new Set((code.match(/(?:yg|y6|z3|xy)[a-z0-9]{8,}/gi)||[]).filter(x=>x.length<=12))]
  if(ga4&&ids.some(x=>x!==ga4))issues.push('Unexpected extra GA4 ID(s): '+ids.filter(x=>x!==ga4).join(','))
  const gaLoaderCount=count(home.body,/googletagmanager\.com\/gtag\/js\?id=/gi)
  const clarityLoaderCount=count(home.body,/clarity\.ms\/tag\//gi)
  if(gaLoaderCount>1)issues.push('Multiple direct GA4 loaders: '+gaLoaderCount)
  if(clarityLoaderCount>1)issues.push('Multiple direct Clarity loaders: '+clarityLoaderCount)
  if(!ga4)notes.push('Central GA4 measurement ID not established for comparison')
  if(!clarity)notes.push('Central Clarity project ID not established for comparison')
  if(home.status===200&&home.url!==root+'/'&&home.url!==root)notes.push('Homepage redirected to '+home.url)
  return {name,domain,homepageStatus:home.status,robotsStatus:robots.status,sitemapStatus:sitemap.status,meta,robotRules,headScripts,gaIds:ids,clarityIds:clids,gaLoaderCount,clarityLoaderCount,issues,notes}
}
const results=[]
let cursor=0
async function worker(){while(cursor<sites.length){const row=sites[cursor++];results.push(await check(row))}}
await Promise.all(Array.from({length:3},()=>worker()))
results.sort((a,b)=>sites.findIndex(x=>x[0]===a.name)-sites.findIndex(x=>x[0]===b.name))
const report=['# RomyLabs live-site portfolio SEO and analytics audit','','Generated '+new Date().toISOString(),'Read-only HTTP verification. A PASS does not establish Google indexing or Cloudflare deployment identity.','','| Site | Home | Robots | Sitemap | Issues |','|---|---:|---:|---:|---|']
for(const row of results)report.push('| '+row.name+' | '+row.homepageStatus+' | '+row.robotsStatus+' | '+row.sitemapStatus+' | '+(row.issues.length?row.issues.join('; ').replaceAll('|','/'): 'None detected')+' |')
for(const row of results)report.push('\n## '+row.name+'\n\nDomain: '+row.domain+'\n\nTitle: '+row.meta.title+'\n\nCanonical: '+row.meta.canonical+'\n\n'+(row.issues.length?'**Issues:** '+row.issues.join('; '):'**Issues:** None detected')+'\n\nNotes: '+row.notes.join('; '))
fs.mkdirSync('portfolio-audit',{recursive:true})
fs.writeFileSync('portfolio-audit/live-seo.json',JSON.stringify({generatedAt:new Date().toISOString(),results},null,2))
fs.writeFileSync('portfolio-audit/live-seo.md',report.join('\n')+'\n')
console.log(report.slice(0,7+results.length).join('\n'))
for(const row of results)console.log('LIVE_DIAGNOSTIC '+JSON.stringify({name:row.name,robotRules:row.robotRules,scripts:row.headScripts,canonical:row.meta.canonical,h1:row.meta.h1}))
console.log('LIVE_AUDIT_SUMMARY '+JSON.stringify({count:results.length,issueSites:results.filter(x=>x.issues.length).map(x=>x.name),cleanSites:results.filter(x=>!x.issues.length).map(x=>x.name)}))
if(results.some(x=>x.issues.length))process.exitCode=1
