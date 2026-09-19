// QuickBooksCallback — handles the Intuit OAuth redirect at /auth/quickbooks-callback
// Intuit sends: ?code=...&state=...&realmId=...
// This page forwards those params to the quickbooks-oauth-callback edge function,
// which exchanges the code for tokens, stores them, and redirects to /settings.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const EDGE_FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/quickbooks-oauth-callback`

export default function QuickBooksCallback() {
  const [status, setStatus] = useState('working')
  const [message, setMessage] = useState('Connecting QuickBooks…')

  useEffect(() => {
    async function run() {
      const params = new URLSearchParams(window.location.search)
      const code     = params.get('code')
      const state    = params.get('state')
      const realmId  = params.get('realmId')
      const errParam = params.get('error')

      if (errParam) {
        setStatus('error')
        setMessage('Intuit returned an error: ' + errParam)
        return
      }
      if (!code || !state || !realmId) {
        setStatus('error')
        setMessage('Missing required parameters from Intuit redirect.')
        return
      }

      try {
        // Forward to the edge function which does the token exchange
        const url = `${EDGE_FN}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}&realmId=${encodeURIComponent(realmId)}`
        const res = await fetch(url)
        const body = await res.json().catch(() => ({}))
        if (res.ok && body?.ok) {
          const connectedName = body.company_name || 'Nashville QuickBooks'
          setStatus('success')
          setMessage(`Connected to ${connectedName}. Redirecting to Settings…`)
          setTimeout(() => {
            window.location.href = '/settings?qb_connect=ok&msg=' + encodeURIComponent(`Connected to ${connectedName}`)
          }, 1200)
        } else {
          throw new Error(body?.message || `QuickBooks connection failed (HTTP ${res.status})`)
        }
      } catch (e) {
        setStatus('error')
        setMessage(e.message || 'Something went wrong connecting QuickBooks.')
      }
    }
    run()
  }, [])

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0f172a', color: '#f1f5f9', fontFamily: 'Arial,sans-serif', padding: 24,
    }}>
      <div style={{
        background: '#1e293b', borderRadius: 14, padding: 32, maxWidth: 420, width: '100%',
        textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,.3)',
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>
          {status === 'working' && '⏳'}
          {status === 'success' && '✅'}
          {status === 'error' && '⚠️'}
        </div>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>
          {status === 'working' && 'Connecting QuickBooks…'}
          {status === 'success' && 'QuickBooks Connected!'}
          {status === 'error' && 'Connection Failed'}
        </div>
        <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>{message}</div>
        {status === 'error' && (
          <button
            onClick={() => window.location.href = '/settings'}
            style={{ marginTop: 20, padding: '10px 24px', background: '#3b82f6', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>
            Back to Settings
          </button>
        )}
      </div>
    </div>
  )
}
