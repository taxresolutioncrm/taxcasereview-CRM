import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const URL=Deno.env.get('SUPABASE_URL')!
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON=Deno.env.get('SUPABASE_ANON_KEY')!
const ADMIN_TENANT='a0000000-0000-0000-0000-000000000001'
const ADMIN_EMAIL='romy@taxrescrm.net'
const OWNER_EMAILS=new Set(['romy@taxrescrm.net','romy@romylabs.com','info@romylabs.com'])
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}})

async function authorized(req:Request,admin:any){
 const token=req.headers.get('x-internal-cron-token')||''
 if(token){const{data}=await admin.rpc('verify_internal_cron_token',{provided:token});if(data===true)return true}
 const a=req.headers.get('authorization')||''
 if(!a.startsWith('Bearer ')||!ANON)return false
 const jwt=a.slice(7),uc=createClient(URL,ANON,{global:{headers:{Authorization:`Bearer ${jwt}`}}})
 const{data:{user}}=await uc.auth.getUser(jwt);const email=String(user?.email||'').toLowerCase()
 return !!user&&OWNER_EMAILS.has(email)
}
const sum=(rows:any[],key:string)=>rows.reduce((s,r)=>s+Number(r?.[key]||0),0)

Deno.serve(async req=>{
 if(req.method!=='POST')return json({error:'Method not allowed'},405)
 const admin=createClient(URL,SERVICE)
 if(!(await authorized(req,admin)))return json({error:'Unauthorized'},401)
 let body:any={};try{body=await req.json()}catch{}
 const now=new Date(),et=new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'})),force=body.force===true
 if(!force&&et.getDay()!==1)return json({ok:true,skipped:'not_monday'})
 const monday=new Date(et);monday.setHours(0,0,0,0)
 if(!force){const{data:existing}=await admin.from('marketing_weekly_reports').select('id').eq('tenant_id',ADMIN_TENANT).gte('sent_at',monday.toISOString()).limit(1);if(existing?.length)return json({ok:true,skipped:'already_sent'})}
 const weekAgo=new Date(now.getTime()-7*86400000),twoWeeksAgo=new Date(now.getTime()-14*86400000)
 const [gscR,gaR,prevR,postsR,nextR,prosR,connR]=await Promise.all([
  admin.from('marketing_gsc_performance').select('impressions,clicks,position,query').gte('date',weekAgo.toISOString().slice(0,10)).order('clicks',{ascending:false}).limit(50),
  admin.from('marketing_ga4_traffic').select('sessions,users,channel').eq('product_id','taxres_crm').gte('date',weekAgo.toISOString().slice(0,10)).limit(1000),
  admin.from('marketing_ga4_traffic').select('sessions,users,channel').eq('product_id','taxres_crm').gte('date',twoWeeksAgo.toISOString().slice(0,10)).lt('date',weekAgo.toISOString().slice(0,10)).limit(1000),
  admin.from('linkedin_posts').select('id,title,body,category,published_at,linkedin_url').eq('tenant_id',ADMIN_TENANT).eq('status','published').gte('published_at',weekAgo.toISOString()).limit(100),
  admin.from('linkedin_posts').select('id,title,category,scheduled_at,status').eq('tenant_id',ADMIN_TENANT).in('status',['approved','draft']).gte('scheduled_at',now.toISOString()).order('scheduled_at',{ascending:true}).limit(10),
  admin.from('prospects').select('id,stage,source,created_at').gte('created_at',weekAgo.toISOString()).limit(1000),
  admin.from('linkedin_connections').select('display_name,expires_at').eq('tenant_id',ADMIN_TENANT).maybeSingle(),
 ])
 const gsc=gscR.data||[],ga=gaR.data||[],prev=prevR.data||[],posts=postsR.data||[],next=nextR.data||[],pros=prosR.data||[],conn=connR.data
 // Daily property totals are authoritative; channel rows are for attribution only.
 const totalRows=ga.filter((r:any)=>r.channel==='__TOTAL__'),prevTotalRows=prev.filter((r:any)=>r.channel==='__TOTAL__')
 const impressions=sum(gsc,'impressions'),clicks=sum(gsc,'clicks'),sessions=sum(totalRows,'sessions'),prevSessions=sum(prevTotalRows,'sessions'),users=sum(totalRows,'users')
 const organic=ga.filter((r:any)=>String(r.channel||'').toLowerCase().includes('organic')).reduce((s:number,r:any)=>s+Number(r.sessions||0),0)
 const social=ga.filter((r:any)=>/linkedin|social/i.test(String(r.channel||''))).reduce((s:number,r:any)=>s+Number(r.sessions||0),0)
 const demos=pros.filter((p:any)=>['Demo Booked','Demo Completed','Won'].includes(p.stage)).length,won=pros.filter((p:any)=>p.stage==='Won').length
 const daysLeft=conn?.expires_at?Math.floor((new Date(conn.expires_at).getTime()-now.getTime())/86400000):null
 const needsApproval=next.filter((p:any)=>p.status==='draft').length
 const actions:string[]=[];if(needsApproval)actions.push(`Approve ${needsApproval} LinkedIn draft(s)`);if(daysLeft!==null&&daysLeft<=14)actions.push(`LinkedIn token expires in ${daysLeft} days`);if(!ga.length)actions.push('GA4 data unavailable');if(!gsc.length)actions.push('GSC data unavailable')
 const pct=prevSessions?Math.round(((sessions-prevSessions)/prevSessions)*100):null
 const top=gsc.slice(0,5).map((r:any)=>`${r.query} (${r.clicks} clicks, pos ${Math.round(r.position||0)})`).join(' · ')||'N/A'
 const html=`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px"><h2>TaxRes CRM — Weekly Growth Report</h2><p><strong>Owner actions:</strong> ${actions.length?actions.join(' · '):'None'}</p><h3>SEO</h3><p>Impressions: <strong>${impressions}</strong> · Clicks: <strong>${clicks}</strong><br>Top queries: ${top}</p><h3>Traffic</h3><p>Sessions: <strong>${sessions}</strong>${pct===null?'':` (${pct>=0?'+':''}${pct}% vs prior week)`} · Users: <strong>${users}</strong><br>Organic: ${organic} · Social: ${social}</p><h3>LinkedIn</h3><p>Published last week: ${posts.length} · Upcoming: ${next.length} · Token: ${daysLeft===null?'Unknown':`${daysLeft} days`}</p><h3>Sales</h3><p>New prospects: ${pros.length} · Demos: ${demos} · Won: ${won}</p></div>`
 const send=await admin.functions.invoke('send-email',{body:{to:ADMIN_EMAIL,subject:`TaxRes CRM — Weekly Growth Report (${now.toLocaleDateString('en-US',{timeZone:'America/New_York'})})`,html,from_name:'TaxRes CRM Automation',from_email:ADMIN_EMAIL,tenant_id:ADMIN_TENANT}})
 if(send.error)return json({error:`Email failed: ${send.error.message}`},502)
 const{error:logErr}=await admin.from('marketing_weekly_reports').insert({tenant_id:ADMIN_TENANT,week_ending:now.toISOString().slice(0,10),sent_at:now.toISOString(),impressions:impressions||null,clicks:clicks||null,sessions:sessions||null,prospects_new:pros.length,demos,li_published:posts.length,owner_actions:actions.length})
 if(logErr)console.error('[weekly-growth-report] log failed',logErr.message)
 return json({ok:true,sent_to:ADMIN_EMAIL,owner_actions:actions})
})
