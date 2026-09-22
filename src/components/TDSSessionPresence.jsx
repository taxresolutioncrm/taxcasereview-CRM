import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// TDS session states:
//  'loading'        — checking
//  'not_configured' — IRS ISP credentials not set in Supabase (IRS action required)
//  'idle'           — credentials present, no active session
//  'active'         — session live, can pull
//  'error'          — something went wrong

export default function TDSSessionPresence({ onStatusChange }) {
  const [state, setState] = useState('loading')
  const [status, setStatus] = useState({
    sessionSetupConfigured: false,
    directAvailable: false,
    sessionActive: false,
    expiresAt: null,
    organizationName: null,
    userEmail: null,
    authorizationError: null,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function loadStatus(showSpinner = false) {
    if (showSpinner) setState('loading')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('transcript-pull', {
        body: { action: 'capabilities' },
      })
      if (fnError) throw fnError
      if (data?.error) throw new Error(data.error)
      const next = {
        sessionSetupConfigured: Boolean(data?.sessionSetupConfigured),
        directAvailable: Boolean(data?.authorizationConfigured && data?.transcriptContractConfigured),
        sessionActive: Boolean(data?.sessionActive),
        expiresAt: data?.expiresAt || null,
        organizationName: data?.organizationName || null,
        userEmail: data?.userEmail || null,
        authorizationError: data?.authorizationError || null,
      }
      setStatus(next)
      onStatusChange?.(next)
      setError('')
      if (next.sessionActive) setState('active')
      else if (next.sessionSetupConfigured) setState('idle')
      else setState('not_configured')
    } catch (e) {
      setState('error')
      setError(e?.message || 'Could not check IRS TDS session.')
    }
  }

  useEffect(() => {
    loadStatus(true)
    const id = setInterval(() => loadStatus(false), 15000)
    return () => clearInterval(id)
  }, [])

  async function signInToIrs() {
    setBusy(true)
    setError('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('transcript-pull', {
        body: { action: 'begin-session' },
      })
      if (fnError) throw fnError
      if (data?.error) throw new Error(data.error)
      if (!data?.authorizationUrl) throw new Error('IRS authorization URL was not returned.')

      const popup = window.open(data.authorizationUrl, 'irs-tds-auth', 'popup,width=780,height=760,resizable=yes,scrollbars=yes')
      if (!popup) throw new Error('Your browser blocked the IRS sign-in window. Allow pop-ups for this CRM and try again.')

      const callbackOrigin = data?.redirectUri ? new URL(data.redirectUri).origin : ''
      if (!callbackOrigin) throw new Error('IRS callback origin was not returned.')

      let settled = false
      const cleanup = () => {
        if (settled) return
        settled = true
        window.removeEventListener('message', onMessage)
        clearInterval(closeWatch)
        clearTimeout(deadline)
      }
      const onMessage = async (event) => {
        const msg = event?.data
        if (event.origin !== callbackOrigin || msg?.type !== 'taxres-irs-tds-oauth') return
        cleanup()
        setBusy(false)
        if (!msg.ok) { setError(msg.message || 'IRS authorization failed.'); await loadStatus(false); return }
        await loadStatus(false)
      }
      window.addEventListener('message', onMessage)
      const closeWatch = setInterval(() => { if (!popup.closed) return; cleanup(); setBusy(false) }, 1000)
      const deadline = setTimeout(() => {
        cleanup(); setBusy(false)
        setError('IRS sign-in did not finish within 10 minutes. Return to the CRM and try again.')
      }, 10 * 60 * 1000)
    } catch (e) {
      setBusy(false)
      setError(e?.message || 'Could not start IRS sign-in.')
    }
  }

  async function endSession() {
    setBusy(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('transcript-pull', { body: { action: 'end-session' } })
      if (fnError) throw fnError
      if (data?.error) throw new Error(data.error)
      await loadStatus(false)
      setError('')
    } catch (e) {
      setError(e?.message || 'Could not end the IRS TDS session.')
    } finally {
      setBusy(false)
    }
  }

  const expires = status.expiresAt ? new Date(status.expiresAt) : null
  const minutesLeft = expires ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 60000)) : null
  const sessionUrgent = minutesLeft !== null && minutesLeft <= 10

  // ── NOT CONFIGURED — clear admin-facing message ───────────────────────────
  if (state === 'not_configured') {
    return (
      <div style={{ borderRadius: 12, border: '1px solid rgba(245,158,11,.30)', background: 'rgba(245,158,11,.06)', padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ fontSize: 20, lineHeight: 1, marginTop: 2 }}>⚙️</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--tx)', marginBottom: 4 }}>
              IRS TDS Credentials Not Configured
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.6, marginBottom: 8 }}>
              {status.authorizationError && status.authorizationError !== 'IRS TDS authorization credentials are incomplete.'
                ? status.authorizationError
                : 'Direct IRS transcript delivery requires IRS ISP program credentials. These are issued by the IRS when a software provider is approved as an Independent Software Provider (ISP) for the Transcript Delivery System.'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.55 }}>
              Required secrets in Supabase &rarr; Edge Functions &rarr; Secrets:
              <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 5, marginLeft: 6 }}>
                {['IRS_TDS_CLIENT_ID', 'IRS_TDS_JWT_KID', 'IRS_TDS_JWT_PRIVATE_KEY_PEM', 'IRS_TDS_REDIRECT_URI', 'IRS_TDS_CRM_ORIGIN'].map(k => (
                  <code key={k} style={{ background: 'rgba(245,158,11,.15)', borderRadius: 4, padding: '1px 5px', fontSize: 10.5, fontWeight: 700, color: '#b45309' }}>{k}</code>
                ))}
              </span>
            </div>
            <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--t3)' }}>
              Until then, transcripts can be uploaded manually using the <strong>Manual PDF fallback</strong> below.
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── ACTIVE SESSION ─────────────────────────────────────────────────────────
  if (state === 'active') {
    return (
      <div style={{ borderRadius: 12, border: `1px solid ${sessionUrgent ? 'rgba(239,68,68,.35)' : 'rgba(34,197,94,.30)'}`, background: sessionUrgent ? 'rgba(239,68,68,.05)' : 'rgba(34,197,94,.05)', padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ background: sessionUrgent ? '#ef4444' : '#15803d', color: '#fff', borderRadius: 6, padding: '3px 9px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.03em' }}>
                {sessionUrgent ? `⚠ Expiring in ${minutesLeft}m` : `✓ IRS Session Active${minutesLeft !== null ? ` · ${minutesLeft}m` : ''}`}
              </span>
              {status.organizationName && (
                <span style={{ fontSize: 11.5, color: 'var(--t2)', fontWeight: 600 }}>{status.organizationName}</span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 14px', fontSize: 12 }}>
              <span style={{ color: 'var(--t3)' }}>Practitioner</span>
              <span style={{ fontWeight: 700 }}>{status.userEmail || 'Authenticated'}</span>
              <span style={{ color: 'var(--t3)' }}>Session expires</span>
              <span style={{ fontWeight: 700, color: sessionUrgent ? '#ef4444' : 'inherit' }}>
                {expires ? expires.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {sessionUrgent && (
              <button className="btn" disabled={busy} onClick={signInToIrs} style={{ fontWeight: 700 }}>
                Renew Session
              </button>
            )}
            <button className="btn sec" disabled={busy} onClick={() => loadStatus(true)}>Refresh</button>
            <button className="btn sec" disabled={busy} onClick={endSession}>{busy ? 'Signing out…' : 'Sign Out'}</button>
          </div>
        </div>
        {error && <div style={{ marginTop: 8, color: '#f87171', fontSize: 12, background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.22)', borderRadius: 8, padding: '7px 10px' }}>{error}</div>}
      </div>
    )
  }

  // ── IDLE — credentials present, no session ─────────────────────────────────
  if (state === 'idle') {
    return (
      <div style={{ borderRadius: 12, border: '1px solid var(--br)', background: 'var(--s1)', padding: '16px 18px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 4 }}>IRS e-Services / ID.me</div>
            <div style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.55 }}>
              Authenticate with IRS e-Services / ID.me to open the one-hour transcript session.
              Sign in once, then select a client and request transcripts directly — no switching tabs.
            </div>
          </div>
          <button
            className="btn pri"
            disabled={busy}
            onClick={signInToIrs}
            style={{ fontWeight: 700, fontSize: 13.5, padding: '9px 20px', flexShrink: 0 }}
          >
            {busy ? '⏳ Waiting for IRS…' : '🔐 Connect IRS / ID.me'}
          </button>
        </div>
        {error && <div style={{ marginTop: 10, color: '#f87171', fontSize: 12, background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.22)', borderRadius: 8, padding: '7px 10px' }}>{error}</div>}
      </div>
    )
  }

  // ── LOADING / ERROR ────────────────────────────────────────────────────────
  return (
    <div style={{ borderRadius: 12, border: '1px solid var(--br)', background: 'var(--s1)', padding: '14px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, minHeight: 52 }}>
      {state === 'loading'
        ? <><span style={{ fontSize: 12, color: 'var(--t3)' }}>Checking IRS session status…</span></>
        : <><span style={{ color: '#f87171', fontSize: 12 }}>{error || 'Could not check IRS TDS session. Check your connection and try again.'}</span>
            <button className="btn sec" style={{ marginLeft: 'auto', flexShrink: 0 }} onClick={() => loadStatus(true)}>Retry</button></>
      }
    </div>
  )
}
