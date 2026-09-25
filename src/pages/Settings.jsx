import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import BookingSettings from '../components/BookingSettings'
import { useApp } from '../context/AppContext'
import { loadFirmBranding } from '../lib/firmBranding'

const BUCKET = 'firm-assets'

async function resolveSettingsTenantId() {
  const { data, error } = await supabase.rpc('current_tenant_id')
  if (error || !data) return null
  return data
}

export default function Settings() {
  const { showToast, user, role, myTenantId } = useApp()
  const isPrivileged = ['Super Admin','Admin'].includes(role)
  const [tab, setTab] = useState(isPrivileged ? 'firm' : 'mysignature')
  const [saving, setSaving] = useState(false)
  const [logoUrl, setLogoUrl] = useState('')
  const [uploading, setUploading] = useState(false)

  // Accounting integrations (QuickBooks/Xero) — need this tenant's own id to
  // build the OAuth "state" param and to call get_accounting_status.
  const [acctStatus, setAcctStatus] = useState({}) // { quickbooks: {...}, xero: {...} }
  const [syncing, setSyncing] = useState({ quickbooks: false, xero: false })
  const [expandedInt, setExpandedInt] = useState({}) // which integration cards are expanded
  function toggleInt(key) {
    if (['smtp','gmail','m365'].includes(key)) {
      setExpandedInt(p => ({
        ...p,
        smtp: key === 'smtp' ? !p.smtp : false,
        gmail: key === 'gmail' ? !p.gmail : false,
        m365: key === 'm365' ? !p.m365 : false,
      }))
      return
    }
    setExpandedInt(p => ({ ...p, [key]: !p[key] }))
  }

  useEffect(() => {
    if (!user?.email) return
    loadAcctStatus()
  }, [user?.email])

  async function loadAcctStatus() {
    const { data } = await supabase.rpc('get_accounting_status')
    if (data) setAcctStatus(data)
  }

  async function connectQuickBooks() {
    if (!myTenantId) { showToast('Still loading your account — try again in a moment'); return }
    if (!firm.qb_client_id) { showToast('Save your QuickBooks Client ID/Secret first'); return }
    const { data, error } = await supabase.functions.invoke('quickbooks-oauth-start', { body: {} })
    if (error || !data?.authorize_url) {
      showToast('Could not start secure QuickBooks connection')
      return
    }
    window.location.href = data.authorize_url
  }

  async function connectXero() {
    if (!myTenantId) { showToast('Still loading your account — try again in a moment'); return }
    if (!firm.xero_client_id) { showToast('Save your Xero Client ID/Secret first'); return }
    const { data: state, error } = await supabase.rpc('create_accounting_oauth_state', { p_provider: 'xero' })
    if (error || !state) { showToast('Could not start secure Xero connection'); return }
    const redirectUri = window.location.origin + '/auth/xero-callback'
    const authorizeUrl = `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${encodeURIComponent(firm.xero_client_id)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('accounting.transactions accounting.contacts offline_access')}&state=${encodeURIComponent(state)}`
    window.location.href = authorizeUrl
  }

  async function disconnectAccounting(provider) {
    const { error } = await supabase.rpc('disconnect_accounting', { p_provider: provider })
    if (error) { showToast('❌ ' + error.message); return }
    showToast(`${provider === 'quickbooks' ? 'QuickBooks' : 'Xero'} disconnected`)
    loadAcctStatus()
  }

  async function syncAccounting(provider) {
    setSyncing(s => ({ ...s, [provider]: true }))
    const fnName = provider === 'quickbooks' ? 'quickbooks-sync' : 'xero-sync'
    const { data, error } = await supabase.functions.invoke(fnName, { body: {} })
    setSyncing(s => ({ ...s, [provider]: false }))
    if (error || data?.error) { showToast('❌ ' + (data?.error || error.message)); return }
    showToast(`✅ Synced ${data.synced_invoices} invoice${data.synced_invoices===1?'':'s'}, ${data.synced_payments} payment${data.synced_payments===1?'':'s'}${data.errors?.length ? ` (${data.errors.length} skipped)` : ''}`)
    loadAcctStatus()
  }

  // Show a one-time toast if we just landed back from the OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const qb = params.get('qb_connect'); const xero = params.get('xero_connect'); const msg = params.get('msg')
    if (qb) { showToast((qb === 'ok' ? '✅ ' : '❌ ') + (msg || 'QuickBooks connection updated')); loadAcctStatus() }
    if (xero) { showToast((xero === 'ok' ? '✅ ' : '❌ ') + (msg || 'Xero connection updated')); loadAcctStatus() }
    if (qb || xero) window.history.replaceState({}, '', window.location.pathname)
  }, [])
  const [sigLogoUploading, setSigLogoUploading] = useState(false)
  const fileRef = useRef()
  const sigLogoFileRef = useRef()

  // ── Personal email signature (every employee has their own) ──
  const [mySig, setMySig] = useState({ text: '', logoUrl: '' })
  const [mySigSaving, setMySigSaving] = useState(false)
  const [mySigLogoUploading, setMySigLogoUploading] = useState(false)
  const mySigLogoFileRef = useRef()

  useEffect(() => {
    if (!user?.email) return
    ;(async () => {
      const tid = myTenantId || await resolveSettingsTenantId()
      if (!tid) return
      const { data } = await supabase.from('employees').select('email_signature,email_signature_logo_url')
        .eq('tenant_id', tid).eq('email', user.email).maybeSingle()
      setMySig({ text: data?.email_signature || '', logoUrl: data?.email_signature_logo_url || '' })
    })()
  }, [user?.email, myTenantId])

  async function saveMySignature() {
    if (!user?.email) return
    setMySigSaving(true)
    const tid = myTenantId || await resolveSettingsTenantId()
    if (!tid) { setMySigSaving(false); showToast('Could not resolve this office', 'err'); return }
    await supabase.from('employees').update({
      email_signature: mySig.text,
      email_signature_logo_url: mySig.logoUrl,
    }).eq('tenant_id', tid).eq('email', user.email)
    setMySigSaving(false)
    showToast('Signature saved!')
  }

  async function uploadMySignatureLogo(e) {
    const file = e.target.files?.[0]
    if (!file || !user?.email) return
    setMySigLogoUploading(true)
    const path = `signatures/${user.email.replace(/[^a-zA-Z0-9]/g,'-')}-${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true })
    if (!error) {
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
      setMySig(s => ({ ...s, logoUrl: data.publicUrl }))
    }
    setMySigLogoUploading(false)
  }

  const [connectedGmailCount, setConnectedGmailCount] = useState(0)
  const [connectedM365Count, setConnectedM365Count] = useState(0)
  const [firm, setFirm] = useState({
    name: '', tagline: '', phone: '', email: '',
    address: '', city: '', state: '', zip: '',
    website: '', ein: '', primary_color: '#2563eb',
    preparer_name: '', ptin: '', caf_number: '', efin: '',
    gmail_client_id: '', gmail_client_secret: '', gmail_redirect_uri: '',
    email_signature: '', email_signature_logo_url: '',
    verizon_api_key: '', verizon_account_id: '', verizon_phone_number: '',
    mercury_api_key: '',
    verizon_api_url: 'https://api.verizon.com/v1', calling_provider: 'signalwire',
    m365_client_id: '', m365_client_secret: '', m365_tenant_id: 'common',
    payment_provider: 'stripe',
    slack_bot_token: '', slack_signing_secret: '', slack_channel_map: null, slack_sync_enabled: false
  })

  const [pw, setPw] = useState({ next: '', confirm: '' })
  const [employees, setEmployees] = useState([])

  // Guard: wait for auth — prevents TCR settings loading in Nashville
  useEffect(() => { if (user && myTenantId) { loadFirm(); loadLogo(); loadEmployees() } }, [user?.id, myTenantId])

  async function loadEmployees() {
    const tid = myTenantId || await resolveSettingsTenantId()
    if (!tid) { setEmployees([]); return }
    const { data } = await supabase.from('employees')
      .select('id,name,email,role,access,status,created_at,avatar_url')
      .eq('tenant_id', tid)
      .order('created_at', { ascending: true })
    if (data) setEmployees(data.filter(e => e.email !== 'romy@taxrescrm.net'))
  }

  function applyBrandColor(hex) {
    if (!hex || !hex.startsWith('#')) return
    const r = parseInt(hex.slice(1,3),16)
    const g = parseInt(hex.slice(3,5),16)
    const b = parseInt(hex.slice(5,7),16)
    const rgb = `${r},${g},${b}`
    const root = document.documentElement
    // Primary accent — used everywhere var(--blue) appears
    root.style.setProperty('--blue', hex)
    root.style.setProperty('--b2',   hex)
    // Transparent variants for backgrounds, badges, borders
    root.style.setProperty('--blt',  `rgba(${rgb},.18)`)
    root.style.setProperty('--b2c',  `rgba(${rgb},.14)`)
    // Inject a style tag to override the hardcoded rgba in .nav-item.active
    // (CSS variables can't override static rgba() values in existing rules)
    let styleTag = document.getElementById('tcr-brand-override')
    if (!styleTag) {
      styleTag = document.createElement('style')
      styleTag.id = 'tcr-brand-override'
      document.head.appendChild(styleTag)
    }
    styleTag.textContent = `
      .nav-item.active { background: rgba(${rgb},.18) !important; color: ${hex} !important; border-left-color: ${hex} !important; }
      .btn.pri { background: ${hex} !important; border-color: ${hex} !important; }
      .btn.pri:hover { background: ${hex}dd !important; }
      .bdg.blue, .bdg.bb { background: rgba(${rgb},.18) !important; color: ${hex} !important; }
      .chip.active, .chip:hover, .chip.on { background: rgba(${rgb},.18) !important; color: ${hex} !important; border-color: ${hex} !important; }
      .tl-dot.blue { background: ${hex} !important; }
      .cal-event { background: ${hex} !important; }
      .cal-day.today { border-color: ${hex} !important; }
      .field input:focus, .field select:focus, .field textarea:focus { border-color: ${hex} !important; }
      .search-input:focus { border-color: ${hex} !important; }
      .metric:hover { border-color: ${hex} !important; }
      .tab-active, [class*="tab"].active { border-bottom-color: ${hex} !important; color: ${hex} !important; }
      a { color: ${hex}; }
    `
    // Update meta theme-color for mobile browsers
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', hex)
    // Persist so it survives page refreshes
    localStorage.setItem('tcr_brand_color', hex)
    localStorage.setItem('tcr_brand_rgb', rgb)
  }

  async function loadFirm() {
    const tid = myTenantId || await resolveSettingsTenantId()
    if (!tid) return
    const { data } = await supabase.from('settings').select('*').eq('tenant_id', tid).maybeSingle()
    if (data) {
      setFirm(f => ({ ...f, ...data }))
      if (data.primary_color) applyBrandColor(data.primary_color)
      if (data.logourl) setLogoUrl(data.logourl)
    }
    const { data: tenantEmployees } = await supabase.from('employees').select('email').eq('tenant_id', tid)
    const tenantEmails = (tenantEmployees || []).map(e => e.email).filter(Boolean)
    let gmailCount = 0
    if (tenantEmails.length) {
      const { count } = await supabase.from('employee_gmail_accounts')
        .select('employee_email', { count: 'exact', head: true })
        .in('employee_email', tenantEmails)
        .not('gmail_refresh_token', 'is', null)
      gmailCount = count || 0
    }
    setConnectedGmailCount(gmailCount)
    const { count: m365Count } = await supabase.from('employee_m365_accounts')
      .select('employee_email', { count: 'exact', head: true })
      .eq('tenant_id', tid)
      .not('m365_refresh_token', 'is', null)
    setConnectedM365Count(m365Count || 0)
  }

  async function loadLogo() {
    // Show this tenant's own saved logo; never the shared bucket file (which
    // gets overwritten across tenants). loadFirm sets it from settings.logourl.
    const tid = myTenantId || await resolveSettingsTenantId()
    if (!tid) return
    const { data } = await supabase.from('settings').select('logourl').eq('tenant_id', tid).maybeSingle()
    if (data?.logourl) setLogoUrl(data.logourl)
  }

  async function saveFirm() {
    setSaving(true)
    try {
      // Only save known DB columns - exclude any React state extras
      let payload = {
        name: firm.name, tagline: firm.tagline, phone: firm.phone,
        email: firm.email, address: firm.address, city: firm.city,
        state: firm.state, zip: firm.zip, website: firm.website,
        ein: firm.ein, primary_color: firm.primary_color,
        preparer_name: firm.preparer_name, ptin: firm.ptin,
        caf_number: firm.caf_number, efin: firm.efin,
        gmail_client_id: firm.gmail_client_id,
        gmail_client_secret: firm.gmail_client_secret,
        gmail_redirect_uri: firm.gmail_redirect_uri,
        payment_provider: firm.payment_provider || 'stripe',
        m365_client_id: firm.m365_client_id,
        m365_client_secret: firm.m365_client_secret,
        m365_tenant_id: firm.m365_tenant_id || 'common',
        slack_bot_token: firm.slack_bot_token,
        slack_signing_secret: firm.slack_signing_secret,
        slack_channel_map: firm.slack_channel_map,
        slack_sync_enabled: firm.slack_sync_enabled || false,
        telnyx_api_key: firm.telnyx_api_key,
        firm_fax_number: firm.firm_fax_number,
        smtp_host: firm.smtp_host, smtp_port: firm.smtp_port,
        smtp_email: firm.smtp_email, smtp_password: firm.smtp_password,
        smtp_name: firm.smtp_name, smtp_encryption: firm.smtp_encryption,
        twilio_sid: firm.twilio_sid, twilio_token: firm.twilio_token,
        twilio_phone: firm.twilio_phone,
        sw_space_url: firm.sw_space_url,
        sw_project_id: firm.sw_project_id,
        sw_api_token: firm.sw_api_token,
        sw_sip_username: firm.sw_sip_username,
        sw_sip_password: firm.sw_sip_password,
        sw_inbound_did: firm.sw_inbound_did,
        sw_outbound_did: firm.sw_outbound_did,
        call_forward_number: firm.call_forward_number,
        stripe_publishable_key: firm.stripe_publishable_key,
        signalwire_backend: firm.signalwire_backend,
        qb_client_id: firm.qb_client_id,
        qb_client_secret: firm.qb_client_secret,
        xero_client_id: firm.xero_client_id,
        xero_client_secret: firm.xero_client_secret,
        email_signature: firm.email_signature,
        metered_app_name: firm.metered_app_name,
        metered_api_key: firm.metered_api_key,
        mercury_api_key: firm.mercury_api_key,
        otter_api_key: firm.otter_api_key,
      }
      // Empty-string values blow up non-text columns (date, numeric) with
      // "invalid input syntax" — Postgres wants null for "no value", not ''.
      Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null })

      const tid = myTenantId || await resolveSettingsTenantId()
      if (!tid) throw new Error('Could not resolve this office')
      const { data: existing, error: fetchErr } = await supabase.from('settings').select('id').eq('tenant_id', tid).maybeSingle()
      if (fetchErr) throw fetchErr

      // Self-healing save: if Postgres reports an unknown column, strip it and retry.
      // This guarantees the core Firm Info fields always save even if a newer
      // integration column hasn't been migrated into the DB yet.
      const skipped = []
      let saveErr
      for (let attempt = 0; attempt < 12; attempt++) {
        if (existing?.id) {
          ({ error: saveErr } = await supabase.from('settings').update(payload).eq('tenant_id', tid).eq('id', existing.id))
        } else {
          ({ error: saveErr } = await supabase.from('settings').insert([{ ...payload, tenant_id: tid }]))
        }
        if (!saveErr) break
        // Postgres "column does not exist" error: 42703, message names the column
        const match = saveErr.message?.match(/column ['"]?(\w+)['"]? (of relation .* )?does not exist/i)
          || saveErr.message?.match(/Could not find the '(\w+)' column/i)
        if (match) {
          const badCol = match[1]
          if (badCol in payload) {
            const { [badCol]: _, ...rest } = payload
            payload = rest
            skipped.push(badCol)
            continue
          }
        }
        // Not a recoverable "unknown column" error — stop retrying
        break
      }
      if (saveErr) throw saveErr

      if (firm.primary_color) applyBrandColor(firm.primary_color)
      window.dispatchEvent(new Event('firm-updated'))
      if (skipped.length) {
        showToast(`✅ Saved — but these fields aren't set up in the database yet and were skipped: ${skipped.join(', ')}. Ask to add these columns.`)
      } else {
        showToast('✅ Settings saved!')
      }
    } catch (e) { showToast('Error: ' + e.message, 'err') } finally { setSaving(false) }
  }

  async function uploadLogo(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      // Per-tenant path + saved to settings.logourl so each firm's logo is
      // its own — and every document/pay stub reads it via settings, not a
      // single shared file.
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const path = `logo-${firm.tenant_id || firm.id || 'default'}.${ext}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type })
      if (error) throw error
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
      const bustedUrl = `${pub.publicUrl}?t=${Date.now()}`
      const tid = myTenantId || await resolveSettingsTenantId()
      if (!tid) throw new Error('Could not resolve this office')
      await supabase.from('settings').update({ logourl: bustedUrl }).eq('tenant_id', tid).eq('id', firm.id)
      setFirm(f => ({ ...f, logourl: bustedUrl }))
      setLogoUrl(bustedUrl)
      await loadFirmBranding()
      showToast('Logo uploaded!')
    } catch (err) { showToast(err.message, 'err') } finally { setUploading(false) }
  }

  // Separate from the main firm logo above — this one is specifically for
  // the email signature, since it might be a different (e.g. smaller,
  // wordmark-only) image than the full logo shown elsewhere in the CRM.
  async function uploadSignatureLogo(e) {
    const file = e.target.files[0]
    if (!file) return
    setSigLogoUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      // Per-tenant path — matching the main logo handler above. A flat
      // 'signature-logo.ext' let every tenant's upload overwrite the same
      // shared file, bleeding one firm's signature logo onto all others.
      const path = `signature-logo-${firm.tenant_id || firm.id || 'default'}.${ext}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type })
      if (error) throw error
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
      // Cache-bust so the new logo shows immediately instead of a stale
      // browser-cached copy of the old file at the same URL.
      const bustedUrl = `${pub.publicUrl}?t=${Date.now()}`
      setFirm(f => ({ ...f, email_signature_logo_url: bustedUrl }))
      const tid = myTenantId || await resolveSettingsTenantId()
      if (!tid) throw new Error('Could not resolve this office')
      await supabase.from('settings').update({ email_signature_logo_url: bustedUrl }).eq('tenant_id', tid).eq('id', firm.id)
      showToast('Signature logo uploaded!')
    } catch (err) { showToast(err.message, 'err') } finally { setSigLogoUploading(false) }
  }

  async function changePassword() {
    if (pw.next !== pw.confirm) return showToast('Passwords do not match', 'err')
    if (pw.next.length < 6) return showToast('Min 6 characters', 'err')
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password: pw.next })
    setSaving(false)
    if (error) return showToast(error.message, 'err')
    showToast('Password updated!')
    setPw({ next: '', confirm: '' })
  }

  const set = k => e => setFirm(f => ({ ...f, [k]: e.target.value }))
  // Tax Advisor / Tax Associate / Manager only ever see their own signature
  // editor + the live status page (read-only) — nothing firm-wide.
  const tabs = isPrivileged
    ? ['firm', 'integrations', 'booking', 'branding', 'import', 'users', 'security', 'storage', 'statuses', 'billing', 'uptime']
    : ['mysignature', 'uptime']

  return (
    <div style={{ padding: '20px 24px', maxWidth: 860, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t} className={`btn${tab === t ? ' pri' : ''}`} onClick={() => setTab(t)} style={{ whiteSpace: 'nowrap' }}>
            {t === 'firm' ? '🏢 Firm Info' : t === 'integrations' ? '🔌 Integrations' : t === 'booking' ? '📅 Online Booking' : t === 'branding' ? '🎨 Branding' : t === 'import' ? '📥 Import Data' : t === 'users' ? '👥 Users' : t === 'security' ? '🔒 Security' : t === 'storage' ? '💾 Storage' : t === 'statuses' ? '🏷️ Workflow Statuses' : t === 'billing' ? '⏱️ Billing Rates' : t === 'mysignature' ? '✍️ My Signature' : '🟢 Uptime'}
          </button>
        ))}
      </div>

      {tab === 'firm' && isPrivileged && (
        <div className="card">
          <div className="card-header"><span className="card-title">Firm Information</span></div>
          <div style={{ padding: '0 20px 20px' }}>
            <div className="fg2">
              <div className="field"><label>Firm Name</label><input value={firm.name} onChange={set('name')} placeholder="Tax Case Review" /></div>
              <div className="field"><label>Tagline</label><input value={firm.tagline} onChange={set('tagline')} placeholder="We solve IRS problems" /></div>
            </div>
            <div className="fg2">
              <div className="field"><label>Phone</label><input value={firm.phone} onChange={set('phone')} placeholder="(555) 555-5555" /></div>
              <div className="field"><label>Email</label><input value={firm.email} onChange={set('email')} type="email" placeholder="info@yourfirm.com" /></div>
            </div>
            <div className="field"><label>Address</label><input value={firm.address} onChange={set('address')} placeholder="123 Main St" /></div>
            <div className="fg3">
              <div className="field"><label>City</label><input value={firm.city} onChange={set('city')} /></div>
              <div className="field"><label>State</label><input value={firm.state} onChange={set('state')} maxLength={2} /></div>
              <div className="field"><label>ZIP</label><input value={firm.zip} onChange={set('zip')} /></div>
            </div>
            <div className="fg2">
              <div className="field"><label>Website</label><input value={firm.website} onChange={set('website')} placeholder="https://yourfirm.com" /></div>
              <div className="field"><label>EIN</label><input value={firm.ein} onChange={set('ein')} placeholder="XX-XXXXXXX" /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn pri" onClick={saveFirm} disabled={saving}>{saving ? 'Saving…' : 'Save Firm Info'}</button>
            </div>
          </div>
        </div>
      )}


      {tab === 'integrations' && isPrivileged && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* IRS Preparer Credentials */}
          <div className="card">
            <div className="card-header"><span className="card-title">🪪 IRS Preparer Credentials</span></div>
            <div style={{ padding: '0 20px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 14, lineHeight: 1.6 }}>
                These credentials auto-populate on every Tax Return in the Submit/Export tab.
              </div>
              <div className="fg2">
                <div className="field"><label>Preparer Name</label>
                  <input value={firm.preparer_name} onChange={set('preparer_name')} placeholder="Your full legal name" />
                </div>
                <div className="field"><label>PTIN (Preparer Tax ID Number)</label>
                  <input value={firm.ptin} onChange={set('ptin')} placeholder="P00000000" />
                </div>
              </div>
              <div className="fg2">
                <div className="field"><label>CAF Number (Central Authorization File)</label>
                  <input value={firm.caf_number} onChange={set('caf_number')} placeholder="Used for POA & IRS transcripts" />
                </div>
                <div className="field"><label>EFIN (Electronic Filing ID Number)</label>
                  <input value={firm.efin} onChange={set('efin')} placeholder="6-digit EFIN from IRS" />
                </div>
              </div>
              <div style={{ background: 'rgba(26,127,212,.1)', border: '1px solid rgba(26,127,212,.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--t2)', marginBottom: 14, lineHeight: 1.7 }}>
                <strong style={{ color: 'var(--blue)' }}>📌 Where to find these:</strong><br/>
                PTIN — IRS PTIN system at <strong>irs.gov/ptin</strong><br/>
                CAF# — Your IRS Centralized Authorization File number (shown on Form 2848)<br/>
                EFIN — IRS e-Services at <strong>irs.gov/e-services</strong> (required for this office/ERO)<br/>
                <strong>Transmission:</strong> EFIN alone does not create a direct IRS connection. The CRM must also be connected to IRS-approved/tested e-file software or an authorized transmitter.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn pri" onClick={saveFirm} disabled={saving}>{saving ? 'Saving…' : 'Save Credentials'}</button>
              </div>
            </div>
          </div>

          {/* ── EMAIL & CALENDAR ───────────────────────────────── */}
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12, paddingLeft: 2 }}>
              📧 Email &amp; Calendar
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>

              {/* POP / SMTP */}
              <div style={{ border: '1px solid var(--br)', borderRadius: 12, overflow: 'hidden', background: 'var(--s1)' }}>
                <div onClick={() => toggleInt('smtp')} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', cursor: 'pointer', userSelect: 'none', minHeight: 62 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: '#f0f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>📬</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--tx)' }}>POP / SMTP</div>
                    <div style={{ fontSize: 11, color: firm.smtp_email ? 'var(--ok)' : 'var(--t3)' }}>{firm.smtp_email ? '✅ ' + firm.smtp_email : 'Not configured'}</div>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--t3)' }}>{expandedInt.smtp ? '▲' : '▼'}</span>
                </div>
                {expandedInt.smtp && (
                  <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--br)' }}>
                    <div style={{fontSize:12,color:'var(--t3)',margin:'12px 0 10px',lineHeight:1.6}}>Use any provider — Outlook, Yahoo, Zoho, custom domain. No Google required.</div>
                    <div className="fg2">
                      <div className="field"><label>SMTP Host</label><input value={firm.smtp_host||''} onChange={set('smtp_host')} placeholder="smtp.yourprovider.com"/></div>
                      <div className="field"><label>SMTP Port</label><input value={firm.smtp_port||''} onChange={set('smtp_port')} placeholder="587"/></div>
                    </div>
                    <div className="fg2">
                      <div className="field"><label>Email Address</label><input type="email" value={firm.smtp_email||''} onChange={set('smtp_email')} placeholder="you@yourdomain.com"/></div>
                      <div className="field"><label>Password / App Password</label><input type="password" value={firm.smtp_password||''} onChange={set('smtp_password')} placeholder="••••••••"/></div>
                    </div>
                    <div className="fg2">
                      <div className="field"><label>From Name</label><input value={firm.smtp_name||''} onChange={set('smtp_name')} placeholder="Your Firm Name"/></div>
                      <div className="field"><label>Encryption</label>
                        <select value={firm.smtp_encryption||'TLS'} onChange={set('smtp_encryption')}><option>TLS</option><option>SSL</option><option>None</option></select>
                      </div>
                    </div>
                    <div style={{background:'var(--s2)',borderRadius:6,padding:'8px 12px',fontSize:11,color:'var(--t3)',lineHeight:1.7,marginBottom:12}}>
                      💡 Outlook: smtp.office365.com:587 · Yahoo: smtp.mail.yahoo.com:587 · Zoho: smtp.zoho.com:587
                    </div>
                    <button className="btn pri" onClick={saveFirm} disabled={saving} style={{width:'100%',justifyContent:'center'}}>{saving ? 'Saving…' : 'Save Email Settings'}</button>
                  </div>
                )}
              </div>


              {/* Gmail */}
              <div style={{ border: '1px solid var(--br)', borderRadius: 12, overflow: 'hidden', background: 'var(--s1)' }}>
                <div onClick={() => toggleInt('gmail')} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', cursor: 'pointer', userSelect: 'none', minHeight: 62 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: '#fff3f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg viewBox="0 0 48 48" width="24" height="24"><path fill="#EA4335" d="M6 40h6V23L4 17v20a3 3 0 003 3z"/><path fill="#34A853" d="M36 40h6a3 3 0 003-3V17l-9 6z"/><path fill="#FBBC04" d="M36 8l-12 9L12 8H6l18 13L42 8z"/><path fill="#4285F4" d="M4 17l8 6V8H6a3 3 0 00-2 6z"/><path fill="#C5221F" d="M42 8h-6v15l8-6a3 3 0 00-2-9z"/></svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--tx)' }}>Gmail</div>
                    <div style={{ fontSize: 11, color: connectedGmailCount > 0 ? 'var(--ok)' : 'var(--t3)' }}>{connectedGmailCount > 0 ? `✅ ${connectedGmailCount} connected` : 'Not connected'}</div>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--t3)' }}>{expandedInt.gmail ? '▲' : '▼'}</span>
                </div>
                {expandedInt.gmail && (
                  <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--br)' }}>
                    {connectedGmailCount > 0 ? (
                      <div style={{background:"rgba(34,197,94,.08)",border:"1px solid rgba(34,197,94,.25)",borderRadius:8,padding:"10px 14px",margin:"12px 0 10px",fontSize:12,color:"var(--ok)"}}>
                        ✅ {connectedGmailCount} employee{connectedGmailCount === 1 ? ' has' : 's have'} connected their Gmail.
                      </div>
                    ) : (
                      <div style={{background:"rgba(250,204,21,.08)",border:"1px solid rgba(250,204,21,.25)",borderRadius:8,padding:"10px 14px",margin:"12px 0 10px",fontSize:12,color:"var(--warn)"}}>
                        ⚠️ No employees have connected Gmail yet.
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 12, lineHeight: 1.6 }}>
                      Employees connect their own Gmail from the Email page. Admin setup is only needed once.
                    </div>
                    <details style={{ marginBottom: 14, border: '1px solid var(--br)', borderRadius: 8, background: 'var(--s2)' }}>
                      <summary style={{ cursor: 'pointer', padding: '9px 11px', fontSize: 11, fontWeight: 700, color: 'var(--t2)', userSelect: 'none' }}>
                        Setup details
                      </summary>
                      <div style={{ padding: '0 11px 10px', fontSize: 11, color: 'var(--t3)', lineHeight: 1.65 }}>
                        Google Cloud → enable Gmail API → create a Web OAuth client → add <strong>{window.location.origin}/auth/callback</strong> as the redirect URI → paste the Client ID and Client Secret below.
                      </div>
                    </details>
                    <div className="fg2">
                      <div className="field"><label>Client ID</label><input value={firm.gmail_client_id} onChange={set('gmail_client_id')} placeholder="xxxxx.apps.googleusercontent.com"/></div>
                      <div className="field"><label>Client Secret</label><input type="password" value={firm.gmail_client_secret} onChange={set('gmail_client_secret')} placeholder="GOCSPX-…"/></div>
                    </div>
                    <div className="field"><label>Redirect URI <span style={{fontWeight:400,color:'var(--t3)'}}>(click to copy)</span></label>
                      <input readOnly value={window.location.origin + '/auth/callback'} style={{color:'var(--t3)',cursor:'text'}} onClick={e=>{e.target.select();document.execCommand('copy')}}/>
                    </div>
                    <button className="btn pri" onClick={saveFirm} disabled={saving} style={{width:'100%',justifyContent:'center',marginTop:4}}>{saving ? 'Saving…' : 'Save Gmail Config'}</button>
                  </div>
                )}
              </div>



              {/* Microsoft 365 */}
              <div style={{ border: '1px solid var(--br)', borderRadius: 12, overflow: 'hidden', background: 'var(--s1)' }}>
                <div onClick={() => toggleInt('m365')} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', cursor: 'pointer', userSelect: 'none', minHeight: 62 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: '#f0f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg viewBox="0 0 48 48" width="24" height="24"><path fill="#0078D4" d="M6 6h17v17H6z"/><path fill="#50D9FF" d="M25 6h17v17H25z"/><path fill="#FFB900" d="M6 25h17v17H6z"/><path fill="#EB3C00" d="M25 25h17v17H25z"/></svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--tx)' }}>Microsoft 365</div>
                    <div style={{ fontSize: 11, color: connectedM365Count > 0 ? 'var(--ok)' : 'var(--t3)' }}>{connectedM365Count > 0 ? `✅ ${connectedM365Count} connected` : 'Not connected'}</div>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--t3)' }}>{expandedInt.m365 ? '▲' : '▼'}</span>
                </div>
                {expandedInt.m365 && (
                  <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--br)' }}>
                    {connectedM365Count > 0 ? (
                      <div style={{background:"rgba(34,197,94,.08)",border:"1px solid rgba(34,197,94,.25)",borderRadius:8,padding:"10px 14px",margin:"12px 0 10px",fontSize:12,color:"var(--ok)"}}>
                        ✅ {connectedM365Count} employee{connectedM365Count === 1 ? ' has' : 's have'} connected Microsoft 365.
                      </div>
                    ) : (
                      <div style={{background:"rgba(250,204,21,.08)",border:"1px solid rgba(250,204,21,.25)",borderRadius:8,padding:"10px 14px",margin:"12px 0 10px",fontSize:12,color:"var(--warn)"}}>
                        ⚠️ No employees connected yet. Complete setup below, then each employee connects from the Email page.
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 12, lineHeight: 1.6 }}>
                      Connects Outlook mail and calendar. Admin configuration is done once; employees connect their own account from Email.
                    </div>
                    <details style={{ marginBottom: 14, border: '1px solid var(--br)', borderRadius: 8, background: 'var(--s2)' }}>
                      <summary style={{ cursor: 'pointer', padding: '9px 11px', fontSize: 11, fontWeight: 700, color: 'var(--t2)', userSelect: 'none' }}>
                        Setup details
                      </summary>
                      <div style={{ padding: '0 11px 10px', fontSize: 11, color: 'var(--t3)', lineHeight: 1.65 }}>
                        Microsoft Entra → register a Web app → add the CRM redirect URI → grant the approved Microsoft Graph delegated permissions → create a client secret → paste the Application ID, secret, and tenant below.
                      </div>
                    </details>
                    <div className="fg2">
                      <div className="field"><label>Azure Application (Client) ID</label><input value={firm.m365_client_id||''} onChange={set('m365_client_id')} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/></div>
                      <div className="field"><label>Azure Client Secret</label><input type="password" value={firm.m365_client_secret||''} onChange={set('m365_client_secret')} placeholder="Paste the secret Value from Azure"/></div>
                    </div>
                    <div className="field"><label>Azure Tenant ID</label>
                      <input value={firm.m365_tenant_id||'common'} onChange={set('m365_tenant_id')} placeholder="common"/>
                      <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>Use "common" to allow any Microsoft account. For single-tenant, paste your Azure Directory ID.</div>
                    </div>
                    <button className="btn pri" onClick={saveFirm} disabled={saving} style={{width:'100%',justifyContent:'center',marginTop:4}}>{saving ? 'Saving…' : 'Save M365 Config'}</button>
                  </div>
                )}
              </div>

            </div>{/* end email grid */}
          </div>{/* end email section */}

          {/* SignalWire Dialer */}
          <div className="card">
            <div className="card-header"><span className="card-title">📞 SignalWire Dialer</span></div>
            <div style={{ padding: '0 20px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 14, lineHeight: 1.6 }}>
                Powers SMS and fax directly (no separate backend needed for those), plus the built-in dialer if you deploy one later. Get credentials at <strong>signalwire.com</strong>.
              </div>
              <div className="fg2">
                <div className="field"><label>Space URL</label>
                  <input value={firm.sw_space_url || ''} onChange={set('sw_space_url')} placeholder="yourspace.signalwire.com" />
                </div>
                <div className="field"><label>Project ID</label>
                  <input value={firm.sw_project_id || ''} onChange={set('sw_project_id')} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                </div>
              </div>
              <div className="fg2">
                <div className="field"><label>API Token</label>
                  <input type="password" value={firm.sw_api_token || ''} onChange={set('sw_api_token')} placeholder="PT..." />
                </div>
                <div className="field"><label>Inbound DID (Fax / Inbound-only Number)</label>
                  <input value={firm.sw_inbound_did || ''} onChange={set('sw_inbound_did')} placeholder="+15614206999" />
                  <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>Used for fax reception and inbound-only numbers. Do not use for outbound SMS.</div>
                </div>
                <div className="field"><label>Outbound SMS Number</label>
                  <input value={firm.sw_outbound_did || ''} onChange={set('sw_outbound_did')} placeholder="+15614206665" />
                  <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>All outbound text messages send from this number. Local numbers work immediately — toll-free numbers require SignalWire verification first.</div>
                </div>
              </div>
              <div className="fg2">
                <div className="field"><label>Fax From Number (optional)</label>
                  <input value={firm.firm_fax_number || ''} onChange={set('firm_fax_number')} placeholder="Leave blank to use Inbound DID above" />
                  <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>Only needed if you want fax to send from a different number than voice/SMS — e.g. if the area code you wanted wasn't available for fax.</div>
                </div>
              </div>
              <div className="fg2">
                <div className="field"><label>SIP Username</label>
                  <input value={firm.sw_sip_username || ''} onChange={set('sw_sip_username')} placeholder="SIP endpoint username" />
                </div>
                <div className="field"><label>SIP Password</label>
                  <input type="password" value={firm.sw_sip_password || ''} onChange={set('sw_sip_password')} placeholder="SIP endpoint password" />
                </div>
              </div>
              <div className="fg2">
                <div className="field"><label>Call Forwarding Number</label>
                  <input value={firm.call_forward_number || ''} onChange={set('call_forward_number')} placeholder="+15615551234" />
                  <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>Where incoming calls to your SignalWire number actually ring — your cell, front desk, etc.</div>
                </div>
              </div>
              <div className="field"><label>Backend Server URL (optional)</label>
                <input value={firm.signalwire_backend || ''} onChange={set('signalwire_backend')} placeholder="https://your-backend.onrender.com" />
                <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>Not needed for SMS or fax — those run through Supabase Edge Functions now. Only fill this in if you deploy a separate backend for real-time browser calling later.</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn pri" onClick={saveFirm} disabled={saving}>{saving ? 'Saving…' : 'Save SignalWire'}</button>
              </div>
            </div>
          </div>



          {/* Slack Integration */}
          <div className="card">
            <div className="card-header"><span className="card-title">💬 Slack Integration</span></div>
            <div style={{ padding: '0 20px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 14, lineHeight: 1.7 }}>
                Two-way bridge between Slack and CRM Team Chat. Messages sent in mapped Slack channels appear in the CRM instantly, and CRM messages forward to Slack. Also supports importing Slack message history from a workspace export.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                {[
                  ['1', 'Go to api.slack.com/apps → Create New App → From scratch. Name it "TaxRes CRM".'],
                  ['2', 'Under OAuth & Permissions → Scopes → Bot Token Scopes, add: channels:history, channels:read, chat:write, users:read'],
                  ['3', 'Click "Install to Workspace" — copy the Bot User OAuth Token (starts with xoxb-)'],
                  ['4', 'Under Basic Information → App Credentials, copy the Signing Secret'],
                  ['5', 'Under Event Subscriptions → Enable Events. Request URL: paste your Supabase edge function URL (shown below). Subscribe to bot events: message.channels'],
                  ['6', 'Map each Slack channel ID to a CRM channel name below (get channel IDs from Slack: right-click channel → View channel details → Channel ID at bottom)'],
                ].map(([step, text]) => (
                  <div key={step} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#4a154b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{step}</div>
                    <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.6, paddingTop: 2 }}>{text}</div>
                  </div>
                ))}
              </div>
              <div className="field"><label>Slack Webhook URL (paste into Slack Event Subscriptions)</label>
                <input readOnly value="https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/slack-events"
                  style={{ color: 'var(--t3)', cursor: 'text', fontSize: 11 }}
                  onClick={e => { e.target.select(); document.execCommand('copy'); }} />
                <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>Click to copy. Paste this exactly into Slack's Event Subscriptions → Request URL field.</div>
              </div>
              <div className="fg2">
                <div className="field"><label>Slack Bot Token (xoxb-...)</label>
                  <input type="password" value={firm.slack_bot_token || ''} onChange={set('slack_bot_token')} placeholder="xoxb-xxxxxxxxxxxx" />
                </div>
                <div className="field"><label>Slack Signing Secret</label>
                  <input type="password" value={firm.slack_signing_secret || ''} onChange={set('slack_signing_secret')} placeholder="From Basic Information → App Credentials" />
                </div>
              </div>
              <div className="field"><label>Channel Mapping (Slack Channel ID → CRM channel name, one per line)</label>
                <textarea rows={4}
                  value={firm.slack_channel_map ? Object.entries(firm.slack_channel_map).map(([k,v]) => `${k} = ${v}`).join('\n') : ''}
                  onChange={e => {
                    const map = {}
                    e.target.value.split('\n').forEach(line => {
                      const [k, v] = line.split('=').map(s => s.trim())
                      if (k && v) map[k] = v
                    })
                    setFirm(f => ({ ...f, slack_channel_map: Object.keys(map).length ? map : null }))
                  }}
                  placeholder={"C0123ABCDEF = general\nC0456GHIJKL = tax-team"}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
                <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>Format: SlackChannelID = crm-channel-name. Right-click any Slack channel → View channel details to find the ID.</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 16 }}>
                <input type="checkbox" id="slack_sync" checked={!!firm.slack_sync_enabled}
                  onChange={e => setFirm(f => ({ ...f, slack_sync_enabled: e.target.checked }))} />
                <label htmlFor="slack_sync" style={{ fontSize: 13, color: 'var(--tx)', cursor: 'pointer' }}>
                  Enable two-way Slack sync (messages bridge between Slack and CRM chat)
                </label>
              </div>
              <button className="btn pri" onClick={saveFirm} disabled={saving}>{saving ? 'Saving…' : 'Save Slack Config'}</button>
            </div>
          </div>

          {/* Verizon Business Calling */}
          <div className="card">
            <div className="card-header"><span className="card-title">📞 Verizon Business Calling</span></div>
            <div style={{ padding: '0 20px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 14, lineHeight: 1.6 }}>
                Connect your Verizon Business account for click-to-call, inbound routing, and call logging.
                Contact your Verizon Business rep to get your API credentials, or email <strong>businesssupport@verizon.com</strong>.
                Once connected, set Calling Provider to "Verizon" below to activate.
              </div>
              <div className="fg2">
                <div className="field"><label>Verizon Account ID</label>
                  <input value={firm.verizon_account_id || ''} onChange={set('verizon_account_id')} placeholder="Your Verizon Business account ID" />
                </div>
                <div className="field"><label>Verizon API Key</label>
                  <input type="password" value={firm.verizon_api_key || ''} onChange={set('verizon_api_key')} placeholder="API key from Verizon Business portal" />
                </div>
              </div>
              <div className="fg2">
                <div className="field"><label>Verizon Business Phone Number</label>
                  <input value={firm.verizon_phone_number || ''} onChange={set('verizon_phone_number')} placeholder="+16155022250" />
                </div>
                <div className="field"><label>Calling Provider</label>
                  <select value={firm.calling_provider || 'signalwire'} onChange={set('calling_provider')}>
                    <option value="signalwire">SignalWire (default)</option>
                    <option value="verizon">Verizon Business</option>
                    <option value="none">None / Manual</option>
                  </select>
                  <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>Switch to Verizon after entering credentials above. SignalWire remains active for TCR and any office without Verizon configured.</div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn pri" onClick={saveFirm} disabled={saving}>{saving ? 'Saving…' : 'Save Verizon'}</button>
              </div>
            </div>
          </div>

          {/* Video Calling (TURN server) */}
          <div className="card">
            <div className="card-header"><span className="card-title">🎥 Video Calling (Huddle + Client Meetings)</span></div>
            <div style={{ padding: '0 20px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 14, lineHeight: 1.6 }}>
                Powers the team Huddle and client meeting links — free, browser-to-browser video. Without this, calls only connect when both people's networks happen to allow a direct connection; this fills in the gap for everyone else (different ISPs, office firewalls, etc).
                <br/><br/>
                Sign up free (no card needed, 20GB/month relay) at <strong>dashboard.metered.ca/signup?tool=turnserver</strong>, then copy your app name and API key from the dashboard.
              </div>
              <div className="fg2">
                <div className="field"><label>Metered App Name</label>
                  <input value={firm.metered_app_name || ''} onChange={set('metered_app_name')} placeholder="yourappname" />
                  <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>The subdomain shown in your dashboard — just the name, not the full URL.</div>
                </div>
                <div className="field"><label>API Key</label>
                  <input type="password" value={firm.metered_api_key || ''} onChange={set('metered_api_key')} placeholder="API key from your dashboard" />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn pri" onClick={saveFirm} disabled={saving}>{saving ? 'Saving…' : 'Save Video Calling'}</button>
              </div>
            </div>
          </div>

          {/* ── OFFICE BILLING ── */}
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', margin: '8px 0 8px 2px' }}>🏦 Office Billing</div>

          {/* Mercury — Office Billing */}
          <div className="card">
            <div className="card-header"><span className="card-title">💳 Mercury — Office Billing</span></div>
            <div className="card-body">
              <div style={{fontSize:13,color:'var(--t3)',marginBottom:16,lineHeight:1.6}}>
                Mercury is used to charge offices their monthly subscription. Once connected, the Charge Office panel in the Admin Portal will process payments directly against your Mercury checking account.
                <br/><br/>
                Get your API key from <strong>app.mercury.com → Settings → API → Generate Key</strong>.
              </div>
              <div className="field">
                <label>Mercury API Key</label>
                <input type="password" value={firm.mercury_api_key || ''} onChange={set('mercury_api_key')} placeholder="Your Mercury API key" />
                <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>Stored securely — never exposed to clients or staff.</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn pri" onClick={saveFirm} disabled={saving}>{saving ? 'Saving…' : 'Save Mercury'}</button>
              </div>
            </div>
          </div>

          {/* AI Transcription — Otter + Fathom */}
          <div className="card">
            <div className="card-header"><span className="card-title">🎙️ AI Transcription (Otter & Fathom)</span></div>
            <div className="card-body">
              <div style={{fontSize:13,color:'var(--t3)',marginBottom:16,lineHeight:1.6}}>
                <strong>Otter.ai</strong> automatically transcribes your phone call recordings. Once your API key is entered below, a "Transcribe with Otter" button will appear on every recorded call.
                <br/><br/>
                <strong>Fathom</strong> auto-records and summarizes your Zoom and video meetings. It works as a Chrome extension — no key needed here, just install it and connect your Zoom account.
              </div>

              <div style={{background:'var(--s2)',border:'1px solid var(--br)',borderRadius:8,padding:'12px 14px',marginBottom:16}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>🦦 Otter.ai — Phone Call Transcription</div>
                <div className="field" style={{marginBottom:8}}>
                  <label>Otter API Key</label>
                  <input type="password" value={firm.otter_api_key||''} onChange={set('otter_api_key')} placeholder="Get from otter.ai → Settings → API"/>
                </div>
                <div style={{fontSize:11,color:'var(--t3)',lineHeight:1.6}}>
                  Free at <strong>otter.ai</strong> (300 min/month). Get your API key under <strong>Settings → Account → Integrations → API</strong>. Requires Otter Pro or Business for the import API — free plan can be used manually by uploading recordings directly at otter.ai/import.
                </div>
              </div>

              <div style={{background:'var(--s2)',border:'1px solid var(--br)',borderRadius:8,padding:'12px 14px',marginBottom:16}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:6}}>🌟 Fathom — Video Meeting Recording</div>
                <div style={{fontSize:12,color:'var(--t3)',lineHeight:1.7}}>
                  Fathom requires no API key — it runs as a Chrome extension.<br/>
                  <strong>Step 1:</strong> Go to <strong>fathom.video</strong> and sign up free (no credit card).<br/>
                  <strong>Step 2:</strong> Install the Fathom Chrome extension when prompted.<br/>
                  <strong>Step 3:</strong> Connect your Zoom account inside Fathom.<br/>
                  Every Zoom meeting you host will now be automatically recorded and summarized by AI after it ends.
                </div>
              </div>

              <div style={{display:'flex',justifyContent:'flex-end'}}>
                <button className="btn pri" onClick={saveFirm} disabled={saving}>{saving?'Saving…':'Save Transcription Settings'}</button>
              </div>
            </div>
          </div>

          {/* ── PAYMENTS & BILLING ── */}
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', margin: '8px 0 8px 2px' }}>💳 Payments &amp; Billing</div>

          {/* Payment Provider */}
          <div className="card">
            <div className="card-header"><span className="card-title">💳 Payment Provider</span></div>
            <div style={{ padding: '0 20px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 14, lineHeight: 1.6 }}>
                Select how this office collects client payments. This controls which payment flow appears on charges throughout the CRM.
              </div>
              <div className="field">
                <label>Payment Provider</label>
                <select value={firm.payment_provider || 'stripe'} onChange={set('payment_provider')}>
                  <option value="stripe">Stripe</option>
                  <option value="intuit">Intuit / QuickBooks Payments</option>
                  <option value="manual">Manual / External</option>
                </select>
                <div style={{fontSize:10,color:'var(--t3)',marginTop:4}}>
                  {(firm.payment_provider || 'stripe') === 'intuit' && 'Connect QuickBooks below to activate Intuit Payments. Once connected, all charge buttons will route through your QuickBooks Payments account.'}
                  {(firm.payment_provider || 'stripe') === 'stripe' && 'Enter your Stripe keys below to activate Stripe payments.'}
                  {firm.payment_provider === 'manual' && 'No online payment processing. Staff will collect payments manually and record them in the CRM.'}
                </div>
              </div>
              <button className="btn pri" onClick={saveFirm} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>

          {/* Stripe Autopay */}
          <div className="card">
            <div className="card-header"><span className="card-title">💳 Stripe (Autopay)</span></div>
            <div style={{ padding: '0 20px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 14, lineHeight: 1.6 }}>
                Powers saved cards/bank accounts and recurring autopay on the Clients page. Get your keys at <strong>dashboard.stripe.com/apikeys</strong>.
              </div>
              <div className="field"><label>Publishable Key</label>
                <input value={firm.stripe_publishable_key || ''} onChange={set('stripe_publishable_key')} placeholder="pk_live_..." />
                <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>Safe to store here — Stripe designs this key to be public-facing.</div>
              </div>
              <div style={{ background:'var(--s2)', border:'1px solid var(--br)', borderRadius:8, padding:'10px 14px', fontSize:12, color:'var(--t3)', lineHeight:1.6, marginTop:10 }}>
                <strong style={{color:'var(--t2)'}}>⚠️ Secret Key does NOT go here.</strong> Unlike the credentials above, the Stripe Secret Key can move money on its own, so it must never sit in this database. Set it as an Edge Function secret instead: Supabase Dashboard → Edge Functions → Secrets → add <code>STRIPE_SECRET_KEY</code>. Then deploy the <code>stripe-setup-intent</code> and <code>stripe-charge</code> functions from <code>supabase/functions/</code>.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn pri" onClick={saveFirm} disabled={saving}>{saving ? 'Saving…' : 'Save Stripe'}</button>
              </div>
            </div>
          </div>

          {/* Fax (uses SignalWire credentials above) */}
          <div className="card">
            <div className="card-header"><span className="card-title">📠 Fax Integration</span></div>
            <div style={{ padding: '0 20px 20px' }}>
              <div style={{fontSize:12,color:'var(--t3)',marginBottom:16,lineHeight:1.7}}>
                Fax is sent via a Supabase Edge Function (<code>send-fax</code>), using the same SignalWire project as SMS above. No separate backend or hosting needed.
              </div>
              <div style={{background:'var(--s2)',borderRadius:8,padding:'12px 16px',marginBottom:16,fontSize:12,lineHeight:1.8}}>
                <div style={{fontWeight:700,color:'var(--tx)',marginBottom:6}}>Setup:</div>
                {[['1','Set up SignalWire credentials in the SignalWire Dialer card above'],['2','Deploy the send-fax Edge Function from your Supabase dashboard (Edge Functions → send-fax)'],['3','Fax sends from the Fax From Number above if set, otherwise the Inbound DID']].map(([step,text])=>(
                  <div key={step} style={{display:'flex',gap:10,marginBottom:4,alignItems:'flex-start'}}>
                    <div style={{width:20,height:20,borderRadius:'50%',background:'var(--blue)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:800,flexShrink:0,marginTop:1}}>{step}</div>
                    <div style={{color:'var(--t2)'}}>{text}</div>
                  </div>
                ))}
              </div>
              <div style={{background:'rgba(26,127,212,.08)',border:'1px solid rgba(26,127,212,.2)',borderRadius:8,padding:'10px 14px',fontSize:12,color:'var(--t2)',lineHeight:1.6}}>
                SignalWire Space: <strong>{firm.sw_space_url || 'Not configured'}</strong><br/>
                Fax From Number: <strong>{firm.firm_fax_number || firm.sw_inbound_did || 'Not configured'}</strong>
              </div>
            </div>
          </div>

          {/* QuickBooks Online */}
          <div className="card">
            <div className="card-header"><span className="card-title">📊 QuickBooks Online</span></div>
            <div style={{ padding: '0 20px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 14, lineHeight: 1.7 }}>
                Connect QuickBooks Online to sync invoices and payments automatically. Until this is connected, use the
                <strong> "Export to QuickBooks" </strong> button on the Books & Ledger page to download a CSV you can
                import manually under QuickBooks → Banking → Upload from file.
              </div>

              {/* Step by step */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                {[
                  ['1', 'Go to developer.intuit.com and sign in with your QuickBooks account'],
                  ['2', 'Create a new app → choose "QuickBooks Online and Payments"'],
                  ['3', 'In the app\'s Keys & OAuth section, grab your Client ID and Client Secret (use the Production keys, not Sandbox)'],
                  ['4', `Add Redirect URI: ${window.location.origin}/auth/quickbooks-callback`],
                  ['5', 'Copy your Client ID and Client Secret below, then save'],
                ].map(([step, text]) => (
                  <div key={step} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#2CA01C', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{step}</div>
                    <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.6, paddingTop: 2 }}>{text}</div>
                  </div>
                ))}
              </div>

              <div className="fg2">
                <div className="field"><label>QuickBooks Client ID</label>
                  <input value={firm.qb_client_id || ''} onChange={set('qb_client_id')} placeholder="ABxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
                </div>
                <div className="field"><label>QuickBooks Client Secret</label>
                  <input type="password" value={firm.qb_client_secret || ''} onChange={set('qb_client_secret')} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
                </div>
              </div>
              <div className="field"><label>Redirect URI (copy this exactly into the Intuit Developer app)</label>
                <input readOnly value={window.location.origin + '/auth/quickbooks-callback'} style={{ color: 'var(--t3)', cursor: 'text' }} onClick={e => { e.target.select(); document.execCommand('copy'); }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 14 }}>Click the Redirect URI field to copy it.</div>

              <div style={{ background: 'rgba(212,147,10,.1)', border: '1px solid rgba(212,147,10,.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--t2)', marginBottom: 14, lineHeight: 1.7 }}>
                <strong style={{ color: 'var(--warn)' }}>⚠️ Note:</strong> Save your Client ID/Secret above first, then click Connect.
              </div>

              {acctStatus.quickbooks?.status === 'reconnect_required' ? (
                <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', marginBottom: 4 }}>QuickBooks authorization needs to be renewed</div>
                  <div style={{ fontSize: 11.5, color: 'var(--t3)', lineHeight: 1.6 }}>Click Connect to QuickBooks and select the Nashville company. Historical Canopy-imported payments are excluded from outbound sync so reconnecting will not duplicate them.</div>
                </div>
              ) : null}

              {acctStatus.quickbooks?.status === 'connected' ? (
                <div style={{ background: 'rgba(44,160,28,.1)', border: '1px solid rgba(44,160,28,.3)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#2CA01C', marginBottom: 4 }}>✅ Connected{acctStatus.quickbooks.external_company_name ? ` — ${acctStatus.quickbooks.external_company_name}` : ''}</div>
                  {acctStatus.quickbooks.last_synced_at && <div style={{ fontSize: 11.5, color: 'var(--t3)' }}>Last synced {new Date(acctStatus.quickbooks.last_synced_at).toLocaleString()}{acctStatus.quickbooks.last_sync_result ? ` — ${acctStatus.quickbooks.last_sync_result.synced_invoices||0} invoices, ${acctStatus.quickbooks.last_sync_result.synced_payments||0} payments` : ''}</div>}
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn pri" onClick={saveFirm} disabled={saving}>{saving ? 'Saving…' : 'Save QuickBooks Config'}</button>
                {acctStatus.quickbooks?.status === 'connected' ? (
                  <>
                    <button className="btn sec" disabled={syncing.quickbooks} onClick={()=>syncAccounting('quickbooks')}>{syncing.quickbooks ? 'Syncing…' : '🔄 Sync Now'}</button>
                    <button className="btn sec" onClick={()=>disconnectAccounting('quickbooks')} style={{color:'#ef4444'}}>Disconnect</button>
                  </>
                ) : (
                  <button className="btn sec" onClick={connectQuickBooks}>🔗 Connect to QuickBooks</button>
                )}
              </div>
            </div>
          </div>

          {/* Xero */}
          <div className="card">
            <div className="card-header"><span className="card-title">📗 Xero</span></div>
            <div style={{ padding: '0 20px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 14, lineHeight: 1.7 }}>
                Connect Xero to sync invoices and payments automatically — same idea as QuickBooks above, for firms that run their books on Xero instead.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                {[
                  ['1', 'Go to developer.xero.com/app/manage and sign in with your Xero account'],
                  ['2', 'Create a new app → choose "Web app"'],
                  ['3', `Add Redirect URI: ${window.location.origin}/auth/xero-callback`],
                  ['4', 'In the app\'s Configuration, grab your Client ID and generate a Client Secret'],
                  ['5', 'Copy your Client ID and Client Secret below, then save'],
                ].map(([step, text]) => (
                  <div key={step} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#13B5EA', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{step}</div>
                    <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.6, paddingTop: 2 }}>{text}</div>
                  </div>
                ))}
              </div>

              <div className="fg2">
                <div className="field"><label>Xero Client ID</label>
                  <input value={firm.xero_client_id || ''} onChange={set('xero_client_id')} placeholder="XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" />
                </div>
                <div className="field"><label>Xero Client Secret</label>
                  <input type="password" value={firm.xero_client_secret || ''} onChange={set('xero_client_secret')} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
                </div>
              </div>
              <div className="field"><label>Redirect URI (copy this exactly into the Xero app)</label>
                <input readOnly value={window.location.origin + '/auth/xero-callback'} style={{ color: 'var(--t3)', cursor: 'text' }} onClick={e => { e.target.select(); document.execCommand('copy'); }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 14 }}>Click the Redirect URI field to copy it.</div>

              {acctStatus.xero?.status === 'connected' ? (
                <div style={{ background: 'rgba(19,181,234,.1)', border: '1px solid rgba(19,181,234,.3)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#13B5EA', marginBottom: 4 }}>✅ Connected{acctStatus.xero.external_company_name ? ` — ${acctStatus.xero.external_company_name}` : ''}</div>
                  {acctStatus.xero.last_synced_at && <div style={{ fontSize: 11.5, color: 'var(--t3)' }}>Last synced {new Date(acctStatus.xero.last_synced_at).toLocaleString()}{acctStatus.xero.last_sync_result ? ` — ${acctStatus.xero.last_sync_result.synced_invoices||0} invoices, ${acctStatus.xero.last_sync_result.synced_payments||0} payments` : ''}</div>}
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn pri" onClick={saveFirm} disabled={saving}>{saving ? 'Saving…' : 'Save Xero Config'}</button>
                {acctStatus.xero?.status === 'connected' ? (
                  <>
                    <button className="btn sec" disabled={syncing.xero} onClick={()=>syncAccounting('xero')}>{syncing.xero ? 'Syncing…' : '🔄 Sync Now'}</button>
                    <button className="btn sec" onClick={()=>disconnectAccounting('xero')} style={{color:'#ef4444'}}>Disconnect</button>
                  </>
                ) : (
                  <button className="btn sec" onClick={connectXero}>🔗 Connect to Xero</button>
                )}
              </div>
            </div>
          </div>


          <div className="card">
            <div className="card-header"><span className="card-title">📁 Document Storage</span></div>
            <div style={{ padding: '0 20px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 14, lineHeight: 1.6 }}>
                Document uploads use Supabase Storage. The bucket is configured and active.
              </div>
                            <div style={{background:"rgba(34,197,94,.08)",border:"1px solid rgba(34,197,94,.25)",borderRadius:8,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10,fontSize:12,color:"var(--ok)"}}><span>✅</span><span>Storage bucket configured and active.</span></div>
              </div>
          </div>
        </div>
      )}

      {tab === 'booking' && isPrivileged && <BookingSettings />}

      {/* Email Accounts — personal IMAP/SMTP connections for each employee */}
      {tab === 'integrations' && <EmailAccountsSection />}

      {tab === 'branding' && isPrivileged && (
        <div className="card">
          <div className="card-header"><span className="card-title">Branding</span></div>
          <div style={{ padding: '0 20px 20px' }}>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>Company Logo</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                <div style={{
                  width: 120, height: 80, borderRadius: 10, border: '2px dashed var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden', background: 'var(--bg2)'
                }}>
                  {logoUrl
                    ? <img src={logoUrl} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    : <span style={{ fontSize: 28 }}>🏢</span>}
                </div>
                <div>
                  <button className="btn pri" onClick={() => fileRef.current.click()} disabled={uploading}>
                    {uploading ? 'Uploading…' : '📤 Upload Logo'}
                  </button>
                  <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 6 }}>PNG, JPG, SVG — max 2MB</div>
                  <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={uploadLogo} />
                </div>
              </div>
            </div>
            <div className="field" style={{ maxWidth: 420 }}>
              <label>Accent Color</label>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10, lineHeight: 1.6 }}>
                Controls the highlight color for the active sidebar item, selected tabs (like in Reports), buttons, and badges throughout the CRM.
              </div>
              {/* Hue slider */}
              <div style={{ marginBottom: 12 }}>
                <input
                  type="range" min="0" max="360" step="1"
                  value={(() => {
                    // Convert current hex to hue for slider position
                    const hex = firm.primary_color || '#2563eb'
                    const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255
                    const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min
                    if (d === 0) return 0
                    let h = max === r ? ((g-b)/d + (g<b?6:0)) : max === g ? (b-r)/d+2 : (r-g)/d+4
                    return Math.round(h * 60)
                  })()}
                  onChange={e => {
                    // Convert hue → vivid hex (full saturation/lightness)
                    const h = parseInt(e.target.value)
                    const f = n => { const k=(n+h/30)%12; const a=1*Math.min(k-3,9-k,1); return Math.round((0.5-a*0.5)*255) }
                    // HSL(h, 80%, 50%) for a rich color
                    const toHex = (h,s,l) => {
                      s/=100; l/=100
                      const a=s*Math.min(l,1-l)
                      const fn=n=>{ const k=(n+h/30)%12; return Math.round((l-a*Math.max(Math.min(k-3,9-k,1),-1))*255) }
                      return '#'+[fn(0),fn(8),fn(4)].map(x=>x.toString(16).padStart(2,'0')).join('')
                    }
                    const hex = toHex(h, 80, 45)
                    setFirm(f => ({ ...f, primary_color: hex }))
                    applyBrandColor(hex)
                  }}
                  style={{
                    width: '100%', height: 20, borderRadius: 10, cursor: 'pointer', border: 'none', padding: 0,
                    background: 'linear-gradient(to right,#e53e3e,#ed8936,#ecc94b,#48bb78,#38b2ac,#4299e1,#667eea,#9f7aea,#ed64a6,#e53e3e)',
                    WebkitAppearance: 'none', appearance: 'none',
                  }}
                />
              </div>
              {/* Preset swatches */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                {[
                  ['#2563eb', 'Blue'],
                  ['#16a34a', 'Green'],
                  ['#9333ea', 'Purple'],
                  ['#dc2626', 'Red'],
                  ['#ea580c', 'Orange'],
                  ['#0891b2', 'Teal'],
                  ['#db2777', 'Pink'],
                  ['#475569', 'Slate'],
                ].map(([hex, name]) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => { setFirm(f => ({ ...f, primary_color: hex })); applyBrandColor(hex) }}
                    title={name}
                    style={{
                      width: 34, height: 34, borderRadius: 8, background: hex, cursor: 'pointer',
                      border: firm.primary_color?.toLowerCase() === hex ? '2px solid var(--tx)' : '2px solid transparent',
                      boxShadow: firm.primary_color?.toLowerCase() === hex ? '0 0 0 2px var(--bg)' : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                    }}
                  >
                    {firm.primary_color?.toLowerCase() === hex && <span style={{ color: '#fff', fontSize: 14, fontWeight: 800 }}>✓</span>}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input type="color" value={firm.primary_color} onChange={e => { set('primary_color')(e); applyBrandColor(e.target.value) }} style={{ width: 48, height: 36, borderRadius: 6, border: 'none', cursor: 'pointer' }} />
                <input value={firm.primary_color} onChange={e => { set('primary_color')(e); applyBrandColor(e.target.value) }} style={{ flex: 1 }} placeholder="#2563eb" />
              </div>
            </div>
            <div className="field" style={{ maxWidth: 420 }}>
              <label>Email Signature</label>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10, lineHeight: 1.6 }}>
                Added automatically to the bottom of every email sent from the CRM (invoices, reminders, the Email page, etc).
              </div>
              <textarea value={firm.email_signature||''} onChange={set('email_signature')} rows={4}
                placeholder={"Best regards,\nTax Case Review\n(305) 555-0000\nwww.taxcasereview.org"} />
            </div>

            <div className="field" style={{ maxWidth: 420 }}>
              <label>Signature Logo (optional)</label>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10, lineHeight: 1.6 }}>
                Shows above the signature text on every email sent. PNG with a transparent background works best.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 120, height: 60, borderRadius: 8, border: '1px dashed var(--br)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--s2)', overflow: 'hidden', flexShrink: 0,
                }}>
                  {firm.email_signature_logo_url
                    ? <img src={firm.email_signature_logo_url} alt="Signature logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    : <span style={{ fontSize: 11, color: 'var(--t3)' }}>No logo</span>}
                </div>
                <button className="btn sec" onClick={() => sigLogoFileRef.current.click()} disabled={sigLogoUploading}>
                  {sigLogoUploading ? 'Uploading…' : '📤 Upload Logo'}
                </button>
                <input ref={sigLogoFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={uploadSignatureLogo} />
              </div>

              {/* Live preview of exactly what gets appended to outgoing emails */}
              {(firm.email_signature_logo_url || firm.email_signature) && (
                <div style={{ marginTop: 14, padding: 14, borderRadius: 8, border: '1px solid var(--br)', background: 'var(--s1)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Preview</div>
                  {firm.email_signature_logo_url && (
                    <img src={firm.email_signature_logo_url} alt="" style={{ maxHeight: 60, maxWidth: 240, display: 'block', marginBottom: 8 }} />
                  )}
                  <div style={{ fontSize: 13, color: 'var(--t2)', whiteSpace: 'pre-wrap', fontFamily: 'Arial, sans-serif' }}>{firm.email_signature}</div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn pri" onClick={saveFirm} disabled={saving}>{saving ? 'Saving…' : 'Save Branding'}</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'mysignature' && (
        <div className="card">
          <div className="card-header"><span className="card-title">✍️ My Email Signature</span></div>
          <div style={{ padding: '0 20px 20px' }}>
            <div className="field" style={{ maxWidth: 420 }}>
              <label>Signature Text</label>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10, lineHeight: 1.6 }}>
                Added automatically to the bottom of emails you personally send from the Email page.
              </div>
              <textarea value={mySig.text} onChange={e => setMySig(s => ({ ...s, text: e.target.value }))} rows={4}
                placeholder={"Best Regards,\nYour Name\nYour Title"} />
            </div>

            <div className="field" style={{ maxWidth: 420 }}>
              <label>Signature Logo (optional)</label>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10, lineHeight: 1.6 }}>
                Shows above your signature text. PNG with a transparent background works best.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 120, height: 60, borderRadius: 8, border: '1px dashed var(--br)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--s2)', overflow: 'hidden', flexShrink: 0,
                }}>
                  {mySig.logoUrl
                    ? <img src={mySig.logoUrl} alt="Signature logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    : <span style={{ fontSize: 11, color: 'var(--t3)' }}>No logo</span>}
                </div>
                <button className="btn sec" onClick={() => mySigLogoFileRef.current.click()} disabled={mySigLogoUploading}>
                  {mySigLogoUploading ? 'Uploading…' : '📤 Upload Logo'}
                </button>
                <input ref={mySigLogoFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={uploadMySignatureLogo} />
              </div>

              {(mySig.logoUrl || mySig.text) && (
                <div style={{ marginTop: 14, padding: 14, borderRadius: 8, border: '1px solid var(--br)', background: 'var(--s1)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Preview</div>
                  {mySig.logoUrl && (
                    <img src={mySig.logoUrl} alt="" style={{ maxHeight: 60, maxWidth: 240, display: 'block', marginBottom: 8 }} />
                  )}
                  <div style={{ fontSize: 13, color: 'var(--t2)', whiteSpace: 'pre-wrap', fontFamily: 'Arial, sans-serif' }}>{mySig.text}</div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn pri" onClick={saveMySignature} disabled={mySigSaving}>{mySigSaving ? 'Saving…' : 'Save Signature'}</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'users' && isPrivileged && (
        <div className="card">
          <div className="card-header"><span className="card-title">Team Members</span></div>
          <div style={{ padding: '0 20px 20px' }}>
            {employees.length === 0
              ? <div style={{ color:'var(--t3)', fontSize:13, padding:'20px 0' }}>No employees found.</div>
              : employees.map(m => {
                const displayRole = m.access || m.role || 'Staff'
                const roleColor = displayRole === 'Super Admin' ? 'br' : displayRole === 'Admin' ? 'bb' : displayRole === 'Manager' ? 'bg' : 'bn'
                const isYou = m.email === user?.email
                const initials = (m.name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()
                const inactive = m.status && m.status !== 'Active'
                return (
                  <div key={m.id} style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 0', borderBottom:'1px solid var(--br)', opacity: inactive ? 0.5 : 1 }}>
                    <div style={{ width:40, height:40, borderRadius:'50%', background:'var(--blue)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:15, color:'#fff', flexShrink:0, overflow:'hidden' }}>
                      {m.avatar_url ? <img src={m.avatar_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/> : initials}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:700, fontSize:14, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                        {m.name}
                        {isYou && <span style={{ fontSize:10, color:'var(--ok)' }}>● You</span>}
                        {inactive && <span style={{ fontSize:10, color:'var(--t3)' }}>({m.status})</span>}
                      </div>
                      <div style={{ color:'var(--t2)', fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.email || '—'}</div>
                    </div>
                    <span className={`bdg ${roleColor}`} style={{ fontSize:11, flexShrink:0 }}>{displayRole}</span>
                  </div>
                )
              })
            }
            <div style={{ color:'var(--t3)', fontSize:12, marginTop:14 }}>
              To add or remove team members, go to <strong>Employees</strong> in the sidebar.
            </div>
          </div>
        </div>
      )}

      {tab === 'security' && isPrivileged && (
        <div className="card">
          <div className="card-header"><span className="card-title">Change Password</span></div>
          <div style={{ padding: '0 20px 20px', maxWidth: 400 }}>
            <div className="field"><label>New Password</label><input type="password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} /></div>
            <div className="field"><label>Confirm Password</label><input type="password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} /></div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn pri" onClick={changePassword} disabled={saving}>{saving ? 'Saving…' : 'Update Password'}</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'import' && isPrivileged && <ImportTab />}
      {tab === 'storage' && isPrivileged && <StorageTab tenantId={myTenantId} />}
      {tab === 'statuses' && isPrivileged && <StatusesTab />}
      {tab === 'billing' && isPrivileged && <BillingRatesTab />}
      {tab === 'uptime' && <UptimeTab />}
    </div>
  )
}


// ── Storage Tab ────────────────────────────────────────────────────────────
function StorageTab({ tenantId }) {
  const [docs,    setDocs]    = useState([])
  const [esigns,  setEsigns]  = useState([])
  const [loading, setLoading] = useState(true)
  const [usage,   setUsage]   = useState(null)
  const [usageLoading, setUsageLoading] = useState(true)
  const [projectStorage, setProjectStorage] = useState(null)

  useEffect(() => {
    const tid = tenantId
    if (!tid) return  // Wait for tenantId prop
    async function load() {
      const [{ data: d, error: docsErr }, { data: e }] = await Promise.all([
        supabase.from('documents').select('file_size, "docType", client, created_at').eq('tenant_id', tid).order('file_size', { ascending: false }),
        supabase.from('esigns').select('created_at').eq('tenant_id', tid).limit(200),
      ])
      if (docsErr) console.error('Storage Usage: failed to load documents —', docsErr.message)
      setDocs(d || [])
      setEsigns(e || [])
      setLoading(false)
    }
    load()

    async function loadUsage() {
      // Real, self-contained usage tracking — computed from the CRM's own
      // tables instead of Supabase's billing API. This is what makes it
      // work for any future tenant in the multi-tenant SaaS build too:
      // each firm's usage comes from their own rows, no external account
      // access required, nothing that breaks if Supabase changes their API.
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

      const tid = tenantId
      if (!tid) { setUsageLoading(false); return }
      const [{ count: callCount }, { count: smsCount }, { count: faxCount }, { count: emailCount }, storageRes] = await Promise.all([
        supabase.from('calllog').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', monthStart),
        supabase.from('sms_messages').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', monthStart),
        supabase.from('fax_logs').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', monthStart),
        supabase.from('emails').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', monthStart),
        supabase.rpc('get_project_storage_usage'),
      ])
      if (storageRes.error) console.error('Storage Usage: exact project usage RPC failed —', storageRes.error.message)
      else setProjectStorage(storageRes.data)

      setUsage({
        period: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
        calls: callCount || 0,
        sms: smsCount || 0,
        faxes: faxCount || 0,
        emails: emailCount || 0,
      })
      setUsageLoading(false)
    }
    loadUsage()
  }, [tenantId])

  // Exact project storage comes from storage.objects metadata via a protected RPC.
  // documents.file_size remains useful for tenant/document-type detail, but it is
  // not complete enough to represent actual disk usage (generated e-sign/package
  // files and other buckets are not guaranteed to have matching documents rows).
  const trackedDocumentBytes = docs.reduce((sum, d) => sum + (Number(d.file_size) || 0), 0)
  const projectBytes = Number(projectStorage?.total_bytes || 0)
  const totalBytes = projectBytes || trackedDocumentBytes

  function fmt(bytes) {
    if (!bytes) return '—'
    if (bytes < 1024)        return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  }

  // Group by docType
  const byType = {}
  docs.forEach(d => {
    const t = d.docType || 'Other'
    if (!byType[t]) byType[t] = { count: 0, bytes: 0 }
    byType[t].count++
    byType[t].bytes += (d.file_size || 0)
  })
  const typeRows = Object.entries(byType).sort((a,b) => b[1].bytes - a[1].bytes)

  // Top 10 largest files
  const largest = [...docs].filter(d => d.file_size > 0).slice(0, 10)

  if (loading) return <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--t3)' }}>Loading storage data…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Supabase project usage (Cached Egress + real Storage) — pulled
          daily via Management API by the fetch-usage-metrics edge
          function. Separate from the "Storage Usage" card below, which
          only tracks our own documents table, not the actual Supabase
          project limits. */}
      {!usageLoading && (
        <div className="card">
          <div className="card-header"><span className="card-title">📊 Activity This Month</span></div>
          <div style={{ padding: '0 20px 20px' }}>
            {!usage ? (
              <div style={{ fontSize: 13, color: 'var(--t3)' }}>Couldn't load activity counts.</div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 12 }}>{usage.period}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                  <div style={{ background: 'var(--s2)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 20, fontWeight: 900 }}>{usage.calls}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>Calls</div>
                  </div>
                  <div style={{ background: 'var(--s2)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 20, fontWeight: 900 }}>{usage.sms}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>Texts</div>
                  </div>
                  <div style={{ background: 'var(--s2)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 20, fontWeight: 900 }}>{usage.faxes}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>Faxes</div>
                  </div>
                  <div style={{ background: 'var(--s2)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 20, fontWeight: 900 }}>{usage.emails}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>Emails</div>
                  </div>
                </div>
                <div style={{ marginTop: 12, fontSize: 11, color: 'var(--t3)' }}>
                  This is activity volume, not a billing dollar figure — it's an early-warning signal: a sudden spike here (especially in calls) is usually what drives a Supabase usage overage, so a jump worth noticing shows up here first.
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Exact Supabase project storage */}
      <div className="card">
        <div className="card-header"><span className="card-title">💾 Storage Usage</span></div>
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:10, marginBottom:14 }}>
            <div style={{background:'var(--s2)',borderRadius:10,padding:'12px 14px'}}>
              <div style={{fontSize:25,fontWeight:900,color:'var(--tx)'}}>{fmt(totalBytes)}</div>
              <div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>Actual project storage used</div>
            </div>
            <div style={{background:'var(--s2)',borderRadius:10,padding:'12px 14px'}}>
              <div style={{fontSize:25,fontWeight:900,color:'var(--tx)'}}>{projectStorage?.total_objects ?? '—'}</div>
              <div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>Stored objects</div>
            </div>
            <div style={{background:'var(--s2)',borderRadius:10,padding:'12px 14px'}}>
              <div style={{fontSize:25,fontWeight:900,color:'var(--tx)'}}>{fmt(trackedDocumentBytes)}</div>
              <div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>Tenant document rows with size metadata</div>
            </div>
          </div>
          <div style={{background:'rgba(26,127,212,.08)',border:'1px solid rgba(26,127,212,.22)',borderRadius:9,padding:'10px 13px',fontSize:12,color:'var(--t2)',lineHeight:1.65,marginBottom:14}}>
            <strong style={{color:'var(--tx)'}}>Measured from Supabase Storage itself.</strong> This includes generated packages, signed copies, firm assets, avatars and every storage bucket — not only rows in the CRM documents table. Your plan quota is intentionally not hardcoded because it changes with the Supabase plan.
          </div>
          {(projectStorage?.buckets || []).map(b => (
            <div key={b.bucket_id} style={{display:'flex',alignItems:'center',gap:12,padding:'8px 0',borderBottom:'1px solid var(--br)'}}>
              <div style={{flex:1,fontSize:13,fontWeight:650}}>{b.bucket_id}</div>
              <div style={{fontSize:11,color:'var(--t3)'}}>{b.objects} object{Number(b.objects)===1?'':'s'}</div>
              <div style={{width:90,textAlign:'right',fontSize:12,fontWeight:700,color:'var(--t2)'}}>{fmt(Number(b.bytes)||0)}</div>
            </div>
          ))}
          {!projectStorage && <div style={{fontSize:12,color:'var(--warn)',marginTop:10}}>Exact project usage is unavailable for this login; showing tracked document metadata only.</div>}
        </div>
      </div>

      {/* By type */}
      {typeRows.length > 0 && (
        <div className="card">
          <div className="card-header"><span className="card-title">By Document Type</span></div>
          <div style={{ padding: '0 20px 16px' }}>
            {typeRows.map(([type, { count, bytes }]) => {
              const typePct = totalBytes > 0 ? (bytes / totalBytes) * 100 : 0
              return (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--br)' }}>
                  <div style={{ width: 120, fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{type}</div>
                  <div style={{ flex: 1, height: 6, background: 'var(--s2)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: typePct + '%', background: 'var(--blue)', borderRadius: 99 }} />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--t2)', flexShrink: 0, width: 80, textAlign: 'right' }}>{fmt(bytes)}</div>
                  <div style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0, width: 50, textAlign: 'right' }}>{count} file{count !== 1 ? 's' : ''}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Largest files */}
      {largest.length > 0 && (
        <div className="card">
          <div className="card-header"><span className="card-title">Largest Files</span></div>
          <div style={{ padding: '0 20px 16px' }}>
            {largest.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--br)', fontSize: 13 }}>
                <span style={{ color: 'var(--t3)', width: 20, flexShrink: 0 }}>#{i+1}</span>
                <span style={{ flex: 1, fontWeight: 600 }}>{d.docType || 'Document'}</span>
                <span style={{ color: 'var(--t2)', fontSize: 12 }}>{d.client || '—'}</span>
                <span style={{ color: d.file_size > 5*1024*1024 ? 'var(--warn)' : 'var(--t2)', fontWeight: 600, flexShrink: 0 }}>{fmt(d.file_size)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {docs.length === 0 && (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--t3)' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📂</div>
          <div style={{ fontWeight: 700, color: 'var(--tx)', marginBottom: 4 }}>No documents tracked yet</div>
          <div style={{ fontSize: 13 }}>Storage usage will appear here once files are uploaded.</div>
        </div>
      )}
    </div>
  )
}

// ── Uptime Tab ─────────────────────────────────────────────────────────────
const SERVICES = [
  {
    name: 'Anthropic',
    description: 'AI document parsing (parse-tax-doc)',
    statusUrl: 'https://status.anthropic.com/',
    apiUrl: 'https://status.anthropic.com/api/v2/status.json',
    indicatorPath: ['status', 'indicator'],
    descriptionPath: ['status', 'description'],
    logo: '🤖',
  },
  {
    name: 'Cloudflare',
    description: 'Hosts the CRM app (deploys)',
    statusUrl: 'https://www.cloudflarestatus.com/',
    apiUrl: 'https://www.cloudflarestatus.com/api/v2/status.json',
    indicatorPath: ['status', 'indicator'],
    descriptionPath: ['status', 'description'],
    logo: '🟠',
  },
  {
    name: 'Intuit / QuickBooks',
    description: 'Payments and accounting sync',
    statusUrl: 'https://status.developer.intuit.com/',
    apiUrl: null,
    logo: '💚',
  },
  {
    name: 'Microsoft 365',
    description: 'Email, calendar, and Teams integration',
    statusUrl: 'https://status.office365.com/',
    apiUrl: null,
    logo: '🪟',
  },
  {
    name: 'SignalWire',
    description: 'Phone calls, SMS, fax, IVR',
    statusUrl: 'https://signalwire.trust.pagerduty.com/posts/dashboard',
    apiUrl: null,
    logo: '📞',
  },
  {
    name: 'Supabase',
    description: 'Database, storage, edge functions',
    statusUrl: 'https://status.supabase.com/',
    apiUrl: 'https://status.supabase.com/api/v2/status.json',
    indicatorPath: ['status', 'indicator'],
    descriptionPath: ['status', 'description'],
    logo: '⚡',
  },
  {
    name: 'Groq',
    description: 'AI assistant and call transcription',
    statusUrl: 'https://groqstatus.com/',
    apiUrl: null,
    logo: '🧠',
  },
  {
    name: 'Google Gemini',
    description: 'AI call summaries and transcription',
    statusUrl: 'https://status.cloud.google.com/',
    apiUrl: null,
    logo: '✨',
  },
]

function indicatorToStatus(indicator) {
  if (!indicator || indicator === 'none') return { label: 'Operational', color: 'var(--green)', dot: '#22c55e' }
  if (indicator === 'minor')              return { label: 'Minor Issues', color: 'var(--warn)', dot: '#f59e0b' }
  if (indicator === 'major')              return { label: 'Major Outage', color: 'var(--bad)', dot: '#ef4444' }
  if (indicator === 'critical')           return { label: 'Critical Outage', color: 'var(--bad)', dot: '#ef4444' }
  return { label: 'Unknown', color: 'var(--t3)', dot: '#64748b' }
}

function UptimeTab() {
  const [statuses, setStatuses] = useState({})
  const [loading,  setLoading]  = useState(true)
  const [lastChecked, setLastChecked] = useState(null)

  async function fetchStatuses() {
    setLoading(true)
    const results = {}

    // Fetch via the check-service-status edge function — Supabase's own status
    // page happens to allow direct browser CORS, but Stripe's and Anthropic's
    // do not, so a direct browser fetch to those two silently fails every
    // time. Routing all three through the edge function (server-side, no CORS)
    // fixes that for good.
    const NAME_MAP = { supabase: 'Supabase', stripe: 'Stripe', anthropic: 'Anthropic', github: 'GitHub Pages' }
    try {
      const { data, error } = await supabase.functions.invoke('check-service-status')
      if (error) throw error
      for (const [key, label] of Object.entries(NAME_MAP)) {
        const d = data?.[key]
        if (!d || d.error) { results[label] = { error: d?.error || 'Could not reach status API' }; continue }
        results[label] = { ok: true, indicator: d?.status?.indicator, description: d?.status?.description }
      }
    } catch (e) {
      Object.values(NAME_MAP).forEach(label => { results[label] = { error: 'Could not reach status check service' } })
    }

    // Link-only services
    results['SignalWire']     = { type: 'link-only' }
    results['Gmail / Google'] = { type: 'link-only' }

    setStatuses(results)
    setLastChecked(new Date())
    setLoading(false)
  }

  useEffect(() => { fetchStatuses() }, [])

  const allGreen = SERVICES.filter(s => s.apiUrl).every(s => {
    const r = statuses[s.name]
    return r?.ok && (!r.indicator || r.indicator === 'none')
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: loading ? '#94a3b8' : allGreen ? '#22c55e' : '#f59e0b', boxShadow: loading ? 'none' : `0 0 8px ${allGreen ? '#22c55e' : '#f59e0b'}`, flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                {loading ? 'Checking services…' : allGreen ? 'All systems operational' : 'One or more services have issues'}
              </div>
              {lastChecked && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>Last checked {lastChecked.toLocaleTimeString()}</div>}
            </div>
          </div>
          <button className="btn sec" style={{ fontSize: 12, padding: '6px 14px' }} onClick={fetchStatuses} disabled={loading}>
            {loading ? 'Checking…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Service cards */}
      {SERVICES.map(svc => {
        const result = statuses[svc.name]
        const isLinkOnly = svc.apiUrl === null
        const status = isLinkOnly ? null : (result?.error ? { label: 'Check failed', color: 'var(--t3)', dot: '#94a3b8' } : indicatorToStatus(result?.indicator))
        const desc = result?.description || (result?.error ? 'Could not reach status API' : null)

        return (
          <div key={svc.name} className="card" style={{ padding: '14px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {/* Icon */}
              <div style={{ fontSize: 24, flexShrink: 0 }}>{svc.logo}</div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{svc.name}</div>
                <div style={{ fontSize: 12, color: 'var(--t3)' }}>{svc.description}</div>
                {desc && !isLinkOnly && <div style={{ fontSize: 11, color: status?.color || 'var(--t2)', marginTop: 3 }}>{desc}</div>}
              </div>

              {/* Status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                {loading && !result ? (
                  <span style={{ fontSize: 12, color: 'var(--t3)' }}>Checking…</span>
                ) : isLinkOnly ? (
                  <span style={{ fontSize: 12, color: 'var(--t3)', fontStyle: 'italic' }}>No API — check link</span>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: status?.dot, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: status?.color }}>{status?.label}</span>
                  </div>
                )}
                <a href={svc.statusUrl} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 11, color: 'var(--blue)', textDecoration: 'none', padding: '4px 10px', border: '1px solid var(--br)', borderRadius: 6, whiteSpace: 'nowrap' }}>
                  Status page ↗
                </a>
              </div>
            </div>
          </div>
        )
      })}

      <div style={{ fontSize: 11, color: 'var(--t3)', textAlign: 'center', marginTop: 4 }}>
        SignalWire and Gmail don't provide a public status API — click their status page links to check manually.
      </div>
    </div>
  )
}

// ── Import Data Tab — businesses bring in existing clients/leads from a
// spreadsheet. Parses CSV/XLSX client-side with SheetJS, lets the admin map
// columns to CRM fields, previews the first rows, then bulk-inserts.
function ImportTab() {
  const { showToast } = useApp()
  const [step, setStep] = useState(1) // 1=upload, 2=map, 3=preview, 4=done
  const [importTarget, setImportTarget] = useState('clients') // 'clients' or 'leads'
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [mapping, setMapping] = useState({})
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const fileRef = useRef()

  // CRM fields available to map spreadsheet columns onto. Matches the real
  // clients/leads schema — see BLANK at the top of this file (clients) and
  // the equivalent in Leads.jsx.
  const CRM_FIELDS = [
    { key: '', label: '— Skip this column —' },
    { key: 'name', label: 'Full Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'phone2', label: 'Phone 2' },
    { key: 'email', label: 'Email' },
    { key: 'street', label: 'Street Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'Zip' },
    { key: 'ssn', label: 'SSN' },
    { key: 'ein', label: 'EIN' },
    { key: 'spouseName', label: 'Spouse Name' },
    { key: 'spouseSsn', label: 'Spouse SSN' },
    { key: 'filingStatus', label: 'Filing Status' },
    { key: 'irsBalance', label: 'IRS Balance' },
    { key: 'stateBalance', label: 'State Balance' },
    { key: 'issueType', label: 'Issue Type' },
    { key: 'irsOrState', label: 'IRS / State' },
    { key: 'taxYears', label: 'Tax Years' },
    { key: 'notes', label: 'Notes' },
    { key: 'assignedTo', label: 'Assigned To' },
    { key: 'status', label: 'Status' },
  ]

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
    if (json.length < 2) { showToast('That file has no data rows', 'err'); return }
    const hdrs = json[0].map(h => String(h || '').trim())
    const dataRows = json.slice(1).filter(r => r.some(c => String(c).trim() !== ''))
    setHeaders(hdrs)
    setRows(dataRows)

    // Auto-guess mapping by matching header text to CRM field labels
    const guessed = {}
    hdrs.forEach((h, i) => {
      const norm = h.toLowerCase().replace(/[^a-z0-9]/g, '')
      const match = CRM_FIELDS.find(f => f.key && (
        f.key.toLowerCase() === norm ||
        f.label.toLowerCase().replace(/[^a-z0-9]/g, '') === norm ||
        (norm.includes('name') && f.key === 'name' && !norm.includes('spouse')) ||
        (norm.includes('phone') && !norm.includes('2') && f.key === 'phone') ||
        (norm === 'phone2' && f.key === 'phone2') ||
        (norm.includes('email') && f.key === 'email') ||
        (norm.includes('ssn') && !norm.includes('spouse') && f.key === 'ssn') ||
        (norm.includes('address') && f.key === 'street') ||
        (norm === 'city' && f.key === 'city') ||
        (norm === 'state' && f.key === 'state') ||
        (norm.includes('zip') && f.key === 'zip')
      ))
      guessed[i] = match ? match.key : ''
    })
    setMapping(guessed)
    setStep(2)
  }

  function buildPreviewRows() {
    return rows.slice(0, 8).map(r => {
      const obj = {}
      headers.forEach((h, i) => { if (mapping[i]) obj[mapping[i]] = r[i] })
      return obj
    })
  }

  async function runImport() {
    if (!mapping || Object.values(mapping).every(v => !v)) { showToast('Map at least one column first', 'err'); return }
    setImporting(true)
    const table = importTarget === 'clients' ? 'clients' : 'leads'
    const records = rows.map(r => {
      const obj = {}
      headers.forEach((h, i) => { if (mapping[i]) obj[mapping[i]] = String(r[i] ?? '').trim() })
      if (importTarget === 'clients') {
        obj.clientType = obj.clientType || 'Individual'
        obj.status = obj.status || 'Active'
        obj.pipelineStage = obj.pipelineStage || 'investigation'
        obj.filingStatus = obj.filingStatus || 'Single'
        obj.issueType = obj.issueType || 'OIC'
        obj.irsOrState = obj.irsOrState || 'IRS Federal'
      } else {
        obj.status = obj.status || 'New Lead'
      }
      return obj
    }).filter(r => r.name) // must at least have a name to be a valid record

    const { data, error } = await supabase.from(table).insert(records).select('id')
    setImporting(false)
    if (error) {
      setResult({ ok: false, message: error.message })
      showToast('Import failed: ' + error.message, 'err')
      return
    }
    setResult({ ok: true, count: data?.length || records.length })
    setStep(4)
    showToast(`Imported ${data?.length || records.length} ${importTarget}!`)
  }

  function reset() {
    setStep(1); setFileName(''); setHeaders([]); setRows([]); setMapping({}); setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="card">
      <div className="card-header"><span className="card-title">📥 Import Data</span></div>
      <div style={{ padding: '0 20px 20px' }}>
        <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 18, lineHeight: 1.6 }}>
          Bring in existing clients or leads from a spreadsheet (CSV or Excel). Upload your file, match each column to the right CRM field, preview, then import.
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {['Upload', 'Map columns', 'Preview', 'Done'].map((label, i) => (
            <div key={label} style={{
              flex: 1, textAlign: 'center', padding: '6px 4px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              background: step === i+1 ? 'var(--blue)' : step > i+1 ? 'var(--ok)' : 'var(--s2)',
              color: step >= i+1 ? '#fff' : 'var(--t3)',
            }}>{label}</div>
          ))}
        </div>

        {/* Step 1: Upload */}
        {step === 1 && (
          <div>
            <div className="field" style={{ maxWidth: 320, marginBottom: 14 }}>
              <label>Importing into</label>
              <select value={importTarget} onChange={e => setImportTarget(e.target.value)}>
                <option value="clients">Clients</option>
                <option value="leads">Leads</option>
              </select>
            </div>
            <div onClick={() => fileRef.current.click()} style={{
              border: '2px dashed var(--br)', borderRadius: 10, padding: '40px 20px', textAlign: 'center', cursor: 'pointer', background: 'var(--s1)',
            }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
              <div style={{ fontWeight: 700, color: 'var(--tx)', marginBottom: 4 }}>Click to upload a CSV or Excel file</div>
              <div style={{ fontSize: 12, color: 'var(--t3)' }}>.csv, .xlsx, .xls — first row must be column headers</div>
            </div>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={handleFile}/>
          </div>
        )}

        {/* Step 2: Map columns */}
        {step === 2 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx)', marginBottom: 4 }}>{fileName}</div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 14 }}>{rows.length} rows found. Match each spreadsheet column to a CRM field — we've guessed where we could.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto', marginBottom: 16 }}>
              {headers.map((h, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', background: 'var(--s1)', borderRadius: 8 }}>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h || `Column ${i+1}`}</div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--t3)" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  <select value={mapping[i] || ''} onChange={e => setMapping(m => ({ ...m, [i]: e.target.value }))} style={{ flex: 1 }}>
                    {CRM_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn sec" onClick={reset}>← Start over</button>
              <button className="btn pri" onClick={() => setStep(3)}>Preview →</button>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {step === 3 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx)', marginBottom: 10 }}>Preview — first 8 of {rows.length} rows</div>
            <div style={{ overflowX: 'auto', marginBottom: 16, border: '1px solid var(--br)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--s2)' }}>
                    {Object.values(mapping).filter(Boolean).map(k => (
                      <th key={k} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--t2)', whiteSpace: 'nowrap' }}>
                        {CRM_FIELDS.find(f => f.key === k)?.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {buildPreviewRows().map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--br)' }}>
                      {Object.values(mapping).filter(Boolean).map(k => (
                        <td key={k} style={{ padding: '7px 10px', color: 'var(--tx)', whiteSpace: 'nowrap' }}>{r[k] || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 12, color: 'var(--warn)', marginBottom: 16 }}>
              ⚠️ This will create {rows.length} new {importTarget} records. This can't be undone automatically — review the preview carefully first.
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn sec" onClick={() => setStep(2)}>← Back to mapping</button>
              <button className="btn pri" onClick={runImport} disabled={importing}>
                {importing ? 'Importing…' : `Import ${rows.length} ${importTarget}`}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Done */}
        {step === 4 && result && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>{result.ok ? '✅' : '⚠️'}</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--tx)', marginBottom: 6 }}>
              {result.ok ? `Imported ${result.count} ${importTarget}!` : 'Import failed'}
            </div>
            {!result.ok && <div style={{ fontSize: 12, color: 'var(--bad)', marginBottom: 16 }}>{result.message}</div>}
            <button className="btn pri" onClick={reset}>Import another file</button>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusesTab() {
  const [tenantId, setTenantId] = useState(null)
  const [categories, setCategories] = useState([])
  const [statuses,   setStatuses]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [newCatName, setNewCatName] = useState('')
  const [newStatusText, setNewStatusText] = useState({})
  const [toast, setToast] = useState('')

  function showToast(m){ setToast(m); setTimeout(()=>setToast(''),3000) }

  async function load() {
    setLoading(true)
    const tid = tenantId || await resolveSettingsTenantId()
    if (!tid) { setCategories([]); setStatuses([]); setLoading(false); return }
    if (!tenantId) setTenantId(tid)
    const [{ data: cats }, { data: sts }] = await Promise.all([
      supabase.from('workflow_status_categories').select('*').eq('tenant_id', tid).order('sort_order'),
      supabase.from('workflow_statuses').select('*').eq('tenant_id', tid).order('sort_order'),
    ])
    setCategories(cats || [])
    setStatuses(sts || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function addCategory() {
    if (!newCatName.trim()) return
    const sort_order = categories.length
    const tid = tenantId || await resolveSettingsTenantId()
    if (!tid) { showToast('❌ Could not resolve this office'); return }
    const { error } = await supabase.from('workflow_status_categories').insert([{ tenant_id: tid, name: newCatName.trim(), sort_order }])
    if (error) { showToast('❌ ' + error.message); return }
    setNewCatName('')
    load()
  }

  async function deleteCategory(cat) {
    if (!confirm(`Delete the "${cat.name}" column and all its statuses? Existing tasks already using these statuses keep their text label — this only removes them from the picker.`)) return
    const tid = tenantId || await resolveSettingsTenantId()
    if (!tid) return
    await supabase.from('workflow_status_categories').delete().eq('tenant_id', tid).eq('id', cat.id)
    load()
  }

  async function addStatus(cat) {
    const text = (newStatusText[cat.id] || '').trim()
    if (!text) return
    const sort_order = statuses.filter(s => s.category_id === cat.id).length
    const tid = tenantId || await resolveSettingsTenantId()
    if (!tid) { showToast('❌ Could not resolve this office'); return }
    const { error } = await supabase.from('workflow_statuses').insert([{ tenant_id: tid, category_id: cat.id, label: text, sort_order }])
    if (error) { showToast('❌ ' + error.message); return }
    setNewStatusText(prev => ({ ...prev, [cat.id]: '' }))
    load()
  }

  async function deleteStatus(id) {
    const tid = tenantId || await resolveSettingsTenantId()
    if (!tid) return
    await supabase.from('workflow_statuses').delete().eq('tenant_id', tid).eq('id', id)
    load()
  }

  if (loading) return <div style={{ padding: 20, color: 'var(--t3)' }}>Loading…</div>

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Workflow Statuses</span>
      </div>
      <div style={{ padding: '0 20px 20px' }}>
        <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16 }}>
          This is your master set of task statuses. Each column is a category; the rows underneath are the specific statuses your team can pick on any task.
        </div>
        {toast && <div style={{ fontSize: 12, color: 'var(--ok)', marginBottom: 10 }}>{toast}</div>}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {categories.map(cat => (
            <div key={cat.id} style={{ minWidth: 200, width: 200, border: '1px solid var(--br)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ background: 'var(--s2)', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx)' }}>{cat.name}</span>
                <button onClick={() => deleteCategory(cat)} style={{ background: 'none', border: 'none', color: 'var(--bad)', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>×</button>
              </div>
              <div style={{ padding: 8 }}>
                {statuses.filter(s => s.category_id === cat.id).map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', background: 'var(--s1)', borderRadius: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--tx)' }}>{s.label}</span>
                    <button onClick={() => deleteStatus(s.id)} style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <input
                    value={newStatusText[cat.id] || ''}
                    onChange={e => setNewStatusText(prev => ({ ...prev, [cat.id]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && addStatus(cat)}
                    placeholder="Add status…"
                    style={{ flex: 1, fontSize: 11, padding: '5px 8px', background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 5, color: 'var(--tx)' }}
                  />
                  <button className="btn sec" style={{ fontSize: 11, padding: '5px 8px' }} onClick={() => addStatus(cat)}>+</button>
                </div>
              </div>
            </div>
          ))}

          <div style={{ minWidth: 200, flexShrink: 0, border: '1px dashed var(--br)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
            <input
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCategory()}
              placeholder="New category name…"
              style={{ fontSize: 12, padding: '7px 10px', background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, color: 'var(--tx)' }}
            />
            <button className="btn pri" style={{ fontSize: 11, padding: '6px 10px' }} onClick={addCategory}>+ Add Category</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Billing Rates Tab ───────────────────────────────────────────────────────
function BillingRatesTab() {
  const { showToast } = useApp()
  const [tenantId, setTenantId] = useState(null)
  const [activities, setActivities] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(null) // id being saved
  const [deleting,   setDeleting]   = useState(null)
  const [newForm,    setNewForm]    = useState({ name: '', default_rate: '', color: '#2563eb' })
  const [adding,     setAdding]     = useState(false)

  const COLORS = ['#2563eb','#7c3aed','#0891b2','#059669','#dc2626','#d97706','#64748b','#ec4899']

  async function load() {
    setLoading(true)
    const tid = tenantId || await resolveSettingsTenantId()
    if (!tid) { setActivities([]); setLoading(false); return }
    if (!tenantId) setTenantId(tid)
    const { data } = await supabase.from('billing_activity_types').select('*').eq('tenant_id', tid).order('sort_order')
    setActivities(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function updateRate(act, rate) {
    setSaving(act.id)
    const parsed = parseFloat(rate)
    if (isNaN(parsed) || parsed < 0) { showToast('Enter a valid rate'); setSaving(null); return }
    const tid = tenantId || await resolveSettingsTenantId()
    if (!tid) { setSaving(null); return }
    await supabase.from('billing_activity_types').update({ default_rate: parsed }).eq('tenant_id', tid).eq('id', act.id)
    setSaving(null)
    load()
  }

  async function toggleNonBillable(id, current) {
    const tid = tenantId || await resolveSettingsTenantId()
    if (!tid) return
    await supabase.from('billing_activity_types').update({ non_billable: !current }).eq('tenant_id', tid).eq('id', id)
    load()
  }

  async function updateColor(id, color) {
    const tid = tenantId || await resolveSettingsTenantId()
    if (!tid) return
    await supabase.from('billing_activity_types').update({ color }).eq('tenant_id', tid).eq('id', id)
    load()
  }

  async function addActivity() {
    const name = newForm.name.trim()
    const rate = parseFloat(newForm.default_rate)
    if (!name) { showToast('Enter an activity name'); return }
    if (isNaN(rate) || rate < 0) { showToast('Enter a valid rate'); return }
    setAdding(true)
    const maxSort = activities.reduce((m, a) => Math.max(m, a.sort_order || 0), 0)
    const tid = tenantId || await resolveSettingsTenantId()
    if (!tid) { setAdding(false); showToast('❌ Could not resolve this office'); return }
    const { error } = await supabase.from('billing_activity_types').insert([{
      tenant_id: tid, name, default_rate: rate, color: newForm.color, sort_order: maxSort + 1
    }])
    setAdding(false)
    if (error) { showToast('❌ ' + (error.code === '23505' ? 'Activity type already exists' : error.message)); return }
    setNewForm({ name: '', default_rate: '', color: '#2563eb' })
    showToast('✅ Activity type added')
    load()
  }

  async function deleteActivity(id) {
    if (!confirm('Delete this activity type? Existing time entries keep their activity label.')) return
    setDeleting(id)
    const tid = tenantId || await resolveSettingsTenantId()
    if (!tid) { setDeleting(null); return }
    await supabase.from('billing_activity_types').delete().eq('tenant_id', tid).eq('id', id)
    setDeleting(null)
    load()
  }

  if (loading) return <div style={{ padding: 20, color: 'var(--t3)' }}>Loading…</div>

  return (
    <div className="card">
      <div className="card-header"><span className="card-title">⏱️ Billing Activity Types & Rates</span></div>
      <div style={{ padding: '0 20px 20px' }}>
        <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16 }}>
          Default hourly rates for each activity type. Staff can override the rate on individual time entries.
          These rates auto-fill when logging time.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {activities.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                                     background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 8 }}>
              {/* Color picker */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', background: a.color, cursor: 'pointer', border: '2px solid var(--br)' }}
                  onClick={() => {
                    const idx = COLORS.indexOf(a.color)
                    const next = COLORS[(idx + 1) % COLORS.length]
                    updateColor(a.id, next)
                  }} title="Click to change color" />
              </div>

              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--tx)' }}>{a.name}</span>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--t3)' }}>$/hr</span>
                <input
                  type="text" inputMode="decimal"
                  defaultValue={Number(a.default_rate).toFixed(2)}
                  onBlur={e => { if (e.target.value !== String(Number(a.default_rate).toFixed(2))) updateRate(a, e.target.value) }}
                  onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                  style={{ width: 80, padding: '5px 8px', background: 'var(--s2)', border: '1px solid var(--br)',
                           borderRadius: 6, color: 'var(--tx)', fontSize: 13, textAlign: 'right' }}
                />
                {saving === a.id && <span style={{ fontSize: 11, color: 'var(--t3)' }}>Saving…</span>}
              </div>
              <button onClick={() => toggleNonBillable(a.id, a.non_billable)}
                style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid var(--br)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                         background: a.non_billable ? '#fef3c7' : 'var(--s2)', color: a.non_billable ? '#92400e' : 'var(--t3)' }}
                title="Toggle non-billable">
                {a.non_billable ? 'NON-BILLABLE' : 'Billable'}
              </button>

              <button onClick={() => deleteActivity(a.id)} disabled={deleting === a.id}
                style={{ padding: '4px 8px', background: 'none', border: '1px solid var(--br)',
                         borderRadius: 5, color: 'var(--bad)', cursor: 'pointer', fontSize: 13 }}>×</button>
            </div>
          ))}
        </div>

        {/* Add new */}
        <div style={{ background: 'var(--s1)', border: '1px dashed var(--br)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Add Activity Type</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Activity name…" onKeyDown={e => e.key === 'Enter' && addActivity()}
              style={{ flex: 2, minWidth: 140, padding: '7px 10px', background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 7, color: 'var(--tx)', fontSize: 13 }} />
            <input value={newForm.default_rate} onChange={e => setNewForm(f => ({ ...f, default_rate: e.target.value }))}
              placeholder="Rate/hr" inputMode="decimal" onKeyDown={e => e.key === 'Enter' && addActivity()}
              style={{ width: 90, padding: '7px 10px', background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 7, color: 'var(--tx)', fontSize: 13 }} />
            <div style={{ display: 'flex', gap: 4 }}>
              {COLORS.map(c => (
                <div key={c} onClick={() => setNewForm(f => ({ ...f, color: c }))}
                  style={{ width: 18, height: 18, borderRadius: '50%', background: c, cursor: 'pointer',
                           border: newForm.color === c ? '3px solid var(--tx)' : '2px solid transparent' }} />
              ))}
            </div>
            <button className="btn pri" onClick={addActivity} disabled={adding} style={{ fontSize: 12, padding: '7px 14px' }}>
              {adding ? 'Adding…' : '+ Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Email Accounts — personal IMAP/SMTP per employee ────────────────────────
function EmailAccountsSection() {
  const { user, showToast } = useApp()
  const [tenantId, setTenantId] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const DEFAULTS = {
    email_address: '', display_name: '', password: '',
    imap_host: 'mail.taxrescrm.net', imap_port: 993,
    smtp_host: 'mail.taxrescrm.net', smtp_port: 587, use_ssl: true,
  }
  const [form, setForm] = useState(DEFAULTS)
  function fld(k, v) { setForm(f => ({ ...f, [k]: v })) }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const tid = tenantId || await resolveSettingsTenantId()
    if (!tid) { setAccounts([]); setLoading(false); return }
    if (!tenantId) setTenantId(tid)
    const { data } = await supabase.from('email_accounts')
      .select('id,email_address,display_name,imap_host,imap_port,smtp_host,smtp_port,is_active,last_sync_at,sync_status,sync_error')
      .eq('tenant_id', tid)
      .eq('employee_email', user?.email || '')
      .order('created_at')
    setAccounts(data || [])
    setLoading(false)
  }

  async function save() {
    if (!form.email_address || !form.password) {
      showToast('Email address and password are required'); return
    }
    setSaving(true)
    const { error } = await supabase.functions.invoke('save-email-account', {
      body: {
        email_address: form.email_address.trim(),
        display_name:  form.display_name.trim() || form.email_address.trim(),
        imap_host: form.imap_host, imap_port: Number(form.imap_port),
        smtp_host: form.smtp_host, smtp_port: Number(form.smtp_port),
        use_ssl: form.use_ssl, password: form.password,
      }
    })
    setSaving(false)
    if (error) { showToast('❌ ' + error.message); return }
    showToast('✅ Email account saved')
    setShowForm(false); setForm(DEFAULTS); load()
  }

  async function remove(id) {
    if (!confirm('Remove this email account? Synced emails will remain.')) return
    const tid = tenantId || await resolveSettingsTenantId()
    if (!tid) return
    await supabase.from('email_accounts').update({ is_active: false }).eq('tenant_id', tid).eq('id', id)
    load()
  }

  async function syncNow(id) {
    setTesting(true)
    const { data, error } = await supabase.functions.invoke('imap-sync', { body: { account_id: id } })
    setTesting(false)
    if (error) { showToast('❌ ' + error.message); return }
    const r = data?.results?.[0]
    showToast(r ? `✅ Synced — ${r.synced} new message${r.synced !== 1 ? 's' : ''}` : '✅ Sync complete')
    load()
  }

  const STATUS_COLOR = { ok: '#10b981', error: '#ef4444', pending: '#f59e0b' }

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-header">
        <span className="card-title">📧 Connected Email Accounts</span>
        <button className="btn sec" style={{ fontSize: 12 }} onClick={() => { setShowForm(true); setForm(DEFAULTS) }}>
          + Connect Mailbox
        </button>
      </div>
      <div style={{ padding: '0 20px 20px' }}>
        <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16 }}>
          Connect your IMAP/SMTP mailbox to send and receive emails directly inside client records.
          Each rep connects their own mailbox — passwords are encrypted at rest, never stored in plaintext.
        </div>

        {showForm && (
          <div style={{ background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Connect a Mailbox</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field" style={{ gridColumn: '1/-1' }}>
                <label>Email Address *</label>
                <input value={form.email_address} onChange={e => fld('email_address', e.target.value)} placeholder="romy@taxrescrm.net" type="email"/>
              </div>
              <div className="field" style={{ gridColumn: '1/-1' }}>
                <label>Display Name</label>
                <input value={form.display_name} onChange={e => fld('display_name', e.target.value)} placeholder="Romy Cruz — TaxRes CRM"/>
              </div>
              <div className="field" style={{ gridColumn: '1/-1' }}>
                <label>Password / App Password *</label>
                <input value={form.password} onChange={e => fld('password', e.target.value)} type="password" placeholder="••••••••"/>
              </div>
              <div className="field"><label>IMAP Host</label>
                <input value={form.imap_host} onChange={e => fld('imap_host', e.target.value)}/>
              </div>
              <div className="field"><label>IMAP Port</label>
                <input value={form.imap_port} onChange={e => fld('imap_port', e.target.value)} type="number"/>
              </div>
              <div className="field"><label>SMTP Host</label>
                <input value={form.smtp_host} onChange={e => fld('smtp_host', e.target.value)}/>
              </div>
              <div className="field"><label>SMTP Port</label>
                <input value={form.smtp_port} onChange={e => fld('smtp_port', e.target.value)} type="number"/>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--t3)', margin: '8px 0 12px' }}>
              Stalwart defaults: IMAP 993 SSL · SMTP 587 STARTTLS or 465 SSL
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn pri" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save & Connect'}</button>
              <button className="btn sec" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ color: 'var(--t3)', fontSize: 13 }}>Loading…</div>
        ) : accounts.length === 0 ? (
          <div style={{ color: 'var(--t3)', fontSize: 13, padding: '12px 0' }}>No email accounts connected yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {accounts.map(a => (
              <div key={a.id} style={{ background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 8, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--tx)' }}>{a.email_address}</div>
                  <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                    IMAP {a.imap_host}:{a.imap_port} · SMTP {a.smtp_host}:{a.smtp_port}
                    {a.last_sync_at && ` · Last sync: ${new Date(a.last_sync_at).toLocaleString()}`}
                  </div>
                  {a.sync_error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>{a.sync_error}</div>}
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase',
                  background: (STATUS_COLOR[a.sync_status] || '#64748b') + '22',
                  color: STATUS_COLOR[a.sync_status] || '#64748b' }}>
                  {a.sync_status || 'pending'}
                </span>
                <button className="btn sec" style={{ fontSize: 11 }} disabled={testing} onClick={() => syncNow(a.id)}>
                  {testing ? '⏳' : '🔄'} Sync
                </button>
                <button className="btn sec" style={{ fontSize: 11, color: 'var(--bad)' }} onClick={() => remove(a.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
