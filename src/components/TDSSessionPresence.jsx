import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function TDSSessionPresence() {
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
    return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', marginBottom: 16, background: 'var(--s1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>IRS Sign-In</div>
          <div style={{ color: 'var(--t3)', fontSize: 11.5, marginTop: 3 }}>
            {status.sessionActive
              ? `Connected for this practitioner session${status.organizationName ? ` · ${status.organizationName}` : ''}`
              : 'Authenticate with IRS e-Services / ID.me to open the one-hour transcript session.'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading ? (
            <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>Checking…</span>
          ) : status.sessionActive ? (
            <>
              <span style={{ background: '#15803d', color: '#fff', borderRadius: 6, padding: '4px 9px', fontSize: 10.5, fontWeight: 700 }}>
                Connected{minutesLeft !== null ? ` · ${minutesLeft}m` : ''}
              </span>
              <button className="btn sec" disabled={busy} onClick={endSession}>{busy ? 'Ending…' : 'Sign Out'}</button>
            </>
          ) : (
            <button className="btn" disabled={busy || !status.sessionSetupConfigured} onClick={signInToIrs}>
              {busy ? 'Waiting for IRS…' : 'Sign in to IRS'}
            </button>
          )}
        </div>
      </div>

      {!loading && !status.sessionActive && !status.sessionSetupConfigured && !error && (
        <div style={{ marginTop: 8, color: '#b45309', fontSize: 11.5 }}>
          {status.authorizationError || 'IRS authorization is not configured yet.'}
        </div>
      )}
      {error && <div style={{ marginTop: 8, color: '#f87171', fontSize: 11.5 }}>{error}</div>}
    </div>
  )
}
