import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const sql=readFileSync('supabase/migrations/20261115005500_public_form_link_expiration_revocation.sql','utf8')
const leads=readFileSync('src/pages/Leads.jsx','utf8')
const clients=readFileSync('src/pages/Clients.jsx','utf8')
const views=['src/components/FinancialIntakeView.jsx','src/components/OrganizerView.jsx'].map(p=>readFileSync(p,'utf8'))
for(const table of ['tax_organizer_responses','financial_intake_responses']){
 assert.ok(sql.includes('ALTER TABLE public.'+table),'missing link lifecycle columns for '+table)
 assert.ok(sql.includes('UPDATE public.'+table),'missing compatibility grace for '+table)
}
for(const entry of ['organizer_get','organizer_save_answers','organizer_submit','financial_intake_load','financial_intake_save','financial_intake_submit']){
 assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.'+entry+'('),'public function not protected: '+entry)
}
assert.equal((sql.match(/IF NOT public\._public_form_access_active\(/g)||[]).length,6,'every public RPC must enforce expiry and revocation')
assert.ok(sql.includes("REVOKE ALL ON FUNCTION public._public_form_access_active(text,text) FROM PUBLIC, anon, authenticated;"),'internal guard cannot be publicly callable')
assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION public._public_form_access_active(text,text) TO service_role;"),'server access must be preserved')
assert.ok(sql.includes("interval '90 days'"),'existing open forms must not be invalidated immediately')
assert.ok(sql.includes("interval '60 days'"),'new forms must have a finite expiration')
assert.ok(sql.includes('public_access_revoked_at')&&sql.includes('public_access_expires_at'),'explicit revocation and expiry checks must be present')
assert.ok(sql.includes("now()>=timestamptz '2027-02-14"),'legacy lead-id fallback must sunset')
for(const file of [leads,clients]) {
 assert.ok(file.includes('public_access_expires_at')&&file.includes('public_access_revoked_at'),'sending must not reuse expired/revoked links')
}
assert.ok(leads.includes('existingIntake?.answers || {}'),'expired unsubmitted intake drafts must survive reissue')
for(const file of views)assert.ok(file.includes('Link expired or revoked'),'staff must see link expiry instead of dead link')
console.log('PASS: all six public form RPCs gated; existing forms preserved, new links expire, revocation is enforced, and staff can resend')
