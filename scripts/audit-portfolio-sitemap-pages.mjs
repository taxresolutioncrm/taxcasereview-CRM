// Exhaustive public sitemap-page metadata inspection, no site writes.
// Full crawl of every URL advertised in each known portfolio sitemap.
import fs from 'node:fs'
const sites=[
 ['PoolVerge','poolverge.com'],['TaxRes','taxrescrm.net'],['Oculivo','oculivo.com'],
 ['Groundivo','groundivo.com'],['Restore Relay','restorerelay.com'],['BocaSync','bocasync.com'],
 ['RomyLabs','romylabs.com'],['Arcvena','arcvena.com'],['Camvella','camvella.com'],
 ['SettleLift','settlelift.com'],['ChairStyle','chairstyle.net'],['Lakeside Pools','lakesidepoolsfl.com'],
]
const MAX_URLS=3000
const normalize=url=>{
 const u=new URL(url);u.hash='';u.search='';return u.toString().replace(/\/$/,'')
}
const request=async(url)=>{
 for(let i=0;i<2;i++)try{
   const r=await fetch(url,{redirect:'follow',headers:{'User-Agent':'RomyLabs-ReadOnly-SitemapQA/1.0','Accept':'text/html,application/xml,text/plain,*/*'},signal:AbortSignal.timeout(18000)})
   return {status:r.status,url:r.url,html:(await r.text()).slice(0,300000)}
 }catch(e){if(i===1)return{status:0,url,html:'',error:String(e?.message||e)}}
}
const locs=s=>[...s.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(x=>x[1].replace(/&amp;/g,'&').trim())
const canonical=s=>(s.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i)
 ||s.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i))?.[1]||''
const meta=s=>(s.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)/i)
 ||s.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i))?.[1]||''
const title=s=>s.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g,' ').trim()||''
async function collect(domain){
 const root='https://'+domain,found=new Set(),sitemaps=new Set(),errors=[],queue=[root+'/sitemap.xml']
 let inspected=0
 while(queue.length && sitemaps.size<30){
  const path=queue.shift();if(sitemaps.has(path))continue;sitemaps.add(path)
  let r=await request(path)
  if(r.status===404&&path===root+'/sitemap.xml'){queue.push(root+'/sitemap-index.xml');continue}
  if(r.status!==200){errors.push('sitemap HTTP '+r.status+' '+path);continue}
  const locations=locs(r.html)
  if(/<sitemapindex\b/i.test(r.html)){
   for(const item of locations)try{
    const u=new URL(item);if(u.hostname===domain&&!sitemaps.has(u.href))queue.push(u.href)
   }catch{errors.push('invalid sitemap URL '+item)}
  }else if(/<urlset\b/i.test(r.html)){
   for(const item of locations)try{
    const u=new URL(item);if(u.hostname===domain||u.hostname==='www.'+domain)found.add(u.href)
    else errors.push('cross-domain sitemap URL '+item)
   }catch{errors.push('invalid URL '+item)}
  }else errors.push('unexpected sitemap content '+path)
 }
 if(queue.length)errors.push('sitemap index count exceeds 30')
 const urls=[...found];const result=[],titles=new Map()
 if(urls.length>MAX_URLS)errors.push('incomplete: sitemap has '+urls.length+' URLs, safety limit '+MAX_URLS)
 let cursor=0
 async function worker(){while(cursor<Math.min(urls.length,MAX_URLS)){
   const page=urls[cursor++],r=await request(page),problems=[],warnings=[]
   if(r.status!==200)problems.push('HTTP '+r.status)
   if(r.status===200){
    const t=title(r.html),d=meta(r.html),c=canonical(r.html)
    if(!t)problems.push('missing title')
    else{const existing=titles.get(t)||[];existing.push(page);titles.set(t,existing)}
    if(!d)problems.push('missing description')
    if(!c)problems.push('missing canonical')
    else try{if(normalize(c)!==normalize(page))warnings.push('canonical differs from sitemap URL: '+c)}
    catch{problems.push('invalid canonical')}
    if(!r.html.includes('<h1')&&!r.html.includes('<H1'))warnings.push('no H1 in initial HTML; JS rendering may supply it')
    if(/<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(r.html))warnings.push('sitemap page has noindex meta')
    if(!/type=["']application\/ld\+json["']/i.test(r.html))warnings.push('no JSON-LD in initial HTML')
    if(normalize(r.url)!==normalize(page)){
      warnings.push('redirected to '+r.url)
      const c=canonical(r.html)
      if(c && normalize(c)!==normalize(r.url))warnings.push('FINAL-URL CANONICAL CONFLICT: final='+r.url+' canonical='+c)
    }
   }
   result.push({url:page,status:r.status,title:title(r.html),issues:problems,warnings})
 }}
 await Promise.all(Array.from({length:Math.min(6,urls.length)},()=>worker()))
 for(const [t,items] of titles){if(items.length>1)errors.push('duplicate title '+JSON.stringify(t)+' on '+items.length+' URLs')}
 result.sort((a,b)=>a.url.localeCompare(b.url))
 const issuePages=result.filter(x=>x.issues.length),warnPages=result.filter(x=>x.warnings.length)
 return {domain, sitemapFiles:[...sitemaps],advertised:urls.length,inspected:result.length,
    fatalErrors:errors,issueCount:issuePages.length,warningCount:warnPages.length,
    sampleIssues:issuePages.slice(0,30),sampleWarnings:warnPages.slice(0,18),pages:result}
}
const audits=[]
for(const [name,domain] of sites){
 const data=await collect(domain);audits.push({name,...data})
 console.log('SITE_CRAWL '+JSON.stringify({name,domain,advertised:data.advertised,inspected:data.inspected,issues:data.issueCount,warnings:data.warningCount,fatalErrors:data.fatalErrors.slice(0,7),sampleIssues:data.sampleIssues.slice(0,5),sampleWarnings:data.sampleWarnings.slice(0,5)}))
}
fs.mkdirSync('portfolio-audit',{recursive:true})
fs.writeFileSync('portfolio-audit/sitewide-pages.json',JSON.stringify(audits,null,2))
const lines=['# Sitewide sitemap crawl','',new Date().toISOString(),'','| Site | Advertised | Checked | Errors | Warnings |','|---|---:|---:|---:|---:|']
for(const a of audits)lines.push('| '+a.name+' | '+a.advertised+' | '+a.inspected+' | '+(a.issueCount+a.fatalErrors.length)+' | '+a.warningCount+' |')
for(const a of audits){
 lines.push('\n## '+a.name,'\nAdvertised URLs: '+a.advertised+'; inspected: '+a.inspected)
 for(const issue of a.fatalErrors)lines.push('- '+issue)
 for(const page of a.sampleIssues)lines.push('- '+page.url+': '+page.issues.join('; '))
 for(const page of a.sampleWarnings.slice(0,6))lines.push('- WARN '+page.url+': '+page.warnings.join('; '))
}
fs.writeFileSync('portfolio-audit/sitewide-pages.md',lines.join('\n')+'\n')
console.log(lines.slice(0,7+audits.length).join('\n'))
if(audits.some(a=>a.fatalErrors.length||a.issueCount))process.exitCode=1
