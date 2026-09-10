import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCall } from '../../context/CallContext'
import { supabase } from '../../lib/supabase'

// Quick note starters for logging a call — click to insert, then edit.
const CALL_LOG_TEMPLATES = [
  { label: 'Left voicemail', body: 'Left a voicemail. Will follow up if no callback.' },
  { label: 'Discussed options', body: 'Discussed resolution options and next steps. Client considering.' },
  { label: 'Requested docs', body: 'Requested documents needed to proceed. Client to send.' },
  { label: 'Scheduled follow-up', body: 'Scheduled a follow-up call. ' },
  { label: 'Sent agreement', body: 'Reviewed and sent engagement/service agreement for signature.' },
  { label: 'Payment discussed', body: 'Discussed fees and payment arrangement.' },
  { label: 'No answer', body: 'No answer — will attempt again.' },
]

export default function ActiveCallBar() {
  const navigate = useNavigate()
  const [polishing, setPolishing] = useState(false)

  // ── Live transcription ───────────────────────────────────────────────
  const [transcribing,   setTranscribing]   = useState(false)
  const [transcript,     setTranscript]     = useState('')     // final confirmed text
  const [interimText,    setInterimText]    = useState('')     // live unconfirmed text
  const [showTranscript, setShowTranscript] = useState(false)
  const [showDialpad,    setShowDialpad]    = useState(false)
  const [callBarCollapsed, setCallBarCollapsed] = useState(false)
  const [dtmfPressed,    setDtmfPressed]    = useState('')
  const recognitionRef = useRef(null)
  const shouldRestartRef = useRef(false)

  const {
    phoneContext,
    incomingCall, incomingMatch, calling, ending, active, elapsed, formatTime,
    answerIncoming, declineIncoming, cancelCall, endCall,
    logModal, logForm, setLogForm, saving, OUTCOMES, saveCallLog, closeLogModalWithoutSaving,
    callToast, sendDTMF, muted, toggleMute, onHold, holdBusy, toggleHold, addParticipant, transferCall, canTransfer,
  } = useCall()

  // Add-caller popover state
  const [showAddCaller, setShowAddCaller] = useState(false)
  const [addNumber, setAddNumber] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addMsg, setAddMsg] = useState('')

  const [participants, setParticipants] = useState([]) // {id, number, status: 'ringing'|'connected'}

  async function handleAddCaller() {
    const digits = addNumber.replace(/\D/g, '')
    if (digits.length < 10) { setAddMsg('Enter a full 10-digit number.'); return }
    setAddBusy(true); setAddMsg('')
    const res = await addParticipant(addNumber.trim())
    setAddBusy(false)
    if (res?.error) { setAddMsg('❌ ' + res.error); return }
    const num = addNumber.trim()
    const pid = Date.now()
    // Show them as a persistent participant — ringing first, then connected.
    // SignalWire is placing the call; this keeps the CRM in sync with what's
    // actually happening on the line instead of the panel just vanishing.
    setParticipants(p => [...p, { id: pid, number: num, status: 'ringing' }])
    setTimeout(() => {
      setParticipants(p => p.map(x => x.id === pid && x.status === 'ringing' ? { ...x, status: 'connected' } : x))
    }, 8000)
    setAddMsg('')
    setAddNumber('')
    setShowAddCaller(false)
  }

  function markParticipant(id, status) {
    if (status === 'remove') { setParticipants(p => p.filter(x => x.id !== id)); return }
    setParticipants(p => p.map(x => x.id === id ? { ...x, status } : x))
  }

  // Transfer panel state — employee directory loads when the panel opens
  const [showTransfer, setShowTransfer] = useState(false)
  const [xferEmployees, setXferEmployees] = useState([])
  const [xferNumber, setXferNumber] = useState('')
  const [xferBusy, setXferBusy] = useState(false)
  const [xferMsg, setXferMsg] = useState('')

  useEffect(() => {
    if (!showTransfer) return
    if (phoneContext === 'romylabs') {
      setXferEmployees([])
      return
    }
    supabase.from('employees').select('name,title,extension')
      .not('extension', 'is', null).neq('extension', '').order('name')
      .then(({ data }) => setXferEmployees(data || []))
  }, [showTransfer, phoneContext])

  async function handleTransfer(target) {
    if (xferBusy) return
    setXferBusy(true); setXferMsg('')
    const res = await transferCall(target)
    setXferBusy(false)
    if (res?.error) { setXferMsg('❌ ' + res.error); return }
    // On success transferCall already ends our side; the bar closes itself.
  }

  function openFile(entry) {
    if (!entry?.id) return
    navigate(entry.entityType === 'client' ? `/clients/${entry.id}` : `/leads/${entry.id}`)
  }

  // When call ends and log modal opens, pre-fill notes with transcript if present
  useEffect(() => {
    if (logModal && transcript.trim()) {
      setLogForm(f => ({
        ...f,
        notes: f.notes ? f.notes + '\n\n--- Live Transcript ---\n' + transcript : '--- Live Transcript ---\n' + transcript
      }))
    }
  }, [logModal])

  // Stop transcription when call ends
  useEffect(() => {
    if (!calling) stopTranscription()
  }, [calling])

  function startTranscription() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      alert('Live transcription requires Chrome. Please use Chrome for this feature.')
      return
    }
    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.maxAlternatives = 1

    recognition.onresult = (e) => {
      let interim = ''
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript
        if (e.results[i].isFinal) {
          final += text + ' '
        } else {
          interim += text
        }
      }
      if (final) setTranscript(prev => prev + final)
      setInterimText(interim)
    }

    recognition.onend = () => {
      setInterimText('')
      // Auto-restart so it doesn't stop after ~60s silence
      if (shouldRestartRef.current) {
        try { recognition.start() } catch {}
      }
    }

    recognition.onerror = (e) => {
      if (e.error === 'not-allowed') {
        alert('Microphone access denied. Allow mic access in your browser to use transcription.')
        stopTranscription()
      }
    }

    shouldRestartRef.current = true
    recognitionRef.current = recognition
    try { recognition.start() } catch {}
    setTranscribing(true)
    setShowTranscript(true)
    setTranscript('')
    setInterimText('')
  }

  function stopTranscription() {
    shouldRestartRef.current = false
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
      recognitionRef.current = null
    }
    setTranscribing(false)
    setInterimText('')
  }

  function toggleTranscription() {
    if (transcribing) { stopTranscription() } else { startTranscription() }
  }

  async function polishNotes() {
    if (!logForm.notes?.trim() || polishing) return
    setPolishing(true)
    const { data, error } = await supabase.functions.invoke('call-recap', {
      body: { bullets: logForm.notes, contactName: active?.name, outcome: logForm.outcome, phoneContext }
    })
    setPolishing(false)
    if (error || data?.error) {
      alert(data?.error || error?.message || 'Could not polish notes — try again.')
      return
    }
    if (data?.recap) setLogForm(f => ({ ...f, notes: data.recap }))
  }

  return (
    <>
      {callToast && (
        <div className="toast show" style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 4000 }}>{callToast}</div>
      )}

      {/* ── Incoming Call Banner ── */}
      {incomingCall && (
        <div style={{
          position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 3500,
          width: 'min(560px, 92vw)',
          background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)',
          borderRadius: 10, padding: '16px 20px', boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
            }}>📞</div>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>
                {incomingMatch ? incomingMatch.name : 'Incoming Call'}
                {incomingMatch && !incomingMatch.isDepartment && (
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, background: 'rgba(255,255,255,0.2)', borderRadius: 6, padding: '2px 8px' }}>
                    {incomingMatch.entityType === 'client' ? 'Client' : incomingMatch.entityType === 'lead' ? 'Lead' : incomingMatch.entityType === 'reference' ? 'Reference' : 'Call'}
                  </span>
                )}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>
                {incomingCall.options?.remoteCallerNumber || incomingCall.options?.destinationNumber || 'Unknown number'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {incomingMatch && !incomingMatch.isDepartment && (
              <button onClick={() => openFile(incomingMatch)} className="btn"
                style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }}>
                📂 Open File
              </button>
            )}
            <button onClick={declineIncoming} className="btn"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }}>
              Decline
            </button>
            <button onClick={answerIncoming}
              style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
              ✅ Answer
            </button>
          </div>
        </div>
      )}

      {/* ── Active Call Bar ── */}
      {calling && active && (
        <>
          {callBarCollapsed && (
            <button
              onClick={() => setCallBarCollapsed(false)}
              title="Show active call controls"
              style={{
                position: 'fixed', top: 0, left: '45%', transform: 'translateX(-50%)', zIndex: 3501,
                background: 'linear-gradient(135deg, #0f6e2e, #25A25A)', color: '#fff',
                border: '1px solid rgba(255,255,255,.2)', borderTop: 'none',
                borderRadius: '0 0 8px 8px',
                padding: '6px 16px 7px',
                boxShadow: '0 4px 12px rgba(0,0,0,.25)',
                fontSize: 13.5, fontWeight: 800, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap'
              }}
            >
              ▼ Show Call
            </button>
          )}
                    {!callBarCollapsed && (
          <div style={{
            position: 'fixed', top: 10, left: '45%', transform: 'translateX(-50%)', zIndex: 3500,
            width: 'min(650px, 92vw)',
            background: 'linear-gradient(135deg, #0f6e2e, #25A25A)',
            borderRadius: showTranscript ? '12px 12px 0 0' : 12,
            padding: '9px 13px', boxShadow: '0 7px 20px rgba(0,0,0,0.32)',
            display: 'flex', flexDirection: 'column', gap: 5,
          }}>
            {/* Row 1 — who you're talking to + End */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, flexShrink: 0
                }}>📞</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {active?.name || `${active?.first || ''} ${active?.last || ''}`.trim()}
                    {active.entityType && (
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, background: 'rgba(255,255,255,0.2)', borderRadius: 6, padding: '2px 8px', verticalAlign: 'middle' }}>
                        {active.entityType === 'client' ? 'Client' : active.entityType === 'lead' ? 'Lead' : active.entityType === 'reference' ? 'Reference' : 'Call'}
                      </span>
                    )}
                    {onHold && (
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, background: '#B45309', borderRadius: 6, padding: '2px 8px', verticalAlign: 'middle' }}>
                        ON HOLD
                      </span>
                    )}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11.75, whiteSpace: 'nowrap' }}>
                    {active.phone} <span style={{ opacity: 0.75, margin: '0 6px' }}>•</span> ⏱ {formatTime(elapsed)}
                  </div>
                </div>
              </div>
              <button onClick={() => endCall()} disabled={ending}
                style={{
                  background: '#C0202F', color: '#fff', border: 'none', flexShrink: 0,
                  borderRadius: 7, padding: '6px 13px', fontWeight: 800,
                  cursor: ending ? 'wait' : 'pointer', opacity: ending ? 0.75 : 1, fontSize: 11.75, display: 'flex', alignItems: 'center', gap: 6,
                  whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                }}>
                {ending ? 'Ending…' : '🔴 End Call'}
              </button>
            </div>

            {/* Conference participants — persistent, so you always see who's on */}
            {participants.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 700 }}>On this call:</span>
                {participants.map(p => (
                  <span key={p.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: p.status === 'connected' ? 'rgba(21,128,61,0.35)' : 'rgba(180,83,9,0.35)',
                    border: `1px solid ${p.status === 'connected' ? 'rgba(34,197,94,0.6)' : 'rgba(245,158,11,0.6)'}`,
                    borderRadius: 20, padding: '3px 10px', fontSize: 11.5, color: '#fff', fontWeight: 600,
                  }}>
                    {p.status === 'connected' ? '✅' : '📞'} {p.number}
                    <span style={{ opacity: 0.85 }}>{p.status === 'connected' ? 'On call' : 'Ringing…'}</span>
                    {p.status === 'ringing' && (
                      <span onClick={() => markParticipant(p.id, 'connected')} title="Mark connected"
                        style={{ cursor: 'pointer', opacity: 0.8, marginLeft: 2 }}>✓</span>
                    )}
                    <span onClick={() => markParticipant(p.id, 'remove')} title="Remove from view"
                      style={{ cursor: 'pointer', opacity: 0.7, marginLeft: 2 }}>✕</span>
                  </span>
                ))}
              </div>
            )}

            {/* Row 2 — call controls, uniform sizing, never wrap labels */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {[
                { key: 'mute', onClick: toggleMute, on: muted, onBg: '#C0202F',
                  label: muted ? '🔇 Unmute' : '🎤 Mute',
                  title: muted ? 'Unmute microphone' : 'Mute microphone' },
                { key: 'hold', onClick: toggleHold, on: onHold, onBg: '#B45309', disabled: holdBusy,
                  label: holdBusy ? '⏳ Hold…' : (onHold ? '▶ Resume' : '⏸ Hold'),
                  title: onHold ? 'Take the caller off hold' : 'Put the caller on hold (they hear hold music)' },
                { key: 'add', onClick: () => { setShowAddCaller(v => !v); setShowTransfer(false); setAddMsg('') }, on: showAddCaller, onBg: 'rgba(255,255,255,0.35)',
                  label: '➕ Add Caller', title: 'Conference another person into this call' },
                { key: 'transfer', onClick: () => { setShowTransfer(v => !v); setShowAddCaller(false); setXferMsg('') },
                  on: showTransfer, onBg: 'rgba(255,255,255,0.35)', disabled: !canTransfer,
                  label: '↪ Transfer',
                  title: canTransfer ? 'Transfer this call to a teammate or an outside number' : 'Transfer becomes available once the call connects' },
                { key: 'dialpad', onClick: () => setShowDialpad(d => !d), on: showDialpad, onBg: 'rgba(255,255,255,0.35)',
                  label: '⌨️ Dialpad', title: phoneContext === 'romylabs' ? 'Open dialpad for phone menus' : 'Open dialpad for IRS prompts' },
                { key: 'transcribe', onClick: toggleTranscription, on: transcribing, onBg: 'rgba(239,68,68,0.85)',
                  label: transcribing ? '⏹ Stop' : '🎙️ Transcribe',
                  title: transcribing ? 'Stop transcription' : 'Start live transcription (Chrome only)',
                  pulse: transcribing },
              ].map(b => (
                <button key={b.key} onClick={b.onClick} disabled={b.disabled} title={b.title}
                  style={{
                    background: b.on ? b.onBg : 'rgba(255,255,255,0.15)',
                    color: '#fff', border: 'none', borderRadius: 7,
                    height: 26, padding: '0 9px', fontWeight: 700, fontSize: 11.25,
                    cursor: b.disabled ? 'not-allowed' : 'pointer', opacity: b.disabled ? 0.55 : 1,
                    display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                    animation: b.pulse ? 'pulse 1.5s infinite' : 'none',
                  }}>
                  {b.label}
                </button>
              ))}
              {active.id && (
                <button onClick={() => openFile(active)}
                  style={{
                    background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 8,
                    height: 29, padding: '0 11px', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                  }}>
                  📂 Open File
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button onClick={cancelCall} title="Abort this call attempt"
                style={{
                  background: 'transparent', color: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.35)',
                  borderRadius: 7, height: 26, padding: '0 9px', fontWeight: 600, fontSize: 10.75,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                Cancel
              </button>
            </div>

            {/* Row 3 — conference-in input, only while Add Caller is open */}
            {showAddCaller && (
              <div style={{
                background: 'rgba(0,0,0,0.22)', borderRadius: 8,
                padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                alignSelf: 'flex-start',
              }}>
                <span style={{ color: '#fff', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>Conference in:</span>
                <input
                  autoFocus
                  value={addNumber}
                  onChange={e => setAddNumber(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddCaller() }}
                  placeholder="(561) 555-0123"
                  inputMode="tel"
                  style={{
                    background: 'rgba(255,255,255,0.95)', border: 'none', borderRadius: 7,
                    padding: '6px 10px', fontSize: 12.5, width: 145, height: 28, boxSizing: 'border-box',
                  }}
                />
                <button onClick={handleAddCaller} disabled={addBusy}
                  style={{
                    background: '#15803D', color: '#fff', border: 'none', borderRadius: 7,
                    height: 28, padding: '0 12px', fontWeight: 700, cursor: addBusy ? 'wait' : 'pointer', fontSize: 12,
                    opacity: addBusy ? 0.7 : 1, whiteSpace: 'nowrap',
                  }}>
                  {addBusy ? 'Dialing…' : '📞 Dial in'}
                </button>
                {addMsg && <span style={{ color: '#fff', fontSize: 12 }}>{addMsg}</span>}
              </div>
            )}

            {/* Transfer panel — employee directory + external number */}
            {showTransfer && (
              <div style={{
                background: 'rgba(0,0,0,0.22)', borderRadius: 8,
                padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 7,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ color: '#fff', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', marginRight: 2 }}>Transfer to:</span>
                  {xferEmployees.length === 0 && (
                    <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>
                      {phoneContext === 'romylabs' ? 'RomyLabs internal extensions are not configured yet.' : 'No teammates with extensions found.'}
                    </span>
                  )}
                  {xferEmployees.map(e => (
                    <button key={e.extension} disabled={xferBusy}
                      onClick={() => handleTransfer({ type: 'extension', extension: e.extension, label: `${e.name} (x${e.extension})` })}
                      title={e.title ? `${e.name} — ${e.title}` : e.name}
                      style={{
                        background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 7,
                        height: 28, padding: '0 11px', fontWeight: 700, fontSize: 12,
                        cursor: xferBusy ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                        opacity: xferBusy ? 0.7 : 1, display: 'inline-flex', alignItems: 'center', gap: 5,
                      }}>
                      👤 {e.name} <span style={{ opacity: 0.75, fontWeight: 600 }}>x{e.extension}</span>
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>Outside number:</span>
                  <input
                    value={xferNumber}
                    onChange={e => setXferNumber(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && xferNumber.replace(/\D/g, '').length >= 10) handleTransfer({ type: 'external', number: xferNumber.trim(), label: xferNumber.trim() }) }}
                    placeholder="(561) 555-0123"
                    inputMode="tel"
                    style={{
                      background: 'rgba(255,255,255,0.95)', border: 'none', borderRadius: 7,
                      padding: '6px 10px', fontSize: 12.5, width: 145, height: 28, boxSizing: 'border-box',
                    }}
                  />
                  <button disabled={xferBusy}
                    onClick={() => {
                      if (xferNumber.replace(/\D/g, '').length < 10) { setXferMsg('Enter a full 10-digit number.'); return }
                      handleTransfer({ type: 'external', number: xferNumber.trim(), label: xferNumber.trim() })
                    }}
                    style={{
                      background: '#15803D', color: '#fff', border: 'none', borderRadius: 7,
                      height: 28, padding: '0 12px', fontWeight: 700, cursor: xferBusy ? 'wait' : 'pointer', fontSize: 12,
                      opacity: xferBusy ? 0.7 : 1, whiteSpace: 'nowrap',
                    }}>
                    {xferBusy ? 'Transferring…' : '↪ Transfer'}
                  </button>
                  {xferMsg && <span style={{ color: '#fff', fontSize: 12 }}>{xferMsg}</span>}
                </div>
              </div>
            )}
              <button
                onClick={() => {
                  setCallBarCollapsed(true)
                  setShowDialpad(false)
                  setShowTranscript(false)
                  setShowAddCaller(false)
                  setShowTransfer(false)
                }}
                title="Hide active call controls"
                style={{
                  background: 'rgba(255,255,255,.12)', color: '#fff',
                  border: '1px solid rgba(255,255,255,.22)', borderRadius: 7,
                  height: 30, padding: '0 11px', fontSize: 12.25, fontWeight: 800,
                  cursor: 'pointer', whiteSpace: 'nowrap'
                }}
              >
                ▲ Hide
              </button>
          </div>
          )}

          {/* ── DTMF Dialpad — appears below call bar ── */}
          {!callBarCollapsed && showDialpad && (
            <div style={{
              position: 'fixed', top: 122, left: '38%', transform: 'translateX(-50%)', zIndex: 3502,
              width: 205,
              background: 'rgba(5,15,30,0.98)',
              border: '1px solid rgba(255,255,255,.2)',
              borderRadius: '10px',
              padding: '10px',
              boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
            }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                Keypad — {dtmfPressed || 'Press to send tones'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 5 }}>
                {['1','2','3','4','5','6','7','8','9','*','0','#'].map(d => (
                  <button key={d} onClick={() => {
                    sendDTMF(d)
                    setDtmfPressed(p => (p + d).slice(-8))
                  }}
                    style={{
                      background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 7, padding: '8px 0', fontSize: 16, fontWeight: 700,
                      cursor: 'pointer', fontFamily: 'monospace',
                      transition: 'background .1s',
                    }}
                    onMouseDown={e => e.currentTarget.style.background='rgba(255,255,255,0.3)'}
                    onMouseUp={e => e.currentTarget.style.background='rgba(255,255,255,0.12)'}
                    onTouchStart={e => e.currentTarget.style.background='rgba(255,255,255,0.3)'}
                    onTouchEnd={e => e.currentTarget.style.background='rgba(255,255,255,0.12)'}
                  >{d}</button>
                ))}
              </div>
            </div>
          )}

          {/* Live transcript panel — attached below the call bar */}
          {!callBarCollapsed && showTranscript && (
            <div style={{
              position: 'fixed', top: 122, left: '45%', transform: 'translateX(-50%)', zIndex: 3502,
              width: 'min(560px, 88vw)',
              background: 'rgba(5,15,30,0.97)',
              border: '1px solid rgba(255,255,255,.15)',
              borderTop: 'none',
              borderRadius: '0 0 10px 10px',
              padding: '12px 16px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              maxHeight: 200, overflowY: 'auto',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {transcribing && (
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1s infinite' }}/>
                  )}
                  <span style={{ fontSize: 11, fontWeight: 700, color: transcribing ? '#ef4444' : '#64748b', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {transcribing ? 'Live Transcription — Your Mic' : 'Transcription Paused'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {transcript && (
                    <button onClick={() => { navigator.clipboard?.writeText(transcript); }}
                      style={{ fontSize: 11, padding: '3px 8px', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 5, color: '#94a3b8', cursor: 'pointer' }}>
                      📋 Copy
                    </button>
                  )}
                  <button onClick={() => setShowTranscript(false)}
                    style={{ fontSize: 14, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', lineHeight: 1 }}>×</button>
                </div>
              </div>
              <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.7, minHeight: 32 }}>
                {transcript || <span style={{ color: '#475569', fontStyle: 'italic' }}>Listening… speak naturally.</span>}
                {interimText && <span style={{ color: '#94a3b8', fontStyle: 'italic' }}> {interimText}</span>}
              </div>
              {transcript && (
                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => {
                      setLogForm(f => ({
                        ...f,
                        notes: f.notes ? f.notes + '\n\n' + transcript : transcript
                      }))
                    }}
                    style={{ fontSize: 11, padding: '4px 10px', background: 'rgba(59,130,246,.2)', border: '1px solid rgba(59,130,246,.4)', borderRadius: 5, color: '#93c5fd', cursor: 'pointer', fontWeight: 600 }}>
                    ➕ Add to Notes
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Log Call Modal ── */}
      {logModal && (
        <div className="modal-bg open" style={{ zIndex: 4000 }} onClick={e => e.target === e.currentTarget && closeLogModalWithoutSaving()}>
          <div className="modal">
            <div className="mh">
              <span className="mt">Log Call — {active?.name || `${active?.first || ''} ${active?.last || ''}`.trim()}</span>
              <button className="xbtn" onClick={closeLogModalWithoutSaving}>&times;</button>
            </div>

            <div style={{
              background: 'var(--bg)', borderRadius: 8, padding: '10px 14px',
              marginBottom: 14, display: 'flex', gap: 20, flexWrap: 'wrap'
            }}>
              <div><span style={{ color: 'var(--t3)', fontSize: 11 }}>Phone</span><br />
                <span style={{ fontWeight: 600 }}>{active?.phone}</span></div>
              <div><span style={{ color: 'var(--t3)', fontSize: 11 }}>Duration</span><br />
                <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{logForm.duration || formatTime(elapsed)}</span></div>
            </div>

            <div className="field">
              <label>Outcome</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {OUTCOMES.map(o => (
                  <button key={o}
                    onClick={() => setLogForm(f => ({ ...f, outcome: o }))}
                    className={logForm.outcome === o ? 'btn pri' : 'btn sec'}
                    style={{ padding: '6px 12px', fontSize: 12 }}>
                    {o}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Notes {transcript && <span style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 600 }}>✓ Transcript included</span>}</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {(phoneContext === 'romylabs' ? [
                  { label:'Follow-up', body:'Follow-up needed.' },
                  { label:'Demo discussed', body:'Discussed a RomyLabs product demo and next steps.' },
                  { label:'Support request', body:'Reviewed the support request and next steps.' },
                  { label:'Billing discussed', body:'Discussed billing or account questions.' },
                  { label:'Left voicemail', body:'Left a voicemail. Will follow up if no callback.' },
                  { label:'No answer', body:'No answer — will attempt again.' },
                ] : CALL_LOG_TEMPLATES).map(t => (
                  <button key={t.label} className="btn sec" style={{ fontSize: 11, padding: '4px 9px' }}
                    onClick={() => setLogForm(f => ({ ...f, notes: f.notes?.trim() ? f.notes + '\n' + t.body : t.body }))}>
                    {t.label}
                  </button>
                ))}
              </div>
              <textarea
                value={logForm.notes}
                onChange={e => setLogForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="What was discussed? Follow-up needed?"
                style={{ minHeight: 100 }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button className="btn sec" style={{ fontSize: 12, padding: '6px 12px' }}
                  onClick={polishNotes} disabled={!logForm.notes?.trim() || polishing}>
                  {polishing ? 'Polishing…' : '✨ Polish Notes'}
                </button>
                {transcript && (
                  <button className="btn sec" style={{ fontSize: 12, padding: '6px 12px' }}
                    onClick={() => setLogForm(f => ({ ...f, notes: transcript }))}>
                    🎙️ Use Raw Transcript
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
                Type quick bullet points then hit ✨ Polish Notes — or use the raw transcript from your mic.
              </div>
            </div>

            <button className="btn pri"
              style={{ width: '100%', justifyContent: 'center', padding: 10 }}
              onClick={() => saveCallLog()} disabled={saving}>
              {saving ? 'Saving...' : '💾 Save Call Log'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
