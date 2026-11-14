import assert from 'node:assert/strict'
import { existsSync,readFileSync } from 'node:fs'
assert.ok(!existsSync('supabase/migrations/esign_rpc_conversion.sql'), 'unsafe unnumbered e-sign conversion cannot be active')
const archived=readFileSync('supabase/quarantine/legacy_esign_rpc_conversion_DO_NOT_RUN.sql','utf8')
assert.ok(archived.startsWith('-- HISTORICAL ONLY / DO NOT EXECUTE.'), 'legacy migration must clearly be marked do not execute')
const lockdown=readFileSync('supabase/migrations/20261114014500_esign_legacy_rpc_public_execute_lockdown.sql','utf8')
for (const name of ['esign_load(text)','esign_mark_signed(text,text,text,text,text)','esign_finalize(text,text,text,text,text,timestamptz,text,text,jsonb,bigint)']) {
  assert.ok(lockdown.includes('REVOKE ALL ON FUNCTION public.'+name), 'lockdown must revoke '+name)
}
console.log('PASS: unsafe unnumbered e-sign migration archived; mandatory legacy RPC lockdown preserved')
