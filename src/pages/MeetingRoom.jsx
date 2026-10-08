import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { FIRM, loadFirmBrandingPublic } from '../lib/firmBranding'
import { useWebRTCRoom } from '../lib/webrtcRoom'
import { useVideoBackground } from '../lib/videoBackground'
import VirtualBackground from '../components/VirtualBackground'
import VideoTile from '../components/VideoTile'
import LargeTrainingRoom from './LargeTrainingRoom'

export default function MeetingRoom() {
  const [params] = useSearchParams()
  if (params.get('large') === '1') return <LargeTrainingRoom />
  return <StandardMeetingRoom />
}

function StandardMeetingRoom() {
  const { id } = useParams()
  const [params]                    = useSearchParams()
  const [brandingReady, setBrandingReady] = useState(false)
  const [name, setName]             = useState('')
  const [entered, setEntered]       = useState(false)
  const [joining, setJoining]       = useState(false)
  const [showBgPanel, setShowBgPanel] = useState(false)
  const [processedStream, setProcessedStream] = useState(null)

  const webrtc  = useWebRTCRoom('meet')
  const peerConnsRef = webrtc.peerConnsRef
  const vbg = useVideoBackground()
  const rawRef  = useRef(null)

  useEffect(() => {
    if (window.location.hostname.toLowerCase() === 'admin.romylabs.com') {
      FIRM.name = 'RomyLabs'
      FIRM.logoUrl = '/romylabs-logo.svg'
      FIRM.email = 'info@romylabs.com'
      FIRM.tenantId = 'a0000000-0000-0000-0000-000000000001'
      FIRM.loaded = true
      setBrandingReady(true)
      return
    }
    const t = (params.get('t') || '').trim()
    loadFirmBrandingPublic(t || undefined).finally(() => setBrandingReady(true))
  }, [params])

  useEffect(() => {
    return () => { webrtc.leave(); vbg.stopLoop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleJoin() {
    if (!name.trim()) return
    setJoining(true)
    const result = await webrtc.join(id, name.trim(), true)
    setJoining(false)
    if (result.ok) {
      rawRef.current = webrtc.localStreamRef.current
      setEntered(true)
    }
  }

  async function handleLeave() {
    vbg.stopLoop()
    await webrtc.leave()
    setEntered(false)
    setProcessedStream(null)
    setShowBgPanel(false)
  }

  async function handleBgSelect(mode, presetId, customUrl) {
    const raw = rawRef.current
    if (!raw) return
    if (mode === 'none') {
      vbg.stopLoop()
      setProcessedStream(null)
      webrtc.localStreamRef.current = raw
      return
    }
    const out = await vbg.changeBackground(raw, mode, presetId, customUrl)
    if (!out) return
    webrtc.localStreamRef.current = out
    setProcessedStream(new MediaStream(out.getTracks()))
    try {
      const newTrack = out.getVideoTracks()[0]
      if (newTrack) {
        const pcs = Object.values(webrtc.peerConnsRef?.current || {})
        for (const pc of pcs) {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video')
          if (sender) sender.replaceTrack(newTrack).catch(() => {})
        }
      }
    } catch (_) {}
  }

  const displayStream = processedStream || webrtc.localStreamRef.current

  if (!entered) {
    return (
      <div style={S.page}>
        <div style={S.card}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <img src={FIRM.logoUrl || ''} alt={FIRM.name || 'Firm'} style={{ height: 48, objectFit: 'contain', marginBottom: 14 }} onError={e => e.target.style.display='none'} />
            <div style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Join your meeting</div>
            <div style={{ fontSize: 13, color: '#94a3b8' }}>{FIRM.name || 'Firm'} — secure video meeting</div>
          </div>
          <label style={S.label}>Your name</label>
          <input style={S.textInput} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleJoin() }} placeholder="Enter your name" autoFocus />
          {webrtc.error && <div style={{ color: '#fdba74', fontSize: 12, marginTop: 10 }}>{webrtc.error}</div>}
          <button style={S.bigBtn} disabled={!name.trim() || joining} onClick={handleJoin}>{joining ? 'Joining…' : 'Join Meeting'}</button>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 14, textAlign: 'center' }}>Your browser will ask for camera and microphone access.</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0f1a', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #1e293b' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{FIRM.name || 'Firm'} — Meeting</div>
        <div style={{ fontSize: 12, color: '#86efac' }}>{webrtc.members.length} in the call</div>
      </div>
      {webrtc.error && <div style={{ background: '#451a03', color: '#fdba74', fontSize: 12, padding: '8px 20px' }}>{webrtc.error}</div>}
      <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', gap: 14, padding: 20, overflowY: 'auto' }}>
        <div style={{ width: 440, flexShrink: 0 }}>
          <VideoTile stream={displayStream} name={name} label={`${name} (you)${vbg.bgMode !== 'none' ? ' 🖼️' : ''}`} muted mirror={vbg.bgMode === 'none'} videoEnabled={webrtc.cameraOn} />
        </div>
        {webrtc.members.filter(n => n !== name).map(n => <div key={n} style={{ width: 440, flexShrink: 0 }}><VideoTile stream={webrtc.remoteStreams[n]} name={n} /></div>)}
      </div>
      {showBgPanel && <VirtualBackground bgMode={vbg.bgMode} bgPreset={vbg.bgPreset} segStatus={vbg.segStatus} onSelect={handleBgSelect} />}
      <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'center', gap: 10, borderTop: '1px solid #1e293b', flexWrap: 'wrap' }}>
        <button onClick={webrtc.toggleMic} style={S.ctrlBtn(webrtc.micOn)}>{webrtc.micOn ? '🎤 Mic On' : '🔇 Muted'}</button>
        <button onClick={webrtc.toggleCamera} style={S.ctrlBtn(webrtc.cameraOn)}>{webrtc.cameraOn ? '📹 Camera On' : '📷 Off'}</button>
        <button onClick={() => setShowBgPanel(p => !p)} style={{ ...S.ctrlBtn(showBgPanel), background: showBgPanel ? 'rgba(59,130,246,.2)' : S.ctrlBtn(false).background, border: `1px solid ${showBgPanel ? '#3b82f6' : '#334155'}`, color: showBgPanel ? '#93c5fd' : '#e2e8f0' }}>🖼️ Background{vbg.bgMode !== 'none' ? ' ●' : ''}</button>
        <button onClick={handleLeave} style={{ padding: '10px 22px', borderRadius: 8, background: '#dc2626', border: 'none', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Leave Meeting</button>
      </div>
    </div>
  )
}

const S = {
  page: { minHeight: '100vh', background: 'linear-gradient(160deg,#071c30 0%,#0a2f4e 55%,#0a3f60 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' },
  card: { background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 18, padding: '24px 26px', width: '100%', maxWidth: 420 },
  label: { fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6, display: 'block' },
  textInput: { width: '100%', padding: '11px 14px', fontSize: 14, background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 10, color: '#f1f5f9', outline: 'none', boxSizing: 'border-box' },
  bigBtn: { marginTop: 16, width: '100%', padding: 13, background: '#3b82f6', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  ctrlBtn: (on) => ({ padding: '10px 18px', borderRadius: 8, background: on ? '#1e293b' : 'rgba(248,113,113,.15)', border: `1px solid ${on ? '#334155' : '#f87171'}`, color: on ? '#e2e8f0' : '#fca5a5', fontWeight: 600, cursor: 'pointer', fontSize: 13 }),
}
