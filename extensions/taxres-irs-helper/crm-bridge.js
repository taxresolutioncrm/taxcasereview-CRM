// TaxRes IRS Helper — CRM bridge (runs only on TaxRes CRM pages).
// Hands transcript PDFs to the CRM page with window.postMessage and relays the CRM's answer back.
// It carries PDF bytes only. It never touches IRS / ID.me passwords, cookies, tokens or sessions.
(() => {
  const HELPER = 'taxres-irs-helper'
  const CRM = 'taxres-crm'
  const ACK_TIMEOUT_MS = 120000
  let crmReady = false
  const pending = new Map()

  const toPage = msg => window.postMessage({ source: HELPER, ...msg }, window.location.origin)
  const toHelper = msg => { try { chrome.runtime.sendMessage(msg).catch(() => {}) } catch { /* extension reloaded */ } }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== window.location.origin) return
    const data = event.data
    if (!data || data.source !== CRM) return
    if (data.type === 'crm-hello' || data.type === 'crm-ready') {
      crmReady = true
      toHelper({ type: 'crm-ready' })
      if (data.type === 'crm-hello') toPage({ type: 'helper-hello' })
    } else if (data.type === 'crm-gone') {
      crmReady = false
      toHelper({ type: 'crm-gone' })
    } else if (data.type === 'transcript-ack') {
      const done = pending.get(String(data.id))
      if (done) { pending.delete(String(data.id)); done({ ok: true, status: data.status, detail: data.detail || '' }) }
    }
  })

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false
    if (msg.type === 'ping') { sendResponse({ ready: crmReady }); return false }
    if (msg.type === 'download-unreadable') {
      if (crmReady) toPage({ type: 'download-unreadable', name: String(msg.name || '') })
      sendResponse({ ok: crmReady })
      return false
    }
    if (msg.type === 'transcript-pdf') {
      if (!crmReady) { sendResponse({ ok: false, status: 'no-crm' }); return false }
      const id = String(msg.id)
      const timer = setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); sendResponse({ ok: false, status: 'timeout' }) }
      }, ACK_TIMEOUT_MS)
      pending.set(id, answer => { clearTimeout(timer); sendResponse(answer) })
      toPage({ type: 'transcript-pdf', id, name: String(msg.name || 'irs-transcript.pdf'), base64: msg.base64 })
      return true
    }
    return false
  })

  window.addEventListener('pagehide', () => { crmReady = false; toHelper({ type: 'crm-gone' }) })
  toPage({ type: 'helper-hello' })
})()
