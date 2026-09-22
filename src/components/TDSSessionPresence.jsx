import { useState } from 'react'
import { supabase } from '../lib/supabase'

// ─── IRS TDS Session Presence ────────────────────────────────────────────────
//
// TWO SEPARATE CAPABILITIES — do not conflate:
//
//  A) INTERACTIVE PRACTITIONER LOGIN (this component's default)
//     Practitioner clicks "Open IRS TDS" → browser window opens the official
//     IRS e-Services / TDS URL → practitioner signs in with their own IRS/ID.me
//     credentials → selects organization → works in TDS normally → downloads
//     transcript PDFs → uploads them back to the CRM via manual upload or the
//     folder-watcher fallback.
//     NO IRS API credentials required. Available immediately.
//
//  B) DIRECT IRS API / A2A (optional, future, requires IRS ISP enrollment)
//     CRM acts as an OAuth2 client to IRS TDS API (ISP program). Requires
//     IRS_TDS_CLIENT_ID + JWT keypair issued by IRS during ISP enrollment.
//     When configured, transcripts are fetched automatically without the
//     practitioner manually downloading PDFs. The A2A capability check below
//     shows status when those secrets are present.
//
// Authenticate with IRS e-Services / ID.me to open the one-hour transcript session.

const IRS_TDS_URL = 'https://www.irs.gov/tax-professionals/transcript-delivery-system-tds'
const IRS_ESERVICES_URL = 'https://www.irs.gov/tax-professionals/e-services-tools-and-applications'

export default function TDSSessionPresence({ onStatusChange }) {
  const [tdsOpen, setTdsOpen] = useState(false)
  const [a2aStatus, setA2aStatus] = useState(null) // null = not yet checked
  const [a2aChecked, setA2aChecked] = useState(false)
  const [a2aLoading, setA2aLoading] = useState(false)
  const [showA2a, setShowA2a] = useState(false)

  // Optional: check if A2A is configured (for ISP-enrolled deployments)
  // A2A callback uses: new URL(data.redirectUri).origin for postMessage origin check
  async function checkA2aStatus() {
    setA2aLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('transcript-pull', {
        body: { action: 'capabilities' },
      })
      if (error || data?.error) {
        setA2aStatus({ configured: false, active: false, error: data?.error || error?.message })
      } else {
        const configured = Boolean(data?.authorizationConfigured)
        const active = Boolean(data?.sessionActive)
        const next = {
          configured,
          active,
          sessionSetupConfigured: Boolean(data?.sessionSetupConfigured),
          directAvailable: Boolean(data?.authorizationConfigured && data?.transcriptContractConfigured),
          sessionActive: active,
          expiresAt: data?.expiresAt || null,
          organizationName: data?.organizationName || null,
          userEmail: data?.userEmail || null,
          authorizationError: data?.authorizationError || null,
          error: null,
        }
        setA2aStatus(next)
        onStatusChange?.(next)
      }
    } catch (e) {
      setA2aStatus({ configured: false, active: false, error: e?.message })
    } finally {
      setA2aLoading(false)
      setA2aChecked(true)
    }
  }

  function openTds() {
    const w = window.open(IRS_TDS_URL, 'irs-tds', 'width=1100,height=800,resizable=yes,scrollbars=yes')
    if (!w) {
      // Popup blocked — open in new tab instead
      window.open(IRS_TDS_URL, '_blank', 'noopener,noreferrer')
    }
    setTdsOpen(true)
    // Emit a status so TranscriptPull knows TDS window was launched
    onStatusChange?.({ sessionActive: false, directAvailable: false, tdsWindowOpened: true })
  }

  const expires = a2aStatus?.expiresAt ? new Date(a2aStatus.expiresAt) : null
  const minutesLeft = expires ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 60000)) : null
  const sessionUrgent = minutesLeft !== null && minutesLeft <= 10

  return (
    <div id="irs-session-status" style={{ scrollMarginTop: 20, marginBottom: 16 }}>

      {/* ── PRIMARY: Interactive TDS Launch ─────────────────────────── */}
      <div style={{
        borderRadius: 12,
        border: '1px solid var(--br)',
        background: 'var(--s1)',
        padding: '16px 18px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 4 }}>IRS e-Services / TDS</div>
            <div style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.55 }}>
              Open IRS Transcript Delivery System in a secure window. Sign in with your IRS / ID.me credentials,
              choose your organization, then request transcripts. Return here to upload the PDFs.
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
            <button
              className="btn pri"
              onClick={openTds}
              style={{ fontWeight: 700, fontSize: 13.5, padding: '9px 20px', whiteSpace: 'nowrap' }}
            >
              🔐 Open IRS TDS
            </button>
            <a
              href={IRS_ESERVICES_URL}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 11, color: 'var(--t3)', textDecoration: 'underline' }}
            >
              IRS e-Services portal ↗
            </a>
          </div>
        </div>

        {tdsOpen && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--t2)', background: 'rgba(37,99,235,.06)', border: '1px solid rgba(37,99,235,.18)', borderRadius: 8, padding: '9px 12px', lineHeight: 1.55 }}>
            <strong>IRS TDS window opened.</strong> Complete your sign-in and transcript request there.
            When done, upload the transcript PDF below using <strong>Manual PDF upload</strong> or the folder watcher.
          </div>
        )}
      </div>

      {/* ── SECONDARY: A2A / ISP Status (collapsed by default) ──────── */}
      <div style={{ marginTop: 8 }}>
        <button
          onClick={() => { setShowA2a(v => !v); if (!a2aChecked && !showA2a) checkA2aStatus() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11.5, color: 'var(--t3)', padding: '4px 0', fontFamily: 'inherit', textDecoration: 'underline' }}
        >
          {showA2a ? '▲ Hide' : '▼ Show'} direct API connection status (ISP / A2A)
        </button>

        {showA2a && (
          <div style={{ marginTop: 8, borderRadius: 10, border: '1px solid var(--br)', background: 'var(--s2)', padding: '12px 14px' }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Direct IRS API (ISP Program)</div>
            <div style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.55, marginBottom: 10 }}>
              The A2A / ISP integration allows the CRM to pull transcripts automatically without the practitioner
              manually downloading PDFs. It requires separate IRS enrollment as an Independent Software Provider (ISP)
              and the following secrets configured in Supabase:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
              {['IRS_TDS_CLIENT_ID','IRS_TDS_JWT_KID','IRS_TDS_JWT_PRIVATE_KEY_PEM','IRS_TDS_REDIRECT_URI','IRS_TDS_CRM_ORIGIN'].map(k => (
                <code key={k} style={{ background: 'var(--s1)', borderRadius: 4, padding: '2px 6px', fontSize: 10.5, fontWeight: 700, color: a2aStatus?.configured ? '#15803d' : '#b45309', border: '1px solid var(--br)' }}>{k}</code>
              ))}
            </div>

            {a2aLoading && <div style={{ fontSize: 12, color: 'var(--t3)' }}>Checking…</div>}

            {!a2aLoading && a2aStatus && (
              <>
                {a2aStatus.active ? (
                  <div style={{ borderRadius: 8, border: `1px solid ${sessionUrgent ? 'rgba(239,68,68,.35)' : 'rgba(34,197,94,.3)'}`, background: sessionUrgent ? 'rgba(239,68,68,.05)' : 'rgba(34,197,94,.05)', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ background: sessionUrgent ? '#ef4444' : '#15803d', color: '#fff', borderRadius: 6, padding: '3px 8px', fontSize: 10.5, fontWeight: 800 }}>
                        {sessionUrgent ? `⚠ Expiring in ${minutesLeft}m` : `✓ A2A Session Active${minutesLeft !== null ? ` · ${minutesLeft}m` : ''}`}
                      </span>
                      {a2aStatus.organizationName && <span style={{ fontSize: 11.5, color: 'var(--t2)', fontWeight: 600 }}>{a2aStatus.organizationName}</span>}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 14px', fontSize: 12 }}>
                      <span style={{ color: 'var(--t3)' }}>Practitioner</span><span style={{ fontWeight: 700 }}>{a2aStatus.userEmail || 'Authenticated'}</span>
                      <span style={{ color: 'var(--t3)' }}>Expires</span><span style={{ fontWeight: 700, color: sessionUrgent ? '#ef4444' : 'inherit' }}>{expires ? expires.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                    </div>
                  </div>
                ) : a2aStatus.configured ? (
                  <div style={{ fontSize: 12, color: 'var(--t2)', background: 'rgba(37,99,235,.06)', border: '1px solid rgba(37,99,235,.18)', borderRadius: 8, padding: '9px 12px' }}>
                    ISP credentials are configured. Use the A2A connect flow above to start an API session.
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: '#b45309', background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.22)', borderRadius: 8, padding: '9px 12px' }}>
                    {a2aStatus.authorizationError || 'ISP credentials are not configured. Set the secrets above in Supabase → Edge Functions → Secrets to enable A2A.'}
                  </div>
                )}
                <button onClick={checkA2aStatus} disabled={a2aLoading} style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--t3)', fontFamily: 'inherit', textDecoration: 'underline' }}>
                  Refresh status
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
