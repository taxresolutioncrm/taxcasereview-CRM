import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function TDSSessionPresence({ onStatusChange }) {
  const [status, setStatus] = useState({
    sessionSetupConfigured: false,
    sessionActive: false,
    expiresAt: null,
    organizationName: null,
    userEmail: null,
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
      const next = {
        sessionSetupConfigured: Boolean(data?.sessionSetupConfigured),
        directAvailable: Boolean(data?.authorizationConfigured && data?.transcriptContractConfigured && data?.apiFlowVerified),
        sessionActive: Boolean(data?.sessionActive),
        expiresAt: data?.expiresAt || null,
        organizationName: data?.organizationName || null,
        userEmail: data?.userEmail || null,
        authorizationError: data?.authorizationError || null,
        missingAuthorizationConfig: Array.isArray(data?.missingAuthorizationConfig) ? data.missingAuthorizationConfig : [],
        missingContractConfig: Array.isArray(data?.missingContractConfig) ? data.missingContractConfig : [],
        apiFlowVerified: Boolean(data?.apiFlowVerified),
      }
      setStatus(next)
      onStatusChange?.(next)
      setError('')
    } catch (e) {
      setStatus({
        sessionSetupConfigured: false,
        sessionActive: false,
        expiresAt: null,
        organizationName: null,
        userEmail: null,
        authorizationError: null,
        missingAuthorizationConfig: [],
        missingContractConfig: [],
      })
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

      const callbackOrigin = data?.redirectUri ? new URL(data.redirectUri).origin : ''
      if (!callbackOrigin) throw new Error('IRS callback origin was not returned.')

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
      }
      window.addEventListener('message', onMessage)

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
      setError('')
    } catch (e) {
      setError(e?.message || 'Could not end the IRS TDS session.')
    } finally {
      setBusy(false)
    }
  }

  const expires = status.expiresAt ? new Date(status.expiresAt) : null
  const minutesLeft = expires ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 60000)) : null
  const expiresLabel = expires ? expires.toLocaleString() : '—'

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '11px 13px', marginBottom: 14, background: 'var(--s1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 13 }}>IRS / ID.me Connection</div>
          <div style={{ color: 'var(--t3)', fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>
            {status.sessionActive
              ? `Connected for this practitioner session${status.organizationName ? ` · ${status.organizationName}` : ''}`
              : 'Connect securely to IRS e-Services / ID.me. Authentication opens in a secure IRS window and returns you to this CRM session.'}
          </div>
          {status.sessionActive && (
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', marginTop: 9, fontSize: 11.5 }}>
              <span style={{ color: 'var(--t3)' }}>User</span><span style={{ fontWeight: 700 }}>{status.userEmail || 'Authenticated IRS practitioner'}</span>
              <span style={{ color: 'var(--t3)' }}>Session expires</span><span style={{ fontWeight: 700 }}>{expiresLabel}</span>
              <span style={{ color: 'var(--t3)' }}>Time remaining</span><span style={{ fontWeight: 700 }}>{minutesLeft !== null ? `${minutesLeft} minutes` : '—'}</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading ? (
            <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>Checking…</span>
          ) : status.sessionActive ? (
            <>
              <span style={{ background: '#15803d', color: '#fff', borderRadius: 6, padding: '4px 9px', fontSize: 10.5, fontWeight: 700 }}>
                Connected{minutesLeft !== null ? ` · ${minutesLeft}m` : ''}
              </span>
              <button className="btn sec" disabled={busy} onClick={() => loadStatus(true)}>Refresh Session</button>
              <button className="btn sec" disabled={busy} onClick={endSession}>{busy ? 'Ending…' : 'Sign Out'}</button>
            </>
          ) : (
            <button className="btn" disabled={busy || !status.sessionSetupConfigured} onClick={signInToIrs}>
              {busy ? 'Waiting for IRS…' : 'Connect IRS / ID.me'}
            </button>
          )}
        </div>
      </div>

      {!loading && !status.sessionActive && !status.sessionSetupConfigured && !error && (
        <div style={{ marginTop: 8, color: '#f59e0b', fontSize: 11.5, lineHeight: 1.45, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.22)', borderRadius: 8, padding: '7px 9px' }}>
          {status.authorizationError || 'IRS connection setup is incomplete. Configure the IRS TDS connection in Settings → Integrations, then return here to connect your IRS / ID.me session.'}
        </div>
      )}
      {error && <div style={{ marginTop: 8, color: '#f87171', fontSize: 11.5, lineHeight: 1.45, background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.22)', borderRadius: 8, padding: '7px 9px' }}>{error}</div>}
    </div>
  )
}
