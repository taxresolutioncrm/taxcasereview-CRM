import { useEffect, useRef, useState } from 'react'

// Renders one participant's video tile, or an initials avatar fallback if
// they have no camera track (joined audio-only) or have it turned off.
// `muted` should only be true for the local self-preview (avoid hearing
// your own echo). `videoEnabled` lets the local tile react instantly to
// the camera toggle; remote tiles just show whatever video track exists.
export default function VideoTile({ stream, name, muted = false, mirror = false, label, videoEnabled }) {
  const videoRef = useRef(null)
  const [playbackError, setPlaybackError] = useState('')
  const [trackLive, setTrackLive] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    setPlaybackError('')
    const track = stream?.getVideoTracks?.()[0] || null
    const syncTrackState = () => setTrackLive(Boolean(track && track.readyState === 'live' && !track.muted))
    syncTrackState()
    if (track) {
      track.addEventListener('mute', syncTrackState)
      track.addEventListener('unmute', syncTrackState)
      track.addEventListener('ended', syncTrackState)
    }
    video.srcObject = stream || null
    if (stream) {
      const startPlayback = () => {
        const promise = video.play()
        if (promise?.catch) promise.catch(err => setPlaybackError(err?.message || 'Video playback was blocked'))
      }
      if (video.readyState >= 1) startPlayback()
      else video.addEventListener('loadedmetadata', startPlayback, { once: true })
    }
    return () => {
      if (track) {
        track.removeEventListener('mute', syncTrackState)
        track.removeEventListener('unmute', syncTrackState)
        track.removeEventListener('ended', syncTrackState)
      }
      if (video.srcObject === stream) video.srcObject = null
    }
  }, [stream])

  const hasVideoTrack = (stream?.getVideoTracks()?.length || 0) > 0
  const showVideo = hasVideoTrack && videoEnabled !== false && trackLive

  return (
    <div style={{ position: 'relative', background: '#1e293b', borderRadius: 10, overflow: 'hidden', aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <video ref={videoRef} autoPlay playsInline muted={muted} onError={() => setPlaybackError('Video device failed to play')}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: showVideo ? 'block' : 'none', transform: mirror ? 'scaleX(-1)' : 'none' }} />
      {!showVideo && (
        <div style={{ textAlign:'center' }}>
          <div style={{ width: 56, height: 56, margin:'0 auto', borderRadius: '50%', background: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: '#e2e8f0' }}>
            {(name || '?').trim().split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
          </div>
          {playbackError && <div style={{ marginTop:8, maxWidth:240, fontSize:10, color:'#fca5a5' }}>{playbackError}</div>}
        </div>
      )}
      <div style={{ position: 'absolute', bottom: 6, left: 8, fontSize: 11, fontWeight: 600, color: '#fff', background: 'rgba(0,0,0,.55)', padding: '2px 8px', borderRadius: 5 }}>
        {label || name}
      </div>
    </div>
  )
}
