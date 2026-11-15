import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const migration=readFileSync('supabase/migrations/20261114203000_portal_legacy_upload_rpc_lockdown.sql','utf8')
const portal=readFileSync('src/pages/ClientPortal.jsx','utf8')
const edge=readFileSync('supabase/functions/portal-action/index.ts','utf8')
const sig='public.portal_action_upload_document(text,text,text,text,bigint)'
assert.ok(migration.includes('REVOKE ALL ON FUNCTION '+sig+' FROM PUBLIC, anon, authenticated;'),'legacy URL-only upload RPC must not be callable directly')
assert.ok(migration.includes('GRANT EXECUTE ON FUNCTION '+sig+' TO service_role;'),'server-side compatibility retained')
assert.ok(portal.includes("supabase.functions.invoke('portal-action'"),'client must use portal-action')
assert.ok(portal.includes("type: 'upload_document', token: portalToken"),'client must supply portal session token')
assert.ok(!portal.includes("rpc('portal_action_upload_document'"),'client must never call legacy RPC')
for(const key of ['fileBase64','ALLOWED_MIME','MAX_FILE_BYTES','crypto.randomUUID()','supabase.storage.from(\'documents\').upload'])
  assert.ok(edge.includes(key),'protected server upload invariant missing: '+key)
assert.ok(!edge.includes("rpc('portal_action_upload_document'"),'Edge Function must not depend on legacy RPC')
console.log('PASS: browser portal uploads through validated Edge Function; legacy URL-only RPC execution is restricted')
