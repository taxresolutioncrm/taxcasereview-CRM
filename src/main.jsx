// ─────────────────────────────────────────────────────────────────────────────
// main.jsx MUST remain minimal.
//
// HARD RULE: Only App is mounted here. Nothing else.
//
// DO NOT mount additional components directly in this file. Components mounted
// here run OUTSIDE App's ErrorBoundary and outside AppContext/auth state.
// Any crash here (network error, missing RPC, uninitialized context) brings
// down the entire application with a white screen — there is no recovery.
//
// Audit trail: EsignAuditBridge, EsignManagerAuditBridge, and TeamChatProBridge
// were mounted here and caused a full production outage (2026-08-27).
// They were removed to restore service. Their RPCs exist; if this functionality
// is needed, mount inside App.jsx wrapped in an ErrorBoundary.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './manual-premium.css'
import './lib/routePrefetch'
import './lib/operationalI18n'
import './lib/spanishUiParity'
import './polish.css'
import './theme-scrollbars.css'
import './taxres-mobile.css'
import './taxres-dashboard.css'
import App from './App.jsx'
import { getModel } from './lib/leadStatus'

globalThis.React = React
globalThis.getModel = getModel
globalThis.useMemo = React.useMemo

// A user can keep TCR open while a new deploy replaces the hashed lazy-page
// JavaScript or CSS chunks underneath that already-running tab. Vite can report
// either a dynamic import failure OR an "Unable to preload CSS" failure. Both
// poison lazy navigation until the shell reloads. Recover exactly once per
// minute while preserving the current URL.
;(function installStaleChunkRecovery() {
  const KEY = 'tcr_last_chunk_recovery'
  const WINDOW_MS = 60_000
  const matchesChunkFailure = value => {
    const msg = String(value?.message || value?.reason?.message || value?.reason || value || '')
    return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|dynamically imported module|Unable to preload CSS|Failed to fetch.*assets\/.+\.(?:js|css)|error loading dynamically imported module/i.test(msg)
  }
  const recover = value => {
    if (!matchesChunkFailure(value)) return
    try {
      const last = Number(sessionStorage.getItem(KEY) || 0)
      const now = Date.now()
      if (now - last < WINDOW_MS) return
      sessionStorage.setItem(KEY, String(now))
    } catch {}
    window.location.reload()
  }
  window.addEventListener('unhandledrejection', event => recover(event.reason))
  window.addEventListener('error', event => recover(event.error || event.message))
})()

// Apply saved brand color instantly — before React renders (no flash)
;(function() {
  const hex = localStorage.getItem('tcr_brand_color')
  const rgb = localStorage.getItem('tcr_brand_rgb')
  if (!hex || !hex.startsWith('#')) return
  const root = document.documentElement
  root.style.setProperty('--blue', hex)
  root.style.setProperty('--b2',   hex)
  root.style.setProperty('--blt',  `rgba(${rgb},.18)`)
  root.style.setProperty('--b2c',  `rgba(${rgb},.14)`)
  const s = document.createElement('style')
  s.id = 'tcr-brand-override'
  s.textContent = `
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
    a { color: ${hex}; }
  `
  document.head.appendChild(s)
})()

// Restore deep-link URL after the GitHub Pages 404 SPA redirect.
;(function() {
  try {
    const saved = sessionStorage.getItem('redirect') || sessionStorage.redirect
    if (saved && saved.includes('/')) {
      sessionStorage.removeItem('redirect')
      try { delete sessionStorage.redirect } catch(e) {}
      window.history.replaceState(null, '', saved)
    }
  } catch(e) {}
})()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Register service worker to ensure all users always get fresh deploys
// service worker removed