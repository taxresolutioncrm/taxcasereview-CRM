// Training — screen-share / training session page.
// All session state lives in ScreenShareContext (mounted in Shell/App.jsx)
// so navigating away and back does NOT kill the session.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useScreenShare } from '../context/ScreenShareContext'
import { useApp }         from '../context/AppContext'
import { supabase }       from '../lib/supabase'
import { FIRM, firmFooterLine } from '../lib/firmBranding'

const BASE = ''

// RomyLabs Admin Portal always uses the RomyLabs platform identity.
// Every real tenant — including the canonical TaxRes Demo tenant — must use
// that tenant's own branding. Never classify tenants by a shared UUID prefix.
const PRODUCT_NAME  = 'RomyLabs'
const PRODUCT_LOGO  = `${window.location.origin}/romylabs-logo.svg`
const PRODUCT_EMAIL = 'info@romylabs.com'
const PLATFORM_ADMIN_TENANT_ID = '00000000-0000-0000-0000-000000000000'

function isAdminContext(tenantId) {
  return String(tenantId || '').trim() === PLATFORM_ADMIN_TENANT_ID
}

function ScreenPreview({ stream }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream || null }, [stream])
  return (
    <video ref={ref} autoPlay playsInline muted
      style={{ width: '100%', maxHeight: 360, objectFit: 'contain',
               display: 'block', background: '#0d1526', borderRadius: '10px 10px 0 0' }} />
  )
}

export default function Training() {
  const ss  = useScreenShare()
  const { employeeName, showToast } = useApp()
  const myName = employeeName || 'Me'

  const [starting, setStarting] = useState(false)
  const [copied,   setCopied]   = useState(false)
  const [activeTab, setActiveTab] = useState('session') // 'session' | 'recordings'
  const [recordings, setRecordings] = useState([])
  const [recLoading, setRecLoading] = useState(false)
  const [playingUrl, setPlayingUrl] = useState(null)

  // Capture FIRM into React state on mount — FIRM is a mutable module object that
  // may not be set yet as a plain const. Reading it in useEffect guarantees we get
  // the branding that AdminTraining loaded before rendering this component.
  const [firmName,     setFirmName]     = useState(() => FIRM.name || '')
  const [firmLogo,     setFirmLogo]     = useState(() => FIRM.logoUrl || '')
  const [firmTenantId, setFirmTenantId] = useState(() => FIRM.tenantId || '')
  const [firmEmail,    setFirmEmail]    = useState(() => FIRM.email || '')
  useEffect(() => {
    // AdminTraining awaits set_admin_tenant_override + loadFirmBranding before
    // rendering us, but FIRM may still be mid-load. Poll briefly to capture it.
    const apply = () => {
      if (FIRM.name) {
        setFirmName(FIRM.name)
        setFirmLogo(FIRM.logoUrl || '')
        setFirmTenantId(FIRM.tenantId || '')
        setFirmEmail(FIRM.email || '')
      }
    }
    apply()
    const t = setTimeout(apply, 300)
    const t2 = setTimeout(apply, 800)
    return () => { clearTimeout(t); clearTimeout(t2) }
  }, [])

  // Email the invite link straight from this page
  const [emailOpen,   setEmailOpen]   = useState(false)
  const [emailTo,     setEmailTo]     = useState('')
  const [emailSending,setEmailSending]= useState(false)

  // Screen label (Entire screen / Window / Browser tab)
  const [screenLabel, setScreenLabel] = useState('')
  useEffect(() => {
    if (!ss.sharingScreen || !ss.screenStream) { setScreenLabel(''); return }
    const track   = ss.screenStream.getVideoTracks()[0]
    const surface = track?._surface || track?.getSettings?.()?.displaySurface
    setScreenLabel(
      surface === 'monitor' ? 'Entire screen' :
      surface === 'window'  ? 'Window' :
      surface === 'browser' ? 'Browser tab' :
      track?.label?.slice(0, 40) || 'Screen'
    )
  }, [ss.sharingScreen, ss.screenStream])

  async function loadRecordings() {
    setRecLoading(true)
    try {
      const { data, error } = await supabase.storage
        .from('training-recordings')
        .list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })
      if (!error && data) setRecordings(data.filter(f => f.name.endsWith('.webm') || f.name.endsWith('.mp4')))
    } catch {}
    setRecLoading(false)
  }

  useEffect(() => { if (activeTab === 'recordings') loadRecordings() }, [activeTab])

  async function getPlayUrl(name) {
    const { data } = await supabase.storage.from('training-recordings').createSignedUrl(name, 3600)
    if (data?.signedUrl) setPlayingUrl({ url: data.signedUrl, name })
  }

  async function downloadRec(name) {
    const { data } = await supabase.storage.from('training-recordings').createSignedUrl(name, 60)
    if (data?.signedUrl) {
      const a = Object.assign(document.createElement('a'), { href: data.signedUrl, download: name })
      a.click()
    }
  }

  async function deleteRec(name) {
    if (!window.confirm(`Delete ${name}?`)) return
    await supabase.storage.from('training-recordings').remove([name])
    setRecordings(r => r.filter(f => f.name !== name))
    if (playingUrl?.name === name) setPlayingUrl(null)
  }

  function fmtBytes(b) {
    if (!b) return '—'
    if (b < 1024 * 1024) return `${(b/1024).toFixed(0)} KB`
    return `${(b/1024/1024).toFixed(1)} MB`
  }

  function fmtRecName(name) {
    // training-ROOMID-2026-08-12T10-30-00.webm → Room ROOMID · Aug 12 2026 10:30
    const m = name.match(/training-([A-Z0-9]+)-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/)
    if (!m) return name
    const [,room,yr,mo,dy,hr,mn] = m
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `Room ${room} · ${months[+mo-1]} ${+dy} ${yr} ${hr}:${mn}`
  }

  async function startSession() {
    setStarting(true)
    const result = await ss.startSession(myName)
    setStarting(false)
    if (!result.ok) { showToast(result.reason || 'Could not start session'); return }
    const sResult = await ss.startScreenShare(myName)
    if (!sResult.ok) showToast(sResult.reason || 'Use the Share screen button below')
  }

  // Resolved branding — RomyLabs Admin uses RomyLabs identity.
  // Per-tenant training uses that tenant's own branding.
  const resolvedTenantId = FIRM.tenantId || firmTenantId
  const isAdmin  = isAdminContext(resolvedTenantId)
  const dispName = isAdmin ? PRODUCT_NAME  : (FIRM.name  || firmName  || PRODUCT_NAME)
  const dispEmail= isAdmin ? PRODUCT_EMAIL : (FIRM.email || firmEmail || PRODUCT_EMAIL)

  // Logo: RomyLabs Admin → canonical RomyLabs logo. Tenant → their own logo.
  const rawLogo  = isAdmin ? PRODUCT_LOGO : (FIRM.logoUrl || firmLogo || '')
  const safeLogo = rawLogo.startsWith('https://')
    ? rawLogo
    : rawLogo
      ? `${window.location.origin}${rawLogo}`
      : PRODUCT_LOGO

  function buildJoinUrl(extraParams = '') {
    const firmParam = `&firm=${encodeURIComponent(dispName)}`
    const logoParam = safeLogo ? `&logo=${encodeURIComponent(safeLogo)}` : ''
    const tParam    = resolvedTenantId ? `&t=${encodeURIComponent(resolvedTenantId)}` : ''
    return `${window.location.origin}${BASE}/screenshare?room=${ss.roomId}${firmParam}${logoParam}${tParam}${extraParams}`
  }

  function buildHostUrl() {
    const firmParam = `&firm=${encodeURIComponent(dispName)}`
    const logoParam = safeLogo ? `&logo=${encodeURIComponent(safeLogo)}` : ''
    const tParam    = resolvedTenantId ? `&t=${encodeURIComponent(resolvedTenantId)}` : ''
    return `${window.location.origin}${BASE}/screenshare-host?room=${ss.roomId}&name=${encodeURIComponent(myName)}${firmParam}${logoParam}${tParam}`
  }

  function copyLink() {
    navigator.clipboard.writeText(buildJoinUrl()).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  async function sendInviteEmail() {
    const raw = emailTo.split(',').map(v => v.trim()).filter(Boolean)
    if (!raw.length) return
    const bad = raw.filter(v => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
    if (bad.length) { showToast?.(`Not a valid email: ${bad[0]}`, 'error'); return }

    const url = buildJoinUrl()
    setEmailSending(true)
    try {
      for (const to of raw) {
        const { error } = await supabase.functions.invoke('send-email', {
          body: {
            tenant_id:  isAdmin ? undefined : (resolvedTenantId || undefined),
            from_name:  dispName,
            from_email: dispEmail,
            to,
            subject: `Join the training session — ${dispName}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
<div style="text-align:center;margin-bottom:20px">
${safeLogo ? `<img src="${safeLogo}" alt="${dispName}" style="max-height:56px;max-width:190px;object-fit:contain;display:block;margin:0 auto 8px" onerror="this.style.display='none'"/>` : ''}
<div style="font-size:12px;font-weight:800;color:#1d4ed8;letter-spacing:.1em;text-transform:uppercase;margin-top:6px">${dispName}</div>
</div>
<p>You've been invited to a live training session with <strong>${myName}</strong>.</p>
<p style="text-align:center;margin:24px 0">
<a href="${url}" style="background:#7c3aed;color:#fff;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">Join session &rarr;</a>
</p>
<p style="font-size:13px;color:#475569">No account or download needed — the link opens straight in your browser. Room code <strong>${ss.roomId}</strong>.</p>
<p style="font-size:12px;color:#64748b">${url}</p>
<p style="font-size:11px;color:#94a3b8;margin-top:24px">${firmFooterLine()}</p>
</div>`
          }
        })
        if (error) throw error
      }
      showToast?.(`Invite sent to ${raw.length} recipient${raw.length > 1 ? 's' : ''}`, 'success')
      setEmailTo(''); setEmailOpen(false)
    } catch (e) {
      // Offices with no email connected fall back to the copy button.
      navigator.clipboard.writeText(url).catch(() => {})
      showToast?.('Could not send email — link copied to clipboard instead', 'error')
    } finally {
      setEmailSending(false)
    }
  }

  function openPopout() {
    const url  = buildHostUrl()
    const w    = Math.min(1400, window.screen.availWidth  - 40)
    const h    = Math.min(900,  window.screen.availHeight - 80)
    const left = Math.round((window.screen.availWidth  - w) / 2)
    const top  = Math.max(30, Math.round((window.screen.availHeight - h) / 2))
    window.open(url, `romylabs-training-${ss.roomId}`, `width=${w},height=${h},left=${left},top=${top},resizable=yes`)
  }

  const joinUrl      = buildJoinUrl()
  const participants = ss.webrtc.members.filter(n => !n.endsWith('(view)') && n !== myName).length

  // ── Recordings tab (shown regardless of session state) ───────────────────
  const tabBar = (
    <div style={{ display:'flex', gap:4, marginBottom:24 }}>
      {[['session','🖥️ Session'],['recordings','🎬 Recordings']].map(([id,label]) => (
        <button key={id} onClick={() => setActiveTab(id)}
          style={{ padding:'8px 18px', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer', border:'none',
                   background: activeTab===id ? '#2563eb' : 'var(--s1)',
                   color: activeTab===id ? '#fff' : 'var(--t2)' }}>
          {label}
        </button>
      ))}
    </div>
  )

  if (activeTab === 'recordings') {
    return (
      <div style={{ padding:'28px 32px', maxWidth:780 }}>
        <div style={{ fontSize:22, fontWeight:800, color:'var(--tx)', marginBottom:20 }}>🎬 Training Recordings</div>
        {tabBar}
        {playingUrl && (
          <div style={{ marginBottom:20, background:'#000', borderRadius:12, overflow:'hidden',
                        border:'1px solid var(--br)', position:'relative' }}>
            <video src={playingUrl.url} controls autoPlay
              style={{ width:'100%', maxHeight:420, display:'block', background:'#000' }} />
            <div style={{ padding:'10px 14px', background:'var(--s1)', display:'flex',
                          alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:13, color:'var(--t2)' }}>{fmtRecName(playingUrl.name)}</span>
              <button onClick={() => setPlayingUrl(null)}
                style={{ background:'none', border:'none', color:'var(--t3)', cursor:'pointer', fontSize:13 }}>
                ✕ Close
              </button>
            </div>
          </div>
        )}
        <div style={{ background:'var(--s1)', border:'1px solid var(--br)', borderRadius:12, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--br)',
                        display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:12, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.05em' }}>
              Saved Recordings
            </span>
            <button onClick={loadRecordings} disabled={recLoading}
              style={{ background:'none', border:'none', color:'var(--t3)', cursor:'pointer', fontSize:12 }}>
              {recLoading ? 'Loading…' : '↻ Refresh'}
            </button>
          </div>
          {recLoading
            ? <div style={{ padding:32, textAlign:'center', color:'var(--t3)', fontSize:13 }}>Loading recordings…</div>
            : recordings.length === 0
            ? <div style={{ padding:32, textAlign:'center', color:'var(--t3)', fontSize:13 }}>
                No recordings yet. Start a session and hit ⏺ Record in the pop-out window.
              </div>
            : recordings.map(rec => (
              <div key={rec.name} style={{ display:'flex', alignItems:'center', gap:12,
                                           padding:'12px 16px', borderBottom:'1px solid var(--br)' }}>
                <div style={{ fontSize:20 }}>🎬</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:600, color:'var(--tx)', marginBottom:2,
                                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {fmtRecName(rec.name)}
                  </div>
                  <div style={{ fontSize:12, color:'var(--t3)' }}>{fmtBytes(rec.metadata?.size)}</div>
                </div>
                <div style={{ display:'flex', gap:8, flexShrink:0 }}>
                  <button onClick={() => getPlayUrl(rec.name)}
                    style={{ background:'#2563eb', border:'none', borderRadius:6, padding:'6px 14px',
                             color:'#fff', fontWeight:700, fontSize:12, cursor:'pointer' }}>
                    ▶ Play
                  </button>
                  <button onClick={() => downloadRec(rec.name)}
                    style={{ background:'var(--s2)', border:'1px solid var(--br)', borderRadius:6,
                             padding:'6px 14px', color:'var(--tx)', fontWeight:700, fontSize:12, cursor:'pointer' }}>
                    ↓ Download
                  </button>
                  <button onClick={() => deleteRec(rec.name)}
                    style={{ background:'none', border:'1px solid var(--br)', borderRadius:6,
                             padding:'6px 10px', color:'var(--t3)', fontWeight:700, fontSize:12, cursor:'pointer' }}>
                    🗑
                  </button>
                </div>
              </div>
            ))
          }
        </div>
      </div>
    )
  }

  // ── Not started ──────────────────────────────────────────────────────────
  if (!ss.active) {
    return (
      <div style={{ padding: '28px 32px', maxWidth: 780 }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--tx)', marginBottom: 4 }}>🖥️ Training Sessions</div>
          <div style={{ fontSize: 13, color: 'var(--t3)' }}>
            Start a live screen-share session with client firms. Participants join via a link — no install required.
          </div>
        </div>
        {tabBar}
        <div style={{ background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 12, padding: 32,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 48, lineHeight: 1 }}>📺</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--tx)' }}>Ready to train</div>
          <div style={{ fontSize: 13, color: 'var(--t3)', maxWidth: 400, lineHeight: 1.6 }}>
            Start a session, share your screen, then copy the invite link and send it to the firm's staff.
            You can navigate anywhere in the CRM while the session stays live.
          </div>
          <button onClick={startSession} disabled={starting}
            style={{ background: '#2563eb', border: 'none', borderRadius: 10, padding: '12px 28px',
                     color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
                     opacity: starting ? .6 : 1, marginTop: 8 }}>
            {starting ? 'Starting…' : '📺 Start training session'}
          </button>
        </div>
      </div>
    )
  }

  // ── Active session ────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '28px 32px', maxWidth: 780 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--tx)', marginBottom: 4 }}>🖥️ Training Sessions</div>
      </div>
      {tabBar}

      {/* Session header bar */}
      <div style={{ background: '#1e3a8a', borderRadius: 12, padding: '14px 20px',
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }}/>
        <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: 15 }}>
          {ss.sharingScreen ? `Sharing: ${screenLabel}` : 'Session live — not sharing yet'}
        </span>
        <span style={{ fontSize: 12, color: '#93c5fd', fontFamily: 'monospace', letterSpacing: 2 }}>{ss.roomId}</span>
        <span style={{ fontSize: 12, color: '#86efac' }}>· {participants} participant{participants !== 1 ? 's' : ''}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={openPopout}
            style={{ background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.3)',
                     borderRadius: 7, padding: '6px 14px', color: '#e2e8f0',
                     cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>⧉ Pop out</button>
          <button onClick={() => ss.endSession(myName)}
            style={{ background: '#dc2626', border: 'none', borderRadius: 7,
                     padding: '6px 14px', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
            End session
          </button>
        </div>
      </div>

      {/* Screen preview */}
      <div style={{ border: '1px solid var(--br)', borderRadius: 12, overflow: 'hidden',
                    background: '#0d1526', minHeight: 200, marginBottom: 16 }}>
        {ss.sharingScreen && ss.screenStream
          ? <ScreenPreview stream={ss.screenStream} />
          : (
            <div style={{ minHeight: 200, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontSize: 36, opacity: .3 }}>🖥️</span>
              <span style={{ color: 'var(--t3)', fontSize: 13 }}>
                {participants > 0 ? 'Start sharing your screen below' : 'Waiting for participants — share the invite link'}
              </span>
            </div>
          )}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        {!ss.sharingScreen
          ? <button onClick={() => ss.startScreenShare(myName)}
              style={{ background: '#2563eb', border: 'none', borderRadius: 8,
                       padding: '10px 20px', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              🖥️ Share screen
            </button>
          : <button onClick={() => ss.stopScreenShare(myName)}
              style={{ background: '#7c3aed', border: 'none', borderRadius: 8,
                       padding: '10px 20px', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              ⏹ Stop sharing
            </button>
        }
      </div>

      {/* Invite link */}
      <div style={{ background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 10,
                    padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase',
                      letterSpacing: '.05em', marginBottom: 8 }}>Participant invite link</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, fontSize: 12, color: 'var(--t2)', fontFamily: 'monospace',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        background: 'var(--bg)', border: '1px solid var(--br)',
                        borderRadius: 6, padding: '8px 10px' }}>
            {joinUrl}
          </div>
          <button onClick={copyLink}
            style={{ background: copied ? '#16a34a' : '#2563eb', border: 'none', borderRadius: 8,
                     padding: '8px 16px', color: '#fff', fontWeight: 700, fontSize: 13,
                     cursor: 'pointer', flexShrink: 0, transition: 'background .2s' }}>
            {copied ? '✓ Copied!' : '📋 Copy'}
          </button>
          <button onClick={() => setEmailOpen(o => !o)}
            style={{ background: emailOpen ? 'var(--s3)' : '#7c3aed', border: 'none', borderRadius: 8,
                     padding: '8px 16px', color: '#fff', fontWeight: 700, fontSize: 13,
                     cursor: 'pointer', flexShrink: 0 }}>
            ✉️ Email
          </button>
        </div>

        {emailOpen && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="email"
              value={emailTo}
              onChange={e => setEmailTo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendInviteEmail() }}
              placeholder="name@firm.com — separate multiple with commas"
              style={{ flex: 1, fontSize: 13, padding: '9px 11px', borderRadius: 6,
                       border: '1px solid var(--br)', background: 'var(--bg)', color: 'var(--tx)' }} />
            <button onClick={sendInviteEmail} disabled={emailSending || !emailTo.trim()}
              style={{ background: '#16a34a', border: 'none', borderRadius: 8, padding: '9px 18px',
                       color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0,
                       cursor: emailSending || !emailTo.trim() ? 'not-allowed' : 'pointer',
                       opacity: emailSending || !emailTo.trim() ? .55 : 1 }}>
              {emailSending ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        )}

        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--t3)' }}>
          Share in Chat, email, or SMS. Anyone who clicks joins instantly — no account needed.
        </div>
      </div>

      {/* Participant list */}
      <div style={{ background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase',
                      letterSpacing: '.05em', marginBottom: 10 }}>
          Connected participants ({participants})
        </div>
        {participants === 0
          ? <div style={{ color: 'var(--t3)', fontSize: 13 }}>No one has joined yet.</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ss.webrtc.members.filter(n => !n.endsWith('(view)') && n !== myName).map(n => (
                <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--tx)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }}/>
                  {n}
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  )
}
