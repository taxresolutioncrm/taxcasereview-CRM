// platform-metrics — TCR live metrics endpoint for the Admin Portal hub
// Accepts ?view=tcr (Tax Case Review practice) | ?view=saas (Tax Res CRM SaaS) | ?view=nash (Nashville)
// Called on-demand by the hub when a product card is clicked.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hub-secret',
}

const TCR_TENANT_ID  = '61a89aef-0e7e-4ea2-b222-44ab2024655a'
const NASH_TENANT_ID = '489ace07-1a6b-4864-833a-4f8420568b40'
const DEMO_RUNTIME_TENANT_ID = 'a0000000-0000-0000-0000-000000000001'
const ADMIN_CODE     = 'ADMIN'
const TCR_CODE       = 'TRC-001'
const DEMO_CODE      = 'DEMO'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const hubSecret = req.headers.get('x-hub-secret')
  if (hubSecret !== Deno.env.get('HUB_METRICS_SECRET')) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
  const url  = new URL(req.url)
  const view = url.searchParams.get('view') || 'saas'
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    const now = new Date()
    const tenantView = async (tenantId:string, product:string, label:string, mrrFallback:number, demoScope=false) => {
      const today = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
      const [{ count: totalClientCount },{ count: activeClientCount },{ count: totalLeadCount },{ count: activeLeadCount },{ count: taskCount },{ count: caseCount },{ data: docs },{ data: tenantStorage },{ count: storageObjectCount },{ count: pendingEsignCount },{ count: demosTodayCount },{ data: recentActivity },{ data: employees },{ data: tenant }] = await Promise.all([
        supabase.from('clients').select('*',{count:'exact',head:true}).eq('tenant_id',tenantId),
        supabase.from('clients').select('*',{count:'exact',head:true}).eq('tenant_id',tenantId).is('deleted_at',null),
        supabase.from('leads').select('*',{count:'exact',head:true}).eq('tenant_id',tenantId),
        supabase.from('leads').select('*',{count:'exact',head:true}).eq('tenant_id',tenantId).is('deleted_at',null),
        supabase.from('tasks').select('*',{count:'exact',head:true}).eq('tenant_id',tenantId).eq('done',false).or('deleted.is.null,deleted.eq.false'),
        supabase.from('cases').select('*',{count:'exact',head:true}).eq('tenant_id',tenantId),
        supabase.from('documents').select('file_size').eq('tenant_id',tenantId),
        supabase.rpc('_admin_tenant_storage_bytes',{p_tenant_id:tenantId}),
        supabase.schema('storage').from('objects').select('id',{count:'exact',head:true}).like('name',`%${tenantId}%`),
        supabase.from('esigns').select('id',{count:'exact',head:true}).eq('tenant_id',tenantId).or('status.ilike.pending,status.ilike.sent,status.ilike.awaiting'),
        supabase.from('calevents').select('id',{count:'exact',head:true}).eq('tenant_id',tenantId).ilike('eventType','%demo%').eq('date',today),
        supabase.from('activity_log').select('description,created_at,employee_email').eq('tenant_id',tenantId).order('created_at',{ascending:false}).limit(50),
        supabase.from('employees').select('id,email').eq('tenant_id',tenantId).ilike('status','active'),
        supabase.from('tenants').select('monthly_rate,per_seat_rate,billing_seats').eq('id',tenantId).maybeSingle(),
      ])
      const documentStorage=(docs||[]).reduce((s:number,d:any)=>s+Number(d.file_size||0),0)
      const totalStorage=Number(tenantStorage ?? documentStorage ?? 0)
      const storageFiles=Math.max(Number(storageObjectCount||0),Array.isArray(docs)?docs.length:0)
      const isDemoEmployee = (email:string) => {
        const normalized=String(email||'').trim().toLowerCase()
        return normalized==='demo@taxrescrm.net' || normalized.endsWith('@taxrescrm.demo')
      }
      const scopedEmployees=(employees||[]).filter((e:any)=>!demoScope || isDemoEmployee(e.email))
      const scopedEmails=new Set(scopedEmployees.map((e:any)=>String(e.email||'').trim().toLowerCase()).filter(Boolean))
      const scopedRecentActivity=(recentActivity||[]).filter((n:any)=>{
        if(!demoScope) return true
        return scopedEmails.has(String(n.employee_email||'').trim().toLowerCase())
      })
      let authLastSignIn:string|null=null
      if(scopedEmails.size){
        const {data:authUsers,error:authUsersError}=await supabase.auth.admin.listUsers({page:1,perPage:1000})
        if(authUsersError) console.warn('platform-metrics auth activity unavailable:',authUsersError.message)
        for(const user of authUsers?.users||[]){
          const email=String(user.email||'').trim().toLowerCase()
          if(!scopedEmails.has(email) || !user.last_sign_in_at) continue
          if(!authLastSignIn || new Date(user.last_sign_in_at).getTime()>new Date(authLastSignIn).getTime()) authLastSignIn=user.last_sign_in_at
        }
      }
      const logLast=String(scopedRecentActivity[0]?.created_at||'') || null
      const activityTimes=[logLast,authLastSignIn].filter(Boolean) as string[]
      const lastActivity=activityTimes.length
        ? activityTimes.reduce((latest,current)=>new Date(current).getTime()>new Date(latest).getTime()?current:latest)
        : null
      const staffCount=scopedEmployees.length
      const computedMrr=Number(tenant?.monthly_rate || 0)
        || (Number(tenant?.per_seat_rate || 0) * Number(tenant?.billing_seats || 0))
        || mrrFallback
      return {
        ok:true,product,product_label:label,fetched_at:now.toISOString(),
        metrics:{
          mrr:computedMrr,arr:computedMrr*12,
          total_clients:totalClientCount||0,
          active_clients:activeClientCount||0,
          total_leads:totalLeadCount||0,
          active_leads:activeLeadCount||0,
          active_staff:staffCount,
          active_users:staffCount,
          open_jobs:caseCount||0,
          pending_tasks:taskCount||0,
          pending_esigns:pendingEsignCount||0,
          demos_today:demosTodayCount||0,
          storage_bytes:totalStorage,
          storage_objects:storageFiles,
          storage_files:storageFiles,
          last_activity:lastActivity,
          active_offices:1,total_offices:1
        },
        offices:[{
          id:tenantId,name:label,is_active:true,mrr:computedMrr,
          total_clients:totalClientCount||0,
          active_clients:activeClientCount||0,
          client_count:totalClientCount||0,
          total_leads:totalLeadCount||0,
          active_leads:activeLeadCount||0,
          lead_count:totalLeadCount||0,
          active_staff:staffCount,
          employee_count:staffCount,
          open_jobs:caseCount||0,
          job_count:caseCount||0,
          pending_tasks:taskCount||0,
          pending_esigns:pendingEsignCount||0,
          demos_today:demosTodayCount||0,
          storage_bytes:totalStorage,
          storage_objects:storageFiles,
          storage_files:storageFiles,
          last_activity:lastActivity
        }],
        recent_activity:scopedRecentActivity.slice(0,5).map((n:any)=>({text:(n.description||'').slice(0,120),at:n.created_at,by:n.employee_email}))
      }
    }
    if(view==='tcr') return new Response(JSON.stringify(await tenantView(TCR_TENANT_ID,'tax_case_review','Tax Case Review',0)),{headers:{...cors,'Content-Type':'application/json'}})
    if(view==='nash') return new Response(JSON.stringify(await tenantView(NASH_TENANT_ID,'nashville','Nashville Tax Solutions',0)),{headers:{...cors,'Content-Type':'application/json'}})
    if(view==='cloudcpa') return new Response(JSON.stringify(await tenantView('ecd3d3ce-016a-4bb4-800e-f090f51e4cae','cloudcpa','CloudCPA Inc',0)),{headers:{...cors,'Content-Type':'application/json'}})
    if(view==='demo') return new Response(JSON.stringify(await tenantView(DEMO_RUNTIME_TENANT_ID,'taxres_demo','Tax Res CRM Demo',0,true)),{headers:{...cors,'Content-Type':'application/json'}})

    const {data:tenants}=await supabase.from('tenants').select('id,firm_name,tenant_code,monthly_rate,created_at').not('tenant_code','in',`(${ADMIN_CODE},${TCR_CODE},${DEMO_CODE})`).neq('id',NASH_TENANT_ID)
    const tenantIds=(tenants||[]).map((t:any)=>t.id)
    const scoped = <T>(q:T):T => (tenantIds.length ? (q as any).in('tenant_id',tenantIds) : (q as any).eq('tenant_id','00000000-0000-0000-0000-000000000000'))
    const [{count:clientCount},{count:leadCount},{count:taskCount},{data:docs},{data:recentActivity},{data:employees}] = await Promise.all([
      scoped(supabase.from('clients').select('*',{count:'exact',head:true})),
      scoped(supabase.from('leads').select('*',{count:'exact',head:true})),
      scoped(supabase.from('tasks').select('*',{count:'exact',head:true}).eq('done',false).or('deleted.is.null,deleted.eq.false')),
      scoped(supabase.from('documents').select('file_size')),
      scoped(supabase.from('activity_log').select('description,created_at,employee_email')).order('created_at',{ascending:false}).limit(5),
      scoped(supabase.from('employees').select('id')).limit(200)
    ])
    const totalMRR=(tenants||[]).reduce((s:number,t:any)=>s+Number(t.monthly_rate||0),0)
    const totalStorage=(docs||[]).reduce((s:number,d:any)=>s+Number(d.file_size||0),0)
    return new Response(JSON.stringify({ok:true,product:'taxres_crm',product_label:'Tax Res CRM',fetched_at:now.toISOString(),metrics:{mrr:totalMRR,arr:totalMRR*12,active_clients:clientCount||0,active_leads:leadCount||0,pending_tasks:taskCount||0,storage_bytes:totalStorage,active_offices:(tenants||[]).length,total_offices:(tenants||[]).length,active_users:(employees||[]).length},offices:(tenants||[]).map((t:any)=>({id:t.id,name:t.firm_name,is_active:true,mrr:t.monthly_rate||0,since:t.created_at?.slice(0,10)})),recent_activity:(recentActivity||[]).map((n:any)=>({text:(n.description||'').slice(0,120),at:n.created_at,by:n.employee_email}))}),{headers:{...cors,'Content-Type':'application/json'}})
  } catch(err){console.error('platform-metrics error:',err);return new Response(JSON.stringify({ok:false,error:String(err)}),{status:500,headers:{...cors,'Content-Type':'application/json'}})}
})
