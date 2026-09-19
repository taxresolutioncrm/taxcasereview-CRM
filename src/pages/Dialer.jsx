import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useCall } from '../context/CallContext'
import { useApp } from '../context/AppContext'
import ClientLink from '../components/ClientLink'
import { FIRM } from '../lib/firmBranding'

const OUTCOME_C = {
  'Connected': 'bg', 'No Answer': 'bn', 'Voicemail': 'ba',
  'Wrong Number': 'br', 'Callback Requested': 'bb', 'Converted': 'bg',
  // Raw call statuses (incoming_calls / outbound_calls) shown when staff
  // never filled out the Log This Call modal for that call — see loadCallLog.
  'Ringing': 'ba', 'Answered': 'bb', 'Completed': 'bg', 'Missed': 'br',
  'Dialing…': 'ba', 'Failed': 'br',
}
const RAW_STATUS_LABEL = {
  ringing: 'Ringing', answered: 'Answered', completed: 'Completed', missed: 'Missed',
  pending: 'Dialing…', connected: 'Connected', failed: 'Failed',
}
function initialsFor(name) {
  if (!name) return '?'
  const p = name.trim().split(' ')
  return p.length >= 2 ? p[0][0] + p[p.length-1][0] : name[0].toUpperCase()
}
const AV_COLORS = ['blue','green','amber','red','gray']
function avColor(name) {
  if (!name) return 'gray'
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AV_COLORS.length
  return AV_COLORS[h]
}

export default function Dialer() {
  const {
    relayStatus, calling, active,
    startCall: startCallShared, logModal,
    outboundCallerId, setOutboundCallerId,
  } = useCall()
  const { role } = useApp()
  const canDeleteRecordings = role === 'Super Admin' || role === 'Admin'
  const [confirmDel, setConfirmDel] = useState(null)

  const [leads, setLeads]       = useState([])
  const [callLog, setCallLog]   = useState([])
  const [dialpad, setDialpad]   = useState('')
  const [toast, setToast]       = useState('')
  const [tab, setTab]           = useState('queue') // 'queue' | 'log'

  const [clientQueue, setClientQueue] = useState([])
  const [voicemails, setVoicemails] = useState([])
  const [recordings, setRecordings] = useState([])
  const [attachRec, setAttachRec]   = useState(null)   // recording being attached to a client
  const [transcribingId, setTranscribingId] = useState(null)
  const [otterLinks, setOtterLinks]     = useState({}) // recId -> otter URL
  const [attachSearch, setAttachSearch] = useState('')
  const [attachResults, setAttachResults] = useState([])
  const [attaching, setAttaching]   = useState(false)
  const prevLogModalRef = useRef(false)
  const phoneDirectoryRef = useRef([])
  const callLogReloadTimerRef = useRef(null)

  // Page-local wrapper around the shared connection's startCall.
  function startCall(lead) { startCallShared(lead) }

  // The "log this call" modal now renders globally (so it still shows up
  // even if a call ends on a different page) — when it closes while this
  // page happens to be the one mounted, refresh this page's own lists.
  useEffect(() => {
    if (prevLogModalRef.current && !logModal) {
      const q = JSON.parse(sessionStorage.getItem('dialerQueue') || '[]')
      setClientQueue(q)
      loadCallLog()
      loadLeads()
    }
    prevLogModalRef.current = logModal
  }, [logModal])

  useEffect(() => {
    loadLeads(); loadPhoneDirectory().then(()=>loadCallLog()); loadVoicemails(); loadRecordings()
    // Pick up number passed from client phone link
    const pre = sessionStorage.getItem('dialerNumber')
    if (pre) {
      setDialpad(pre)
      sessionStorage.removeItem('dialerNumber')
      sessionStorage.removeItem('dialerName')
    }
    // Load client call queue (from "Add to Call Queue" on Clients page)
    const q = JSON.parse(sessionStorage.getItem('dialerQueue')||'[]')
    setClientQueue(q)
  }, [])

  // Call history is authoritative from incoming_calls/outbound_calls. Refresh it
  // whenever the Dialer becomes visible/focused, and whenever staff opens the
  // Call History tab, so recent calls never wait on a hard refresh.
  useEffect(() => {
    const refresh = () => loadPhoneDirectory().then(()=>loadCallLog())
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    if (tab === 'log') loadCallLog()
  }, [tab])

  useEffect(() => {
    const scheduleReload = () => {
      if (callLogReloadTimerRef.current) clearTimeout(callLogReloadTimerRef.current)
      callLogReloadTimerRef.current = setTimeout(() => loadCallLog(), 250)
    }
    const tenantFilter = FIRM.tenantId ? { filter: `tenant_id=eq.${FIRM.tenantId}` } : {}
    const channel = supabase
      .channel('dialer-calllog-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calllog', ...tenantFilter }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incoming_calls', ...tenantFilter }, scheduleReload)
      .subscribe()
    return () => {
      if (callLogReloadTimerRef.current) clearTimeout(callLogReloadTimerRef.current)
      supabase.removeChannel(channel)
    }
  }, [])

  // Realtime handles normal history updates. Keep a low-frequency safety poll
  // only while a call is actively in progress, when provider state can change
  // without a new durable calllog row yet.
  useEffect(() => {
    loadCallLog()
    if (!calling) return
    const t = setInterval(loadCallLog, 10000)
    return () => clearInterval(t)
  }, [calling])


  async function loadLeads() {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, first, last, phone, status, source')
      .not('status', 'eq', 'Converted to Client')
      .not('status', 'eq', 'Dead')
      .order('created_at', { ascending: false })
    if (error) console.error('loadLeads error:', error)
    if (data) setLeads(data)
  }

  async function loadPhoneDirectory() {
    const [{ data: allLeads, error: leadsError }, { data: allClients, error: clientsError }] = await Promise.all([
      supabase.from('leads').select('id,name,phone').limit(5000),
      supabase.from('clients').select('id,name,phone').limit(5000),
    ])
    if (leadsError || clientsError) {
      console.error('loadPhoneDirectory error:', leadsError || clientsError)
      return
    }
    phoneDirectoryRef.current = [...(allLeads || []), ...(allClients || [])]
  }

  async function loadCallLog() {
    // Durable call history now comes from calllog. Contact matching is cached
    // separately so a 100-user dialer fleet does not download the entire
    // client/lead directory every few seconds.
    const [
      { data: inbound, error: inboundError },
      { data: logged, error: loggedError },
    ] = await Promise.all([
      supabase.from('incoming_calls').select('*').order('created_at', { ascending: false }).limit(150),
      supabase.from('calllog').select('*').order('created_at', { ascending: false }).limit(300),
    ])

    const firstError = loggedError || inboundError
    if (firstError) {
      console.error('loadCallLog error:', firstError)
      showToast('Call history failed to load: ' + firstError.message)
    }

    function matchPhone(phone) {
      if (!phone) return null
      const digits = phone.replace(/\D/g,'').slice(-10)
      const found = phoneDirectoryRef.current.find(c => c.phone?.replace(/\D/g,'').slice(-10) === digits)
      return found?.name || null
    }

    const durableRows = (logged || []).map(c => {
      const direction = c.direction || (c.raw_call_id ? 'Outbound' : 'Outbound')
      return {
        id: 'log-' + c.id,
        direction,
        phone: c.phone,
        clientName: c.clientName || matchPhone(c.phone) || null,
        outcome: c.outcome || '—',
        duration: c.duration || null,
        notes: c.notes || null,
        created_at: c.created_at,
      }
    })

    // Avoid duplicating inbound rows that already have a manually-saved log
    // near the same time/number.
    function hasLoggedInbound(phone, createdAt) {
      const t = new Date(createdAt || 0).getTime()
      return durableRows.some(r =>
        r.direction === 'Inbound' &&
        r.phone === phone &&
        Math.abs(new Date(r.created_at || 0).getTime() - t) < 15 * 60 * 1000
      )
    }

    const inboundRows = (inbound || [])
      .filter(c => !hasLoggedInbound(c.from_number, c.created_at))
      .map(c => ({
        id: 'in-' + c.id,
        direction: 'Inbound',
        phone: c.from_number,
        clientName: matchPhone(c.from_number) || null,
        outcome: RAW_STATUS_LABEL[c.status] || c.status || '—',
        duration: null,
        notes: null,
        created_at: c.created_at,
      }))

    const merged = [...durableRows, ...inboundRows]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 150)

    setCallLog(merged)
  }

  async function loadVoicemails() {
    const { data, error } = await supabase
      .from('voicemails')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) console.error('loadVoicemails error:', error)
    if (data) setVoicemails(data)
  }

  async function loadRecordings() {
    const { data, error } = await supabase
      .from('call_recordings')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) console.error('loadRecordings error:', error)
    if (data) setRecordings(data)
  }

  async function markVoicemailRead(vm) {
    await supabase.from('voicemails').update({ is_read: true }).eq('id', vm.id)
    setVoicemails(vs => vs.map(v => v.id === vm.id ? { ...v, is_read: true } : v))
  }

  async function deleteVoicemail(vm) {
    setConfirmDel({ type: 'voicemail', item: vm })
  }
  async function confirmDeleteVoicemail(vm) {
    const { error } = await supabase.from('voicemails').delete().eq('id', vm.id)
    if (error) { showToast('Error: ' + error.message); setConfirmDel(null); return }
    if (vm.recording_url?.includes('/storage/v1/object/public/voicemails/')) {
      const fileName = vm.recording_url.split('/voicemails/').pop()
      if (fileName) await supabase.storage.from('voicemails').remove([fileName]).catch(() => {})
    }
    setVoicemails(vs => vs.filter(v => v.id !== vm.id))
    setConfirmDel(null); showToast('Voicemail deleted.')
  }

  async function deleteRecording(rec) {
    if (!canDeleteRecordings) return
    setConfirmDel({ type: 'recording', item: rec })
  }
  async function confirmDeleteRecording(rec) {
    const { error } = await supabase.from('call_recordings').delete().eq('id', rec.id)
    if (error) { showToast('Error: ' + error.message); setConfirmDel(null); return }
    if (rec.recording_url?.includes('/documents/')) {
      const path = rec.recording_url.split('/documents/')[1]
      if (path) await supabase.storage.from('documents').remove([path]).catch(() => {})
    }
    setRecordings(rs => rs.filter(r => r.id !== rec.id))
    setConfirmDel(null); showToast('Recording deleted.')
  }

  // Attach to Client — drops a row into that client's Documents pointing at
  // the recording's existing file (already hosted in the documents storage
  // bucket by call-recorded), so it shows up in their file without needing
  // to re-upload the audio anywhere.
  async function searchClientsToAttach(q) {
    setAttachSearch(q)
    if (!q.trim()) { setAttachResults([]); return }
    const { data } = await supabase.from('clients').select('id,name,phone')
      .ilike('name', `%${q.trim()}%`).limit(8)
    setAttachResults(data || [])
  }

  async function attachToClient(client) {
    if (!attachRec) return
    setAttaching(true)
    const when = attachRec.created_at ? new Date(attachRec.created_at).toLocaleString() : ''
    const { error } = await supabase.from('documents').insert([{
      name: `Call Recording — ${when}`,
      client: client.name,
      clientname: client.name,
      client_id: String(client.id),
      docType: 'Call Recording',
      notes: `From ${attachRec.from_number || 'unknown'}${attachRec.duration_seconds ? ` · ${attachRec.duration_seconds}s` : ''}`,
      file_url: attachRec.recording_url,
      file_name: `call-recording-${attachRec.id}.mp3`,
      file_size: null,
      created_at: new Date().toISOString(),
    }])
    setAttaching(false)
    if (error) { showToast('Error: ' + error.message); return }
    showToast(`✅ Attached to ${client.name}'s file`)
    setAttachRec(null); setAttachSearch(''); setAttachResults([])
  }

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  function dialpadPress(val) {
    setDialpad(p => p + val)
  }

  function callDialpad() {
    if (!dialpad) return
    const fakeLead = { id: null, name: 'Manual Dial', first: 'Manual', last: 'Dial', phone: dialpad, status: 'Manual' }
    startCall(fakeLead)
  }

  function callQueueEntry(entry) {
    const fakeLead = { id: null, name: entry.name || 'Client', first: entry.name||'', last: '', phone: entry.phone, status: 'Client Queue', entityType: 'client' }
    startCall(fakeLead)
  }

  function removeFromQueue(idx) {
    setClientQueue(q => {
      const next = q.filter((_,i)=>i!==idx)
      sessionStorage.setItem('dialerQueue', JSON.stringify(next))
      return next
    })
  }

  function clearQueue() {
    setClientQueue([])
    sessionStorage.removeItem('dialerQueue')
  }

  const DIALPAD_KEYS = [
    ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
    ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
    ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
    ['*', ''], ['0', '+'], ['#', ''],
  ]

  return (
    <div>
      {toast && <div className="toast show">{toast}</div>}

      {/* ── Caller ID + calling connection status ─────────────────── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, marginBottom:8 }}>
        <div style={{ display:'inline-flex', gap:3, background:'var(--s2)', padding:3, borderRadius:8, border:'1px solid var(--br)' }}>
          <button
            type="button"
            onClick={() => setOutboundCallerId('local')}
            style={{
              border:0, borderRadius:6, padding:'5px 9px', cursor:'pointer',
              fontSize:10.5, fontWeight:700,
              background: outboundCallerId === 'local' ? 'var(--blue)' : 'transparent',
              color: outboundCallerId === 'local' ? '#fff' : 'var(--t2)',
            }}>
            561 Local
          </button>
          <button
            type="button"
            onClick={() => setOutboundCallerId('tollfree')}
            style={{
              border:0, borderRadius:6, padding:'5px 9px', cursor:'pointer',
              fontSize:10.5, fontWeight:700,
              background: outboundCallerId === 'tollfree' ? 'var(--blue)' : 'transparent',
              color: outboundCallerId === 'tollfree' ? '#fff' : 'var(--t2)',
            }}>
            888 Toll-Free
          </button>
        </div>
        <span style={{
          fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 600,
          background: relayStatus === 'ready' ? 'rgba(37,162,90,0.15)' : relayStatus === 'error' ? 'rgba(192,32,47,0.15)' : 'rgba(245,158,11,0.15)',
          color: relayStatus === 'ready' ? '#25A25A' : relayStatus === 'error' ? '#C0202F' : '#f59e0b',
        }}>
          {relayStatus === 'ready' ? '🟢 Phone line connected' : relayStatus === 'error' ? '🔴 Phone line error' : '🟡 Connecting phone line…'}
        </span>
      </div>

      {/* ── Incoming Call Banner and Active Call Banner now render
           globally (see ActiveCallBar in App.jsx) so they're visible no
           matter which page you're on, not just here. ───────────────── */}

      <div className="dialer-layout" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

        {/* ── Left: Dialpad ──────────────────────────────────────────── */}
        <div className="card dialer-dialpad-card" style={{ width: 320, flexShrink: 0 }}>
          <div className="ch"><span className="ct">Dialpad</span></div>

          {/* Number display — a real input now, not just a click-built display.
              You can type, paste, or select-all+delete like any normal text
              field; the on-screen keypad below still appends digits the same
              way it always did. */}
          <input
            type="tel"
            value={dialpad}
            onChange={e => setDialpad(e.target.value.replace(/[^\d#*+]/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter' && dialpad && !calling) callDialpad() }}
            placeholder="Enter number"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--bg)', borderRadius: 8, padding: '10px 14px',
              textAlign: 'center', fontSize: 22, fontWeight: 700, letterSpacing: 4,
              color: 'var(--tx)', marginBottom: 12, minHeight: 48,
              border: '1px solid var(--br)', fontFamily: 'monospace'
            }}
          />

          {/* Dialpad grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
            {DIALPAD_KEYS.map(([num, letters]) => (
              <button key={num} onClick={() => dialpadPress(num)}
                style={{
                  background: 'var(--sf)', border: '1px solid var(--br)',
                  borderRadius: 8, padding: '12px 8px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1
                }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--tx)' }}>{num}</span>
                {letters && <span style={{ fontSize: 9, color: 'var(--t3)', letterSpacing: 1 }}>{letters}</span>}
              </button>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn pri" style={{ flex: 1, justifyContent: 'center', padding: 10 }}
              onClick={callDialpad} disabled={!dialpad || calling}>
              📞 Call
            </button>
            <button className="btn sec" style={{ padding: '10px 14px' }}
              onClick={() => setDialpad(p => p.slice(0, -1))}>
              ⌫
            </button>
          </div>
        </div>

        {/* ── Right: Queue + Log ─────────────────────────────────────── */}
        <div style={{ flex: 1 }}>

          {/* Client Call Queue (added via Clients page "Add to Call Queue") */}
          {clientQueue.length > 0 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="ch">
                <span className="ct">📇 Client Call Queue ({clientQueue.length})</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn pri" style={{ padding: '5px 12px', fontSize: 12 }}
                    onClick={() => callQueueEntry(clientQueue[0])} disabled={calling}>
                    📞 Call Next
                  </button>
                  <button className="btn sec" style={{ padding: '5px 12px', fontSize: 12 }} onClick={clearQueue}>
                    Clear Queue
                  </button>
                </div>
              </div>
              <div className="ovx">
                {clientQueue.map((entry, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderBottom: i < clientQueue.length - 1 ? '1px solid var(--br)' : 'none' }}>
                    <div className={`av ${avColor(entry.name || '?')}`} style={{ width: 24, height: 24, fontSize: 9.5 }}>{initialsFor(entry.name)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--tx)' }}>{entry.name || 'Unknown'}</div>
                      <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace', marginTop: 1 }}>
                        <a href={`tel:${entry.phone?.replace(/\D/g,'')}`} onClick={e=>e.stopPropagation()} style={{color:'var(--blue)',textDecoration:'none'}}>{entry.phone}</a>
                      </div>
                    </div>
                    <button className="btn pri" style={{ padding: '5px 11px', fontSize: 11, gap: 4 }}
                      onClick={() => callQueueEntry(entry)} disabled={calling}>
                      📞 Call
                    </button>
                    <button className="btn sec" style={{ padding: '5px 9px', fontSize: 11 }}
                      onClick={() => removeFromQueue(i)}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 2, marginBottom: 12, background: 'var(--s2)', padding: 3, borderRadius: 9, border: '1px solid var(--br)' }}>
            {[
              ['queue', '📋', 'Call Queue', leads.length],
              ['voicemail', '🔵', 'Voicemails', voicemails.filter(v => !v.is_read).length],
              ['recordings', '🎙️', 'Recordings', recordings.length],
              ['log', '📞', 'Call History', callLog.length > 99 ? '99+' : callLog.length],
            ].map(([key, icon, label, count]) => (
              <button key={key} onClick={() => setTab(key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px', fontSize: 11.5, fontWeight: 700,
                  borderRadius: 6, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  background: tab === key ? 'var(--blue)' : 'transparent',
                  color: tab === key ? '#fff' : 'var(--t2)',
                  transition: 'background .15s, color .15s',
                }}>
                <span style={{ fontSize: 12 }}>{icon}</span>{label}
                {count > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 20, minWidth: 16, textAlign: 'center',
                    background: tab === key ? 'rgba(255,255,255,.25)' : 'var(--s3)',
                    color: tab === key ? '#fff' : 'var(--t2)',
                  }}>{count}</span>
                )}
              </button>
            ))}
          </div>

          {/* Voicemails */}
          {tab === 'voicemail' && (
            <div className="card">
              <div className="ovx">
                {voicemails.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 32 }}>No voicemails yet</div>
                ) : voicemails.map(vm => (
                  <div key={vm.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                    borderBottom: '1px solid var(--br)',
                    background: vm.is_read ? 'transparent' : 'rgba(37,99,235,0.06)'
                  }}>
                    <div className={`av ${avColor(vm.from_number || '?')}`} style={{ position: 'relative', width: 24, height: 24, fontSize: 11 }}>
                      📵
                      {!vm.is_read && <span style={{ position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', border: '2px solid var(--card-bg, #0f172a)' }} />}
                    </div>
                    <div style={{ minWidth: 135 }}>
                      <div style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 12.5, color: 'var(--tx)' }}>{vm.from_number || 'Unknown'}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 1 }}>
                        {vm.created_at ? new Date(vm.created_at).toLocaleString() : '—'}
                        {vm.duration_seconds ? ` · ${vm.duration_seconds}s` : ''}
                      </div>
                    </div>
                    {vm.recording_url ? (
                      <audio controls src={vm.recording_url} style={{ flex: 1, height: 28 }}
                        onPlay={() => !vm.is_read && markVoicemailRead(vm)} />
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--t3)', flex: 1 }}>Recording unavailable</span>
                    )}
                    {!vm.is_read && (
                      <button className="btn sec" style={{ padding: '5px 10px', fontSize: 10.5, flexShrink: 0 }}
                        onClick={() => markVoicemailRead(vm)}>
                        Mark Read
                      </button>
                    )}
                    <button className="btn sec" style={{ padding: '5px 10px', fontSize: 10.5, color: '#dc2626', flexShrink: 0 }}
                      onClick={() => deleteVoicemail(vm)}>
                      🗑️ Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Call Recordings */}
          {tab === 'recordings' && (
            <div className="card">
              <div className="ovx">
                {recordings.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 32 }}>No recorded calls yet</div>
                ) : recordings.map(rec => (
                  <div key={rec.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                    borderBottom: '1px solid var(--br)',
                  }}>
                    <div className={`av ${avColor(rec.from_number || '?')}`} style={{ width: 24, height: 24, fontSize: 11 }}>🎙️</div>
                    <div style={{ minWidth: 135 }}>
                      <div style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 12.5, color: 'var(--tx)' }}>{rec.from_number || 'Unknown'}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 1 }}>
                        {rec.created_at ? new Date(rec.created_at).toLocaleString() : '—'}
                        {rec.duration_seconds ? ` · ${rec.duration_seconds}s` : ''}
                      </div>
                    </div>
                    {rec.recording_url ? (
                      <audio controls src={rec.recording_url} style={{ flex: 1, height: 28 }} />
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--t3)', flex: 1 }}>Recording unavailable</span>
                    )}
                    {otterLinks[rec.id] ? (
                      <a href={otterLinks[rec.id]} target="_blank" rel="noreferrer"
                        className="btn sec" style={{ padding: '5px 10px', fontSize: 10.5, flexShrink: 0, textDecoration: 'none' }}>
                        🦦 Open in Otter
                      </a>
                    ) : (
                      <button className="btn sec" style={{ padding: '5px 10px', fontSize: 10.5, flexShrink: 0 }}
                        onClick={() => transcribeWithOtter(rec)} disabled={transcribingId === rec.id}>
                        {transcribingId === rec.id ? '⏳ Sending…' : '🦦 Transcribe'}
                      </button>
                    )}
                    <button className="btn sec" style={{ padding: '5px 10px', fontSize: 10.5, flexShrink: 0 }}
                      onClick={() => { setAttachRec(rec); setAttachSearch(''); setAttachResults([]) }}>
                      📎 Attach to Client
                    </button>
                    {canDeleteRecordings && (
                      <button className="btn sec" style={{ padding: '5px 10px', fontSize: 10.5, color: '#dc2626', flexShrink: 0 }}
                        onClick={() => deleteRecording(rec)}>
                        🗑️ Delete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Call Queue */}
          {tab === 'queue' && (
            <div className="card" style={{ maxWidth: 1040 }}>
              <div className="ovx">
                {leads.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 32 }}>No leads in queue</div>
                ) : leads.map(lead => {
                  const name = lead.name || `${lead.first || ''} ${lead.last || ''}`.trim() || 'Unknown'
                  return (
                    <div key={lead.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '7px 14px',
                      borderBottom: '1px solid var(--br)',
                      background: active?.id === lead.id ? 'rgba(37,162,90,0.08)' : 'transparent',
                      transition: 'background .12s ease',
                    }}
                      onMouseEnter={e => { if (active?.id !== lead.id) e.currentTarget.style.background = 'var(--s2)' }}
                      onMouseLeave={e => { if (active?.id !== lead.id) e.currentTarget.style.background = 'transparent' }}>
                      <div className={`av ${avColor(name)}`} style={{ width: 28, height: 28, fontSize: 10.5, flexShrink: 0 }}>{initialsFor(name)}</div>
                      <div style={{ width: 220, minWidth: 0, flexShrink: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <ClientLink name={name} subtle />
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
                          {lead.phone
                            ? <span style={{ fontFamily: 'monospace' }}>{lead.phone}</span>
                            : <span style={{ fontStyle: 'italic', opacity: 0.7 }}>No phone</span>}
                          {lead.source && <><span>·</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.source}</span></>}
                        </div>
                      </div>
                      <div style={{ flex: 1 }} />
                      <span className="bdg bb" style={{ fontSize: 10.5, flexShrink: 0, whiteSpace: 'nowrap' }}>{lead.status}</span>
                      <div style={{ width: 84, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
                        {lead.phone ? (
                          <button className="btn pri"
                            style={{ padding: '6px 14px', fontSize: 11.5, gap: 4 }}
                            onClick={() => startCall({ ...lead, entityType: 'lead' })}
                            disabled={calling}>
                            📞 Call
                          </button>
                        ) : (
                          <span style={{ fontSize: 10.5, color: 'var(--t3)' }}>—</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Call History */}
          {tab === 'log' && (
            <div className="card" style={{ maxWidth: 1040 }}>
              <div className="ovx">
                {callLog.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 32 }}>No calls logged yet</div>
                ) : callLog.map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 14px', borderBottom: '1px solid var(--br)', transition: 'background .12s ease' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div className={`av ${avColor(c.clientName || c.phone || '?')}`} style={{ width: 28, height: 28, fontSize: 10.5, flexShrink: 0 }}>{initialsFor(c.clientName) !== '?' ? initialsFor(c.clientName) : (c.direction === 'Inbound' ? '↘' : '↗')}</div>
                    <div style={{ width: 200, minWidth: 0, flexShrink: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.clientName ? <ClientLink name={c.clientName} subtle /> : 'Unknown caller'}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontFamily: 'monospace' }}>{c.phone || '—'}</span>
                        {c.duration && <><span>·</span><span style={{ fontFamily: 'monospace' }}>{c.duration}</span></>}
                      </div>
                    </div>
                    <span className={`bdg ${c.direction === 'Inbound' ? 'bb' : 'bn'}`} style={{ fontSize: 9.5, flexShrink: 0 }}>{c.direction === 'Inbound' ? '↘ In' : '↗ Out'}</span>
                    <span className={`bdg ${OUTCOME_C[c.outcome] || 'bn'}`} style={{ fontSize: 9.5, flexShrink: 0 }}>{c.outcome}</span>
                    {c.notes && <span style={{ fontSize: 11, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>{c.notes}</span>}
                    <div style={{ flex: c.notes ? 'unset' : 1 }} />
                    <div style={{ fontSize: 10.5, color: 'var(--t3)', flexShrink: 0, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {c.created_at ? new Date(c.created_at).toLocaleString() : '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Attach Recording to Client */}
      {attachRec && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
          onClick={e => e.target === e.currentTarget && setAttachRec(null)}>
          <div className="modal" style={{ width: 420, maxWidth: '95vw', padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>📎 Attach Recording to Client</div>
              <button className="xbtn" onClick={() => setAttachRec(null)}>&times;</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 12 }}>
              {attachRec.from_number || 'Unknown'} · {attachRec.created_at ? new Date(attachRec.created_at).toLocaleString() : ''}
            </div>
            <div className="field"><label>Search client by name</label>
              <input autoFocus value={attachSearch} onChange={e => searchClientsToAttach(e.target.value)} placeholder="Start typing a name…" />
            </div>
            <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 8 }}>
              {attachSearch.trim() && attachResults.length === 0 && (
                <div style={{ color: 'var(--t3)', fontSize: 12, padding: '10px 0', textAlign: 'center' }}>No clients found</div>
              )}
              {attachResults.map(cl => (
                <div key={cl.id} onClick={() => !attaching && attachToClient(cl)}
                  style={{ padding: '10px 8px', borderBottom: '1px solid var(--br)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{cl.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'monospace' }}>{cl.phone}</div>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 600 }}>{attaching ? 'Attaching…' : 'Attach →'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Log Call Modal now renders globally too (see ActiveCallBar
           in App.jsx), so it pops up correctly even if the call ended
           while you were on a different page. ─────────────────────── */}
    <DeleteConfirmModal
      open={!!confirmDel}
      label={confirmDel?.type === 'voicemail' ? 'voicemail' : 'recording'}
      onConfirm={() => confirmDel?.type === 'voicemail' ? confirmDeleteVoicemail(confirmDel.item) : confirmDeleteRecording(confirmDel.item)}
      onCancel={() => setConfirmDel(null)}
    />
    </div>
  )
}



