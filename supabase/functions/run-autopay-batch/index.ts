import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type,x-cron-secret',
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...corsHeaders,'Content-Type':'application/json'}
})
function advanceDate(dateStr:string,frequency:string){
  const d=new Date(dateStr+'T00:00:00')
  if(frequency==='weekly')d.setDate(d.getDate()+7)
  else if(frequency==='biweekly')d.setDate(d.getDate()+14)
  else d.setMonth(d.getMonth()+1)
  return d.toISOString().slice(0,10)
}

serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  if(req.method!=='POST')return json({error:'Method not allowed'},405)

  try{
    const SUPABASE_URL=Deno.env.get('SUPABASE_URL')??''
    const SERVICE_ROLE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??''
    const CRON_SECRET=Deno.env.get('AUTOPAY_CRON_SECRET')??''
    if(!SUPABASE_URL||!SERVICE_ROLE_KEY)return json({error:'Server configuration missing'},500)

    // Existing deployments may still use a service-role bearer token. Prefer
    // the dedicated cron secret when configured; never accept an unauthenticated
    // public request that can move money.
    const auth=req.headers.get('authorization')||''
    const bearer=auth.toLowerCase().startsWith('bearer ')?auth.slice(7).trim():''
    const cron=req.headers.get('x-cron-secret')||''
    const authorized=(CRON_SECRET&&cron===CRON_SECRET)||bearer===SERVICE_ROLE_KEY
    if(!authorized)return json({error:'Unauthorized'},401)

    const db=createClient(SUPABASE_URL,SERVICE_ROLE_KEY)
    const today=new Date().toISOString().slice(0,10)
    const {data:clients,error}=await db.from('clients')
      .select('id,name,tenant_id,autopay_enabled,autopay_amount,autopay_frequency,autopay_next_charge')
      .eq('autopay_enabled',true)
      .not('autopay_amount','is',null)
      .not('autopay_next_charge','is',null)
      .lte('autopay_next_charge',today)
    if(error)throw new Error(error.message)

    const due=clients||[]
    if(!due.length)return json({success:true,charged:0,failed:0,skipped:0,message:'Nothing due today'})

    const tenantIds=[...new Set(due.map(c=>c.tenant_id).filter(Boolean))]
    const [{data:settings},{data:tenants}]=await Promise.all([
      db.from('settings').select('tenant_id,name,payment_provider').in('tenant_id',tenantIds),
      db.from('tenants').select('id,stripe_connect_account_id').in('id',tenantIds),
    ])
    const settingsBy=new Map((settings||[]).map(s=>[s.tenant_id,s]))
    const tenantBy=new Map((tenants||[]).map(t=>[t.id,t]))
    const platformTenants=new Set([
      '61a89aef-0e7e-4ea2-b222-44ab2024655a',
      'a0000000-0000-0000-0000-000000000001',
      '518808b4-10dd-47fd-900e-6c3fc1ff2e7e',
    ])

    const results:any[]=[]
    for(const c of due){
      const cfg:any=settingsBy.get(c.tenant_id)
      const tenant:any=tenantBy.get(c.tenant_id)
      const stripeReady=cfg?.payment_provider==='stripe'&&(platformTenants.has(c.tenant_id)||!!tenant?.stripe_connect_account_id)
      if(!stripeReady){
        results.push({tenant_id:c.tenant_id,name:c.name,amount:c.autopay_amount,ok:false,skipped:true,msg:'Office payment processor not connected'})
        continue
      }
      try{
        const res=await fetch(`${SUPABASE_URL}/functions/v1/stripe-charge`,{
          method:'POST',
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${SERVICE_ROLE_KEY}`},
          body:JSON.stringify({clientId:c.id,tenant_id:c.tenant_id,amount:c.autopay_amount,source:'autopay'}),
        })
        const data=await res.json()
        const ok=res.ok&&!data?.error
        results.push({tenant_id:c.tenant_id,name:c.name,amount:c.autopay_amount,ok,skipped:false,msg:ok?'Charged':(data?.error||'Charge failed')})
        if(ok){
          const nextDate=c.autopay_frequency==='one-time'?null:advanceDate(c.autopay_next_charge,c.autopay_frequency)
          await db.from('clients').update({
            autopay_next_charge:nextDate,
            autopay_enabled:c.autopay_frequency!=='one-time',
          }).eq('id',c.id).eq('tenant_id',c.tenant_id)
        }
      }catch(e){
        results.push({tenant_id:c.tenant_id,name:c.name,amount:c.autopay_amount,ok:false,skipped:false,msg:e instanceof Error?e.message:'Charge failed'})
      }
    }

    // One summary per office. Never mix client names or payment outcomes across tenants.
    for(const tenantId of tenantIds){
      const tenantResults=results.filter(r=>r.tenant_id===tenantId&&!r.skipped)
      if(!tenantResults.length)continue
      try{
        const cfg:any=settingsBy.get(tenantId)
        const firmName=cfg?.name||'Tax Office'
        const {data:admins}=await db.from('employees')
          .select('email').eq('tenant_id',tenantId)
          .in('access',['Super Admin','Admin']).not('email','is',null)
        const recipients=[...new Set((admins||[]).map(a=>a.email).filter(Boolean))]
        const succeeded=tenantResults.filter(r=>r.ok)
        const failed=tenantResults.filter(r=>!r.ok)
        const rowsHtml=tenantResults.map(r=>
          `<tr><td style="padding:4px 8px;color:#334155">${r.name}</td><td style="padding:4px 8px;text-align:right">$${Number(r.amount).toFixed(2)}</td><td style="padding:4px 8px;color:${r.ok?'#16a34a':'#dc2626'}">${r.ok?'✅ Charged':'❌ '+r.msg}</td></tr>`
        ).join('')
        const html=`<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px"><div style="font-size:18px;font-weight:800;color:#1d4ed8;margin-bottom:8px">${firmName}</div><p style="font-size:14px;color:#334155">Today's autopay batch: <strong>${succeeded.length} charged</strong>${failed.length?`, <strong style="color:#dc2626">${failed.length} failed</strong>`:''}.</p><table style="font-size:13px;border-collapse:collapse;margin-top:10px">${rowsHtml}</table></div>`
        await Promise.all(recipients.map(to=>fetch(`${SUPABASE_URL}/functions/v1/send-email`,{
          method:'POST',
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${SERVICE_ROLE_KEY}`},
          body:JSON.stringify({tenant_id:tenantId,to,subject:`Autopay batch — ${succeeded.length} charged${failed.length?`, ${failed.length} failed`:''}`,html}),
        }).catch(()=>null)))
      }catch(e){console.error('autopay tenant summary email error',tenantId,e)}
    }

    return json({
      success:true,
      charged:results.filter(r=>r.ok).length,
      failed:results.filter(r=>!r.ok&&!r.skipped).length,
      skipped:results.filter(r=>r.skipped).length,
      results,
    })
  }catch(err){
    console.error('run-autopay-batch error:',err)
    return json({error:err instanceof Error?err.message:'Batch run failed'},500)
  }
})
