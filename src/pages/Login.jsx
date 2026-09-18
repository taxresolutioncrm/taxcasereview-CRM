import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'

const ROMYLABS_OWNERS = ['romy@romylabs.com', 'info@romylabs.com', 'romy@taxrescrm.net', 'romy@taxcasereview.org']
const ROMYLABS_ADMIN_HOST = 'admin.romylabs.com'

const COPY = {
  en: {
    eyebrow: 'TAX RESOLUTION MANAGEMENT',
    headline: 'Your entire tax resolution practice, in sync.',
    body: 'Leads, clients, cases, IRS workflows, documents and communications in one secure workspace.',
    secure: 'Secure practice access',
    heading: 'Welcome back',
    sub: 'Sign in to manage your tax resolution practice.',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign In',
    signingIn: 'Signing in…',
    required: 'Email and password required',
    powered: 'Powered by TaxRes CRM',
    platform: 'RomyLabs Platform',
  },
  es: {
    eyebrow: 'GESTIÓN DE RESOLUCIÓN TRIBUTARIA',
    headline: 'Toda su práctica de resolución tributaria, en sincronía.',
    body: 'Prospectos, clientes, casos, procesos del IRS, documentos y comunicaciones en un solo espacio seguro.',
    secure: 'Acceso seguro para la práctica',
    heading: 'Bienvenido de nuevo',
    sub: 'Inicie sesión para administrar su práctica de resolución tributaria.',
    email: 'Correo electrónico',
    password: 'Contraseña',
    signIn: 'Iniciar sesión',
    signingIn: 'Iniciando sesión…',
    required: 'Correo electrónico y contraseña requeridos',
    powered: 'Desarrollado con TaxRes CRM',
    platform: 'Plataforma RomyLabs',
  },
}

const CSS = `
.tcr-login-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#060F1C;padding:20px;font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif}
.tcr-login-card2{display:flex;width:100%;max-width:920px;min-height:560px;border-radius:20px;overflow:hidden;box-shadow:0 32px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.06)}
.tcr-login-left2{flex:0 0 420px;background:linear-gradient(160deg,#0A1929 0%,#0D2140 55%,#0A2550 100%);display:flex;flex-direction:column;padding:52px 44px 40px;position:relative;overflow:hidden}
.tcr-login-left2:before{content:'';position:absolute;top:-80px;right:-80px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(26,127,212,.18) 0%,transparent 70%);pointer-events:none}
.tcr-login-left2:after{content:'';position:absolute;bottom:-60px;left:-40px;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,rgba(26,127,212,.10) 0%,transparent 70%);pointer-events:none}
.tcr-login-logo2{height:48px;max-width:220px;object-fit:contain;display:block;margin-bottom:40px;position:relative;z-index:1}
.tcr-login-copy2{position:relative;z-index:1;display:flex;flex-direction:column;flex:1}
.tcr-login-eyebrow2{font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#1A7FD4;margin-bottom:12px}
.tcr-login-title2{font-size:28px;font-weight:800;color:#F0F6FF;line-height:1.18;margin:0 0 18px;letter-spacing:-.01em}
.tcr-login-divider2{width:36px;height:2px;background:linear-gradient(90deg,#1A7FD4,transparent);border-radius:2px;margin:10px 0 28px}
.tcr-login-body2{font-size:14px;color:#8BA8C4;line-height:1.7;margin:0;max-width:330px}
.tcr-login-secure2{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:32px;font-size:11.5px;color:#8BA8C4;font-weight:500}
.tcr-login-dot2{width:7px;height:7px;border-radius:50%;background:#22d3a5;box-shadow:0 0 6px rgba(34,211,165,.5)}
.tcr-login-right2{flex:1;background:#fff;display:flex;flex-direction:column;justify-content:center;padding:52px 48px;position:relative}
.tcr-login-lang2{position:absolute;top:24px;right:28px;display:flex;gap:2px;background:#E8EDF2;border-radius:8px;padding:3px}
.tcr-login-lang2 button{font-size:11px;font-weight:700;color:#8A9BAC;background:transparent;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;font-family:inherit}
.tcr-login-lang2 button.active{background:#fff;color:#1A2A3A;box-shadow:0 1px 4px rgba(0,0,0,.10)}
.tcr-login-form2{width:100%;max-width:380px;margin:0 auto}
.tcr-login-form2 h2{font-size:24px;font-weight:800;color:#0A1929;margin:0 0 6px;letter-spacing:-.01em}
.tcr-login-sub2{font-size:13.5px;color:#64748B;margin:0 0 32px;line-height:1.5}
.tcr-login-error2{background:#FEF2F2;border:1.5px solid #FECACA;border-radius:10px;padding:10px 14px;font-size:13px;color:#DC2626;margin-bottom:20px;line-height:1.4}
.tcr-login-field2{margin-bottom:18px}
.tcr-login-field2 label{display:block;font-size:12px;font-weight:600;color:#334155;margin-bottom:5px}
.tcr-login-field2 input{width:100%;padding:11px 14px;font-size:14px;border:1.5px solid #E2E8F0;border-radius:10px;background:#F8FAFC;color:#0F172A;outline:none;box-sizing:border-box;transition:border-color .15s,box-shadow .15s,background .15s;font-family:inherit}
.tcr-login-field2 input:focus{border-color:#1A7FD4;box-shadow:0 0 0 3px rgba(26,127,212,.12);background:#fff}
.tcr-login-btn2{width:100%;padding:13px;font-size:14.5px;font-weight:700;background:#1A7FD4;color:#fff;border:0;border-radius:10px;cursor:pointer;margin-top:8px;transition:background .15s,transform .1s,box-shadow .15s;font-family:inherit;box-shadow:0 4px 14px rgba(26,127,212,.35)}
.tcr-login-btn2:hover:not(:disabled){background:#1567B8;box-shadow:0 6px 18px rgba(26,127,212,.45)}
.tcr-login-btn2:active:not(:disabled){transform:translateY(1px)}
.tcr-login-btn2:disabled{opacity:.65;cursor:not-allowed;box-shadow:none}
.tcr-login-footer2{margin-top:28px;font-size:11px;color:#94A3B8;text-align:center}
@media(max-width:700px){.tcr-login-card2{flex-direction:column;min-height:unset}.tcr-login-left2{flex:auto;padding:32px 28px 28px}.tcr-login-logo2{height:38px;margin-bottom:26px}.tcr-login-title2{font-size:23px}.tcr-login-body2{display:none}.tcr-login-secure2{padding-top:20px}.tcr-login-right2{padding:52px 28px 38px}.tcr-login-form2{max-width:none}}
@media(max-width:400px){.tcr-login-page{padding:12px}.tcr-login-left2{padding:24px 20px 22px}.tcr-login-right2{padding:52px 20px 30px}}
`

export default function Login() {
  const { login, showToast } = useApp()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [branding, setBranding] = useState(null)
  const [lang, setLang] = useState('en')
  const debounceRef = useRef(null)
  const isAdminHost = window.location.hostname.toLowerCase() === ROMYLABS_ADMIN_HOST
  const t = COPY[lang]

  useEffect(() => {
    const switchRequested = new URLSearchParams(window.location.search).get('switch') === '1'
    if (!switchRequested || isAdminHost) return
    let cancelled = false
    ;(async () => {
      try {
        await supabase.auth.signOut()
        if (!cancelled) window.history.replaceState({}, '', '/login')
      } catch (_) {}
    })()
    return () => { cancelled = true }
  }, [isAdminHost])

  useEffect(() => {
    if (document.getElementById('tcr-login-bilingual-css')) return
    const style = document.createElement('style')
    style.id = 'tcr-login-bilingual-css'
    style.textContent = CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, [])

  useEffect(() => {
    // Branding follows the host/tenant, not the privilege level of the email.
    // Owner credentials such as romy@taxcasereview.org remain TCR-branded on
    // the TCR login; only admin.romylabs.com is allowed to show RomyLabs.
    if (isAdminHost) {
      setBranding({ firm_name: 'RomyLabs', logo_url: '/romylabs-logo.png', sub: 'Platform Administration' })
      return
    }
    const domain = email.split('@')[1]?.toLowerCase()
    if (!domain || !domain.includes('.')) { setBranding(null); return }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const { data } = await supabase.rpc('get_branding_by_email_domain', { p_domain: domain })
        if (data && data.firm_name) {
          setBranding({ firm_name: data.firm_name, logo_url: data.logo_url || null, sub: data.sub || 'IRS Resolution Platform' })
        } else setBranding(null)
      } catch (_) { setBranding(null) }
    }, 400)
    return () => clearTimeout(debounceRef.current)
  }, [email, isAdminHost])

  async function sendPasswordReset() {
    const target = email.trim()
    if (!target) { setError(lang === 'es' ? 'Ingrese su correo electrónico primero' : 'Enter your email address first'); return }
    setResetting(true); setError(''); setResetSent(false)
    const { error } = await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: window.location.origin + '/settings?reset_password=1'
    })
    setResetting(false)
    if (error) { setError(error.message); return }
    setResetSent(true)
  }

  async function submit(e) {
    e.preventDefault()
    if (!email || !password) return setError(t.required)
    setLoading(true)
    setError('')
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error

      const signedInEmail = data.user?.email?.toLowerCase() || ''
      const ownerLogin = ROMYLABS_OWNERS.includes(signedInEmail)

      // SECURITY BOUNDARY: admin.romylabs.com accepts platform-owner sessions
      // only. Never allow a valid tenant/demo credential to become app state on
      // the Admin Portal, even if a mobile browser autofills it.
      if (isAdminHost && !ownerLogin) {
        try { sessionStorage.removeItem('admin_impersonation') } catch (_) {}
        await supabase.auth.signOut()
        setPassword('')
        setError('RomyLabs Admin access only. Use an authorized RomyLabs owner account.')
        return
      }

      const isAdminLogin = isAdminHost && ownerLogin

      // Defense in depth: the Admin Portal must always start with NO tenant
      // context. A previous Jump In can leave both a browser marker and a
      // durable DB override behind, so clear both before routing to /crm-admin.
      if (isAdminLogin) {
        try { sessionStorage.removeItem('admin_impersonation') } catch (_) {}
        try { await supabase.rpc('set_admin_tenant_override', { p_tenant_id: null }) } catch (_) {}
      }

      login(data.user)
      showToast(lang === 'es' ? '¡Bienvenido de nuevo!' : 'Welcome back!')

      if (isAdminLogin) {
        window.location.href = '/crm-admin'
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const firmName = branding?.firm_name || (isAdminHost ? 'RomyLabs' : 'Tax Case Review')
  const logoUrl = branding?.logo_url || (isAdminHost ? '/romylabs-logo.png' : '/taxrescrm-logo.png')

  return (
    <div className="tcr-login-page">
      <div className="tcr-login-card2">
        <div className="tcr-login-left2">
          <img src={logoUrl} alt={firmName} className="tcr-login-logo2" onError={e => { e.target.style.display = 'none' }} />
          <div className="tcr-login-copy2">
            <div className="tcr-login-eyebrow2">{t.eyebrow}</div>
            <h1 className="tcr-login-title2">{t.headline}</h1>
            <div className="tcr-login-divider2" />
            <p className="tcr-login-body2">{t.body}</p>
            <div className="tcr-login-secure2"><span className="tcr-login-dot2" />{t.secure}</div>
          </div>
        </div>

        <div className="tcr-login-right2">
          <div className="tcr-login-lang2" role="group" aria-label="Language">
            <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => { setLang('en'); setError('') }}>EN</button>
            <button type="button" className={lang === 'es' ? 'active' : ''} onClick={() => { setLang('es'); setError('') }}>ES</button>
          </div>

          <div className="tcr-login-form2">
            <h2>{t.heading}</h2>
            <p className="tcr-login-sub2">{t.sub}</p>
            {error && <div className="tcr-login-error2">{error}</div>}

            <form onSubmit={submit} noValidate>
              <div className="tcr-login-field2">
                <label htmlFor="tcr-email">{t.email}</label>
                <input id="tcr-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" autoFocus />
              </div>
              <div className="tcr-login-field2">
                <label htmlFor="tcr-password">{t.password}</label>
                <input id="tcr-password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
              </div>
              <div style={{display:'flex',justifyContent:'flex-end',marginTop:-10,marginBottom:12}}>
                <button type="button" onClick={sendPasswordReset} disabled={resetting}
                  style={{border:0,background:'transparent',color:'#1A7FD4',fontSize:12,fontWeight:700,cursor:'pointer',padding:0}}>
                  {resetting ? (lang==='es'?'Enviando…':'Sending…') : (lang==='es'?'¿Olvidó su contraseña?':'Forgot password?')}
                </button>
              </div>
              {resetSent && <div style={{fontSize:12,color:'#047857',background:'#ecfdf5',border:'1px solid #a7f3d0',borderRadius:8,padding:'9px 12px',marginBottom:12}}>
                {lang==='es'?'Enlace de restablecimiento enviado. Revise su correo.':'Password reset link sent. Check your email.'}
              </div>}
              <button type="submit" disabled={loading} className="tcr-login-btn2">{loading ? t.signingIn : t.signIn}</button>
            </form>

            <div className="tcr-login-footer2">{isAdminHost ? t.platform : t.powered}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
