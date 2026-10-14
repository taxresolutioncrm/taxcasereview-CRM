import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import AdminPortal from './AdminPortal'

const PLATFORM_OWNER_EMAILS = new Set([
  'info@romylabs.com',
  'romy@romylabs.com',
  'romy@taxrescrm.net',
  'romy@taxcasereview.org',
])

export default function AdminPortalGuard() {
  const { user, checking } = useApp()
  const [portalReady, setPortalReady] = useState(false)
  const resumeInProgress = useRef(false)
  const email = user?.email?.toLowerCase() || ''
  const authorized = PLATFORM_OWNER_EMAILS.has(email)

  useEffect(() => {
    if (checking || !authorized) return
    let cancelled = false

    async function resetTenantContext() {
      // /crm-admin is the platform control plane, never a tenant session.
      // A previous Jump In may leave BOTH browser state and the durable
      // admin_tenant_overrides row pointing at CloudCPA/TCR/etc. Clear both
      // before rendering the portal so tenant context can never bleed in.
      try { sessionStorage.removeItem('admin_impersonation') } catch (_) {}
      try { await supabase.rpc('set_admin_tenant_override', { p_tenant_id: null }) } catch (_) {}
      if (!cancelled) setPortalReady(true)
    }

    resetTenantContext()
    return () => { cancelled = true }
  }, [checking, authorized, email])


  // Recover a stale Supabase session after laptop sleep or network loss.
  // Check elapsed clock time on resume because background timers are throttled.
  // No interval polling, database rows, or additional services.
  useEffect(() => {
    if (checking || !authorized) return
    const IDLE_MS = 3.5 * 60 * 60 * 1000
    const KEY = 'romylabs_admin_last_activity'
    let active = true
    let lastActivity = Number(sessionStorage.getItem(KEY)) || Date.now()
    let timer = null
    const logout = async () => {
      if (!active || resumeInProgress.current) return
      resumeInProgress.current = true
      try { await supabase.auth.signOut() } catch (_) {}
      sessionStorage.removeItem(KEY)
      if (active) window.location.replace('/login?reason=idle')
    }
    const expired = () => {
      if (Date.now() - lastActivity < IDLE_MS) return false
      void logout()
      return true
    }
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(expired, Math.max(1000, IDLE_MS - (Date.now() - lastActivity)))
    }
    const activity = () => {
      if (expired()) return
      lastActivity = Date.now()
      sessionStorage.setItem(KEY, String(lastActivity))
      schedule()
    }
    const resume = async () => {
      if (expired() || resumeInProgress.current || !navigator.onLine) return
      resumeInProgress.current = true
      try {
        const { data, error } = await supabase.auth.refreshSession()
        if (!active) return
        if (!error && !data?.session) window.location.replace('/login?reason=session')
        // Network errors do not prove that credentials expired. Retry on next
        // online, focus, or visibility event without discarding the page.
      } catch (_) {
        // Keep the session state until connectivity is restored.
      } finally {
        resumeInProgress.current = false
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void resume() }
    const onFocus = () => { void resume() }
    const onOnline = () => { void resume() }
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll']
    events.forEach(event => window.addEventListener(event, activity, { passive: true }))
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    schedule()
    if (document.visibilityState === 'visible') void resume()
    return () => {
      active = false
      clearTimeout(timer)
      events.forEach(event => window.removeEventListener(event, activity))
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
    }
  }, [checking, authorized])

  if (checking) return null
  if (!authorized) return <Navigate to="/" replace />
  if (!portalReady) return <div style={{minHeight:'100vh',background:'#0d0c1a'}} />
  return <AdminPortal />
}
