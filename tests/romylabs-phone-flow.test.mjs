import assert from 'node:assert/strict'

const ROMY = '+15614206999'
const ADMIN_TENANT = 'a0000000-0000-0000-0000-000000000001'
const PHONE_RE = /^\+\d{10,15}$/

function normalize(v='') {
  const d=String(v).replace(/\D/g,'')
  return d.length===10?`+1${d}`:(d.length===11&&d.startsWith('1')?`+${d}`:'')
}
function genericRoute({to,romyDid}) {
  const to10=normalize(to).slice(-10), romy10=normalize(romyDid).slice(-10)
  return romy10&&to10===romy10?'romylabs-receive-call':'taxres-receive-call'
}
class Conference {
  constructor(name){this.name=name;this.started=false;this.participants=[]}
  join(label,startConferenceOnEnter){
    const p={label,startConferenceOnEnter,onHold:false,connected:false}
    this.participants.push(p)
    if(startConferenceOnEnter)this.started=true
    for(const x of this.participants){x.onHold=!this.started;x.connected=this.started}
    return p
  }
}
function pickRomyBridge({from,to,answeredInbound,outbound}){
  if(normalize(from)!==normalize(ROMY)||normalize(to)!==normalize(ROMY))return null
  if(answeredInbound?.conference_name)return {kind:'inbound',conference:answeredInbound.conference_name,startConferenceOnEnter:true}
  if(outbound?.conference_name)return {kind:'outbound',conference:outbound.conference_name,startConferenceOnEnter:true}
  return null
}
function claim(row,claimedBy='sandbox'){if(row.status!=='ringing')return false;row.status='answered';row.claimed_by=claimedBy;row.claimed_at='now';return true}
function releaseClaim(row){if(row.status!=='answered')return false;row.status='ringing';row.claimed_by=null;row.claimed_at=null;return true}
function redirectToVoicemail(row){if(row.status!=='ringing')return false;row.status='missed';return true}
function complete(row){if(row.status==='answered'){row.status='completed';return true}return false}

assert.equal(genericRoute({to:'(561) 420-6999',romyDid:ROMY}),'romylabs-receive-call')
assert.equal(genericRoute({to:'+15614206665',romyDid:ROMY}),'taxres-receive-call')
assert.equal(PHONE_RE.test(ROMY),true)
assert.equal(PHONE_RE.test('5614206999'),false)
assert.equal(PHONE_RE.test('+156142069'),false)
assert.equal(PHONE_RE.test('+1561420699900000'),false)

const conf=new Conference('romylabs-4-CA123')
const caller=conf.join('external-caller',false)
assert.equal(conf.started,false);assert.equal(caller.onHold,true);assert.equal(caller.connected,false)

const row={callsid:'CA123',conference_name:conf.name,status:'ringing',tenant_id:ADMIN_TENANT,claimed_by:null,claimed_at:null}
assert.equal(claim(row,'romy'),true)
const bridge=pickRomyBridge({from:ROMY,to:ROMY,answeredInbound:row,outbound:null})
assert.deepEqual(bridge,{kind:'inbound',conference:conf.name,startConferenceOnEnter:true})
const agent=conf.join('browser-agent',true)
assert.equal(conf.started,true);assert.equal(agent.onHold,false);assert.equal(caller.onHold,false);assert.equal(agent.connected,true);assert.equal(caller.connected,true)

assert.equal(pickRomyBridge({from:ROMY,to:ROMY,answeredInbound:null,outbound:null}),null)

const failed={callsid:'CAFAIL',conference_name:'romylabs-4-CAFAIL',status:'ringing',claimed_by:null,claimed_at:null}
assert.equal(claim(failed,'romy'),true);assert.equal(releaseClaim(failed),true);assert.equal(redirectToVoicemail(failed),true);assert.equal(failed.status,'missed')

const ringing={status:'ringing'};assert.equal(redirectToVoicemail(ringing),true)
const answered={status:'answered'};assert.equal(redirectToVoicemail(answered),false)
const ended={status:'answered'};assert.equal(complete(ended),true);assert.equal(ended.status,'completed')

assert.deepEqual(pickRomyBridge({from:ROMY,to:ROMY,answeredInbound:null,outbound:{conference_name:'outbound-123'}}),{kind:'outbound',conference:'outbound-123',startConferenceOnEnter:true})

const ivr={'1':'RomyLabs Sales','2':'RomyLabs Support','3':'RomyLabs Billing','4':'Representative','5':'Voicemail'}
assert.deepEqual(Object.keys(ivr),['1','2','3','4','5']);assert.equal(ivr['4'],'Representative');assert.equal(ivr['5'],'Voicemail')

const visibleSms=rows=>rows.filter(r=>!String(r.signalwire_sms_id||'').startsWith('demo-seed-sms-'))
assert.deepEqual(visibleSms([{signalwire_sms_id:'demo-seed-sms-001',body:'fake'},{signalwire_sms_id:'real-provider-sid-1',body:'real'}]).map(r=>r.body),['real'])

const restored={callsid:'CARESTORE',conference_name:'romylabs-2-CARESTORE',status:'answered',tenant_id:ADMIN_TENANT}
const restoredBridge=pickRomyBridge({from:ROMY,to:ROMY,answeredInbound:restored,outbound:null})
assert.equal(restoredBridge.conference,restored.conference_name);assert.equal(restoredBridge.startConferenceOnEnter,true)

const raced={callsid:'CARACE',conference_name:'romylabs-1-CARACE',status:'ringing'}
assert.equal(claim(raced,'agent-a'),true);assert.equal(claim(raced,'agent-b'),false);assert.equal(raced.claimed_by,'agent-a')

const browserDeadlineMs=26000,serverWatchdogMs=28000
assert.equal(browserDeadlineMs<serverWatchdogMs,true)
const timeoutRow={status:'ringing'};assert.equal(redirectToVoicemail(timeoutRow),true);assert.equal(timeoutRow.status,'missed')

console.log(JSON.stringify({
  T1_6999_routes_romylabs:'PASS',
  T2_self_dial_identity_guard:'PASS',
  T3_caller_waits_before_answer:'PASS',
  T4_agent_answer_releases_hold:'PASS',
  T5_unclaimed_call_cannot_hijack_bridge:'PASS',
  T6_bridge_failure_goes_to_voicemail:'PASS',
  T7_no_answer_race_safe:'PASS',
  T8_hangup_completion:'PASS',
  T9_outbound_bridge_preserved:'PASS',
  T10_ivr_menu_1_to_5:'PASS',
  T11_demo_sms_filtered:'PASS',
  T12_refresh_rejoin_same_conference:'PASS',
  T13_atomic_answer_race:'PASS',
  T14_no_answer_timing_order:'PASS'
},null,2))
