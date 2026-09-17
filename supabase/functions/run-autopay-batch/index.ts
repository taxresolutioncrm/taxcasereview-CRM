import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const DEMO_TENANT='a0000000-0000-0000-0000-000000000001'

function advanceDate(dateStr, frequency) {
  const d = new Date(dateStr + 'T00:00:00')
  if (frequency === 'weekly') d.setDate(d.getDate() + 7)
  else if (frequency === 'biweekly') d.setDate(d.getDate() + 14)
  else d.setMonth(d.getMonth() + 1)
  return d.toISOString().slice(0, 10)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const today = new Date().toISOString().slice(0, 10)
    const { data: clients, error } = await supabase.from('clients')
      .select('id,name,tenant_id,autopay_enabled,autopay_amount,autopay_frequency,autopay_next_charge')
      .eq('autopay_enabled', true)
      .not('tenant_id','is',null)
      .not('autopay_amount', 'is', null)
      .not('autopay_next_charge', 'is', null)
      .lte('autopay_next_charge', today)

    if (error) throw new Error(error.message)
    const due = clients || []

    if (due.length === 0) {
      return new Response(JSON.stringify({ success: true, charged: 0, message: 'Nothing due today' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const results:any[] = []
    for (const c of due) {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/stripe-charge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ clientId: c.id, amount: c.autopay_amount, source: 'autopay' }),
        })
        const data = await res.json()
        const ok = res.ok && !data?.error
        results.push({ name: c.name, tenant_id:c.tenant_id, amount: c.autopay_amount, ok, msg: ok ? 'Charged' : (data?.error || 'Charge failed') })

        if (ok) {
          const nextDate = c.autopay_frequency === 'one-time' ? null : advanceDate(c.autopay_next_charge, c.autopay_frequency)
          await supabase.from('clients').update({
            autopay_next_charge: nextDate,
            autopay_enabled: c.autopay_frequency !== 'one-time',
          }).eq('id', c.id).eq('tenant_id',c.tenant_id)
        }
      } catch (e) {
        results.push({ name: c.name, tenant_id:c.tenant_id, amount: c.autopay_amount, ok: false, msg: e.message || 'Charge failed' })
      }
    }

    try {
      const tenantIds=[...new Set(results.map(r=>r.tenant_id).filter(Boolean))]
      for(const tenantId of tenantIds){
        const tenantResults=results.filter(r=>r.tenant_id===tenantId)
        const succeeded=tenantResults.filter(r=>r.ok),failed=tenantResults.filter(r=>!r.ok)
        const [{data:admins},{data:settings}]=await Promise.all([
          supabase.from('employees').select('email').eq('tenant_id',tenantId).in('access',['Super Admin','Admin']).not('email','is',null),
          supabase.from('settings').select('name,firmname').eq('tenant_id',tenantId).maybeSingle(),
        ])
        const recipients=[...new Set((admins||[]).map((a:any)=>a.email).filter(Boolean))]
        if(!recipients.length)continue
        const firmName=settings?.name||settings?.firmname||'TaxRes CRM'
        const rowsHtml=tenantResults.map(r=>`<tr><td style="padding:4px 8px;color:#334155">${r.name}</td><td style="padding:4px 8px;text-align:right">$${Number(r.amount).toFixed(2)}</td><td style="padding:4px 8px;color:${r.ok?'#16a34a':'#dc2626'}">${r.ok?'✅ Charged':'❌ '+r.msg}</td></tr>`).join('')
        const html=`<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px"><div style="font-size:18px;font-weight:800;color:#1d4ed8;margin-bottom:8px">${firmName}</div><p style="font-size:14px;color:#334155">Today's autopay batch ran automatically: <strong>${succeeded.length} charged</strong>${failed.length?`, <strong style="color:#dc2626">${failed.length} failed</strong>`:''}.</p><table style="font-size:13px;border-collapse:collapse;margin-top:10px">${rowsHtml}</table></div>`
        const mailFn=String(tenantId)===DEMO_TENANT?'demo-send-email':'send-email'
        await Promise.all(recipients.map(to=>fetch(`${SUPABASE_URL}/functions/v1/${mailFn}`,{
          method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${SERVICE_ROLE_KEY}`},
          body:JSON.stringify({to,tenant_id:tenantId,subject:`Autopay batch — ${succeeded.length} charged${failed.length?`, ${failed.length} failed`:''}`,html}),
        }).catch(()=>{})))
      }
    } catch (e) {
      console.error('autopay summary email error:', e)
    }

    return new Response(JSON.stringify({ success: true, charged: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('run-autopay-batch error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Batch run failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
