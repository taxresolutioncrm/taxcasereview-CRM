// TaxRes IRS Helper — mailbox / transcript sender
// Runs on IRS TDS and SOR pages.
// Reads transcript content already visible on the page and sends it to the CRM.
// Never reads, stores, or transmits IRS / ID.me sign-in data.

let panel = null
let panelStatus = null

// ── Helpers ───────────────────────────────────────────────────────────────────

function toBase64(buffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function safeUrl(href) {
  try {
    const u = new URL(href, location.href)
    return u.protocol === 'https:' && u.origin === location.origin ? u : null
  } catch { return null }
}

function updatePanel(msg) {
  if (!panel) buildPanel()
  if (panelStatus) panelStatus.textContent = msg
  // Also expose to crm-bridge.js
  if (window.__taxresHelper) window.__taxresHelper.updatePanel = updatePanel
}

function postToCrm(msg) {
  window.__taxresHelper?.postToCrm?.(msg)
}

function getState() {
  return window.__taxresHelper?.getState?.() || {}
}

// ── Extract text from the current page (SOR read view) ───────────────────────

function extractPageText() {
  const clone = document.documentElement.cloneNode(true)
  clone.querySelectorAll('script, style').forEach(el => el.remove())
  const html = clone.innerHTML
    .replace(/<\/?(tr|td|th|div|p|br|li|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ').replace(/&#160;/g, ' ')
  return html.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n')
}

// ── Send the current page as an HTML file ─────────────────────────────────────

async function sendCurrentPageContent(label) {
  updatePanel('⏳ Reading transcript…')
  try {
    const html = document.documentElement.outerHTML
    const blob = new Blob([html], { type: 'text/html' })
    const buf = await blob.arrayBuffer()
    const base64 = toBase64(buf)
    const filename = (label || document.title || 'irs-transcript').replace(/[^\w\s.-]/g, '_').trim() + '.html'
    const id = crypto.randomUUID()
    const { tenantId, requestIds, nonce } = getState()
    postToCrm({ type: 'transcript-pdf', id, name: filename, base64, tenantId, requestIds, nonce, contentType: 'text/html' })
    updatePanel('⏳ Sending to CRM…')
  } catch (e) {
    updatePanel('❌ Could not read page: ' + (e?.message || 'Unknown error'))
  }
}

// ── Fetch an attachment link and send it ──────────────────────────────────────

async function sendAttachmentLink(href, label) {
  const u = safeUrl(href)
  if (!u) { updatePanel('❌ Skipped: link is not on this IRS page.'); return }
  updatePanel('⏳ Fetching transcript…')
  try {
    const resp = await fetch(u.href, { credentials: 'same-origin' })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const buf = await resp.arrayBuffer()
    const base64 = toBase64(buf)
    const contentType = resp.headers.get('content-type') || ''
    const isHtml = contentType.includes('html') || /\.html?(\?|$)/i.test(u.pathname)
    const ext = isHtml ? '.html' : '.pdf'
    const filename = (label || 'irs-transcript').replace(/[^\w\s.-]/g, '_').trim() + ext
    const id = crypto.randomUUID()
    const { tenantId, requestIds, nonce } = getState()
    postToCrm({
      type: 'transcript-pdf', id, name: filename, base64, tenantId, requestIds, nonce,
      contentType: isHtml ? 'text/html' : 'application/pdf',
    })
    updatePanel('⏳ Sending to CRM…')
  } catch (e) {
    updatePanel('❌ Could not fetch: ' + (e?.message || 'Unknown error'))
  }
}

// ── Collect all sendable items from current page ──────────────────────────────

async function sendAll(silent) {
  const url = window.location.href

  // SOR read view — send the full page HTML
  if (/read_content\.jsp/i.test(url)) {
    await sendCurrentPageContent(document.title || 'irs-sor-transcript')
    return
  }

  // SOR inbox — look for checked items
  if (/list_mail/i.test(url) || /semail/i.test(url)) {
    const checked = [...document.querySelectorAll('input[type=checkbox]:checked')]
      .map(cb => cb.closest('tr')).filter(Boolean)
    if (checked.length === 0) {
      if (!silent) updatePanel('Check a transcript message first, then click Send to CRM.')
      return
    }
    for (const row of checked) {
      const readLink = row.querySelector('a[href*="read_content"]')
      if (readLink) {
        const label = readLink.textContent?.trim() || 'irs-transcript'
        await sendAttachmentLink(readLink.href, label)
      }
    }
    return
  }

  // TDS pages — look for transcript download links on this same origin
  const attachLinks = [...document.querySelectorAll('a[href]')].filter(a => {
    const u = safeUrl(a.href)
    return u && /download|attachment|transcript|\.html|\.pdf/i.test(a.href + a.textContent)
  })
  if (attachLinks.length > 0) {
    for (const a of attachLinks) {
      await sendAttachmentLink(a.href, a.textContent.trim() || 'irs-transcript')
    }
    return
  }

  // Fallback — send the whole page
  await sendCurrentPageContent(document.title || 'irs-transcript')
}

// ── Panel UI ──────────────────────────────────────────────────────────────────

function buildPanel() {
  if (panel) return

  panel = document.createElement('div')
  panel.id = 'taxres-helper-panel'
  panel.style.cssText = [
    'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483647',
    'background:#1e3a5f', 'color:#fff', 'border-radius:10px',
    'box-shadow:0 4px 24px rgba(0,0,0,.35)', 'font-family:system-ui,sans-serif',
    'font-size:13px', 'min-width:240px', 'max-width:320px', 'overflow:hidden',
  ].join(';')

  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.15);font-weight:700;font-size:12px;letter-spacing:.4px;'
  header.innerHTML = '<span>🏛 TaxRes IRS Helper</span>'

  const closeBtn = document.createElement('button')
  closeBtn.textContent = '✕'
  closeBtn.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:14px;padding:0 2px;opacity:.7;'
  closeBtn.onclick = () => { panel.style.display = 'none' }
  header.appendChild(closeBtn)

  panelStatus = document.createElement('div')
  panelStatus.style.cssText = 'padding:9px 12px;line-height:1.45;font-size:12px;color:rgba(255,255,255,.85);'
  panelStatus.textContent = 'Connecting to CRM…'

  const sendBtn = document.createElement('button')
  sendBtn.id = 'taxres-send-btn'
  sendBtn.textContent = 'Send to CRM'
  sendBtn.style.cssText = [
    'display:block', 'width:calc(100% - 24px)', 'margin:0 12px 12px',
    'padding:8px 0', 'background:#2563eb', 'color:#fff',
    'border:none', 'border-radius:7px', 'font-size:13px',
    'font-weight:700', 'cursor:pointer', 'transition:background .15s',
  ].join(';')
  sendBtn.onmouseenter = () => { sendBtn.style.background = '#1d4ed8' }
  sendBtn.onmouseleave = () => { sendBtn.style.background = '#2563eb' }

  // Required: must use addEventListener, not onclick, and must call sendAll(false)
  sendBtn.addEventListener('click', () => sendAll(false))

  panel.appendChild(header)
  panel.appendChild(panelStatus)
  panel.appendChild(sendBtn)
  document.body.appendChild(panel)

  // Expose updatePanel to crm-bridge.js
  if (window.__taxresHelper) window.__taxresHelper.updatePanel = updatePanel
}

// ── Wire inline "→ CRM" buttons next to SOR read links ───────────────────────

function wireInlineSendButtons() {
  document.querySelectorAll('a[href*="read_content"]').forEach(a => {
    if (a.dataset.taxresWired) return
    a.dataset.taxresWired = '1'
    const btn = document.createElement('button')
    btn.textContent = '→ CRM'
    btn.title = 'Send this transcript to TaxRes CRM'
    btn.style.cssText = 'margin-left:8px;padding:2px 8px;background:#2563eb;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;vertical-align:middle;'
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const label = a.closest('tr')?.querySelector('td:nth-child(4)')?.textContent?.trim() || 'irs-transcript'
      sendAttachmentLink(a.href, label)
    })
    a.parentNode.insertBefore(btn, a.nextSibling)
  })

  if (/read_content\.jsp/i.test(window.location.href)) {
    updatePanel('Transcript detected — click Send to CRM.')
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  buildPanel()
  wireInlineSendButtons()
  const observer = new MutationObserver(() => wireInlineSendButtons())
  observer.observe(document.body, { childList: true, subtree: true })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
