import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const IRS_TDS_URL = 'https://la.www4.irs.gov/esrv/tds/'

export default function TDSSessionPresence({ onStatusChange }) {
  const [status, setStatus] = useState({
    directAvailable: false,
    apiSessionActive: false,
    apiFlowVerified: false,
    authorizationConfigured: false,
    transcriptContractConfigured: false,
    missingAuthorizationConfig: [],
    missingContractConfig: [],
    authorizationError: null,
  })
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState('')
  const [authorizingApi, setAuthorizingApi] = useState(false)
  const popupRef = useRef(null)
  const expectedCallbackOriginRef = useRef(null)

  async function loadStatus(showSpinner = false) {
    if (showSpinner) setLoading(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('transcript-pull', {
        body: { action: 'capabilities' },
      })
      if (fnError) throw fnError
      if (data?.error) throw new Error(data.error)
      const next = {
        directAvailable: Boolean(data?.authorizationConfigured && data?.transcriptContractConfigured && data?.apiFlowVerified),
        apiSessionActive: Boolean(data?.sessionActive),
        apiFlowVerified: Boolean(data?.apiFlowVerified),
        authorizationConfigured: Boolean(data?.authorizationConfigured),
        transcriptContractConfigured: Boolean(data?.transcriptContractConfigured),
        missingAuthorizationConfig: Array.isArray(data?.missingAuthorizationConfig) ? data.missingAuthorizationConfig : [],
        missingContractConfig: Array.isArray(data?.missingContractConfig) ? data.missingContractConfig : [],
        authorizationError: data?.authorizationError || null,
      }
      setStatus(next)
      onStatusChange?.({
        directAvailable: next.directAvailable,
        sessionActive: next.apiSessionActive,
        apiFlowVerified: next.apiFlowVerified,
        interactiveAvailable: true,
      })
      setApiError('')
    } catch (e) {
      const next = {
        directAvailable: false,
        apiSessionActive: false,
        apiFlowVerified: false,
        authorizationConfigured: false,
        transcriptContractConfigured: false,
        missingAuthorizationConfig: [],
        missingContractConfig: [],
        authorizationError: null,
      }
      setStatus(next)
      onStatusChange?.({ directAvailable: false, sessionActive: false, apiFlowVerified: false, interactiveAvailable: true })
      setApiError(e?.message || 'Could not check automated IRS API status.')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  useEffect(() => {
    function handleMessage(event) {
      const expectedOrigin = expectedCallbackOriginRef.current
      if (!expectedOrigin || event.origin !== expectedOrigin) return
      if (popupRef.current && event.source !== popupRef.current) return
      if (!event.data || event.data.type !== 'taxres-irs-tds-oauth') return

      setAuthorizingApi(false)
      expectedCallbackOriginRef.current = null
      if (popupRef.current) {
        try { popupRef.current.close() } catch (_) {}
        popupRef.current = null
      }
      if (event.data.ok) {
        setApiError('')
        loadStatus(true)
      } else {
        setApiError(event.data.message || 'IRS API authorization was not completed.')
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadStatus(true)
    const refresh = setInterval(() => loadStatus(false), 15000)
    return () => clearInterval(refresh)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function openPractitionerTds() {
    const popup = window.open(IRS_TDS_URL, 'taxres-irs-tds', 'popup,width=1200,height=860,resizable=yes,scrollbars=yes')
    if (!popup) window.open(IRS_TDS_URL, '_blank', 'noopener,noreferrer')
  }

  async function beginApiSession() {
    if (authorizingApi || !status.directAvailable) return
    setAuthorizingApi(true)
    setApiError('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('transcript-pull', {
        body: { action: 'begin-session' },
      })
      if (fnError) throw fnError
      if (data?.error) throw Object.assign(new Error(data.error), { code: data.code })

      const { authorizationUrl, redirectUri } = data || {}
      if (!authorizationUrl) throw new Error('IRS API authorization URL was not returned.')
      if (redirectUri) {
        try { expectedCallbackOriginRef.current = new URL(redirectUri).origin } catch (_) {}
      }

      const popup = window.open(
        authorizationUrl,
        'taxres-irs-api-oauth',
        'popup,width=1100,height=820,resizable=yes,scrollbars=yes',
      )
      if (!popup) {
        window.open(authorizationUrl, '_blank', 'noopener')
        setAuthorizingApi(false)
        return
      }
      popupRef.current = popup
      const watchdog = setInterval(() => {
        try {
          if (popup.closed) {
            clearInterval(watchdog)
            setAuthorizingApi(false)
            popupRef.current = null
            expectedCallbackOriginRef.current = null
          }
        } catch (_) {
          clearInterval(watchdog)
          setAuthorizingApi(false)
          popupRef.current = null
          expectedCallbackOriginRef.current = null
        }
      }, 800)
    } catch (e) {
      setAuthorizingApi(false)
      setApiError(e?.message || 'Could not start IRS API authorization.')
    }
  }

  async function endApiSession() {
    setApiError('')
    try {
      await supabase.functions.invoke('transcript-pull', { body: { action: 'end-session' } })
      await loadStatus(true)
    } catch (e) {
      setApiError(e?.message || 'Could not end IRS API session.')
    }
  }

  return (
    <div id="irs-session-status" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '11px 13px', marginBottom: 14, background: 'var(--s1)', scrollMarginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontWeight: 800, fontSize: 13 }}>Sign in to IRS TDS</div>
          <div style={{ color: 'var(--t3)', fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>
            Open the official IRS Transcript Delivery System and sign in with your IRS / ID.me credentials. This practitioner web sign-in is independent of the automated IRS software API.
          </div>
        </div>
        <button className="btn" onClick={openPractitionerTds} data-testid="irs-tds-sign-in">
          Sign in to IRS TDS
        </button>
      </div>

      <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 9, fontSize: 11.5, color: 'var(--t3)', lineHeight: 1.45 }}>
        <strong style={{ color: 'var(--t2)' }}>Automated CRM delivery (separate path):</strong>{' '}
        {loading
          ? 'Checking IRS API activation…'
          : status.apiSessionActive
            ? 'IRS API session is active. Automated transcript requests can run from the CRM.'
            : status.directAvailable
              ? 'IRS API integration is configured and can be authorized separately below.'
              : 'Not activated. Practitioner TDS sign-in above remains available.'}
      </div>

      {!loading && status.directAvailable && (
        <div style={{ marginTop: 8 }}>
          {status.apiSessionActive ? (
            <button className="btn btn-secondary" onClick={endApiSession} style={{ fontSize: 12 }}>
              Sign Out of Automated IRS API
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={beginApiSession} disabled={authorizingApi} style={{ fontSize: 12 }}>
              {authorizingApi ? 'Opening IRS API authorization…' : 'Authorize Automated IRS API'}
            </button>
          )}
        </div>
      )}

      {!loading && !status.directAvailable && (
        <div style={{ marginTop: 7, color: '#f59e0b', fontSize: 11, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.22)', borderRadius: 8, padding: '7px 9px' }}>
          Automated CRM delivery is not activated. This does not block the practitioner IRS TDS sign-in above.
        </div>
      )}

      {apiError && <div style={{ marginTop: 7, color: '#f87171', fontSize: 11 }}>{apiError}</div>}
    </div>
  )
}
