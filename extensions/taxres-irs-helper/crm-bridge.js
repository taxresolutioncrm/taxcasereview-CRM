// TaxRes IRS Helper — CRM bridge
// Handles the postMessage channel between this IRS page and the TaxRes CRM.
// Only accepts messages from this page's own origin (window.location.origin).
// Never reads, stores, or relays IRS / ID.me sign-in credentials.

const HELPER_SOURCE = 'taxres-irs-helper'
const CRM_SOURCE = 'taxres-crm'

let crmWindow = null
let tenantId = null
let requestIds = null
let nonce = null

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
window.__taxresHelper.getState = () => ({ tenantId, requestIds, nonce, crmWindow })

window.addEventListener('message', (event) => {
  // Only accept messages sent from this same page (window itself via postMessage relay
  // or from the opener). Guard: reject anything not from this page's own window/origin.
  if (event.source !== window || event.origin !== window.location.origin) {
    // Check if it came from our opener CRM instead
    const opener = findOpener()
    if (!opener || event.source !== opener) return
  }

  const data = event.data
  if (!data || data.source !== CRM_SOURCE) return

  if (data.type === 'crm-ready' || data.type === 'crm-hello') {
    crmWindow = event.source || findOpener()
    if (data.tenantId) tenantId = String(data.tenantId)
    postToCrm({ type: 'helper-hello', url: window.location.href })
    window.__taxresHelper.updatePanel?.('Ready — click a transcript to send it to the CRM.')
  }

  if (data.type === 'crm-bind') {
    if (data.tenantId) tenantId = String(data.tenantId)
    if (Array.isArray(data.requestIds)) requestIds = data.requestIds.map(String)
    if (data.nonce) nonce = data.nonce
    crmWindow = event.source || findOpener()
    postToCrm({ type: 'helper-hello', url: window.location.href })
    window.__taxresHelper.updatePanel?.('Linked to CRM — click a transcript to send it.')
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

// Announce ourselves to the CRM opener on load
;(function announceToOpener() {
  const w = findOpener()
  if (!w) return
  crmWindow = w
  try {
    w.postMessage({ source: HELPER_SOURCE, type: 'helper-hello', url: window.location.href }, '*')
  } catch { /* noop */ }
})()
