// linkedin-scheduler v4 — hands-off product-scoped LinkedIn content automation
// Publishing is handled by the database linkedin-publish-fire/process jobs.
// This function owns generation, validation, queue replenishment, reporting, settings, health, and alerts.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-cron-token',
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
  {category:"websites",cta_type:'website',title:"A website should do more than look good",body:"A business website needs more than attractive colors. It needs mobile usability, clear services, fast pages, and a direct path from a visitor's question to an inquiry. A strong website is part of the business workflow, not just an online brochure.\n\nhttps://romylabs.com" },
  {category:"seo",cta_type:'website',title:"SEO begins with useful service information",body:"Search visibility is not about adding keywords to every page. Service-specific content, helpful local information, clean structure, and fast mobile pages make it easier for the right customers to find a business. Good SEO starts with a useful website.\n\nhttps://romylabs.com" },
  {category:"bookkeeping",cta_type:'website',title:"Bookkeeping needs a clear follow-up workflow",body:"Keeping the books organized means more than entering figures. Documents, invoices, approvals, outstanding questions, and deadlines need clear ownership. When the workflow is visible, teams spend less time reconstructing what happened in scattered emails.\n\nhttps://romylabs.com" },
  {category:"tax_filing",cta_type:'website',title:"Tax filing is a workflow, not a single deadline",body:"A return moves through intake, missing documents, preparation, review, client approval, signature, and filing. Spreadsheets and scattered messages make it difficult to tell what is ready. A structured workflow makes each next step easier to track.\n\nhttps://romylabs.com" },
  {category:"time_clock",cta_type:'website',title:"Time clock records should be useful to the whole operation",body:"Recording a clock-in is just the starting point. Employees need their own hours and timesheets; managers need approvals, corrections, and reports. The right permissions and clear reporting make time tracking part of a reliable workflow.\n\nhttps://romylabs.com" },
  {category:"crm",cta_type:'website',title:"A CRM should not stop at collecting leads",body:"What happens after a lead enters the system? Scheduling, assignments, records, client communication, documents, billing, and follow-up are all part of the relationship. A useful CRM supports the work after the sale instead of acting like a contact list.\n\nhttps://romylabs.com" },
  {category:"automation",cta_type:'website',title:"Business automation needs a clear audit trail",body:"A helpful automation has a specific trigger, a specific action, and a way to see what happened. Whether it routes a lead, sends a reminder, or prepares a report, reliability and visibility matter more than the number of automated steps.\n\nhttps://romylabs.com" },
  {category:"reporting",cta_type:'website',title:"A useful dashboard points to the next action",body:"A dashboard full of numbers is not necessarily useful. Business owners and managers need to see overdue work, pending approvals, upcoming appointments, and operational trends, then open the records behind those metrics to decide what comes next.\n\nhttps://romylabs.com" },
  {category:"billing",cta_type:'website',title:"Billing belongs in the customer workflow",body:"Approved estimates, completed work, invoices, payments, and open balances are connected events. When each lives in a separate place, staff waste time reconciling details. Keeping billing tied to the original customer record improves visibility.\n\nhttps://romylabs.com" },
  {category:"industry_workflows",cta_type:'website',title:"Different businesses need different software workflows",body:"A pool technician, contractor, tax preparer, and office manager share common needs but do not work in identical ways. Good software accounts for those differences instead of forcing everyone into the same generic list of contacts and tasks.\n\nhttps://romylabs.com" },
  {category:"communications",cta_type:'website',title:"Customer communication should be tied to the record",body:"A missed handoff often starts with a message that only one person saw. Keeping relevant calls, emails, texts, notes, and attachments connected to the customer record helps the next employee understand what happened and what still needs attention.\n\nhttps://romylabs.com" },
  {category:"team_management",cta_type:'website',title:"Employee permissions should follow responsibilities",body:"Not every employee needs access to every record or setting. A practical operations system gives each role the tools and information needed for the job while keeping sensitive settings and unrelated records restricted. Useful permissions reduce confusion.\n\nhttps://romylabs.com" },
]

// Five distinct stages of the TaxRes CRM case lifecycle. Each stage has
// multiple examples so the rolling queue can rotate without repeating copy.
const TAXRES_WORKFLOW_STAGES = ["intake","investigation","casework","resolution","closeout"] as const
const TAXRES_WORKFLOW_LIBRARY: Post[] = [
  {category:"intake",cta_type:'demo',title:"Intake is where reliable casework starts",body:"Before a case becomes a deadline, it starts as a conversation. A useful intake captures the client's goals, the notices already received, missing records, who owns the follow-up, and the next appointment. Tax Res CRM keeps that intake context connected to the client record so the next team member does not have to start over.\n\nhttps://taxrescrm.net/demo"},
  {category:"intake",cta_type:'demo',title:"The first client handoff should not lose the details",body:"A new client may contact the office by phone, web form, or referral. Intake works best when documents requested, appointments scheduled, notes taken, and assigned responsibilities follow that person into the working file. The point of a CRM is not simply capturing a lead; it is making that first handoff dependable.\n\nhttps://taxrescrm.net/demo"},
  {category:"intake",cta_type:'demo',title:"Make the missing-document list visible from day one",body:"Intake slows down when outstanding documents live only in a text message or someone's inbox. A shared checklist, clear owner, due date, and client communication history help everyone see what is still needed. Strong intake creates the foundation for investigation and casework, not another spreadsheet to maintain.\n\nhttps://taxrescrm.net/demo"},
  {category:"investigation",cta_type:'demo',title:"A good investigation starts with what you can verify",body:"Before recommending a next step on an IRS matter, the office needs to understand the notice, filing history, available transcripts, account status, authorizations, and important dates. Keeping those findings together makes investigation easier to review and less dependent on one employee remembering the details.\n\nhttps://taxrescrm.net/demo"},
  {category:"investigation",cta_type:'demo',title:"The client's file should explain the numbers",body:"Transcript review can generate questions: which period is involved, which balance changed, what has already been assessed, and what still needs verification? An investigation workspace should connect the source documents, working notes, tasks, and follow-up questions instead of scattering them across email and spreadsheets.\n\nhttps://taxrescrm.net/demo"},
  {category:"investigation",cta_type:'demo',title:"Investigations need ownership, not just documents",body:"Gathering records is only half the job. Someone must request missing information, review the response, track the deadline, and record what was learned. When investigation tasks are assigned and visible, an office can move from uncertainty to a documented case plan without repeatedly rebuilding the same timeline.\n\nhttps://taxrescrm.net/demo"},
  {category:"casework",cta_type:'demo',title:"Active casework is a team workflow",body:"Once a matter is active, every agency contact, client update, requested document, deadline, and assigned task should have a place in the file. A shared case history helps the next person understand what happened yesterday and what must happen today without reconstructing the case from separate systems.\n\nhttps://taxrescrm.net/demo"},
  {category:"casework",cta_type:'demo',title:"Case notes should answer the next-step question",body:"A useful case note records more than 'called the IRS.' It should capture who was contacted, the relevant outcome, promised documents, next action, and date to revisit the matter. Tax Res CRM is designed around that operational continuity so handoffs remain clear as cases move between staff.\n\nhttps://taxrescrm.net/demo"},
  {category:"casework",cta_type:'demo',title:"Managing several open matters requires visibility",body:"A growing team needs to see which cases are awaiting the client, an agency response, an internal review, or a deadline. Tasks and case stages make those distinctions actionable. Better visibility is not about more dashboard numbers; it is about identifying the right next action for each client.\n\nhttps://taxrescrm.net/demo"},
  {category:"resolution",cta_type:'demo',title:"Resolution decisions need a documented trail",body:"A resolution proposal is stronger when its supporting records, communications, financial intake, deadlines, and client approvals are easy to locate. The software should help staff organize and track the work while leaving professional judgment to the people handling the case. Documentation matters as much as the next call.\n\nhttps://taxrescrm.net/demo"},
  {category:"resolution",cta_type:'demo',title:"Follow-through matters after the agency conversation",body:"An installment agreement, penalty request, or hardship discussion often produces another task: provide documents, confirm terms, monitor a response, or follow up with the client. Treating those next steps as assigned work keeps a resolution matter moving instead of relying on a note buried in an inbox.\n\nhttps://taxrescrm.net/demo"},
  {category:"resolution",cta_type:'demo',title:"A clear case timeline makes complex work easier to review",body:"Tax resolution may involve notices, authorization forms, transcripts, financial records, collection deadlines, and repeated contact with an agency. Keeping each action connected to the right matter allows a manager to review the timeline and see what is still outstanding without making unsupported promises about outcomes.\n\nhttps://taxrescrm.net/demo"},
  {category:"closeout",cta_type:'demo',title:"Case closeout should be a workflow of its own",body:"A case is not fully wrapped up just because the last call ended. The office may still need to confirm the outcome, save correspondence, document the client's instructions, reconcile billing, and assign any follow-up. A deliberate closeout process protects the history the team worked to build.\n\nhttps://taxrescrm.net/demo"},
  {category:"closeout",cta_type:'demo',title:"Give the next employee a complete case history",body:"Months after a matter closes, someone may need to find a final notice, payment arrangement, signed form, or client instruction. Organized closeout means those records remain attached to the client and case rather than disappearing into personal folders. Clear archives make future service easier.\n\nhttps://taxrescrm.net/demo"},
  {category:"closeout",cta_type:'demo',title:"The final client update deserves a checklist",body:"Good closeout communication explains what was completed, which documents the client should retain, and whether any monitoring or future action remains. When the update, supporting documents, and final tasks are recorded in one place, the office can close the matter confidently without losing operational context.\n\nhttps://taxrescrm.net/demo"},
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
  [TAXRES_PRODUCT]: /^https:\/\/(?:taxrescrm\.net|romylabs\.com)(?:[/?]|$)/,
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
function utm(p:Post,now:Date,productId:string){const md=new Intl.DateTimeFormat('en-US',{timeZone:TIMEZONE,month:'2-digit',day:'2-digit'}).format(now).replace('/','');return {...p,body:p.body.replace(/https:\/\/(?:taxrescrm\.net|arcvena\.com|romylabs\.com)(?:\/[^\s?]*)?/g,u=>`${u}?utm_source=linkedin&utm_medium=social&utm_campaign=li_${productId}_${p.category}_${md}`)}}
async function recent(sb:any,productId:string){const since=new Date(Date.now()-30*86400000).toISOString();const {data,error}=await sb.from('linkedin_posts').select('body,category,created_at,scheduled_at,status').eq('tenant_id',ADMIN_TENANT).eq('product_id',productId).gte('created_at',since).not('status','eq','failed');if(error)throw error;return data||[]}
async function generate(sb:any,now:Date,productId:string){
  const library=LIBRARIES[productId]; if(!library?.length)return {created:[],quarantined:[],skipped:0,unsupported:true};
  const target=slots(now,8),history=await recent(sb,productId),times=target.map(s=>s.iso);
  const {data:existing,error}=await sb.from('linkedin_posts').select('scheduled_at,status').eq('tenant_id',ADMIN_TENANT).eq('product_id',productId).in('scheduled_at',times).not('status','eq','failed');if(error)throw error;
  const occupied=new Set((existing||[]).map((x:any)=>new Date(x.scheduled_at).toISOString())); const open=target.filter(s=>!occupied.has(new Date(s.iso).toISOString()));
  const bodies=history.map((x:any)=>x.body||''); const created:any[]=[],quarantined:any[]=[]; let cursor=Math.floor(now.getTime()/86400000)%library.length;
  for(const slot of open){
    let source:Post|undefined;
    const usedBodies=[...bodies,...created.map(x=>x.body||'')];
    // Mondays anchor the two-post weekly cadence. This yields Intake ->
    // Investigation -> Casework -> Resolution -> Closeout across future
    // Tuesday/Thursday slots, irrespective of when the cron runs.
    if(productId===TAXRES_PRODUCT){
      const scheduled=new Date(slot.iso);
      const mondayWeek=Math.floor((scheduled.getTime()+3*86400000)/(7*86400000));
      const step=mondayWeek*2+(scheduled.getUTCDay()===4?1:0);
      const stage=TAXRES_WORKFLOW_STAGES[((step%5)+5)%5];
      const options=TAXRES_WORKFLOW_LIBRARY.filter(p=>p.category===stage);
      const start=((Math.floor(now.getTime()/86400000)%options.length)+options.length)%options.length;
      for(let i=0;i<options.length;i++){
        const candidate=options[(start+i)%options.length];
        if(validate(candidate,usedBodies,productId).ok){source=candidate;break}
      }
    }
    // Do not remove existing tax resolution or broader business content:
    // it stays available as a safety fallback if all stage copy is recent.
    if(!source)for(let tries=0;tries<library.length;tries++){
      const candidate=library[(cursor++)%library.length];
      if(validate(candidate,usedBodies,productId).ok){source=candidate;break}
    }
    if(!source){quarantined.push({slot,reasons:['no_unique_valid_content']});continue}
    const post=utm(source,now,productId),check=validate(post,bodies,productId);
    if(!check.ok){quarantined.push({slot,title:post.title,reasons:check.reasons});continue}
    const {data,error:insertError}=await sb.from('linkedin_posts').insert({tenant_id:ADMIN_TENANT,product_id:productId,title:post.title,body:post.body,category:post.category,cta_type:post.cta_type,status:'approved',approved_at:now.toISOString(),scheduled_at:slot.iso,retry_count:0}).select('id,title,body,category,status,scheduled_at').single();
    if(insertError)quarantined.push({slot,title:post.title,reasons:[insertError.message]});else{created.push(data);bodies.push(post.body)}
  }
  return {created,quarantined,skipped:target.length-open.length,unsupported:false}
}
async function authorized(req:Request,sb:any,serviceKey:string){
  const auth=req.headers.get('authorization')||''
  if(serviceKey&&auth===`Bearer ${serviceKey}`)return true
  const cron=req.headers.get('x-internal-cron-token')||''
  if(cron){
    const {data,error}=await sb.rpc('verify_internal_cron_token',{provided:cron})
    if(!error&&data===true)return true
  }
  if(!auth.toLowerCase().startsWith('bearer '))return false
  const token=auth.slice(7)
  const {data:{user},error}=await sb.auth.getUser(token)
  if(error||!user)return false
  const email=String(user.email||'').toLowerCase()
  return ['info@romylabs.com','romy@romylabs.com','romy@taxrescrm.net','romy@taxcasereview.org'].includes(email)
}

async function alert(sb:any,subject:string,html:string){try{await sb.functions.invoke('send-email',{body:{to:ADMIN_EMAIL,subject,html,tenant_id:ADMIN_TENANT}})}catch(e){console.error('[linkedin-scheduler] alert failed',String(e))}}
async function report(sb:any,now:Date,productId?:string){const since=new Date(now.getTime()-7*86400000).toISOString();let pub=sb.from('linkedin_posts').select('id,title,category,published_at,linkedin_url,product_id').eq('tenant_id',ADMIN_TENANT).eq('status','published').gte('published_at',since);let fail=sb.from('linkedin_posts').select('id,title,error_msg,updated_at,product_id').eq('tenant_id',ADMIN_TENANT).eq('status','failed').gte('updated_at',since);let up=sb.from('linkedin_posts').select('id,title,category,status,scheduled_at,product_id').eq('tenant_id',ADMIN_TENANT).in('status',['approved','publishing']).gte('scheduled_at',now.toISOString()).order('scheduled_at',{ascending:true}).limit(20);if(productId){pub=pub.eq('product_id',productId);fail=fail.eq('product_id',productId);up=up.eq('product_id',productId)}const [{data:published},{data:failed},{data:upcoming}]=await Promise.all([pub,fail,up]);return {generated_at:now.toISOString(),product_id:productId||'all',published:published||[],failed:failed||[],upcoming:upcoming||[]}}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||Deno.env.get('SB_SERVICE_KEY');
  if(!url||!key)return response({ok:false,error:'server_configuration_missing'},500);
  const sb=createClient(url,key);
  if(!await authorized(req,sb,key))return response({ok:false,error:'Unauthorized'},401);
  let input:any={}; try{input=await req.json()}catch{}
  const action=input.action||'run',now=new Date();
  try{
    if(action==='get_settings'){const productId=input.product_id||TAXRES_PRODUCT;const {data}=await sb.from('linkedin_settings').select('*').eq('tenant_id',ADMIN_TENANT).eq('product_id',productId).maybeSingle();return response({ok:true,settings:{...(data||{}),autopilot:data?.autopilot??false,timezone:data?.timezone||TIMEZONE},content_library_available:Boolean(LIBRARIES[productId]?.length)})}
    if(action==='save_settings'){
      const productId=String(input.product_id||TAXRES_PRODUCT)
      const enabled=input.settings?.autopilot===true
      if(enabled){
        if(!LIBRARIES[productId])return response({ok:false,error:'product_specific_content_library_not_ready',product_id:productId},409)
        const {data:conn,error:connError}=await sb.from('linkedin_connections')
          .select('expires_at,publish_target_type,linkedin_person_id,linkedin_organization_id')
          .eq('tenant_id',ADMIN_TENANT).eq('product_id',productId).maybeSingle()
        if(connError)return response({ok:false,error:'linkedin_connection_check_failed'},503)
        const org=String(conn?.publish_target_type||'').toUpperCase()==='ORGANIZATION'&&Boolean(conn?.linkedin_organization_id)
        const person=String(conn?.publish_target_type||'').toUpperCase()==='PERSON'&&Boolean(conn?.linkedin_person_id)
        const valid=Boolean(conn&&new Date(conn.expires_at)>now&&(productId===ARCVENA_PRODUCT?org&&String(conn.linkedin_organization_id)==='146118085':productId===TAXRES_PRODUCT?(org||person):org))
        if(!valid)return response({ok:false,error:'verified_linkedin_publishing_destination_required',product_id:productId},409)
      }
      const {error}=await sb.from('linkedin_settings').upsert({tenant_id:ADMIN_TENANT,product_id:productId,...(input.settings||{}),timezone:TIMEZONE,updated_at:now.toISOString()},{onConflict:'tenant_id,product_id'})
      if(error)throw error
      return response({ok:true,autopilot:enabled})
    }
    if(action==='get_health'){const {data,error}=await sb.rpc('get_linkedin_health');if(error)throw error;return response({ok:true,health:data})}
    if(action==='send_alert'){if(!input.subject||!input.html)return response({ok:false,error:'subject_and_html_required'},400);await alert(sb,String(input.subject),String(input.html));return response({ok:true})}
    if(action==='next_slots')return response({ok:true,slots:slots(now,8)})
    if(action==='generate_report')return response({ok:true,report:await report(sb,now,input.product_id)})
    if(action==='list_reports'){const productId=input.product_id||TAXRES_PRODUCT;const {data,error}=await sb.from('linkedin_weekly_reports').select('*').eq('tenant_id',ADMIN_TENANT).eq('product_id',productId).order('week_start',{ascending:false}).limit(12);if(error)throw error;return response({ok:true,reports:data||[]})}
    if(action==='generate_monday_drafts'||action==='generate_content'){const productId=input.product_id||TAXRES_PRODUCT;const x=await generate(sb,now,productId);if(x.unsupported)return response({ok:false,error:'no_content_library_for_product',product_id:productId},400);if(x.quarantined.length && et(now).day==='Mon' && et(now).hour===7)await alert(sb,`LinkedIn autopilot [${productId}]: content withheld`,`<p>${x.quarantined.length} post(s) failed automated validation and were not approved.</p><pre>${JSON.stringify(x.quarantined,null,2)}</pre>`);return response({ok:true,autopilot:true,product_id:productId,...x})}
    if(action!=='run')return response({ok:false,error:'unknown_action'},400)

    const clock=et(now),result:any={ok:true,autopilot:true,generated:0,quarantined:0,skipped:0,products_skipped:[]};
    // Maintain the verified eight-slot rolling queue on every hourly cron run.
    // All slots are future Tuesday/Thursday 9 AM Eastern; no off-hour publishing.
    {
      const {data:settingsRows}=await sb.from('linkedin_settings').select('product_id,autopilot').eq('tenant_id',ADMIN_TENANT).eq('autopilot',true);
      const enabledProducts=(settingsRows||[]).map((r:any)=>r.product_id);
      for(const pid of enabledProducts){
        if(!LIBRARIES[pid]){result.products_skipped.push({product_id:pid,reason:'no_content_library_for_product'});continue}
        const {data:conn}=await sb.from('linkedin_connections').select('product_id,expires_at,publish_target_type,linkedin_organization_id,linkedin_person_id').eq('tenant_id',ADMIN_TENANT).eq('product_id',pid).maybeSingle();
        if(!conn){result.products_skipped.push({product_id:pid,reason:'no_linkedin_connection'});continue}
        if(new Date(conn.expires_at)<now){result.products_skipped.push({product_id:pid,reason:'linkedin_token_expired'});continue}
        if(pid===ARCVENA_PRODUCT&&String(conn.publish_target_type||'').toUpperCase()!=='ORGANIZATION'){result.products_skipped.push({product_id:pid,reason:'company_page_target_not_verified'});continue}
        if(pid===ARCVENA_PRODUCT&&String(conn.linkedin_organization_id||'')!=='146118085'){result.products_skipped.push({product_id:pid,reason:'arcvena_company_page_target_not_verified'});continue}
        if(pid===TAXRES_PRODUCT){
          const target=String(conn.publish_target_type||'').toUpperCase()
          const hasTarget=(target==='PERSON' && Boolean(conn.linkedin_person_id)) || (target==='ORGANIZATION' && Boolean(conn.linkedin_organization_id))
          if(!hasTarget){result.products_skipped.push({product_id:pid,reason:'taxres_publish_target_not_verified'});continue}
        }
        const x=await generate(sb,now,pid);result.generated+=x.created.length;result.quarantined+=x.quarantined.length;result.skipped+=x.skipped;
        if(x.quarantined.length)await alert(sb,`LinkedIn autopilot [${pid}]: validation withheld content`,`<p>${x.quarantined.length} post(s) were safely withheld for ${pid}. No invalid content will publish.</p><pre>${JSON.stringify(x.quarantined,null,2)}</pre>`);
      }
      result.report=await report(sb,now)
    }
    return response(result)
  }catch(e){const msg=e instanceof Error?e.message:String(e);console.error('[linkedin-scheduler]',msg);return response({ok:false,error:msg},500)}
})
