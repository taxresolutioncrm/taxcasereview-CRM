const urls=[
  {name:'products',url:'https://romylabs.com/products/'},
  {name:'home',url:'https://romylabs.com/'},
  {name:'sync',url:'https://romylabs.com/product-sync.js'}
];
const output=await Promise.all(urls.map(async x=>{
 try{
  const res=await fetch(x.url+'?card_qa=20261108',{redirect:'follow',signal:AbortSignal.timeout(16000),headers:{'Cache-Control':'no-cache','User-Agent':'RomyLabs-Live-PoolVerge-Card-QA/1.0'}});
  const raw=await res.text();
  let errors=[];
  if(res.status!==200)errors.push('HTTP '+res.status);
  if(x.name==='products'){
    const n=raw.indexOf('id="pool_crm"');
    if(n<0)errors.push('Missing pool_crm product card');
    const block=n>=0?raw.slice(n,n+9000):'';
    if(!block.includes('Visit PoolVerge'))errors.push('Missing Visit PoolVerge link');
    if(block.includes('Visit PoolVerge website'))errors.push('Outdated PoolVerge website CTA');
    if(/\(planned\)/i.test(block.split(/<a[^>]*class="pfc-cta/)[0]))errors.push('Outdated planned feature text');
    if(!block.includes('>Live<'))errors.push('Missing Live badge');
    if(!block.includes('https://poolverge.com'))errors.push('Broken PoolVerge destination');
  }else if(x.name==='home'){
    const n=raw.indexOf('data-product-id="pool_crm"');
    const block=n>=0?raw.slice(n,n+7000):'';
    if(n<0)errors.push('Missing PoolVerge homepage card');
    if(!block.includes('Visit PoolVerge'))errors.push('Missing PoolVerge CTA');
    if(block.includes('Visit PoolVerge website'))errors.push('Old homepage CTA');
    if(/\(planned\)/i.test(block.split(/<a[^>]*class="product-link/)[0]))errors.push('Outdated homepage planned features');
  }else{
    if(!raw.includes("cta_label:'Visit PoolVerge'"))errors.push('Client hydration CTA is outdated');
    if(!raw.includes("f.replace(/\\s*\\(planned\\)\\s*$/i"))errors.push('Client hydration feature normalizer missing');
    if(raw.includes("cta_label:'Visit PoolVerge website'"))errors.push('Old client CTA remains');
  }
  return {name:x.name,url:x.url,status:errors.length?'FAIL':'PASS',http:res.status,errors,bytes:raw.length};
 }catch(e){return {name:x.name,status:'ERROR',errors:[String(e)]}}
}));
for(const r of output)console.log('POOL_CARD_LIVE '+JSON.stringify(r));
if(output.some(x=>x.status!=='PASS'))process.exitCode=1;
