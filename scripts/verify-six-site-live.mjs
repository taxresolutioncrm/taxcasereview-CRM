// Public, read-only release proof for the six remaining RomyLabs websites.
const targets=[
 {name:'Arcvena',origin:'https://arcvena.com',page:'/pricing',clarity:'y6ou1vr1q0',ga:'',framework:'next'},
 {name:'BocaSync',origin:'https://bocasync.com',page:'/locations/',clarity:'yguw0uq4km',ga:'G-1K0FEZF916',framework:'static'},
 {name:'RomyLabs',origin:'https://romylabs.com',page:'/website-design-development/',clarity:'y54zqoj6c2',ga:'G-2MSNYF9XBE',framework:'astro'},
 {name:'Restore Relay',origin:'https://restorerelay.com',page:'/compare',clarity:'ygv6hce600',ga:'G-SB2HLZHTPS',framework:'react'},
 {name:'ChairStyle',origin:'https://chairstyle.net',page:'/pricing/',clarity:'',ga:'',framework:'static'},
 {name:'SettleLift',origin:'https://settlelift.com',page:'/features/intake-enrollment/',clarity:'',ga:'',framework:'static'}
]
const f=async(url,limit=2500000)=>{
 const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(16000),headers:{'User-Agent':'RomyLabs-Live-Release-QA/1.0','Cache-Control':'no-cache'}})
 return {status:r.status,url:r.url,body:(await r.text()).slice(0,limit),headers:r.headers}
}
const title=s=>s.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()||''
const canonical=s=>(s.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i)||s.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i))?.[1]||''
const out=await Promise.all(targets.map(async t=>{
 try{
 const [home,page,robots,rawSitemap]=await Promise.all([
 f(t.origin+'/?liveqa=20261107'),f(t.origin+t.page+'?liveqa=20261107'),
 f(t.origin+'/robots.txt?liveqa=20261107'),f(t.origin+'/sitemap.xml?liveqa=20261107')
 ])
 let sitemap=rawSitemap
 if(sitemap.status===404){
   const alt=await f(t.origin+'/sitemap-index.xml?liveqa=20261107')
   if(alt.status===200 && /<sitemapindex\b/i.test(alt.body))sitemap=alt
 }
 const errors=[],notes=[]
 for(const [kind,r] of [['home',home],['buyer page',page],['robots',robots],['sitemap',sitemap]])if(r.status!==200)errors.push(kind+' HTTP '+r.status)
 for(const [kind,r] of [['home',home],['buyer page',page]]){
  if(!title(r.body))errors.push(kind+' missing title')
  if(!canonical(r.body))errors.push(kind+' missing canonical')
  if(/<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(r.body))errors.push(kind+' noindex')
 }
 if(!/User-agent:\s*\*/i.test(robots.body)||!/Allow:\s*\//i.test(robots.body))notes.push('Review robots rules manually')
 if(!/<(urlset|sitemapindex)\b/i.test(sitemap.body))errors.push('invalid sitemap document')
 let inspect=home.body+' '+page.body
 const scripts=[...home.body.matchAll(/<script[^>]*src=["']([^"']+\.js(?:\?[^"']*)?)["']/gi)].map(m=>m[1]).filter(u=>u.startsWith('/')||u.includes(t.origin.slice(8))).slice(0,12)
 let checkedScripts=0
 if(t.framework==='react'||t.framework==='static'){
  for(const path of scripts){
   try{const u=new URL(path,t.origin);if(u.hostname!==new URL(t.origin).hostname)continue;const a=await f(u.href,4000000);if(a.status===200){inspect+=' '+a.body;checkedScripts++}}catch{}
  }
 }
 if(t.clarity&&!inspect.includes(t.clarity))errors.push('Clarity ID absent in served HTML/assets '+t.clarity)
 if(t.ga&&!inspect.includes(t.ga)){
  if(t.framework==='next')notes.push('GA4 configured at Cloudflare build time; not established from live HTML')
  else errors.push('GA4 measurement absent in served HTML/assets '+t.ga)
 }
 if(t.framework==='next'&&!inspect.includes('y6ou1vr1q0'))errors.push('Arcvena Clarity missing')
 if(t.framework==='react'&&!/<div[^>]*id=["']root["']/.test(home.body))notes.push('React root element not recognized')
 return {name:t.name,home:home.status,representativePage:page.status,pageUrl:t.origin+t.page,robots:robots.status,sitemap:sitemap.status,title:title(home.body),canonical:canonical(home.body),checkedScripts,tracking:{gaKnown:!!t.ga,gaFound:t.ga?inspect.includes(t.ga):null,clarityKnown:!!t.clarity,clarityFound:t.clarity?inspect.includes(t.clarity):null},status:errors.length?'FAIL':'PASS',errors,notes}
 }catch(e){return{name:t.name,status:'ERROR',errors:[String(e)]}}
}))
for(const row of out)console.log('SIX_SITE_RELEASE '+JSON.stringify(row))
console.log('SIX_SITE_SUMMARY '+JSON.stringify({sites:out.length,passed:out.filter(x=>x.status==='PASS').length,failed:out.filter(x=>x.status!=='PASS').map(x=>x.name)}))
if(out.some(x=>x.status!=='PASS'))process.exitCode=1
