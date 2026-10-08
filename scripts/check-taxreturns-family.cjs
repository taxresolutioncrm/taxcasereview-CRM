const fs = require('fs')

const file = 'src/pages/TaxReturns.jsx'
const src = fs.readFileSync(file,'utf8')
const submit = fs.readFileSync('supabase/functions/submit-to-irs/index.ts','utf8')
const migration = fs.readFileSync('supabase/migrations/20260921124500_taxres_family_efile_tracking.sql','utf8')

const failures=[]
const need=(s,x,m)=>{if(!s.includes(x))failures.push(m)}
const forbid=(s,re,m)=>{if(re.test(s))failures.push(m)}

need(src,"const { user, myTenantId } = useApp()",'Tax Returns must resolve active tenant from AppContext')
need(src,".select('*').eq('tenant_id', myTenantId)",'Tax return list must be explicitly tenant-scoped')
need(src,"payload = toDbReturnPayload(form, {\n        tenant_id: myTenantId",'Tax return saves must persist tenant_id')
need(src,"client_id: selectedClient?.id ? String(selectedClient.id) : null",'Tax returns must link to the selected client id')
need(src,".delete().eq('tenant_id', myTenantId).eq('id', confirmDel)",'Tax return deletes must be tenant-scoped')
need(src,".update({ status, updated_at: new Date().toISOString() }).eq('tenant_id', myTenantId).eq('id', id)",'Tax return status changes must be tenant-scoped')
need(src,"filter:`tenant_id=eq.${myTenantId}`",'Tax Return realtime subscription must be tenant-scoped')
need(src,"triggerWorkflow('tax_return_filed', 'client', form.clientName || ''",'Filed workflow must use the active return client')
forbid(src,/ret\?\.clientName/,'Tax Returns still references undefined ret during manual filing')
forbid(src,/\['Romy Cruz',\s*'Dana Richard',\s*'Yesenia Gonzalez'\]/,'Tax Returns must not inject another office\'s employee names')
need(src,"* 2025 federal filing thresholds for returns generally filed in 2026.",'Filing-reference chart is not on the current filing season')
need(src,"'$15,750'",'2025 Single filing threshold missing')
need(src,"'$31,500'",'2025 joint filing threshold missing')
need(src,"'$25,625'",'2025 age-65 Head of Household threshold missing')

need(submit,".eq('tenant_id', tenantId)",'E-file edge function must scope return and settings to active tenant')
need(submit,"efin.length === 6",'E-file must require office EFIN')
need(submit,"adapterConfigured",'E-file status must expose transmitter readiness')
need(migration,'tenant_id uuid not null','Tax return e-file audit must require tenant_id')
need(migration,'tax_return_id uuid references public.tax_returns(id)','E-file audit must link to tax return')

if(failures.length){
 console.error('TaxRes family Tax Returns check FAILED:')
 failures.forEach(f=>console.error(' - '+f))
 process.exit(1)
}
console.log('TaxRes family Tax Returns check PASS')
