const fs=require('node:fs')
const failures=[]
const read=p=>fs.readFileSync(p,'utf8')
const requireMarker=(source,marker,label)=>{if(!source.includes(marker))failures.push(label+' missing: '+marker)}

const office=read('src/pages/NewOffice.jsx')
for(const [marker,label] of [
  ["restore_relay","Restore Relay product selector"],
  ["onboard_restore_relay","Restore Relay server onboarding"],
  ["admin_romylabs_upsert_office_registry","central external office registry"],
  ["admin_romylabs_link_external_office","signed sale external office link"],
  ["https://restorerelay.com/login","Restore Relay owner login"],
  ["RESTORE_RELAY_PLAN_OPTIONS","Restore Relay plan options"],
  ["value:'scale'","Restore Relay Scale plan"],
  ["external_office_id","external office duplicate guard"],
  ["admin_romylabs_office_registry","cross-product CRM Companies list"],
]) requireMarker(office,marker,label)

const proxy=read('supabase/functions/hub-proxy/index.ts')
for(const marker of ["body.action === 'onboard_restore_relay'","RESTORE_RELAY_SUPPORT_SECRET","yuwxzuybzuqnnldvdenx.supabase.co/functions/v1/provision-tenant","x-romylabs-support-secret"]){
  requireMarker(proxy,marker,'Restore Relay onboarding proxy')
}

const migration=read('supabase/migrations/20261005091500_restore_relay_external_office_handoff.sql')
for(const marker of ["external_product_key","external_office_id","admin_romylabs_link_external_office","romylabs_office_registry","admin_romylabs_agreements_for_prospect"]){
  requireMarker(migration,marker,'Restore Relay external office handoff migration')
}

const agreements=read('src/components/admin/RomyLabsAgreementPanel.jsx')
for(const marker of ["row.external_office_id","prospect?.external_office_id","Office created and linked to this signed sale"]){
  requireMarker(agreements,marker,'Restore Relay agreement handoff state')
}

if(failures.length){
  console.error('Restore Relay onboarding verification FAILED')
  failures.forEach(x=>console.error(' - '+x))
  process.exit(1)
}
console.log('Restore Relay onboarding verification PASS')
