// linkedin-scheduler v4 — hands-off product-scoped LinkedIn content automation
// Publishing is handled by the database linkedin-publish-fire/process jobs.
// This function owns generation, validation, queue replenishment, reporting, settings, health, and alerts.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const TIMEZONE = 'America/New_York'
const ADMIN_EMAIL = 'info@romylabs.com'
const ADMIN_TENANT = 'a0000000-0000-0000-0000-000000000001'
const TAXRES_PRODUCT = 'taxres_crm'
const ARCVENA_PRODUCT = 'arcvena'

type Post = { title: string; body: string; category: string; cta_type: string }

const TAXRES_LIBRARY: Post[] = [
  {category:'practitioner',cta_type:'engage',title:'The hidden cost of scattered case notes',body:`A tax resolution case can involve calls, notices, documents, deadlines, follow-ups, and multiple people touching the file.\n\nWhen those details live in separate inboxes, spreadsheets, and personal notes, it becomes harder to answer a simple question: what needs attention next?\n\nThat is one reason I built Tax Res CRM around the day-to-day workflow of a resolution practice.\n\nHow is your firm keeping the full case history in one place?\n\nhttps://taxrescrm.net`},
  {category:'product',cta_type:'demo',title:'A CRM built around tax resolution work',body:`Generic CRMs can track contacts. Tax resolution teams need the surrounding case workflow to make sense too.\n\nTax Res CRM is built specifically around resolution practices: client records, case activity, documents, tasks, communications, and the operational work around an active case.\n\nThe goal is fewer disconnected systems and a clearer picture of what is happening across the office.\n\nWant to see the workflow?\n\nhttps://taxrescrm.net/demo`},
  {category:'founder_story',cta_type:'engage',title:'Why I built Tax Res CRM',body:`I did not start Tax Res CRM because the world needed another generic CRM.\n\nI built it after working inside tax resolution and seeing how much time gets lost moving between systems that were never designed around this type of practice.\n\nThe product decisions come from that perspective: organize the case, make the next action easier to see, and keep the office from depending on scattered information.\n\nhttps://taxrescrm.net`},
  {category:'practitioner',cta_type:'engage',title:'Follow-up should not depend on memory',body:`The easiest follow-up to miss is the one nobody wrote down.\n\nIn a busy tax resolution practice, client callbacks, document requests, IRS follow-ups, and internal tasks compete for attention every day. A repeatable workflow matters more as the caseload grows.\n\nTax Res CRM was built to give resolution teams a clearer place to organize the work instead of relying on memory and disconnected tools.\n\nhttps://taxrescrm.net/demo`},
  {category:'product',cta_type:'demo',title:'One place to see the work',body:`A resolution practice should not need five different places to understand one client relationship.\n\nTax Res CRM brings operational pieces of the practice together so the team has a clearer view of clients, case activity, communications, documents, and tasks.\n\nIt is software built around the work resolution teams already do rather than forcing that work into a generic sales pipeline.\n\nhttps://taxrescrm.net/demo`},
  {category:'practitioner',cta_type:'engage',title:'The case file should tell the story',body:`Open a client file and ask one question: can another person on the team quickly understand what happened, what is pending, and what comes next?\n\nIf the answer depends on finding the right email thread or asking the person who last touched the case, the workflow is carrying unnecessary risk.\n\nA well-organized case history makes handoffs, follow-up, and client communication easier.\n\nhttps://taxrescrm.net`},
  {category:'founder_story',cta_type:'engage',title:'Software should match the practice',body:`One lesson from working in tax resolution: software can create almost as much work as it removes when the workflow does not match the practice.\n\nThat is why I keep coming back to the same question while building Tax Res CRM: would this actually make sense during a normal workday inside a resolution office?\n\nFeatures are useful. A workflow people can actually follow is more useful.\n\nhttps://taxrescrm.net`},
  {category:'practitioner',cta_type:'engage',title:'Visibility matters as the caseload grows',body:`A small caseload can hide a messy process. A larger caseload exposes it.\n\nAs more cases move at the same time, teams need a reliable way to see pending work, recent activity, client communication, and ownership without rebuilding the picture every morning.\n\nThat visibility is one of the core problems Tax Res CRM is designed around.\n\nhttps://taxrescrm.net`},
  {category:'product',cta_type:'demo',title:'Built for resolution teams, not adapted later',body:`There is a difference between adding tax-resolution labels to a generic CRM and designing the workflow around a resolution practice from the beginning.\n\nTax Res CRM is built from the second approach and centered on the operational reality of managing clients and active resolution work.\n\nIf your current system feels like something your firm has had to work around, take a look.\n\nhttps://taxrescrm.net/demo`},
  {category:'practitioner',cta_type:'engage',title:'Good systems make handoffs easier',body:`A good case-management system should make a handoff boring.\n\nThe next person should be able to open the record, understand recent activity, see what is pending, and continue the work without reconstructing the case from messages and memory.\n\nThat becomes increasingly important as a resolution team grows.\n\nhttps://taxrescrm.net`},
  {category:'founder_story',cta_type:'engage',title:'Building from real workflow problems',body:`The best product ideas for Tax Res CRM have not come from a feature checklist. They have come from moments where the work itself felt harder than it needed to be.\n\nA missed handoff. Information in the wrong place. Too many steps to understand a case. A follow-up that should have been obvious.\n\nThose are the problems I want the software to remove.\n\nhttps://taxrescrm.net`},
  {category:'product',cta_type:'demo',title:'See Tax Res CRM in context',body:`The easiest way to evaluate practice software is not a feature list. It is seeing how the workflow fits the way your office actually works.\n\nTax Res CRM is purpose-built for tax resolution practices and the operational work around their cases.\n\nIf you want to see the product in context, book a walkthrough.\n\nhttps://taxrescrm.net/demo`},
]

const ARCVENA_LIBRARY: Post[] = [
  {category:'dispatch',cta_type:'website',title:'Dispatch should know more than who is available',body:`Good dispatching is not only about finding an open time slot. The office needs to match the right technician, job type, location, required skills, permit requirements, and expected duration.\n\nArcvena gives electrical contractors one operational view from scheduling through closeout—without stitching together five disconnected tools.\n\nSee the dispatch workflow at https://arcvena.com/dispatch`},
  {category:'workflow',cta_type:'website',title:'From lead to paid job without losing the handoff',body:`Every handoff creates risk: lead to estimate, estimate to job, office to technician, completed work to invoice.\n\nArcvena was designed to keep those transitions inside one electrical-contractor workflow. The result is clearer ownership, fewer missing details, and faster closeout.\n\nSee the electrician CRM workflow at https://arcvena.com/electrician-crm`},
  {category:'compliance',cta_type:'website',title:'Permits and inspections should not live on a spreadsheet',body:`Permit numbers, submission dates, inspection windows, corrections, approvals, and supporting documents all affect when an electrical job can move forward.\n\nArcvena keeps permit and inspection activity connected to the customer, property, and job so the office can see what is blocked and what is ready.\n\nExplore permit management at https://arcvena.com/permit-management`},
  {category:'mobile',cta_type:'website',title:'Give technicians the job context before they arrive',body:`A technician should not need to call the office for the customer's history, scope, site notes, panel information, prior photos, or required documents.\n\nArcvena's mobile workflow brings the right job and property context into the field, while the office keeps visibility into progress.\n\nSee the mobile workflow at https://arcvena.com/mobile`},
  {category:'operations',cta_type:'website',title:'Job closeout is where cash flow begins',body:`The work may be finished, but the job is not closed until notes, photos, signatures, materials, inspection status, and billing details are complete.\n\nArcvena turns closeout into a defined workflow so invoices do not wait on missing information.\n\nSee job closeout at https://arcvena.com/job-closeout`},
  {category:'brand',cta_type:'website',title:'Built specifically for electrical contractors',body:`Arcvena is not a generic CRM with electrical labels added afterward. It connects estimating, scheduling, dispatch, field work, permits, inspections, property history, invoicing, automation, and customer communication around the way electrical contractors actually operate.\n\nExplore Arcvena at https://arcvena.com`},
  {category:'margin',cta_type:'website',title:'Why electrical contractors lose margin between estimate and invoice',body:`A profitable electrical job can still leak margin between the estimate, the field, and the final invoice. Scope changes get buried in texts. Materials are not tied back to the job. Photos and signatures arrive late. The invoice waits for someone to reconstruct what happened.\n\nArcvena keeps the estimate, dispatch, field documentation, job history, and invoice connected so the office can close work with the full story in front of them.\n\nLearn more at https://arcvena.com`},
  {category:'property_passport',cta_type:'website',title:'The Property Passport: a permanent electrical history for every property',body:`Most systems organize work by customer or invoice. Electrical contractors also need the property itself to retain memory.\n\nArcvena's Property Passport keeps panels, circuits, equipment, permits, inspections, photos, documents, and completed work connected to the service address. When the next call comes in, the team starts with context instead of starting over.\n\nExplore Arcvena at https://arcvena.com`},
  {category:'estimating',cta_type:'website',title:'Estimating should flow directly into the job',body:`Re-entering an approved estimate into another system creates unnecessary work and another place for details to get lost.\n\nArcvena keeps the estimate connected to the customer, property, job scope, scheduling, field activity, and eventual invoice so the office can move forward without rebuilding the job.\n\nExplore electrical estimating at https://arcvena.com/estimating`},
  {category:'customer_experience',cta_type:'website',title:'Customers should not have to call for every update',body:`Electrical customers want to know when the technician is coming, what was approved, what changed, and what they owe. The office should not have to manually reconstruct that answer every time.\n\nArcvena keeps customer communication tied to the same operational record the team is already using.\n\nSee how Arcvena works at https://arcvena.com`},
  {category:'operations',cta_type:'website',title:'The office should know what is blocking a job',body:`A job can look scheduled and still be blocked by a permit, inspection, missing deposit, unavailable technician, customer approval, or incomplete scope.\n\nArcvena is designed to make those operational blockers visible before they turn into missed appointments or delayed invoices.\n\nExplore Arcvena at https://arcvena.com`},
  {category:'growth',cta_type:'website',title:'Growth exposes disconnected systems fast',body:`A small electrical shop can survive with texts, spreadsheets, inboxes, and memory. Growth makes the cracks obvious. More technicians, more jobs, and more customers mean more handoffs and more places for information to disappear.\n\nArcvena gives electrical contractors one operating system for the work from lead through payment.\n\nSee the platform at https://arcvena.com`},
]

const LIBRARIES: Record<string, Post[]> = {
  [TAXRES_PRODUCT]: TAXRES_LIBRARY,
  [ARCVENA_PRODUCT]: ARCVENA_LIBRARY,
}
const ALLOWED_HOSTS: Record<string, RegExp> = {
  [TAXRES_PRODUCT]: /^https:\/\/taxrescrm\.net(?:[/?]|$)/,
  [ARCVENA_PRODUCT]: /^https:\/\/arcvena\.com(?:[/?]|$)/,
}
const BLOCKED=['[draft','[add ','[describe ','[open ','[share ','[verify ','todo','tbd','guaranteed','settle for pennies','eliminate your tax debt','irs approved','irs certified','always works','never fails','fully automated transcript']

function response(x:unknown,status=200){return new Response(JSON.stringify(x),{status,headers:{...cors,'Content-Type':'application/json'}})}
function clean(s:string){return s.toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
function validate(p:Post,recent:string[],productId:string){
  const r:string[]=[]; const l=p.body.toLowerCase();
  if(p.body.length<180)r.push('body_too_short');
  if(p.body.length>2500)r.push('body_too_long');
  const urls=p.body.match(/https?:\/\/[^\s]+/g)||[]; const allowed=ALLOWED_HOSTS[productId];
  if(!allowed)r.push('unsupported_product');
  if(!urls.length||!allowed||urls.some(u=>!allowed.test(u)))r.push('invalid_destination');
  for(const x of BLOCKED)if(l.includes(x))r.push(`blocked:${x}`);
  const n=clean(p.body); if(recent.some(b=>clean(b)===n))r.push('duplicate_recent_content');
  return {ok:r.length===0,reasons:r}
}
function et(date:Date){const p=new Intl.DateTimeFormat('en-US',{timeZone:TIMEZONE,weekday:'short',hour:'2-digit',hour12:false}).formatToParts(date);return {day:p.find(x=>x.type==='weekday')?.value,hour:Number(p.find(x=>x.type==='hour')?.value)}}
function offset(d:Date){return (new Intl.DateTimeFormat('en-US',{timeZone:TIMEZONE,timeZoneName:'longOffset'}).formatToParts(d).find(x=>x.type==='timeZoneName')?.value||'GMT-04:00').replace('GMT','')}
function slots(from:Date,count=8){const out:{iso:string,label:string}[]=[];const c=new Date(from);c.setUTCHours(12,0,0,0);for(let i=0;i<60&&out.length<count;i++){const p=new Intl.DateTimeFormat('en-US',{timeZone:TIMEZONE,weekday:'short',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(c);const v=(t:string)=>p.find(x=>x.type===t)?.value||'';const wd=v('weekday');if(wd==='Tue'||wd==='Thu'){const y=+v('year'),m=+v('month'),d=+v('day');const probe=new Date(Date.UTC(y,m-1,d,13));const when=new Date(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T09:00:00${offset(probe)}`);if(when>from)out.push({iso:when.toISOString(),label:`${wd==='Tue'?'Tuesday':'Thursday'} ${m}/${d} 9:00 AM ET`})}c.setUTCDate(c.getUTCDate()+1)}return out}
function utm(p:Post,now:Date,productId:string){const md=new Intl.DateTimeFormat('en-US',{timeZone:TIMEZONE,month:'2-digit',day:'2-digit'}).format(now).replace('/','');return {...p,body:p.body.replace(/https:\/\/(?:taxrescrm\.net|arcvena\.com)(?:\/[^\s?]*)?/g,u=>`${u}?utm_source=linkedin&utm_medium=social&utm_campaign=li_${productId}_${p.category}_${md}`)}}
async function recent(sb:any,productId:string){const since=new Date(Date.now()-30*86400000).toISOString();const {data,error}=await sb.from('linkedin_posts').select('body,category,created_at,scheduled_at,status').eq('tenant_id',ADMIN_TENANT).eq('product_id',productId).gte('created_at',since).not('status','eq','failed');if(error)throw error;return data||[]}
async function generate(sb:any,now:Date,productId:string){
  const library=LIBRARIES[productId]; if(!library?.length)return {created:[],quarantined:[],skipped:0,unsupported:true};
  const target=slots(now,2),history=await recent(sb,productId),times=target.map(s=>s.iso);
  const {data:existing,error}=await sb.from('linkedin_posts').select('scheduled_at,status').eq('tenant_id',ADMIN_TENANT).eq('product_id',productId).in('scheduled_at',times).not('status','eq','failed');if(error)throw error;
  const occupied=new Set((existing||[]).map((x:any)=>new Date(x.scheduled_at).toISOString())); const open=target.filter(s=>!occupied.has(new Date(s.iso).toISOString()));
  const bodies=history.map((x:any)=>x.body||''); const created:any[]=[],quarantined:any[]=[]; let cursor=Math.floor(now.getTime()/86400000)%library.length;
  for(const slot of open){let source:Post|undefined;for(let tries=0;tries<library.length;tries++){const candidate=library[(cursor++)%library.length];if(validate(candidate,[...bodies,...created.map(x=>x.body||'')],productId).ok){source=candidate;break}}if(!source){quarantined.push({slot,reasons:['no_unique_valid_content']});continue}const post=utm(source,now,productId),check=validate(post,bodies,productId);if(!check.ok){quarantined.push({slot,title:post.title,reasons:check.reasons});continue}const {data,error:insertError}=await sb.from('linkedin_posts').insert({tenant_id:ADMIN_TENANT,product_id:productId,title:post.title,body:post.body,category:post.category,cta_type:post.cta_type,status:'approved',approved_at:now.toISOString(),scheduled_at:slot.iso,retry_count:0}).select('id,title,body,category,status,scheduled_at').single();if(insertError)quarantined.push({slot,title:post.title,reasons:[insertError.message]});else{created.push(data);bodies.push(post.body)}}
  return {created,quarantined,skipped:target.length-open.length,unsupported:false}
}
async function alert(sb:any,subject:string,html:string){try{await sb.functions.invoke('send-email',{body:{to:ADMIN_EMAIL,subject,html,tenant_id:ADMIN_TENANT}})}catch(e){console.error('[linkedin-scheduler] alert failed',String(e))}}
async function report(sb:any,now:Date,productId?:string){const since=new Date(now.getTime()-7*86400000).toISOString();let pub=sb.from('linkedin_posts').select('id,title,category,published_at,linkedin_url,product_id').eq('tenant_id',ADMIN_TENANT).eq('status','published').gte('published_at',since);let fail=sb.from('linkedin_posts').select('id,title,error_msg,updated_at,product_id').eq('tenant_id',ADMIN_TENANT).eq('status','failed').gte('updated_at',since);let up=sb.from('linkedin_posts').select('id,title,category,status,scheduled_at,product_id').eq('tenant_id',ADMIN_TENANT).in('status',['approved','publishing']).gte('scheduled_at',now.toISOString()).order('scheduled_at',{ascending:true}).limit(20);if(productId){pub=pub.eq('product_id',productId);fail=fail.eq('product_id',productId);up=up.eq('product_id',productId)}const [{data:published},{data:failed},{data:upcoming}]=await Promise.all([pub,fail,up]);return {generated_at:now.toISOString(),product_id:productId||'all',published:published||[],failed:failed||[],upcoming:upcoming||[]}}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||Deno.env.get('SB_SERVICE_KEY');
  if(!url||!key)return response({ok:false,error:'server_configuration_missing'},500);
  const sb=createClient(url,key); let input:any={}; try{input=await req.json()}catch{}
  const action=input.action||'run',now=new Date();
  try{
    if(action==='get_settings'){const productId=input.product_id||TAXRES_PRODUCT;const {data}=await sb.from('linkedin_settings').select('*').eq('tenant_id',ADMIN_TENANT).eq('product_id',productId).maybeSingle();return response({ok:true,settings:{...(data||{}),autopilot:data?.autopilot??false,timezone:data?.timezone||TIMEZONE},content_library_available:Boolean(LIBRARIES[productId]?.length)})}
    if(action==='save_settings'){const productId=input.product_id||TAXRES_PRODUCT;const {error}=await sb.from('linkedin_settings').upsert({tenant_id:ADMIN_TENANT,product_id:productId,...(input.settings||{}),timezone:TIMEZONE,updated_at:now.toISOString()},{onConflict:'tenant_id,product_id'});if(error)throw error;return response({ok:true,autopilot:input.settings?.autopilot??false})}
    if(action==='get_health'){const {data,error}=await sb.rpc('get_linkedin_health');if(error)throw error;return response({ok:true,health:data})}
    if(action==='send_alert'){if(!input.subject||!input.html)return response({ok:false,error:'subject_and_html_required'},400);await alert(sb,String(input.subject),String(input.html));return response({ok:true})}
    if(action==='next_slots')return response({ok:true,slots:slots(now,8)})
    if(action==='generate_report')return response({ok:true,report:await report(sb,now,input.product_id)})
    if(action==='list_reports'){const productId=input.product_id||TAXRES_PRODUCT;const {data,error}=await sb.from('linkedin_weekly_reports').select('*').eq('tenant_id',ADMIN_TENANT).eq('product_id',productId).order('week_start',{ascending:false}).limit(12);if(error)throw error;return response({ok:true,reports:data||[]})}
    if(action==='generate_monday_drafts'||action==='generate_content'){const productId=input.product_id||TAXRES_PRODUCT;const x=await generate(sb,now,productId);if(x.unsupported)return response({ok:false,error:'no_content_library_for_product',product_id:productId},400);if(x.quarantined.length)await alert(sb,`LinkedIn autopilot [${productId}]: content withheld`,`<p>${x.quarantined.length} post(s) failed automated validation and were not approved.</p><pre>${JSON.stringify(x.quarantined,null,2)}</pre>`);return response({ok:true,autopilot:true,product_id:productId,...x})}
    if(action!=='run')return response({ok:false,error:'unknown_action'},400)

    const clock=et(now),result:any={ok:true,autopilot:true,generated:0,quarantined:0,skipped:0,products_skipped:[]};
    if(clock.day==='Mon'&&clock.hour===7){
      const {data:settingsRows}=await sb.from('linkedin_settings').select('product_id,autopilot').eq('tenant_id',ADMIN_TENANT).eq('autopilot',true);
      const enabledProducts=(settingsRows||[]).map((r:any)=>r.product_id);
      for(const pid of enabledProducts){
        if(!LIBRARIES[pid]){result.products_skipped.push({product_id:pid,reason:'no_content_library_for_product'});continue}
        const {data:conn}=await sb.from('linkedin_connections').select('product_id,expires_at,publish_target_type,linkedin_organization_id').eq('tenant_id',ADMIN_TENANT).eq('product_id',pid).maybeSingle();
        if(!conn){result.products_skipped.push({product_id:pid,reason:'no_linkedin_connection'});continue}
        if(new Date(conn.expires_at)<now){result.products_skipped.push({product_id:pid,reason:'linkedin_token_expired'});continue}
        if((pid===TAXRES_PRODUCT||pid===ARCVENA_PRODUCT)&&String(conn.publish_target_type||'').toUpperCase()!=='ORGANIZATION'){result.products_skipped.push({product_id:pid,reason:'company_page_target_required'});continue}
        if((pid===TAXRES_PRODUCT||pid===ARCVENA_PRODUCT)&&!String(conn.linkedin_organization_id||'')){result.products_skipped.push({product_id:pid,reason:'company_page_organization_missing'});continue}
        const x=await generate(sb,now,pid);result.generated+=x.created.length;result.quarantined+=x.quarantined.length;result.skipped+=x.skipped;
        if(x.quarantined.length)await alert(sb,`LinkedIn autopilot [${pid}]: validation withheld content`,`<p>${x.quarantined.length} post(s) were safely withheld for ${pid}. No invalid content will publish.</p><pre>${JSON.stringify(x.quarantined,null,2)}</pre>`);
      }
      result.report=await report(sb,now)
    }
    return response(result)
  }catch(e){const msg=e instanceof Error?e.message:String(e);console.error('[linkedin-scheduler]',msg);return response({ok:false,error:msg},500)}
})
