// Public production buyer-content verification. No credentials and no writes.
import {writeFileSync,mkdirSync} from 'node:fs'
const sites=[
 {name:'PoolVerge (reference)',origin:'https://poolverge.com',path:'/',expected:'G-RPM6TKRCW5',isReference:true},
 {name:'TaxRes',origin:'https://taxrescrm.net',path:'/tax-resolution-crm/',expected:'irs-crm-evaluation'},
 {name:'Oculivo',origin:'https://oculivo.com',path:'/optometry-software/',expected:'Optometry scheduling software buyer guide'},
 {name:'Groundivo',origin:'https://groundivo.com',path:'/lawn-care-crm/',expected:'LAWN CARE CRM BUYER CHECKLIST'},
 {name:'Restore Relay',origin:'https://restorerelay.com',path:'/restoration-crm',expected:'RESTORATION CRM BUYER CHECKLIST',react:true},
 {name:'BocaSync',origin:'https://bocasync.com',path:'/features/dental-communications/',expected:'How to compare dental patient communication software'},
 {name:'RomyLabs',origin:'https://romylabs.com',path:'/industries/',expected:'How to compare industry-specific CRM and multi-location operations software'},
 {name:'Arcvena',origin:'https://arcvena.com',path:'/features/electrician-crm',expected:'What should a CRM for electricians include?'},
 {name:'Camvella',origin:'https://camvella.com',path:'/features/violations/',expected:'How to evaluate HOA violation tracking software'},
 {name:'ChairStyle',origin:'https://chairstyle.net',path:'/salon-software/',expected:'salon-buyer-guide'},
 {name:'SettleLift',origin:'https://settlelift.com',path:'/resources/choosing-debt-settlement-crm/',expected:'crm-buyer-checklist'},
 {name:'Lakeside Pools (read-only)',origin:'https://lakesidepoolsfl.com',path:'/',expected:'Lakeside',isReference:true}
]
async function fetchText(url){
 const r=await fetch(url,{redirect:'follow',headers:{'Cache-Control':'no-cache','User-Agent':'RomyLabs-Buyer-Content-Release-QA/1.0'},signal:AbortSignal.timeout(17000)})
 return {status:r.status,url:r.url,text:(await r.text()).slice(0,8000000)}
}
async function inspect(site){
 const url=site.origin+site.path,notes=[],errors=[]
 try{
  const home=await fetchText(url+'?portfolio_seo_verify=20261107')
  if(home.status!==200)errors.push('HTTP '+home.status)
  let html=home.text,source=html,checkedAssets=0
  if(site.react&&!source.includes(site.expected)){
   const links=[...html.matchAll(/<script[^>]+src=["']([^"']+\.js(?:\?[^"']*)?)["']/gi)].map(x=>x[1]).filter(x=>x.startsWith('/')||x.startsWith(site.origin)).slice(0,15)
   for(const link of links){try{const js=await fetchText(new URL(link,site.origin).href);if(js.status===200){source+=' '+js.text;checkedAssets++}}catch(e){notes.push('JS fetch error '+String(e))}}
  }
  if(!source.includes(site.expected))errors.push('Buyer content not present in public response/assets')
  const canon=html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i)?.[1]||''
  if(!canon)errors.push('canonical absent')
  if(/<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html))errors.push('noindex on public buyer page')
  return {name:site.name,url,status:errors.length?'FAIL':'PASS',http:home.status,expected:site.expected,canonical:canon,checkedAssets,errors,notes}
 }catch(e){return{name:site.name,url,status:'ERROR',errors:[String(e)]}}
}
const results=await Promise.all(sites.map(inspect))
for(const result of results)console.log('BUYER_SEO_LIVE '+JSON.stringify(result))
const passed=results.filter(x=>x.status==='PASS').length
console.log('BUYER_SEO_SUMMARY '+JSON.stringify({checked:results.length,passed,failed:results.filter(x=>x.status!=='PASS').map(x=>x.name)}))
mkdirSync('seo-live',{recursive:true});writeFileSync('seo-live/results.json',JSON.stringify({checkedAt:new Date().toISOString(),results},null,2))
if(passed!==results.length)process.exitCode=1
