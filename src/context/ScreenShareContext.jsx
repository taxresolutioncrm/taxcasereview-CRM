// ScreenShareContext — app-level training/screen-share session state.
//
// Cross-window coordination via BroadcastChannel 'tcr-screenshare':
//   { type: 'end' }         — host ended session; all windows should close/reset
//   { type: 'screen-state', host, sharing } — screen share started/stopped
//
// This lets the main overlay and the pop-out host window stay in sync
// without either holding a ref to the other's window object.

import { createContext, useContext, useState, useRef, useEffect } from 'react'
import { useWebRTCRoom } from '../lib/webrtcRoom'

const Ctx = createContext(null)
export const useScreenShare = () => useContext(Ctx)

// Shared BroadcastChannel — same-origin, works across tabs/pop-outs
let bc = null
function getBC() {
  if (!bc) bc = new BroadcastChannel('tcr-screenshare')
  return bc
}

function makeRoomId() {
  return Math.random().toString(36).slice(2, 7).toUpperCase()
}

export function ScreenShareProvider({ children }) {
  const [active,        setActive]        = useState(false)
  const [roomId,        setRoomId]        = useState('')
  const [minimized,     setMinimized]     = useState(false)
  const [sharingScreen, setSharingScreen] = useState(false)
  const [myName,        setMyName       ] = useState('')
  const [screenStream,  setScreenStream]  = useState(null)
  const [remoteScreenState, setRemoteScreenState] = useState(null)

  const webrtc         = useWebRTCRoom('screenshare')
  const screenTrackRef = useRef(null)
  const stateRef       = useRef({})
  stateRef.current     = { webrtc, screenStream, sharingScreen, myName }

  // Expose screen state on window so the pop-out can read it directly (same-origin)
  useEffect(() => {
    window._tcrScreenShare = {
      sharingScreen, screenStream,
      memberCount: webrtc.members.filter(n => !n.endsWith('(view)')).length - 1,
      // The pop-out must drive the REAL session mic/camera, not a second
      // getUserMedia of its own — otherwise its mute button silences a
      // stream nobody is listening to and participants still hear the host.
      localStream:   webrtc.localStreamRef.current,
      remoteStreams:  webrtc.remoteStreams,
      micOn:         webrtc.micOn,
      cameraOn:      webrtc.cameraOn,
      toggleMic:     webrtc.toggleMic,
      toggleCamera:  webrtc.toggleCamera,
      // Exposed so the host pop-out can send chat messages directly on the channel
      channelRef:    webrtc.channelRef,
      peerConnsRef:  webrtc.peerConnsRef,
      // Upload recording from the pop-out — the pop-out has no auth session,
      // so it delegates the storage upload to the authenticated parent window.
      uploadRecording: async (blob, filename) => {
        const { supabase } = await import('../lib/supabase')
        const { data: tenantId, error: tenantErr } = await supabase.rpc('current_tenant_id')
        if (tenantErr || !tenantId) return { data: null, error: tenantErr || new Error('Could not resolve this office') }
        const path = `${tenantId}/${filename}`
        return supabase.storage
          .from('training-recordings')
          .upload(path, new File([blob], filename, { type: 'video/webm' }), { upsert: true })
      },
    }
  }, [sharingScreen, screenStream, webrtc.members, webrtc.remoteStreams, webrtc.micOn, webrtc.cameraOn, webrtc.joined])

  // Broadcast member list to pop-out whenever it changes
  useEffect(() => {
    if (!active) return
    getBC().postMessage({ type: 'state-snapshot', members: webrtc.members })
  }, [webrtc.members, active])

  // Handle request-snapshot from a newly opened pop-out
  useEffect(() => {
    const ch = getBC()
    function onSnapshotRequest(e) {
      if (e.data?.type === 'request-snapshot') {
        ch.postMessage({ type: 'state-snapshot', members: stateRef.current.webrtc.members })
        if (stateRef.current.sharingScreen) {
          ch.postMessage({ type: 'screen-state', host: stateRef.current.myName, sharing: true })
        }
      }
    }
    ch.addEventListener('message', onSnapshotRequest)
    return () => ch.removeEventListener('message', onSnapshotRequest)
  }, [])

  // Listen for cross-window end signal so the overlay resets
  // when the pop-out's End button is pressed
  useEffect(() => {
    const ch = getBC()
    function onMessage(e) {
      if (e.data?.type === 'end') {
        // Another window ended the session — reset our state too
        _resetState()
      }
    }
    ch.addEventListener('message', onMessage)
    return () => ch.removeEventListener('message', onMessage)
  }, [])

  function broadcastScreenState(sharing, myName) {
    const ch = stateRef.current.webrtc.channelRef?.current
    if (ch) {
      ch.send({ type: 'broadcast', event: 'screen-state',
                payload: { host: myName, sharing } }).catch(() => {})
    }
    // Also send over BroadcastChannel so the pop-out host view gets it
    getBC().postMessage({ type: 'screen-state', host: myName, sharing })
  }

  // screenSendersRef tracks the extra sender added for the screen track
  // so we can remove it cleanly when screen sharing stops.
  const screenSendersRef = { current: [] }

  function addScreenTrackToPeers(track) {
    const pcs = stateRef.current.webrtc.peerConnsRef.current
    const stream = stateRef.current.webrtc.localStreamRef.current
    screenSendersRef.current = []
    Object.values(pcs).forEach(pc => {
      try {
        const sender = pc.addTrack(track, stream || new MediaStream([track]))
        screenSendersRef.current.push(sender)
      } catch (_) {}
    })
  }

  function removeScreenTrackFromPeers() {
    const pcs = stateRef.current.webrtc.peerConnsRef.current
    screenSendersRef.current.forEach(sender => {
      Object.values(pcs).forEach(pc => {
        try { pc.removeTrack(sender) } catch (_) {}
      })
    })
    screenSendersRef.current = []
  }

  // Keep replacePeerTracks for stop-share camera restore
  function replacePeerTracks(newTrack) {
    if (newTrack) {
      addScreenTrackToPeers(newTrack)
    } else {
      removeScreenTrackFromPeers()
    }
  }

  function _resetState() {
    setActive(false); setMinimized(false); setRoomId('')
    setSharingScreen(false); setScreenStream(null); setRemoteScreenState(null)
  }

  function doStopScreenShare(myName) {
    // Stop the track FIRST so the browser's "sharing" indicator disappears
    if (screenTrackRef.current) {
      screenTrackRef.current.onended = null  // prevent double-call
      screenTrackRef.current.stop()
      screenTrackRef.current = null
    }
    if (stateRef.current.webrtc?.screenTrackRef) stateRef.current.webrtc.screenTrackRef.current = null
    const ss = stateRef.current.screenStream
    if (ss) { ss.getTracks().forEach(t => t.stop()); setScreenStream(null) }
    setSharingScreen(false)
    replacePeerTracks(null)
    if (myName) broadcastScreenState(false, myName)
  }

  async function startSession(myName) {
    const id = makeRoomId()
    setRoomId(id); setActive(true); setMinimized(false)
    setMyName(myName)
    const result = await webrtc.join(id, myName, true)
    if (!result.ok) { setActive(false); return { ok: false, reason: result.reason } }
    // Listen for screen-state from other participants
    webrtc.channelRef?.current?.on('broadcast', { event: 'screen-state' }, ({ payload }) => {
      setRemoteScreenState(payload)
    })
    // Respond to late joiners requesting current screen state
    webrtc.channelRef?.current?.on('broadcast', { event: 'request-screen-state' }, () => {
      if (stateRef.current?.sharingScreen && stateRef.current?.myName) {
        broadcastScreenState(true, stateRef.current.myName)
      }
    })
    // Relay incoming chat messages to the host pop-out via BroadcastChannel
    webrtc.channelRef?.current?.on('broadcast', { event: 'chat' }, ({ payload }) => {
      getBC().postMessage({ type: 'chat-msg', msg: { ...payload, self: false } })
    })
    return { ok: true, roomId: id }
  }

  async function joinSession(id, myName) {
    setRoomId(id); setActive(true); setMinimized(false)
    setMyName(myName)
    const result = await webrtc.join(id, myName, true)
    if (!result.ok) { setActive(false); return { ok: false, reason: result.reason } }
    return { ok: true }
  }

  async function startScreenShare(myName) {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30, cursor: 'always' },
        audio: true,
      })
      const track    = stream.getVideoTracks()[0]
      const settings = track.getSettings?.() || {}
      track._surface = settings.displaySurface
      // contentHint='detail' propagates through WebRTC to the receiver's ontrack handler.
      // This is the only reliable cross-browser signal — getSettings().displaySurface
      // is sender-only and not available on the received track.
      track.contentHint = 'detail'

      screenTrackRef.current = track
      // Late joiners get this track at peer-connection creation time
      stateRef.current.webrtc.screenTrackRef.current = track
      setScreenStream(stream)
      setSharingScreen(true)
      // User hits browser's "Stop sharing" button
      track.onended = () => doStopScreenShare(myName)
      replacePeerTracks(track)
      broadcastScreenState(true, myName)
      return { ok: true }
    } catch (e) {
      if (e.name === 'NotAllowedError') return { ok: false, reason: 'Permission denied' }
      return { ok: false, reason: e.message }
    }
  }

  async function endSession(myName) {
    // 1. Stop screen share and tracks cleanly
    doStopScreenShare(myName)
    // 2. Signal ALL other windows (pop-out, any other tabs) before leaving
    getBC().postMessage({ type: 'end' })
    // 3. Leave the WebRTC room
    await webrtc.leave()
    // 4. Reset local state
    _resetState()
  }

  const value = {
    active, minimized, setMinimized, roomId, webrtc,
    screenStream, sharingScreen, remoteScreenState,
    startSession, joinSession,
    startScreenShare, stopScreenShare: doStopScreenShare, endSession,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
