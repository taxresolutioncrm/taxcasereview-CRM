import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

function makeSessionId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID()
  } catch {}
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}

export default function EsignAuditBridge() {
  useEffect(() => {
    const match = window.location.pathname.match(/^\/sign\/([^/?#]+)/i)
    if (!match) return

    const esignId = decodeURIComponent(match[1])
    const mountKey = `__taxres_esign_audit_${esignId}`
    if (window[mountKey]) return
    window[mountKey] = true

    const sessionKey = `taxres_esign_session_${esignId}`
    let sessionId = sessionStorage.getItem(sessionKey)
    if (!sessionId) {
      sessionId = makeSessionId()
      sessionStorage.setItem(sessionKey, sessionId)
    }

    const sent = new Set()
    const track = (eventType, progress = null, step = null, metadata = {}) => {
      const dedupe = `${eventType}:${progress ?? ''}:${step ?? ''}`
      if (eventType !== 'opened' && sent.has(dedupe)) return
      sent.add(dedupe)
      supabase.rpc('esign_track_event', {
        p_id: esignId,
        p_event_type: eventType,
        p_progress: progress,
        p_step: step,
        p_session_id: sessionId,
        p_metadata: metadata,
      }).catch(() => {})
    }

    let visitEvent = 'opened'
    try {
      const seenKey = `taxres_esign_seen_${esignId}`
      const prior = localStorage.getItem(seenKey)
      if (prior) visitEvent = 'reopened'
      localStorage.setItem(seenKey, new Date().toISOString())
    } catch {}

    track(visitEvent, 0, visitEvent, {
      referrer: document.referrer ? document.referrer.slice(0, 300) : null,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    })

    // Public signer route: backend verifies the matching recent audit event
    // before sending any staff notification, so this cannot be used as an
    // arbitrary email relay.
    supabase.functions.invoke('legacy-esign-lifecycle', {
      body: { esign_id: esignId, event_type: visitEvent, session_id: sessionId }
    }).catch(() => {})

    const scrollMarks = [25, 50, 75, 90]
    const onScroll = () => {
      const doc = document.documentElement
      const max = Math.max(1, doc.scrollHeight - window.innerHeight)
      const pct = Math.max(0, Math.min(100, Math.round((window.scrollY / max) * 100)))
      const estimatedPages = Math.max(1, Math.ceil(document.documentElement.scrollHeight / Math.max(window.innerHeight, 900)))
      const estimatedPage = Math.max(1, Math.min(estimatedPages, Math.ceil(((window.scrollY + window.innerHeight * .5) / Math.max(1, document.documentElement.scrollHeight)) * estimatedPages)))
      for (const mark of scrollMarks) {
        if (pct >= mark) track(`view_${mark}`, mark, `view_${mark}`, { estimated_page: estimatedPage, estimated_pages: estimatedPages })
      }
    }

    const onInput = e => {
      const el = e.target
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return
      const hint = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''}`.toLowerCase()
      if (hint.includes('sign')) track('signature_started', 85, 'signature_started')
      else track('identity_started', 75, 'identity_started')
    }

    const onPointer = e => {
      if (e.target instanceof HTMLCanvasElement) track('signature_started', 85, 'signature_started')
    }

    const onClick = e => {
      const btn = e.target?.closest?.('button')
      if (!btn) return
      const text = (btn.textContent || '').trim().toLowerCase()
      if (text.includes('sign') && !text.includes('signed')) track('signing_started', 95, 'signing_started')
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('input', onInput, true)
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('click', onClick, true)
    onScroll()

    return () => {
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('input', onInput, true)
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('click', onClick, true)
      try { delete window[mountKey] } catch {}
    }
  }, [])

  return null
}
