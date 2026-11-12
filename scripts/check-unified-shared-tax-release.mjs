import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source=readFileSync('src/releaseInfo.js','utf8')
const pkg=JSON.parse(readFileSync('package.json','utf8'))
const shared=source.match(/const DEFAULT_RELEASE\s*=\s*\{[\s\S]*?version:\s*'([^']+)'/)?.[1]
assert.equal(shared,pkg.version,'Shared release must match package version')
for(const [name,id] of [
 ['TCR','61a89aef-0e7e-4ea2-b222-44ab2024655a'],
 ['Centurion','8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a'],
]) {
 const entry=source.split("'"+id+"': {")[1]?.split(/\n\s*},/)[0]||''
 assert(/version:\s*DEFAULT_RELEASE\.version/.test(entry),name+' must use the same shared version')
 assert(entry.includes('SHARED_NASHVILLE_PARITY_CHANGES'),name+' must include shared release notes')
}
const taxres=source.split("'a0000000-0000-0000-0000-000000000001': {")[1]?.split(/\n\s*},/)[0]||''
assert(taxres.includes('...DEFAULT_RELEASE'),'TaxRes version must derive from shared release')
const nash=source.split("'489ace07-1a6b-4864-833a-4f8420568b40': {")[1]?.split(/\n\s*},/)[0]||''
assert(nash.includes("version: '3.0.0'"),'Nashville version must remain independent')
assert(!nash.includes('DEFAULT_RELEASE.version'),'Nashville cannot inherit shared tax version')
assert(!/version:\s*'3\.2\.(93|94)'/.test(source),'Former TCR/Centurion release counters must not remain')
assert(source.includes('title: `TaxRes ${DEFAULT_RELEASE.version} — Shared Tax CRM`'),'TaxRes shared release dialog title must interpolate actual version')
assert(source.includes('title: `TCR ${DEFAULT_RELEASE.version} — Shared Tax CRM`'),'TCR release title must interpolate actual version')
assert(source.includes('title: `Centurion ${DEFAULT_RELEASE.version} — Shared Tax CRM`'),'Centurion release title must interpolate actual version')
console.log('PASS: TaxRes, TCR, and Centurion all use shared version '+shared+'; Nashville independent')
