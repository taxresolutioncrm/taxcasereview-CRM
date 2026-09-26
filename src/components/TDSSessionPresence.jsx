import { useEffect, useState } from 'react'
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
    loadStatus(true)
    const refresh = setInterval(() => loadStatus(false), 15000)
    return () => clearInterval(refresh)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function openPractitionerTds() {
    const popup = window.open(IRS_TDS_URL, 'taxres-irs-tds', 'popup,width=1200,height=860,resizable=yes,scrollbars=yes')
    if (!popup) window.open(IRS_TDS_URL, '_blank', 'noopener,noreferrer')
  }

  return (
    <div id="irs-session-status" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '11px 13px', marginBottom: 14, background: 'var(--s1)', scrollMarginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontWeight: 800, fontSize: 13 }}>Sign in to IRS TDS</div>
          <div style={{ color: 'var(--t3)', fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>
            Sign in to the official IRS Transcript Delivery System with your IRS / ID.me account. This practitioner web session is separate from the automated IRS software API.
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
          : status.directAvailable
            ? (status.apiSessionActive ? 'IRS API connection is active.' : 'IRS API is configured; an API authorization session is still required before automated requests can run.')
            : 'Not activated. Practitioner TDS sign-in remains available above; automated CRM transcript requests require the separate IRS software API integration.'}
      </div>

      {!loading && !status.directAvailable && (
        <div style={{ marginTop: 7, color: '#f59e0b', fontSize: 11, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.22)', borderRadius: 8, padding: '7px 9px' }}>
          Automated CRM delivery is not activated. Practitioner IRS / ID.me TDS access remains available.
        </div>
      )}
      {apiError && <div style={{ marginTop: 7, color: '#f87171', fontSize: 11 }}>{apiError}</div>}
    </div>
  )
}
