import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const src=readFileSync('supabase/migrations/20261114062000_search_path_advisor_closure.sql','utf8')
const statements=src.split('\n').filter(x=>x.startsWith('ALTER FUNCTION public.'))
assert.equal(statements.length,13,'all thirteen flagged functions must have a pinned path')
for(const statement of statements)assert.ok(statement.endsWith(' SET search_path = pg_catalog, public, pg_temp;'))
assert.ok(!/(CREATE OR REPLACE FUNCTION|DROP FUNCTION|GRANT |REVOKE )/im.test(src.replace(/^--.*$/gm,'')),'do not alter authorization or function implementation')
console.log('PASS: all thirteen invocation-only function paths pinned without rewriting code or grants')
