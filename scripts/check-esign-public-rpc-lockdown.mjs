import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const migration=readFileSync('supabase/migrations/20261114014500_esign_legacy_rpc_public_execute_lockdown.sql','utf8')
const archive=readFileSync('supabase/functions/esign-archive-upload/index.ts','utf8')
const sign=readFileSync('src/pages/SignPage.jsx','utf8')
for (const sig of [
  'esign_load(text)',
  'esign_mark_signed(text,text,text,text,text)',
  'esign_track_event(text,text,integer,text,text,jsonb)',
  'esign_finalize(text,text,text,text,text,timestamptz,text,text,jsonb,bigint)',
]) {
  assert.ok(migration.includes('REVOKE ALL ON FUNCTION public.'+sig+' FROM PUBLIC, anon, authenticated;'),sig+' must not be anonymously callable')
  assert.ok(migration.includes('GRANT EXECUTE ON FUNCTION public.'+sig+' TO service_role;'),sig+' service-role signing archive must remain available')
}
assert.ok(archive.includes(".eq('id',id).eq('signer_token',token)"), 'public signing must validate signer token against record')
assert.ok(archive.includes("db.rpc('esign_finalize'"), 'service-role finalization must remain available')
assert.ok(sign.includes("supabase.functions.invoke('esign-archive-upload'"), 'public SignPage must use token-validated Edge Function')
assert.ok(!sign.includes("supabase.rpc('esign_mark_signed'"), 'public signer must not call legacy RPC')
console.log('PASS: public e-sign requires token-validated Edge Function; legacy ID-only RPCs revoked for browser roles')
