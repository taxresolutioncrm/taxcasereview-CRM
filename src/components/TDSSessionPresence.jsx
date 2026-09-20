import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function TDSSessionPresence({ onSessionChange }) {
  const [status, setStatus] = useState({
    sessionSetupConfigured: false,
    sessionActive: false,
    expiresAt: null,
    organizationName: null,
    authorizationError: null,
  })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function loadStatus(showSpinner = false) {
    if (showSpinner) setLoading(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('transcript-pull', {
        body: { action: 'capabilities' },
      })
      if (fnError) throw fnError
      if (data?.error) throw new Error(data.error)
      setStatus({
        sessionSetupConfigured: Boolean(data?.sessionSetupConfigured),
        sessionActive: Boolean(data?.sessionActive),
        expiresAt: data?.expiresAt || null,
        organizationName: data?.organizationName || null,
        authorizationError: data?.authorizationError || null,
      })
      setError('')
    } catch (e) {
      setStatus({ sessionSetupConfigured: false, sessionActive: false, expiresAt: null, organizationName: null, authorizationError: null })
      setError(e?.message || 'Could not check your IRS TDS session.')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus(true)
    const refresh = setInterval(() => loadStatus(false), 15000)
    return () => clearInterval(refresh)
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
      if (!popup) throw new Error('Your browser blocked the IRS sign-in window. Allow popups for this CRM and try again.')

      const callbackOrigin = 'https://mpxgxfqdbquzkrvvejkh.supabase.co'
      let settled = false
      const cleanup = () => {
        if (settled) return
        settled = true
        window.removeEventListener('message', onMessage)
        clearInterval(closeWatch)
        clearTimeout(deadlineTimer)
      }
      const onMessage = async (event) => {
        const msg = event?.data
        if (event.origin !== callbackOrigin || msg?.type !== 'taxres-irs-tds-oauth') return
        cleanup()
        setBusy(false)
        if (!msg.ok) {
          setError(msg.message || 'IRS authorization failed.')
          await loadStatus(false)
          return
        }
        await loadStatus(false)
        if (onSessionChange) await onSessionChange()
      }
      window.addEventListener('message', onMessage)

      // Popup closure is local browser state only; this does not poll Supabase.
      const closeWatch = setInterval(() => {
        if (!popup.closed) return
        cleanup()
        setBusy(false)
      }, 1000)
      const deadlineTimer = setTimeout(() => {
        cleanup()
        setBusy(false)
        setError('IRS sign-in did not finish within 10 minutes. Start a new IRS session and try again.')
      }, 10 * 60 * 1000)
    } catch (e) {
      setBusy(false)
      setError(e?.message || 'Could not start IRS sign-in.')
    }
  }

  async function endSession() {
    setBusy(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('transcript-pull', {
        body: { action: 'end-session' },
      })
      if (fnError) throw fnError
      if (data?.error) throw new Error(data.error)
      await loadStatus(false)
      if (onSessionChange) await onSessionChange()
      setError('')
    } catch (e) {
      setError(e?.message || 'Could not end the IRS TDS session.')
    } finally {
      setBusy(false)
    }
  }

  const expires = status.expiresAt ? new Date(status.expiresAt) : null
  const minutesLeft = expires ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 60000)) : null

  return (
    <div style={{ background: 'var(--s2)', border: '1px solid var(--line)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>🔐 IRS TDS Session</div>
          <div style={{ color: 'var(--t3)', fontSize: 11.5, marginTop: 4, lineHeight: 1.45 }}>
            Sign in through IRS e-Services with ID.me and 2FA. IRS handles the credentials and organization selection; the CRM keeps only the short-lived authorized session server-side and never stores your IRS password or 2FA code.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {loading ? (
            <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>Checking…</span>
          ) : status.sessionActive ? (
            <>
              <span style={{ background: '#15803d', color: '#fff', borderRadius: 6, padding: '4px 9px', fontSize: 10.5, fontWeight: 700 }}>
                IRS signed in{minutesLeft !== null ? ` · ${minutesLeft}m left` : ''}
              </span>
              <button className="btn sec" disabled={busy} onClick={endSession}>{busy ? 'Ending…' : 'End IRS Session'}</button>
            </>
          ) : (
            <button className="btn" disabled={busy || !status.sessionSetupConfigured} onClick={signInToIrs}>
              {busy ? 'Waiting for IRS sign-in…' : 'Sign in to IRS'}
            </button>
          )}
        </div>
      </div>

      {status.sessionActive && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--t2)' }}>
          ✅ Direct transcript requests are enabled for this signed-in practitioner session.
          {status.organizationName ? <> Organization: <b>{status.organizationName}</b>.</> : null}
          {expires ? <> Session expires at <b>{expires.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b>.</> : null}
        </div>
      )}

      {!loading && !status.sessionActive && status.sessionSetupConfigured && !error && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--t3)' }}>
          Sign in before submitting a direct pull. If the IRS session expires while requests are queued, sign in again and retry/resume them.
        </div>
      )}

      {!loading && !status.sessionSetupConfigured && !error && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: '#b45309' }}>
          ⚠ {status.authorizationError || 'IRS ISP authorization contract is not configured on the Edge Function yet.'} Direct pull remains disabled; manual TDS fallback is unchanged.
        </div>
      )}

      {error && <div style={{ marginTop: 10, color: '#f87171', fontSize: 11.5 }}>⚠ {error}</div>}
    </div>
  )
}
