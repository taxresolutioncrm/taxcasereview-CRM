import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'

const admin=readFileSync('src/pages/AdminPortal.jsx','utf8')
const billing=readFileSync('src/components/admin/RomyLabsBilling.jsx','utf8')
const esign=readFileSync('src/pages/ESignaturesHub.jsx','utf8')
assert(admin.includes("supabase.rpc('admin_romylabs_office_registry')"),'Admin must load office registry')
assert(admin.includes("product:operationalProduct"),'Registry offices must belong to their product')
assert(admin.includes("firm_name:office.firm_name"),'Registered business name must display')
assert(admin.includes("primary_contact_name:office.primary_contact_name"),'Registered contact name must propagate')
assert(admin.includes("primary_contact_email:office.primary_contact_email"),'Registered contact email must propagate')
assert(admin.includes("primary_contact_name:registryMatch.primary_contact_name"),'Offline office detail must retain owner contact')
assert(admin.includes("pool_crm:      { label:'PoolVerge'"),'PoolVerge office must have correct product label and app route')
assert(billing.includes("supabase.rpc('admin_romylabs_office_registry')"),'Billing should offer registered offices')
assert(billing.includes("registeredOffice:office"),'External office needs an actual selection record')
assert(billing.includes("registeredWithoutBilling"),'Unbilled offices must appear as records, not fabricated accounts')
assert(billing.includes("seat_count:'',per_seat_rate:''"),'No invented purchased seats or rate')
assert(esign.includes("pool_crm:'PoolVerge'"),'E-signatures must show PoolVerge brand')
for(const source of [admin,billing,esign]){
 assert(!source.includes('cfaa3025-42d5-4b7e-93f0-55d402603f09'),'Do not hard-code a real office UUID into components')
 assert(!source.includes('jon@lakesidepoolsfl.com'),'Do not hard-code user contact details into components')
}
console.log('PASS PoolVerge business office registry, company details, billing visibility, and e-sign source checks')
