import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { Relay } from '@signalwire/js'
import { supabase } from '../lib/supabase'
import { useApp } from './AppContext'
import { playSound, playRing, stopRingAudio, playRingback, stopRingback } from '../lib/notifySound'
import { advanceLeadStatus } from '../lib/leadStatus'

// ──────────────────────────────────────────────────────────────────────
// This used to live entirely inside Dialer.jsx. The problem: React
// unmounts a page's component the instant you navigate away from it,
// and the old code's cleanup function called relayRef.current?.disconnect()
// on unmount — so clicking ANY other sidebar tab during a call killed the
// call, and (just as bad) killed the "office" RELAY registration itself,
// which is exactly why inbound calls had nothing to ring into unless the
// Dialer tab happened to be the active page at that exact moment.
//
// Fix: the connection + live call state now live here, in a Provider
// mounted once at the Shell level (outside <Routes>), so navigating
// between pages no longer touches it. It only disconnects on a real
// logout/app close.
// ──────────────────────────────────────────────────────────────────────

const CallContext = createContext(null)
export function useCall() { return useContext(CallContext) }

const OUTCOMES = ['Connected', 'No Answer', 'Voicemail', 'Wrong Number', 'Callback Requested', 'Converted']
const BLANK_LOG = { outcome: 'Connected', notes: '', duration: '' }

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = (sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

// Matches an inbound caller's number against Clients and Leads by the
// last 10 digits, so formatting differences ("+1 561...", "(561)...",
// "561-310-2931") all still match. Small dataset (a tax firm's CRM), so
// pulling both tables and comparing in JS is simple and fast enough —
// worth revisiting with an indexed lookup only if the client list grows
// into the thousands.
async function matchCallerToRecord(rawNumber) {
  const digits = (rawNumber || '').replace(/\D/g, '')
  const last10 = digits.slice(-10)
  if (last10.length < 7) return null

  const [{ data: clients }, { data: leads }] = await Promise.all([
    supabase.from('clients').select('id, name, phone, phone2').limit(3000),
    supabase.from('leads').select('id, name, first, last, phone').limit(3000),
  ])
  const isMatch = (p) => !!p && p.replace(/\D/g, '').slice(-10) === last10

  const client = clients?.find(c => isMatch(c.phone) || isMatch(c.phone2))
  if (client) return { entityType: 'client', id: client.id, name: client.name }

  const lead = leads?.find(l => isMatch(l.phone))
  if (lead) return { entityType: 'lead', id: lead.id, name: lead.name || `${lead.first || ''} ${lead.last || ''}`.trim() }

  return null
}

export function CallProvider({ children, phoneContext = 'taxres' }) {
  const { user } = useApp()
  const [relayStatus, setRelayStatus] = useState('connecting')
  const [incomingCall, setIncomingCall] = useState(null)
  const [incomingMatch, setIncomingMatch] = useState(null) // {entityType,id,name} while ringing, or null
  const [calling, setCalling] = useState(false)
  const [active, setActive] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [logForm, setLogForm] = useState(BLANK_LOG)
  const [logModal, setLogModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [callToast, setCallToast] = useState('')
  const [outboundCallerId, setOutboundCallerIdState] = useState(() =>
    localStorage.getItem(phoneContext === 'romylabs' ? 'romylabs_outbound_caller_id' : 'taxres_outbound_caller_id') || 'local'
  )

  function setOutboundCallerId(value) {
    const next = value === 'tollfree' ? 'tollfree' : 'local'
    setOutboundCallerIdState(next)
    try { localStorage.setItem(phoneContext === 'romylabs' ? 'romylabs_outbound_caller_id' : 'taxres_outbound_caller_id', next) } catch (_) {}
  }

  const relayRef = useRef(null)
  const activeCallRef = useRef(null) // ref to the live RELAY call object for DTMF
  const liveCallRef = useRef(null)
  // Mic mute for the live call — SDK muteAudio/unmuteAudio when available,
  // plus directly toggling the local MediaStream audio track as a
  // belt-and-suspenders (guaranteed to silence the mic regardless of SDK
  // version quirks).
  const [muted, setMuted] = useState(false)

  // ── Hold + conference-in ──
  // Every call already lives in a conference, so Hold = "hold every
  // non-agent participant" (they hear hold music, hear nothing from the
  // room) and Add Caller = "dial a third leg into this same conference".
  // Both are done server-side by edge functions using the SignalWire REST
  // API, keyed off the active conference name.
  const [onHold, setOnHold] = useState(false)
  const [canTransfer, setCanTransfer] = useState(false)
  // Which far-end leg a transfer should redirect: the caller's leg on
  // inbound, the client's leg on outbound.
  const transferableCallsidRef = useRef(null)
  const [holdBusy, setHoldBusy] = useState(false)

  async function toggleHold() {
    const conf = activeConferenceRef.current
    if (!conf || holdBusy) return
    setHoldBusy(true)
    const next = !onHold
    const { data, error } = await supabase.functions.invoke('call-hold', {
      body: { conference_name: conf, hold: next, phoneContext },
    })
    setHoldBusy(false)
    if (error || data?.error) {
      showCallToast('Hold failed: ' + (error?.message || data?.error || 'unknown error'))
      return
    }
    setOnHold(next)
  }

  async function transferCall(target) {
    // Blind transfer: redirect the CALLER's leg away from our conference.
    // 'extension' -> re-parks them in a fresh conference and rings the
    // target agent's browser through the normal extension machinery
    // (12s target-only, then everyone, then voicemail). 'external' ->
    // dials the outside number directly, caller ID = business number.
    const callsid = transferableCallsidRef.current
    if (!callsid) return { error: 'Transfer isn\'t available for this call.' }
    const { data, error } = await supabase.functions.invoke('call-transfer', {
      body: {
        callsid,
        target_type: target.type,
        extension: target.extension || null,
        number: target.number || null,
        phoneContext,
      },
    })
    if (error || data?.error) return { error: error?.message || data?.error || 'unknown error' }
    showCallToast('↪ Transferred' + (target.label ? ' to ' + target.label : ''))
    // Give SignalWire a moment to physically move the caller's leg out of
    // our conference, then close our side WITHOUT the end-conference
    // participant sweep — that sweep hangs up everyone still in the room,
    // and firing it during the redirect kills the caller we just
    // transferred. Our own leg leaving ends the empty conference anyway.
    await new Promise(r => setTimeout(r, 1500))
    endCall({ skipConferenceKill: true })
    return { ok: true }
  }

  async function addParticipant(number) {
    const conf = activeConferenceRef.current
    if (!conf) return { error: 'No active call' }
    const { data, error } = await supabase.functions.invoke('call-add-participant', {
      body: { conference_name: conf, number, phoneContext },
    })
    if (error || data?.error) return { error: error?.message || data?.error || 'unknown error' }
    showCallToast('📞 Dialing ' + number + ' into this call…')
    return { ok: true }
  }

  function toggleMute() {
    const call = liveCallRef.current
    if (!call) return
    const next = !muted
    try {
      if (next && typeof call.muteAudio === 'function') call.muteAudio()
      else if (!next && typeof call.unmuteAudio === 'function') call.unmuteAudio()
    } catch (e) { console.warn('SDK mute call failed:', e) }
    try {
      const stream = call.localStream || call.options?.localStream
      stream?.getAudioTracks?.().forEach(t => { t.enabled = !next })
    } catch (e) { console.warn('local track mute failed:', e) }
    setMuted(next)
  }
  const callerNumberRef = useRef(null)
  const activeConferenceRef = useRef(null)
  const activeInboundCallsidRef = useRef(null)
  // Durable outbound_calls.id for the current call. This is also the
  // calllog.raw_call_id created by the DB sync trigger, so post-call recap
  // enriches that one row instead of inserting a duplicate history row.
  const activeOutboundCallIdRef = useRef(null)
  const uiStartedRef = useRef(false)
  const pageUnloadingRef = useRef(false)
  const callStartedAtRef = useRef(null)
  const restoreAttemptedRef = useRef(false)
  const inboundStatusPollRef = useRef(null)
  const CALL_SESSION_KEY = 'taxres_active_call_v1'

  function persistCallSession(payload) {
    try { sessionStorage.setItem(CALL_SESSION_KEY, JSON.stringify(payload)) } catch (_) {}
  }
  function clearPersistedCallSession() {
    try { sessionStorage.removeItem(CALL_SESSION_KEY) } catch (_) {}
  }
  const elapsedRef = useRef(0)
  const incomingMatchRef = useRef(null)
  const timerRef = useRef(null)
  // Inbound calls no longer arrive as a real RELAY call object (the
  // inbound Verto dial was confirmed dead after a full day of testing —
  // it fails in 0 seconds every time, regardless of registration state).
  // Instead, receive-call holds the caller in a conference and writes a
  // row to incoming_calls; we poll for it here and "answer" by having the
  // browser dial itself (the same outbound mechanism that's reliable all
  // day), which receive-call recognizes and bridges straight into that
  // conference. These three refs track that flow.
  const pendingInboundRef = useRef(null)
  const lastHandledInboundRef = useRef(null)
  const inboundTimeoutRef = useRef(null)
  const ringIntervalRef = useRef(null)
  const ringAudioRef = useRef(null)
  // Backup confirmation that an outbound call has actually ended, started
  // explicitly inside startCall() once the conference name is known
  // (rather than a useEffect keyed on `calling` -- that state flips true
  // synchronously, before activeConferenceRef is populated a moment
  // later, so an effect watching `calling` would check the ref before it
  // was ever set). Cleared in finalizeCallEnd alongside everything else.
  const outboundPollRef = useRef(null)
  // This agent's own extension (employees.extension), used to decide
  // whether an "Extension NNN — Name" inbound call should ring this
  // browser during the target-only stage. null = no extension on file or
  // lookup not finished yet — in that case we FAIL OPEN and ring for
  // everything (today's behavior); the failure mode is extra ringing,
  // never a silent office.
  const myExtensionRef = useRef(null)

  useEffect(() => {
    if (!user?.email) return
    supabase.from('employees').select('extension').ilike('email', user.email).limit(1)
      .then(({ data }) => { myExtensionRef.current = data?.[0]?.extension || null })
      .catch(() => {})
  }, [user?.email])

  function stopRing() {
    if (ringIntervalRef.current) { clearInterval(ringIntervalRef.current); ringIntervalRef.current = null }
    stopRingAudio()
  }

  // Ending a call needs to be CONFIRMED, not fire-and-forget -- a call
  // that silently fails to disconnect on SignalWire's side leaves the
  // other party's phone connected indefinitely with no indication
  // anything went wrong. Retries a couple of times before giving up and
  // warning staff to check manually, rather than trusting a single
  // attempt that could fail for an ordinary transient reason (network
  // blip, SignalWire API hiccup).
  async function endConferenceWithRetry(conferenceName, attempt = 1) {
    const { data, error } = await supabase.functions.invoke('end-conference', { body: { conferenceName, phoneContext } })
    if (error || data?.error) {
      if (attempt < 3) {
        setTimeout(() => endConferenceWithRetry(conferenceName, attempt + 1), 2000)
      } else {
        showCallToast('⚠️ Could not confirm the call actually ended — check your phone, it may still be connected.')
      }
    }
  }

  useEffect(() => { elapsedRef.current = elapsed }, [elapsed])

  // A hard refresh/page close destroys the browser RELAY leg. That must NEVER
  // be interpreted as an intentional End Call. Mark unload before the SDK emits
  // hangup/destroy so the provider conference survives and can be rejoined.
  useEffect(() => {
    const markUnloading = () => { pageUnloadingRef.current = true }
    const clearUnloading = () => { pageUnloadingRef.current = false }
    window.addEventListener('beforeunload', markUnloading)
    window.addEventListener('pagehide', markUnloading)
    window.addEventListener('pageshow', clearUnloading)
    return () => {
      window.removeEventListener('beforeunload', markUnloading)
      window.removeEventListener('pagehide', markUnloading)
      window.removeEventListener('pageshow', clearUnloading)
    }
  }, [])

  function showCallToast(msg) { setCallToast(msg); setTimeout(() => setCallToast(''), 4000) }

  async function fetchIncomingStatus(callsid) {
    if (phoneContext === 'romylabs') {
      const { data, error } = await supabase.functions.invoke('romylabs-phone-state', { body:{ action:'incoming_status', callsid } })
      return { data: data?.row || null, error: error || (data?.error ? new Error(data.error) : null) }
    }
    return supabase.from('incoming_calls').select('status,conference_name,callsid').eq('callsid', callsid).maybeSingle()
  }

  async function fetchOutboundStatus(conferenceName) {
    if (phoneContext === 'romylabs') {
      const { data, error } = await supabase.functions.invoke('romylabs-phone-state', { body:{ action:'outbound_status', conference_name:conferenceName } })
      return { data: data?.row || null, error: error || (data?.error ? new Error(data.error) : null) }
    }
    return supabase.from('outbound_calls').select('id,status,conference_name,provider_call_sid').eq('conference_name', conferenceName).maybeSingle()
  }

  async function fetchLatestRinging() {
    if (phoneContext === 'romylabs') {
      const { data, error } = await supabase.functions.invoke('romylabs-phone-state', { body:{ action:'ringing' } })
      return { data: data?.row || null, error: error || (data?.error ? new Error(data.error) : null) }
    }
    return supabase.from('incoming_calls')
      .select('callsid, conference_name, from_number, department, created_at')
      .eq('status', 'ringing')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  }

  async function claimInbound(row, agentName) {
    if (phoneContext === 'romylabs') {
      const { data, error } = await supabase.functions.invoke('romylabs-phone-state', {
        body:{ action:'claim', callsid:row.callsid, claimed_by:agentName }
      })
      return { data: data?.claimed || [], error: error || (data?.error ? new Error(data.error) : null) }
    }
    return supabase.from('incoming_calls')
      .update({ status: 'answered', claimed_by: agentName, claimed_at: new Date().toISOString() })
      .eq('callsid', row.callsid)
      .eq('status', 'ringing')
      .select('callsid')
  }

  async function restoreCallState(saved) {
    if (phoneContext !== 'romylabs') return null
    const action = saved.kind === 'outbound' ? 'restore_outbound' : 'restore_inbound'
    const body = saved.kind === 'outbound'
      ? { action, conference_name:saved.conferenceName }
      : { action, callsid:saved.inboundCallsid }
    const { data, error } = await supabase.functions.invoke('romylabs-phone-state', { body })
    if (error || data?.error) return null
    return data?.row || null
  }

  async function completeInboundState(callsid) {
    if (phoneContext === 'romylabs') {
      await supabase.functions.invoke('romylabs-phone-state', { body:{ action:'complete_inbound', callsid } })
      return
    }
    await supabase.from('incoming_calls').update({ status: 'completed' })
      .eq('callsid', callsid).eq('status', 'answered')
  }

  useEffect(() => {
    let disposed = false
    let audioEl = document.createElement('audio')
    audioEl.id = 'sw-remote-audio'
    audioEl.autoplay = true
    document.body.appendChild(audioEl)

    let reconnectTimer = null
    function scheduleReconnect() {
      if (disposed || reconnectTimer) return
      reconnectTimer = setTimeout(() => { reconnectTimer = null; connect() }, 3000)
    }

    async function connect() {
      if (disposed) return
      setRelayStatus('connecting')
      const { data, error } = await supabase.functions.invoke('signalwire-relay-token', { body: { phoneContext } })
      if (disposed) return
      if (error || !data?.jwt_token) {
        setRelayStatus('error')
        // Only show toast + retry if SW is configured — skip silently when not set up
        const reason = data?.error || error?.message || ''
        const notConfigured = !data || reason.toLowerCase().includes('not configured') || reason.toLowerCase().includes('not fully set up') || reason.toLowerCase().includes('no signalwire') || reason.toLowerCase().includes('missing')
        if (!notConfigured) {
          showCallToast('Could not connect calling: ' + reason)
          scheduleReconnect()
        }
        return
      }
      callerNumberRef.current = data.caller_number

      const client = new Relay({ project: data.project_id, token: data.jwt_token })
      client.remoteElement = 'sw-remote-audio'

      client.on('signalwire.ready', () => { console.log('%c[RELAY] ready — registered as "office"', 'color:lime'); setRelayStatus('ready') })
      client.on('signalwire.error', (e) => { setRelayStatus('error'); console.error('[RELAY] error', e); scheduleReconnect() })
      client.on('signalwire.socket.close', () => { setRelayStatus('error'); console.warn('[RELAY] socket closed — reconnecting in 3s'); scheduleReconnect() })
      client.on('signalwire.socket.error', (e) => { setRelayStatus('error'); console.error('[RELAY] socket error', e); scheduleReconnect() })
      client.on('blade.disconnect', () => { setRelayStatus('error'); console.warn('[RELAY] disconnected — reconnecting in 3s'); scheduleReconnect() })
      client.on('signalwire.notification', (n) => {
        console.log('[RELAY] notification received:', n.type, n)
        if (n.type !== 'callUpdate') return
        const call = n.call
        console.log('[RELAY] callUpdate — direction:', call.direction, '| state:', call.state, '| from:', call.options?.remoteCallerNumber)
        if (call.state === 'active') {
          activeCallRef.current = call  // always update ref so DTMF works
          stopRingback()               // stop ringback when call connects
        }
        if (call.state === 'active' && !uiStartedRef.current) {
          uiStartedRef.current = true
          setIncomingCall(null)
          stopRing()
          setCalling(true)
          setElapsed(0)
          setLogForm(BLANK_LOG)
          timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
          const m = incomingMatchRef.current
          setActive(prev => prev || {
            id: m?.id ?? null,
            name: m?.name || 'Incoming Call',
            first: 'Incoming', last: 'Call',
            phone: call.options?.remoteCallerNumber || '—',
            status: 'Manual',
            entityType: m?.entityType || null,
          })
        }
        if (call.state === 'hangup' || call.state === 'destroy') {
          activeCallRef.current = null
          setIncomingCall(null)
          setIncomingMatch(null)
          stopRing()
          if (liveCallRef.current === call) {
            // During refresh/page close, only the local browser leg is dying.
            // Do NOT terminate the provider conference or clear persisted call
            // state; the next page load will verify and rejoin it.
            if (pageUnloadingRef.current) {
              liveCallRef.current = null
              return
            }
            finalizeCallEnd({ alreadyHungUp: true })
            handleRemoteHangup()
          }
        }
      })

      client.connect()
      relayRef.current = client
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      relayRef.current?.disconnect()
      audioEl?.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A browser refresh tears down only the local RELAY leg. The provider
  // conference remains authoritative, so once RELAY reconnects we validate the
  // stored conference against Supabase and automatically rejoin it.
  useEffect(() => {
    if (relayStatus !== 'ready' || restoreAttemptedRef.current) return
    restoreAttemptedRef.current = true

    let saved = null
    try { saved = JSON.parse(sessionStorage.getItem(CALL_SESSION_KEY) || 'null') } catch (_) {}
    if (!saved?.conferenceName || !saved?.kind) return

    let cancelled = false
    ;(async () => {
      let row = null
      if (phoneContext === 'romylabs') {
        row = await restoreCallState(saved)
      } else if (saved.kind === 'outbound') {
        const { data } = await supabase.from('outbound_calls')
          .select('id,conference_name,status,provider_call_sid')
          .eq('conference_name', saved.conferenceName)
          .in('status', ['pending','ringing','answered','connected'])
          .maybeSingle()
        row = data
      } else if (saved.kind === 'inbound' && saved.inboundCallsid) {
        const { data } = await supabase.from('incoming_calls')
          .select('conference_name,callsid,status')
          .eq('callsid', saved.inboundCallsid)
          .in('status', ['ringing','answered'])
          .maybeSingle()
        row = data
      }
      if (cancelled) return
      if (!row || row.conference_name !== saved.conferenceName) {
        clearPersistedCallSession()
        return
      }

      const restoredActive = saved.active || {
        id: null, name: saved.kind === 'inbound' ? 'Incoming Call' : 'Active Call',
        phone: '—', status: 'Manual', entityType: null,
      }
      activeConferenceRef.current = saved.conferenceName
      activeInboundCallsidRef.current = saved.kind === 'inbound' ? (saved.inboundCallsid || null) : null
      activeOutboundCallIdRef.current = saved.kind === 'outbound' ? (saved.outboundCallId || row.id || null) : null
      transferableCallsidRef.current = saved.transferableCallsid || row.provider_call_sid || null
      setCanTransfer(!!transferableCallsidRef.current)
      callStartedAtRef.current = Number(saved.startedAt) || Date.now()
      uiStartedRef.current = true
      setActive(restoredActive)
      setCalling(true)
      const restoredElapsed = Math.max(0, Math.floor((Date.now() - callStartedAtRef.current) / 1000))
      elapsedRef.current = restoredElapsed
      setElapsed(restoredElapsed)
      clearInterval(timerRef.current)
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)

      if (saved.kind === 'outbound') {
        const conf = saved.conferenceName
        if (outboundPollRef.current) clearInterval(outboundPollRef.current)
        outboundPollRef.current = setInterval(async () => {
          const { data: live } = await fetchOutboundStatus(conf)
          if (live?.status === 'completed' || live?.status === 'failed') {
            finalizeCallEnd({ alreadyHungUp: true })
            handleRemoteHangup()
          }
        }, 3000)
      } else if (saved.inboundCallsid) {
        const callsid = saved.inboundCallsid
        if (inboundStatusPollRef.current) clearInterval(inboundStatusPollRef.current)
        inboundStatusPollRef.current = setInterval(async () => {
          const { data: live } = await fetchIncomingStatus(callsid)
          if (live?.status === 'completed' || live?.status === 'missed') {
            clearInterval(inboundStatusPollRef.current)
            inboundStatusPollRef.current = null
            finalizeCallEnd({ alreadyHungUp: true })
            handleRemoteHangup()
          }
        }, 3000)
      }

      // Re-create only the browser/agent leg. receive-call recognizes the
      // business-number self-dial and rejoins the still-live conference.
      setTimeout(() => {
        if (cancelled || !uiStartedRef.current || !relayRef.current || !callerNumberRef.current) return
        relayRef.current.newCall({
          destinationNumber: callerNumberRef.current,
          callerNumber: callerNumberRef.current,
        }).then(call => {
          liveCallRef.current = call
          setMuted(false)
          setOnHold(false)
          showCallToast('📞 Reconnected to active call after refresh')
        }).catch(err => {
          console.error('[call-restore] rejoin failed:', err)
          showCallToast('Could not reconnect to the active call. The remote call may still be live.')
        })
      }, 500)
    })()

    return () => { cancelled = true }
  }, [relayStatus])

  // Polls for inbound calls being held by receive-call/ivr-route (see
  // those functions' comments for why — the direct Verto dial-in is
  // dead). When a new 'ringing' row shows up, show the same banner UI as
  // before and start a 15-second window (matches the auto-attendant's
  // "ring ~3 times" spec); if nobody answers in time, redirect-to-
  // voicemail pulls the caller out to the voicemail prompt automatically.
  useEffect(() => {
    if (relayStatus !== 'ready') return
    let cancelled = false

    const poll = setInterval(async () => {
      if (cancelled) return

      // If we have a pending inbound call, check whether it's been resolved
      // elsewhere: caller hung up (missed/completed) or ANOTHER AGENT
      // ANSWERED it ('answered'). The answered case is the important fix —
      // before this, a losing agent's browser kept ringing after a
      // colleague picked up, and its 15s give-up timer would then yank the
      // LIVE call into voicemail mid-conversation.
      if (pendingInboundRef.current && !calling) {
        const { data: check } = await fetchIncomingStatus(pendingInboundRef.current.callsid)
        if (check?.status === 'missed' || check?.status === 'completed' || check?.status === 'answered') {
          console.log('[poll] call resolved elsewhere — clearing banner, status:', check.status)
          if (inboundTimeoutRef.current) { clearTimeout(inboundTimeoutRef.current); inboundTimeoutRef.current = null }
          pendingInboundRef.current = null
          setIncomingCall(null)
          setIncomingMatch(null)
          stopRing()
          return
        }
      }

      if (pendingInboundRef.current || calling) return
      const { data, error } = await fetchLatestRinging()
      if (cancelled || error || !data) return

      // ── Extension-aware ring stages ──
      // Extension-targeted calls ("Extension NNN — Name" rows from
      // ivr-extension) ring ONLY the target agent for the first 12s, then
      // escalate to everyone until 22s, then voicemail. General IVR calls
      // ring everyone immediately. RomyLabs uses a ~26s business ring window;
      // TaxRes keeps its original 15s window.
      // FAIL OPEN: if this browser doesn't know its own extension (none on
      // file / lookup pending), it treats every call as general and rings —
      // extra ringing beats a silent office. The eligibility check happens
      // BEFORE marking the call handled, so a browser that stays quiet in
      // the target-only stage still picks the call up when it escalates.
      const TARGET_ONLY_MS = 12000
      const EXT_DEADLINE_MS = 22000
      const GENERAL_DEADLINE_MS = phoneContext === 'romylabs' ? 26000 : 15000
      const extMatch = /^Extension (\d+)\b/.exec(data.department || '')
      const ageMs = Math.max(0, Date.now() - new Date(data.created_at).getTime())
      const myExt = myExtensionRef.current
      if (extMatch && myExt && String(extMatch[1]) !== String(myExt) && ageMs < TARGET_ONLY_MS) {
        return // targeted at someone else, still their exclusive window — stay quiet
      }
      if (data.callsid === lastHandledInboundRef.current) return

      lastHandledInboundRef.current = data.callsid
      pendingInboundRef.current = data
      setIncomingCall({ options: { remoteCallerNumber: data.from_number } })
      playRing()
      ringIntervalRef.current = setInterval(() => playRing(), 3000)
      // Shows immediately as a fallback label ("Tax Professional" /
      // "Front Desk" from the IVR choice) — overwritten the instant a real
      // Client/Lead match comes back, same as before.
      setIncomingMatch(data.department ? { name: data.department, isDepartment: true } : null)
      incomingMatchRef.current = null
      if (phoneContext !== 'romylabs') {
        matchCallerToRecord(data.from_number).then(m => { incomingMatchRef.current = m; if (m) setIncomingMatch(m) })
      }

      // Give-up timer anchored to the row's created_at instead of "when
      // this browser noticed" — so every agent's timer converges on the
      // same wall-clock deadline regardless of poll skew. The server-side
      // claim in redirect-to-voicemail is the hard guarantee; this just
      // shrinks the race window.
      const deadlineMs = extMatch ? EXT_DEADLINE_MS : GENERAL_DEADLINE_MS
      const remainingMs = Math.min(deadlineMs, Math.max(1500, deadlineMs - ageMs))
      inboundTimeoutRef.current = setTimeout(() => {
        if (pendingInboundRef.current?.callsid !== data.callsid) return
        supabase.functions.invoke('redirect-to-voicemail', { body: { callsid: data.callsid, phoneContext } })
          .then(({ error: e }) => e && console.error('redirect-to-voicemail error:', e))
        pendingInboundRef.current = null
        setIncomingCall(null)
        setIncomingMatch(null)
        stopRing()
      }, remainingMs)
    }, 4000)

    return () => { cancelled = true; clearInterval(poll); stopRing() }
  }, [relayStatus, calling])

  async function answerIncoming() {
    const row = pendingInboundRef.current
    if (!row) return
    if (phoneContext === 'romylabs' && !/^+\d{10,15}$/.test(String(callerNumberRef.current || ''))) {
      showCallToast('RomyLabs phone identity is not ready yet — the caller is still ringing.')
      return
    }
    if (inboundTimeoutRef.current) { clearTimeout(inboundTimeoutRef.current); inboundTimeoutRef.current = null }
    stopRing()

    // ── Atomic claim: only one agent wins, even if multiple click Answer
    // at the same instant. The second .eq('status','ringing') means this
    // update is a no-op for any agent who arrives after the first one
    // flipped the row to 'answered'. If data comes back empty, we lost the
    // race — silently dismiss the banner and let the winner handle the call.
    const agentName = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
    // claimed_at lets receive-call's bridge_pop_claimed RPC pair agent
    // self-dials with claims in FIFO order — the fix for two simultaneous
    // held calls bridging the agent into the wrong caller's conference.
    const { data: claimed, error: claimErr } = await claimInbound(row, agentName)

    if (claimErr) console.error('incoming_calls claim error:', claimErr)

    if (!claimed || claimed.length === 0) {
      // Another agent claimed this call first — dismiss banner silently
      console.log('[answerIncoming] lost claim race for', row.callsid, '— another agent answered first')
      pendingInboundRef.current = null
      setIncomingCall(null)
      setIncomingMatch(null)
      return
    }

    // We won the claim — proceed with full answer flow
    const m = incomingMatchRef.current
    uiStartedRef.current = true
    setIncomingCall(null)
    setCalling(true)
    setElapsed(0)
    setLogForm(BLANK_LOG)
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    const activeEntry = {
      id: m?.id ?? null,
      name: (m && !m.isDepartment) ? m.name : (row.department ? `Incoming — ${row.department}` : 'Incoming Call'),
      first: 'Incoming', last: 'Call',
      phone: row.from_number || '—',
      status: 'Manual',
      entityType: (m && !m.isDepartment) ? m.entityType : null,
    }
    setActive(activeEntry)

    activeConferenceRef.current = row.conference_name || null
    activeInboundCallsidRef.current = row.callsid || null
    transferableCallsidRef.current = row.callsid || null
    setCanTransfer(!!row.callsid)
    callStartedAtRef.current = Date.now()
    persistCallSession({
      kind: 'inbound',
      conferenceName: row.conference_name || null,
      inboundCallsid: row.callsid || null,
      transferableCallsid: row.callsid || null,
      active: activeEntry,
      startedAt: callStartedAtRef.current,
    })

    // Server-side backup hangup detector for inbound calls — mirrors outboundPollRef.
    // When the caller hangs up, caller-hangup marks the row 'completed' or 'missed'.
    // The RELAY SDK hangup event is unreliable for the agent's self-dial leg, so
    // poll the DB every 3s as a guaranteed fallback to end the active call UI.
    const inboundCallsid = row.callsid
    if (inboundStatusPollRef.current) clearInterval(inboundStatusPollRef.current)
    inboundStatusPollRef.current = setInterval(async () => {
      const { data: row } = await fetchIncomingStatus(inboundCallsid)
      if (row?.status === 'completed' || row?.status === 'missed') {
        clearInterval(inboundStatusPollRef.current)
        inboundStatusPollRef.current = null
        finalizeCallEnd({ alreadyHungUp: true })
        handleRemoteHangup()
      }
    }, 3000)

    // Bridge in using the exact same outbound-dial mechanism that's been
    // working reliably all day — the browser dials the business number
    // itself, and receive-call recognizes that self-dial and connects it
    // straight into this caller's hold conference instead of treating it
    // as a new customer call.
    try {
      if (!relayRef.current) throw new Error('Calling connection is not ready')
      const call = await relayRef.current.newCall({
        destinationNumber: callerNumberRef.current,
        callerNumber: callerNumberRef.current,
      })
      if (!call) throw new Error('SignalWire did not create the browser bridge')
      liveCallRef.current = call
      setMuted(false)
      setOnHold(false)
      pendingInboundRef.current = null
    } catch (err) {
      console.error('[answerIncoming] browser bridge failed:', err)
      if (phoneContext === 'romylabs') {
        await supabase.functions.invoke('romylabs-phone-state', {
          body:{ action:'release_claim', callsid:row.callsid }
        }).catch(() => {})
        await supabase.functions.invoke('redirect-to-voicemail', {
          body:{ callsid:row.callsid, phoneContext }
        }).catch(() => {})
      }
      clearPersistedCallSession()
      if (inboundStatusPollRef.current) { clearInterval(inboundStatusPollRef.current); inboundStatusPollRef.current = null }
      activeConferenceRef.current = null
      activeInboundCallsidRef.current = null
      transferableCallsidRef.current = null
      setCanTransfer(false)
      uiStartedRef.current = false
      clearInterval(timerRef.current)
      setCalling(false)
      setActive(null)
      setElapsed(0)
      pendingInboundRef.current = null
      showCallToast('Could not connect the browser call. Caller sent to voicemail.')
    }
  }

  function declineIncoming() {
    const row = pendingInboundRef.current
    if (inboundTimeoutRef.current) { clearTimeout(inboundTimeoutRef.current); inboundTimeoutRef.current = null }
    stopRing()
    setIncomingCall(null)
    setIncomingMatch(null)
    pendingInboundRef.current = null
    if (row?.callsid) {
      supabase.functions.invoke('redirect-to-voicemail', { body: { callsid: row.callsid, phoneContext } })
        .then(({ error }) => error && console.error('redirect-to-voicemail error:', error))
    }
  }

  function handleRemoteHangup() {
    if (uiStartedRef.current) {
      uiStartedRef.current = false
      clearInterval(timerRef.current)
      setCalling(false)
      setLogForm(f => ({ ...f, duration: formatTime(elapsedRef.current) }))
      setLogModal(true)
    }
  }

  function startCall(lead) {
    if (relayStatus !== 'ready') { showCallToast('Calling isn\'t connected yet — wait a moment and try again.'); return false }
    const digits = lead.phone?.replace(/\D/g, '')
    if (!digits) { showCallToast('No phone number to call.'); return false }
    const destinationNumber = digits.length === 10 ? `+1${digits}` : `+${digits}`

    uiStartedRef.current = true
    activeInboundCallsidRef.current = null
    activeOutboundCallIdRef.current = null
    callStartedAtRef.current = Date.now()
    setActive(lead)
    setCalling(true)
    setElapsed(0)
    setLogForm(BLANK_LOG)
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    playRingback() // play US ringback tone while waiting to connect

    // Manual dial-pad calls don't know who they're calling yet — check
    // if the number matches an existing client/lead so the recap still
    // attaches to the right record once the call ends.
    if (phoneContext !== 'romylabs' && !lead.entityType && lead.status === 'Manual') {
      matchCallerToRecord(lead.phone).then(m => {
        if (m) setActive(prev => (prev === lead ? { ...lead, name: m.name, id: m.id, entityType: m.entityType } : prev))
      })
    }

    // Recorded-outbound path: start-outbound-call originates the real leg
    // to the destination (routed through outbound-leg into a recorded
    // conference), then the browser self-dials the business number —
    // same proven bridge mechanism answerIncoming() already uses —
    // and receive-call's isAgentJoin branch bridges us into that same
    // conference once it sees the pending outbound_calls row.
    supabase.functions.invoke('start-outbound-call', {
      body: {
        destinationNumber,
        displayName: lead.name || lead.clientName || lead.phone || destinationNumber,
        entityType: lead.entityType || (lead.status === 'Manual' ? 'manual' : null),
        callerIdPreference: outboundCallerId,
        phoneContext,
      }
    })
      .then(async ({ data, error }) => {
        let responseData = data
        if (error && !responseData && typeof error?.context?.json === 'function') {
          try { responseData = await error.context.json() } catch (_) {}
        }
        if (error || !responseData?.ok) {
          showCallToast('Call failed: ' + (responseData?.error || error?.message || 'unknown error'))
          cancelCall()
          return
        }
        activeConferenceRef.current = responseData.conferenceName || null
        activeOutboundCallIdRef.current = responseData.outboundCallId || null
        transferableCallsidRef.current = responseData.clientCallsid || null
        setCanTransfer(!!responseData.clientCallsid)
        persistCallSession({
          kind: 'outbound',
          conferenceName: responseData.conferenceName || null,
          outboundCallId: responseData.outboundCallId || null,
          transferableCallsid: responseData.clientCallsid || null,
          active: lead,
          startedAt: callStartedAtRef.current || Date.now(),
        })
        // Server-confirmed backup for noticing this call has truly ended,
        // independent of the RELAY SDK's own (sometimes unreliable)
        // call.state events. outbound-call-status writes 'completed' here
        // once SignalWire reports the destination leg as done, whatever
        // the reason. Cleared in finalizeCallEnd.
        if (activeConferenceRef.current) {
          const conf = activeConferenceRef.current
          outboundPollRef.current = setInterval(async () => {
            const { data: row } = await fetchOutboundStatus(conf)
            if (row?.status === 'completed') {
              finalizeCallEnd({ alreadyHungUp: true })
              handleRemoteHangup()
            }
          }, 3000)
        }
        // Deliberate pause before the browser self-dials the business number.
        // This self-dial is itself a second outbound SignalWire origination
        // on top of the start-outbound-call REST leg above. Firing them
        // back-to-back was confirmed via SignalWire's own call history to
        // self-collide and exceed the space-wide outbound rate limit on
        // every single attempt, even fully isolated with nothing else
        // running. Spacing them out clears the rate window. If the call
        // gets cancelled during the wait, cancelCall() already tore down
        // the conference via activeConferenceRef.current, so just bail.
        setTimeout(() => {
          if (!uiStartedRef.current) return
          relayRef.current?.newCall({
            destinationNumber: callerNumberRef.current,
            callerNumber: callerNumberRef.current,
          }).then(call => { liveCallRef.current = call; setMuted(false); setOnHold(false) })
            .catch(err => { showCallToast('Could not connect: ' + (err?.message || err)); cancelCall() })
        }, 1500)
      })
    return true
  }

  // Shared teardown for every path a call can end on: agent clicks End,
  // agent clicks Cancel, or the far end hangs up on their own (caught by
  // the signalwire.notification listener above). All three need to do the
  // exact same cleanup -- hang up the live leg (unless it already ended
  // itself), terminate the conference server-side as a backup to the
  // browser SDK's known-unreliable .hangup(), and mark incoming_calls
  // completed so a stale row can never hijack the next agent-join. Having
  // one shared function means these three paths can't drift out of sync
  // with each other again.
  function finalizeCallEnd({ alreadyHungUp, skipConferenceKill = false }) {
    stopRingback()
    clearPersistedCallSession()
    callStartedAtRef.current = null
    if (outboundPollRef.current) { clearInterval(outboundPollRef.current); outboundPollRef.current = null }
    if (inboundStatusPollRef.current) { clearInterval(inboundStatusPollRef.current); inboundStatusPollRef.current = null }
    if (!alreadyHungUp) liveCallRef.current?.hangup()
    liveCallRef.current = null
    setMuted(false)
    setOnHold(false)
    setCanTransfer(false)
    transferableCallsidRef.current = null
    const conf = activeConferenceRef.current
    activeConferenceRef.current = null
    // After a TRANSFER, end-conference must NOT run: its participant sweep
    // hangs up everyone still in the conference, and the just-transferred
    // caller's leg may not have physically moved out yet — the sweep would
    // kill the caller mid-transfer. Our own RELAY leg hanging up ends the
    // (now empty) conference naturally via endConferenceOnExit.
    if (conf && !skipConferenceKill) endConferenceWithRetry(conf)
    const inboundCallsid = activeInboundCallsidRef.current
    activeInboundCallsidRef.current = null
    if (inboundCallsid) {
      // Conditional on 'answered': after a transfer, this same callsid has
      // a fresh 'ringing' row for the target agent — completing THAT row
      // would kill the transfer. Only our own answered row gets closed.
      completeInboundState(inboundCallsid)
        .catch(error => console.error('incoming_calls completion update error:', error))
    }
  }

  function endCall(opts = {}) {
    finalizeCallEnd({ alreadyHungUp: false, skipConferenceKill: !!opts.skipConferenceKill })
    uiStartedRef.current = false
    clearInterval(timerRef.current)
    setCalling(false)
    setLogForm(f => ({ ...f, duration: formatTime(elapsedRef.current) }))
    setLogModal(true)
  }

  function cancelCall() {
    finalizeCallEnd({ alreadyHungUp: false })
    activeOutboundCallIdRef.current = null
    uiStartedRef.current = false
    clearInterval(timerRef.current)
    setCalling(false)
    setActive(null)
    setElapsed(0)
  }

  async function saveCallLog(onSaved) {
    if (!active) return
    setSaving(true)

    if (phoneContext === 'romylabs') {
      const direction = activeOutboundCallIdRef.current ? 'Outbound' : 'Inbound'
      const { data, error } = await supabase.functions.invoke('romylabs-phone-state', {
        body: {
          action: 'save_log',
          raw_call_id: activeOutboundCallIdRef.current || null,
          client_name: active.name || 'RomyLabs Call',
          phone: active.phone || '',
          outcome: logForm.outcome,
          notes: logForm.notes,
          duration: logForm.duration || formatTime(elapsed),
          direction,
        }
      })
      setSaving(false)
      if (error || data?.error) {
        showCallToast('Error: ' + (data?.error || error?.message || 'Unable to save call log'))
        return
      }
      const record = {
        clientName: active.name || 'RomyLabs Call',
        phone: active.phone || '',
        outcome: logForm.outcome,
        notes: logForm.notes,
        duration: logForm.duration || formatTime(elapsed),
        direction,
      }
      showCallToast('Call logged!')
      setLogModal(false)
      activeOutboundCallIdRef.current = null
      setActive(null)
      setElapsed(0)
      onSaved?.(record)
      return
    }
    const record = {
      leadId: active.id,
      clientName: active.name || `${active.first || ''} ${active.last || ''}`.trim(),
      phone: active.phone,
      outcome: logForm.outcome,
      notes: logForm.notes,
      duration: logForm.duration || formatTime(elapsed),
      created_at: new Date().toISOString()
    }
    const outboundCallId = activeOutboundCallIdRef.current
    let error = null
    if (outboundCallId) {
      // outbound_calls -> calllog is automatic and keyed by raw_call_id.
      // Enrich that durable row with the human recap rather than creating
      // a second history entry.
      const { data: updated, error: updateError } = await supabase.from('calllog')
        .update({
          leadId: record.leadId,
          clientName: record.clientName,
          phone: record.phone,
          outcome: record.outcome,
          notes: record.notes,
          duration: record.duration,
          direction: 'Outbound',
        })
        .eq('raw_call_id', outboundCallId)
        .select('id')
      error = updateError
      if (!error && (!updated || updated.length === 0)) {
        const fallback = await supabase.from('calllog').insert([{ ...record, raw_call_id: outboundCallId, direction: 'Outbound' }])
        error = fallback.error
      }
    } else {
      const inserted = await supabase.from('calllog').insert([record])
      error = inserted.error
    }
    setSaving(false)
    if (error) { showCallToast('Error: ' + error.message); return }

    // Also drop the note into the actual Client/Lead notes timeline (not
    // just buried in the call log), so it shows up where Romy/Dana/Yesenia
    // already look. client_notes keys off the name; lead_notes needs the
    // real lead id, so only leads with a known id get one.
    if (record.notes?.trim()) {
      const author = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
      const noteLine = `[${record.outcome}, ${record.duration}] ${record.notes.trim()}`
      if (active.entityType === 'client') {
        await supabase.from('client_notes').insert({
          clientname: record.clientName, text: noteLine, author,
        }).then(({ error: e }) => e && console.error('client_notes insert error:', e))
      } else if (active.entityType === 'lead' && active.id) {
        await supabase.from('lead_notes').insert([{
          lead_id: active.id, lead_name: record.clientName, text: noteLine,
          type: 'Call', author, created_at: new Date().toISOString(),
        }]).then(({ error: e }) => e && console.error('lead_notes insert error:', e))
      }
    }

    // Only a real lead with a real lead id may advance the lead pipeline.
    // Government/reference calls, manual dials and other non-client calls
    // must never create or mutate lead state.
    if (active.entityType === 'lead' && active.id) {
      if (logForm.outcome === 'Converted') {
        await advanceLeadStatus(supabase, active.name, 'Consultation Scheduled')
      }
      if (logForm.outcome === 'Callback Requested') {
        await supabase.from('leads').update({ status: 'Contacted' }).eq('id', active.id)
      }
    }

    showCallToast('Call logged!')
    setLogModal(false)

    // Log to activity_log
    const _callActor = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Staff'
    import('../lib/activityLog').then(({ logActivity }) => {
      logActivity(supabase, {
        employeeName: _callActor,
        employeeEmail: user?.email,
        action: 'call_logged',
        category: 'call',
        description: `Call with ${record.clientName} — ${record.outcome} (${record.duration})`,
        entityName: record.clientName,
        meta: { outcome: record.outcome, duration: record.duration, phone: record.phone }
      }).catch(() => {})
    })

    if (active.status === 'Client Queue') {
      try {
        const q = JSON.parse(sessionStorage.getItem('dialerQueue') || '[]')
        const next = q.filter(e => e.phone !== active.phone)
        sessionStorage.setItem('dialerQueue', JSON.stringify(next))
      } catch { /* no-op */ }
    }

    activeOutboundCallIdRef.current = null
    setActive(null)
    setElapsed(0)
    onSaved?.(record)
  }

  function closeLogModalWithoutSaving() {
    activeOutboundCallIdRef.current = null
    setLogModal(false)
    setActive(null)
  }

  const value = {
    phoneContext,
    relayStatus, incomingCall, incomingMatch, calling, active, elapsed,
    outboundCallerId, setOutboundCallerId,
    logForm, setLogForm, logModal, setLogModal, saving, callToast,
    OUTCOMES, formatTime,
    answerIncoming, declineIncoming, startCall, endCall, cancelCall,
    muted, toggleMute, onHold, holdBusy, toggleHold, addParticipant, transferCall, canTransfer,
    sendDTMF: (digit) => {
      if (activeCallRef.current?.dtmf) {
        console.log('[DTMF] sending digit:', digit, 'via call object:', activeCallRef.current)
        activeCallRef.current.dtmf(digit)
      } else {
        console.warn('[DTMF] no active call ref — call object:', activeCallRef.current)
      }
    },
    saveCallLog, closeLogModalWithoutSaving,
  }

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>
}

