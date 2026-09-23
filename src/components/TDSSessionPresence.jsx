import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

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
    testModeAvailable: false,
    testSessionActive: false,
  })
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const popupRef = useRef(null)
  // Stored after begin-session so the message handler can validate event.origin.
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
        directAvailable: Boolean(data?.testSessionActive || (data?.authorizationConfigured && data?.transcriptContractConfigured && data?.apiFlowVerified)),
        apiSessionActive: Boolean(data?.sessionActive),
        apiFlowVerified: Boolean(data?.apiFlowVerified),
        authorizationConfigured: Boolean(data?.authorizationConfigured),
        transcriptContractConfigured: Boolean(data?.transcriptContractConfigured),
        missingAuthorizationConfig: Array.isArray(data?.missingAuthorizationConfig) ? data.missingAuthorizationConfig : [],
        missingContractConfig: Array.isArray(data?.missingContractConfig) ? data.missingContractConfig : [],
        authorizationError: data?.authorizationError || null,
        testModeAvailable: Boolean(data?.testModeAvailable),
        testSessionActive: Boolean(data?.testSessionActive),
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
        testModeAvailable: false,
        testSessionActive: false,
      }
      setStatus(next)
      onStatusChange?.({ directAvailable: false, sessionActive: false, apiFlowVerified: false, interactiveAvailable: true })
      setApiError(e?.message || 'Could not check automated IRS API status.')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  // Listen for the OAuth postMessage from the callback popup.
  // transcript-pull-callback sends: { type: 'taxres-irs-tds-oauth', ok: true/false, message }
  //
  // Security: three-part validation on every incoming message —
  //   1. event.origin must match the callback origin stored from begin-session.
  //   2. event.source must be the popup window we opened (when it is still reachable).
  //   3. event.data.type must be 'taxres-irs-tds-oauth'.
  // This prevents a cross-origin page from spoofing a successful IRS authorization.
  useEffect(() => {
    function handleMessage(event) {
      // 1. Origin check — must match the Supabase callback origin stored at begin-session time.
      const expectedOrigin = expectedCallbackOriginRef.current
      if (!expectedOrigin || event.origin !== expectedOrigin) return
      // 2. Source check — message must come from the popup we opened.
      if (popupRef.current && event.source !== popupRef.current) return
      // 3. Type check.
      if (!event.data || event.data.type !== 'taxres-irs-tds-oauth') return

      setSigningIn(false)
      expectedCallbackOriginRef.current = null
      if (popupRef.current) {
        try { popupRef.current.close() } catch (_) {}
        popupRef.current = null
      }
      if (event.data.ok) {
        setApiError('')
        loadStatus(true)
      } else {
        setApiError(event.data.message || 'IRS authorization was not completed. Try signing in again.')
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

  async function beginIrsSession() {
    if (signingIn) return
    setSigningIn(true)
    setApiError('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('transcript-pull', {
        body: { action: (!status.apiFlowVerified && status.testModeAvailable) ? 'begin-test-session' : 'begin-session' },
      })
      if (fnError) throw fnError
      if (data?.error) throw Object.assign(new Error(data.error), { code: data.code })

      const { authorizationUrl, redirectUri } = data
      if (!authorizationUrl) throw new Error('IRS authorization URL was not returned.')

      // Derive and store the expected callback origin so handleMessage can validate event.origin.
      // redirectUri is the Supabase edge function URL (e.g. https://<ref>.supabase.co/functions/v1/…)
      // Works identically in stub mode — the stub callback URL is on the same Supabase origin.
      if (redirectUri) {
        try { expectedCallbackOriginRef.current = new URL(redirectUri).origin } catch (_) {}
      }

      // Open the IRS/ID.me OAuth authorization flow in a popup.
      // The callback (transcript-pull-callback) will postMessage back when complete.
      const popup = window.open(
        authorizationUrl,
        'irs-tds-oauth',
        'popup,width=1100,height=820,resizable=yes,scrollbars=yes',
      )
      if (!popup) {
        // Popup blocked — fall back to new tab; postMessage will still fire if same origin.
        window.open(authorizationUrl, '_blank', 'noopener')
        setSigningIn(false)
        return
      }
      popupRef.current = popup

      // Monitor the popup; if the user closes it before the callback fires, clear the spinner.
      const watchdog = setInterval(() => {
        try {
          if (popup.closed) {
            clearInterval(watchdog)
            setSigningIn(false)
            popupRef.current = null
            expectedCallbackOriginRef.current = null
          }
        } catch (_) {
          clearInterval(watchdog)
          setSigningIn(false)
          popupRef.current = null
          expectedCallbackOriginRef.current = null
        }
      }, 800)
    } catch (e) {
      setSigningIn(false)
      if (e?.code === 'IRS_API_FLOW_NOT_VERIFIED') {
        // The IRS OAuth flow is real but credentials are not yet configured/verified.
        // Surface the specific blocker rather than a generic error.
        setApiError(
          'IRS API credentials are not yet configured in this environment. ' +
          'The authorization flow is implemented and ready; it requires the IRS e-Services ' +
          'Client ID, RSA key, and redirect URI to be set as Supabase secrets and ' +
          'IRS_TDS_AUTH_FLOW_VERIFIED=1 once the IRS enrollment is complete. ' +
          'See the credential checklist for exact values required.',
        )
      } else {
        setApiError(e?.message || 'Could not start IRS authorization. Try again.')
      }
    }
  }

  async function endIrsSession() {
    setApiError('')
    try {
      await supabase.functions.invoke('transcript-pull', { body: { action: 'end-session' } })
      await loadStatus(true)
    } catch (e) {
      setApiError(e?.message || 'Could not end IRS session.')
    }
  }

  return (
    <div id="irs-session-status" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '11px 13px', marginBottom: 14, background: 'var(--s1)', scrollMarginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontWeight: 800, fontSize: 13 }}>IRS / ID.me Sign-In</div>
          <div style={{ color: 'var(--t3)', fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>
            {status.apiSessionActive
              ? (status.testSessionActive ? 'CRM live-test session is active. You can test the complete transcript workflow now.' : 'IRS session is active. Transcript requests will be submitted directly through the CRM.')
              : (!status.apiFlowVerified && status.testModeAvailable ? 'IRS API enrollment is still pending. Admin live-test mode is available so you can test the CRM workflow now.' : 'Sign in with your IRS / ID.me account to authorize automated transcript delivery through the CRM.')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {status.apiSessionActive ? (
            <button className="btn btn-secondary" onClick={endIrsSession} style={{ fontSize: 12 }}>
              Sign Out of IRS
            </button>
          ) : (
            <button className="btn" onClick={beginIrsSession} disabled={signingIn}>
              {signingIn ? 'Connecting…' : (!status.apiFlowVerified && status.testModeAvailable ? 'Run CRM Live Test' : 'Sign in to IRS')}
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 9, fontSize: 11.5, color: 'var(--t3)', lineHeight: 1.45 }}>
        <strong style={{ color: 'var(--t2)' }}>Automated CRM delivery:</strong>{' '}
        {loading
          ? 'Checking IRS API activation…'
          : status.apiSessionActive
            ? (status.testSessionActive ? 'CRM live-test session is active. Request Transcripts will run the full filing/analysis flow without calling the IRS.' : 'IRS session is authorized. Request Transcripts will submit directly through the CRM.')
            : status.directAvailable
              ? 'IRS API is configured. Sign in above to start an authorized session.'
              : (!status.apiFlowVerified && status.testModeAvailable ? 'IRS API activation is pending. Admin live-test mode is available above.' : 'Not activated. IRS e-Services API credentials are required for automated CRM transcript delivery.')}
      </div>

      {!loading && status.apiSessionActive && (
        <div style={{ marginTop: 7, color: '#22c55e', fontSize: 11, background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.22)', borderRadius: 8, padding: '7px 9px' }}>
          {status.testSessionActive ? '✓ CRM live-test session active — test transcripts will run through auto-file and Transcript Analysis.' : '✓ IRS session active — transcript requests will be delivered directly to the CRM.'}
        </div>
      )}

      {!loading && !status.apiSessionActive && !status.directAvailable && (
        <div style={{ marginTop: 7, color: '#f59e0b', fontSize: 11, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.22)', borderRadius: 8, padding: '7px 9px' }}>
          {status.testModeAvailable ? 'IRS e-Services API enrollment is still pending. Use Run CRM Live Test above to test the complete CRM workflow now.' : 'Automated CRM delivery requires IRS e-Services API enrollment. The authorization flow is implemented; see the credential checklist for what is needed from the IRS.'}
        </div>
      )}

      {apiError && <div style={{ marginTop: 7, color: '#f87171', fontSize: 11 }}>{apiError}</div>}
    </div>
  )
}
