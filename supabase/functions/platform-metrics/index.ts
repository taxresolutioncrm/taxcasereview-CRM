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
    const tenantView = async (tenantId:string, product:string, label:string, mrrFallback:number) => {
      const [{ count: clientCount },{ count: leadCount },{ count: taskCount },{ count: caseCount },{ data: docs },{ data: storageObjects },{ data: recentActivity },{ data: employees },{ data: tenant }] = await Promise.all([
        supabase.from('clients').select('*',{count:'exact',head:true}).eq('tenant_id',tenantId).is('deleted_at',null),
        supabase.from('leads').select('*',{count:'exact',head:true}).eq('tenant_id',tenantId).is('deleted_at',null),
        supabase.from('tasks').select('*',{count:'exact',head:true}).eq('tenant_id',tenantId).eq('done',false).or('deleted.is.null,deleted.eq.false'),
        supabase.from('cases').select('*',{count:'exact',head:true}).eq('tenant_id',tenantId),
        supabase.from('documents').select('file_size').eq('tenant_id',tenantId),
        supabase.schema('storage').from('objects').select('metadata').ilike('name',`%${tenantId}%`),
        supabase.from('activity_log').select('description,created_at,employee_email').eq('tenant_id',tenantId).order('created_at',{ascending:false}).limit(5),
        supabase.from('employees').select('id').eq('tenant_id',tenantId).ilike('status','active'),
        supabase.from('tenants').select('monthly_rate,per_seat_rate,billing_seats').eq('id',tenantId).maybeSingle(),
      ])
      const trackedDocumentStorage=(docs||[]).reduce((s:number,d:any)=>s+Number(d.file_size||0),0)
      const objectStorage=(storageObjects||[]).reduce((s:number,o:any)=>s+Number(o?.metadata?.size||0),0)
      const totalStorage=objectStorage > 0 ? objectStorage : trackedDocumentStorage
      const staffCount=(employees||[]).length
      const computedMrr=Number(tenant?.monthly_rate || 0)
        || (Number(tenant?.per_seat_rate || 0) * Number(tenant?.billing_seats || 0))
        || mrrFallback
      return {
        ok:true,product,product_label:label,fetched_at:now.toISOString(),
        metrics:{
          mrr:computedMrr,arr:computedMrr*12,
          active_clients:clientCount||0,
          active_leads:leadCount||0,
          active_staff:staffCount,
          active_users:staffCount,
          open_jobs:caseCount||0,
          pending_tasks:taskCount||0,
          storage_bytes:totalStorage,
          active_offices:1,total_offices:1
        },
        offices:[{
          id:tenantId,name:label,is_active:true,mrr:computedMrr,
          active_clients:clientCount||0,
          client_count:clientCount||0,
          active_leads:leadCount||0,
          lead_count:leadCount||0,
          active_staff:staffCount,
          employee_count:staffCount,
          open_jobs:caseCount||0,
          job_count:caseCount||0,
          pending_tasks:taskCount||0,
          storage_bytes:totalStorage
        }],
        recent_activity:(recentActivity||[]).map((n:any)=>({text:(n.description||'').slice(0,120),at:n.created_at,by:n.employee_email}))
      }
    }
    if(view==='tcr') return new Response(JSON.stringify(await tenantView(TCR_TENANT_ID,'tax_case_review','Tax Case Review',0)),{headers:{...cors,'Content-Type':'application/json'}})
    if(view==='nash') return new Response(JSON.stringify(await tenantView(NASH_TENANT_ID,'nashville','Nashville Tax Solutions',1625)),{headers:{...cors,'Content-Type':'application/json'}})
    if(view==='cloudcpa') return new Response(JSON.stringify(await tenantView('ecd3d3ce-016a-4bb4-800e-f090f51e4cae','cloudcpa','CloudCPA Inc',0)),{headers:{...cors,'Content-Type':'application/json'}})

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
