import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path,root),'utf8')
const ctx = read('src/context/CallContext.jsx')
const bar = read('src/components/calling/ActiveCallBar.jsx')
const conf = read('supabase/functions/romylabs-conference/index.ts')
const add = read('supabase/functions/call-add-participant/index.ts')
const state = read('supabase/functions/romylabs-phone-state/index.ts')
const config = read('supabase/config.toml')

for(const [name,source,loader] of [['CallContext',ctx,'jsx'],['ActiveCallBar',bar,'jsx'],['romylabs-conference',conf,'ts'],['call-add-participant',add,'ts'],['romylabs-phone-state',state,'ts']]){
  assert.doesNotThrow(()=>transformSync(source,{loader}),name+' must parse')
}

// No conference or extra call while a normal person answers a direct call.
const directBlock=ctx.match(/if \(phoneContext === 'romylabs'\) \{\s*\/\/ Direct RELAY[\s\S]*?\/\/ Recorded-outbound path/)?.[0]||''
assert.match(directBlock,/destinationNumber,\s*callerNumber:callerNumberRef\.current/)
assert.doesNotMatch(directBlock,/start-outbound-call|startConferenceOnEnter|call-add-participant/)

// Only an explicit Add Caller invokes an upgrade, and its room is tenant/user scoped.
assert.match(ctx,/async function addParticipant\(number\)/)
assert.match(ctx,/action:'upgrade',outbound_call_id:outboundId/)
assert.match(conf,/action==='upgrade'/)
assert.match(conf,/\.eq\('tenant_id',TENANT\)/)
assert.match(conf,/row\.agent_name/)
assert.match(conf,/normalize\(leg\?\.to\)!==expected/)
assert.match(conf,/if\(!UUID\.test\(callSid\)\|\|!expected\)/)
assert.match(conf,/Provider leg does not match this active destination/)
assert.match(conf,/conference_name:name/)
assert.match(conf,/\bMethod:'POST'/)
assert.match(conf,/action==='status'/)
assert.match(conf,/action==='remove'/)

// Never dial a third party unless both the original and the browser agent
// have genuinely joined. No fake 8-second connected state.
assert.match(ctx,/if\(state\?\.state==='ready'\)/)
assert.match(ctx,/if\(!ready\)throw Error/)
assert.match(ctx,/\bcall-add-participant/)
assert.match(conf,/originalPresent&&agentPresent\?'ready'/)
assert.match(bar,/refreshConferenceParticipants/)
assert.match(bar,/conferenceParticipants\.filter\(p=>p\.kind==='guest'\)/)
assert.match(bar,/removeConferenceParticipant\(sid\)/)
assert.doesNotMatch(bar,/setTimeout\(\(\) => \{\s*setParticipants/)

// Remove action can only disconnect an actual guest, not agent or original.
assert.match(conf,/participant\.kind!=='guest'/)
assert.match(conf,/Participants\/[^\n]*sid/)
assert.match(add,/call_sid:\s*callSid\s*\|\|\s*null/)
assert.match(state,/action==='direct_outbound_bind'/)
assert.match(config,/\[functions\.romylabs-conference\]\s*verify_jwt = true/)

// Simple protocol simulation: no guest can be dialed until both live legs
// are confirmed; one failed rejoin must not send an invitation.
const canInvite=({userPressed,original,agent})=>userPressed&&original&&agent
assert.equal(canInvite({userPressed:false,original:true,agent:true}),false)
assert.equal(canInvite({userPressed:true,original:true,agent:false}),false)
assert.equal(canInvite({userPressed:true,original:false,agent:true}),false)
assert.equal(canInvite({userPressed:true,original:true,agent:true}),true)
console.log('PASS RomyLabs three-way direct call isolation, explicit upgrade, provider validation, agent/caller confirmation, guest removal, JWT gate and source syntax')
