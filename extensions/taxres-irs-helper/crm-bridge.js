// TaxRes IRS Helper — CRM bridge
// Handles the postMessage channel between this IRS page and the TaxRes CRM.
// Only accepts messages from this page's own origin (window.location.origin).
// Never reads, stores, or relays IRS / ID.me sign-in credentials.

const HELPER_SOURCE = 'taxres-irs-helper'
const CRM_SOURCE = 'taxres-crm'

const INITIAL_NONCE = (() => {
  try { return new URLSearchParams(location.hash.slice(1)).get('taxres-bind') || null } catch { return null }
})()

let crmWindow = null
let tenantId = null
let requestIds = null
let nonce = INITIAL_NONCE
let agentName = null
let clientId = null

// Exported so mailbox.js can use them
window.__taxresHelper = window.__taxresHelper || {}

function findOpener() {
  try {
    if (window.opener && !window.opener.closed) return window.opener
  } catch { /* cross-origin opener — normal for IRS popups */ }
  return null
}

function postToCrm(msg) {
  const w = crmWindow || findOpener()
  if (!w) return
  try {
    w.postMessage({ source: HELPER_SOURCE, ...msg }, '*')
  } catch { /* window may have navigated */ }
}

// Expose so mailbox.js can call postToCrm and read shared state
window.__taxresHelper.postToCrm = postToCrm
window.__taxresHelper.getState = () => ({ tenantId, requestIds, nonce, crmWindow, agentName, clientId })

window.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.source !== CRM_SOURCE) return

  const fromSelf = event.source === window && event.origin === window.location.origin
  const fromCrm = crmWindow ? event.source === crmWindow : event.source === findOpener()
  if (!fromSelf && !fromCrm) return

  if (data.type === 'crm-ready' || data.type === 'crm-hello') {
    crmWindow = event.source || findOpener()
    if (data.tenantId) tenantId = String(data.tenantId)
    postToCrm({ type: 'helper-hello', url: window.location.href })
    window.__taxresHelper.updatePanel?.('Ready — click a transcript to send it to the CRM.')
  }

  if (data.type === 'crm-bind' || data.type === 'crm-ping') {
    if (INITIAL_NONCE && data.nonce && data.nonce !== INITIAL_NONCE) return
    if (nonce && data.nonce && data.nonce !== nonce) return
    if (data.tenantId) tenantId = String(data.tenantId)
    if (Array.isArray(data.requestIds)) requestIds = data.requestIds.map(String)
    if (!nonce && data.nonce) nonce = data.nonce
    if (data.agentName) agentName = String(data.agentName)
    if (data.clientId) clientId = String(data.clientId)
    crmWindow = event.source || findOpener()
    postToCrm({ type: 'helper-hello', url: window.location.href })
    const who = agentName ? ` · ${agentName}` : ''
    window.__taxresHelper.updatePanel?.(`Linked to CRM${who} — click a transcript to send it.`)
  }

  if (data.type === 'crm-gone') {
    crmWindow = null
    window.__taxresHelper.updatePanel?.('CRM window closed. Reopen the CRM to link again.')
  }

  if (data.type === 'transcript-ack') {
    if (data.status === 'filed') {
      window.__taxresHelper.updatePanel?.(`✅ Filed to ${data.detail || 'client'}.`)
    } else if (data.status === 'duplicate') {
      window.__taxresHelper.updatePanel?.('ℹ Already filed — not filed again.')
    } else {
      window.__taxresHelper.updatePanel?.(`⚠ ${data.detail || 'Could not file. Try again or drag the file onto the CRM.'}`)
    }
  }
})

// Initial fast path via opener; proactive crm-ping remains the resilient channel after IRS/ID.me navigation
;(function announceToOpener() {
  const w = findOpener()
  if (!w) return
  crmWindow = w
  try {
    w.postMessage({ source: HELPER_SOURCE, type: 'helper-hello', url: window.location.href }, '*')
  } catch { /* noop */ }
})()
