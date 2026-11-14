import assert from 'node:assert/strict'
import fs from 'node:fs'
import {spawnSync} from 'node:child_process'
const file='scripts/staging-security-negative-tests.mjs'
const source=fs.readFileSync(file,'utf8')
const workflow=fs.readFileSync('.github/workflows/shared-tax-staging-security.yml','utf8')
const syntax=spawnSync(process.execPath,['--check',file],{encoding:'utf8'})
assert.equal(syntax.status,0,'staging negative test syntax check failed: '+syntax.stderr)
for(const ref of ['mpxgxfqdbquzkrvvejkh','ydrvncdedgjtcprczwpu','txrcnfhrfqbtuchwznzz']) assert.ok(source.includes(ref),'must block known live project '+ref)
for(const required of ['STAGING_SUPABASE_URL','STAGING_SUPABASE_ANON_KEY','STAGING_TEST_ACCOUNTS_JSON','STAGING_ALLOW_SYNTHETIC_WRITES','STAGING_PENTEST_','current_tenant_id','esign_load','esign_mark_signed','stripe-set-autopay','readonly']) assert.ok(source.includes(required),'missing safety control '+required)
assert.ok(workflow.includes('workflow_dispatch:')&&!/\n\s+(push|schedule|pull_request):/.test(workflow),'must only permit manual sandbox run')
assert.ok(workflow.includes('contents: read'),'action must be read-only')
assert.ok(!source.includes('SERVICE_ROLE_KEY'),'test must not use elevated database credentials')
const refused=spawnSync(process.execPath,[file],{encoding:'utf8',env:{PATH:process.env.PATH||'',HOME:process.env.HOME||''}})
assert.equal(refused.status,2,'no-config staging test must fail closed')
console.log('PASS: staging pen-test syntax, production ban, synthetic-only checks, no service role and manual workflow gating')
