// TaxRes IRS Helper — IRS page script.
// On the IRS Secure Mailbox it shows a small "Send N transcripts to CRM" panel. It does nothing
// until the rep clicks, then opens the transcript files one at a time, like the rep would.
// Files are opened by this IRS page itself, inside the rep's own browser session. This script never
// reads or sends passwords, cookies, tokens or session IDs, and never touches the sign-in pages.
(() => {
  if (window.top !== window) return
  const MAX_PDF_BYTES = 15 * 1024 * 1024
  const PACE_MS = 1500
  const PDF_LINK = /\.pdf\b|attach|download/i
  const MESSAGE_LINK = /view.?mail|read.?mail|messageid|mailid|msgid|view_message|viewmessage/i

  const ask = msg => new Promise(resolve => {
    try { chrome.runtime.sendMessage(msg, answer => { void chrome.runtime.lastError; resolve(answer || null) }) } catch { resolve(null) }
  })
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

  ask({ type: 'irs-ready' })

  // ---- read a file the same way the page would open it ----
  async function fetchSameSite(url) {
    const u = new URL(url, location.href)
    if (u.protocol !== 'blob:' && u.origin !== location.origin) throw new Error('Not on this IRS site')
    const res = await fetch(u.href, { credentials: 'same-origin', redirect: 'follow' })
    if (!res.ok) throw new Error('IRS returned ' + res.status)
    return res
  }
  function isPdfBytes(buf) {
    const b = new Uint8Array(buf, 0, Math.min(5, buf.byteLength))
    return String.fromCharCode(...b) === '%PDF-'
  }
  function toBase64(buf) {
    const bytes = new Uint8Array(buf)
    let out = ''
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    return btoa(out)
  }
  async function readPdf(url) {
    const res = await fetchSameSite(url)
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_PDF_BYTES) throw new Error('File is too large')
    if (!isPdfBytes(buf)) return { pdf: false, html: new TextDecoder().decode(buf), finalUrl: res.url || url }
    return { pdf: true, base64: toBase64(buf), finalUrl: res.url || url }
  }
  async function hashText(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  }

  // Option 1 support: the background asks this page to re-open a file the rep just downloaded.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'refetch') return false
    readPdf(msg.url)
      .then(got => sendResponse(got.pdf ? { ok: true, base64: got.base64 } : { ok: false }))
      .catch(() => sendResponse({ ok: false }))
    return true
  })

  if (!/\/semail\//i.test(location.pathname)) return

  // ---- find transcript files on the mailbox page ----
  function linkName(a) {
    return (a.textContent || a.getAttribute('title') || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
  }
  function usableHref(a, base) {
    const raw = a.getAttribute('href') || ''
    if (!raw || /^(javascript|mailto|tel):/i.test(raw) || raw.startsWith('#')) return null
    try {
      const u = new URL(raw, base)
      if (u.origin !== location.origin) return null
      if (/logout|signout|sign-out|log-out/i.test(u.pathname)) return null
      return u.href
    } catch { return null }
  }
  function pdfLinksIn(root, base) {
    const found = []
    for (const a of root.querySelectorAll('a[href]')) {
      const href = usableHref(a, base)
      if (!href) continue
      const name = linkName(a)
      if (PDF_LINK.test(href) || PDF_LINK.test(name) || /transcript/i.test(name)) found.push({ url: href, name, kind: 'file' })
    }
    return found
  }
  function scanPage() {
    const files = pdfLinksIn(document, location.href)
    const seen = new Set()
    const unique = list => list.filter(item => (seen.has(item.url) ? false : seen.add(item.url)))
    if (files.length) return unique(files)
    const messages = []
    for (const a of document.querySelectorAll('a[href]')) {
      const href = usableHref(a, location.href)
      if (href && MESSAGE_LINK.test(href) && href !== location.href) messages.push({ url: href, name: linkName(a), kind: 'message' })
    }
    return unique(messages)
  }

  // ---- panel (shadow DOM so the IRS page styles are untouched) ----
  const host = document.createElement('div')
  host.id = 'taxres-irs-helper'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `
    <style>
      .box{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:300px;font:13px/1.4 system-ui,sans-serif;
        background:#fff;color:#1f2937;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:12px}
      .title{font-weight:600;color:#1e3a8a;margin-bottom:6px}
      button{font:inherit;border-radius:6px;padding:6px 10px;cursor:pointer;border:1px solid #1e3a8a}
      .send{background:#1e3a8a;color:#fff;width:100%;margin:6px 0}
      .send[disabled]{opacity:.55;cursor:default}
      .row{display:flex;gap:6px;justify-content:space-between;align-items:center}
      .rescan,.hide{background:#fff;color:#1e3a8a}
      .status{white-space:pre-line;color:#374151;margin-top:4px;max-height:160px;overflow:auto}
    </style>
    <div class="box" role="region" aria-label="TaxRes IRS Helper">
      <div class="title">TaxRes IRS Helper</div>
      <div class="found"></div>
      <button class="send" type="button">Send transcripts to CRM</button>
      <div class="row"><button class="rescan" type="button">Rescan</button><button class="hide" type="button">Hide</button></div>
      <div class="status"></div>
    </div>`
  const $ = sel => shadow.querySelector(sel)
  const sendBtn = $('.send')
  const setStatus = text => { $('.status').textContent = text }
  let items = []
  let busy = false

  async function refresh() {
    if (busy) return
    const scanned = scanPage()
    const withState = []
    for (const item of scanned) {
      const key = await hashText(item.url)
      const answer = await ask({ type: 'was-sent', key })
      withState.push({ ...item, key, sent: !!(answer && answer.sent) })
    }
    items = withState
    const todo = items.filter(i => !i.sent)
    const files = items.filter(i => i.kind === 'file').length
    $('.found').textContent = items.length
      ? (files ? `${files} transcript file${files === 1 ? '' : 's'} on this page` : `${items.length} message${items.length === 1 ? '' : 's'} to check`) +
        (items.length - todo.length ? ` (${items.length - todo.length} already sent)` : '')
      : 'No transcript files found on this page yet. Open the message with the transcripts, or click Rescan.'
    sendBtn.textContent = todo.length ? `Send ${todo.length} transcript${todo.length === 1 ? '' : 's'} to CRM` : 'Nothing new to send'
    sendBtn.disabled = !todo.length
  }

  async function sendOne(url, name, results, already) {
    const got = already || await readPdf(url)
    if (!got.pdf) return false
    const id = (await hashText(got.finalUrl)).slice(0, 16) + '-' + Date.now()
    const fileName = /\.pdf$/i.test(name) ? name : (name ? name.replace(/[^\w .-]+/g, '').slice(0, 60) || 'irs-transcript' : 'irs-transcript') + '.pdf'
    const answer = await ask({ type: 'deliver', id, name: fileName, base64: got.base64 })
    const status = answer && answer.status ? answer.status : 'no-crm'
    results.push({ name: fileName, status, detail: (answer && answer.detail) || '' })
    return status !== 'no-crm' && status !== 'timeout' && status !== 'error'
  }

  async function sendAll() {
    if (busy) return
    const crm = await ask({ type: 'crm-status' })
    if (!crm || !crm.ready) {
      setStatus('Open the TaxRes CRM "IRS Transcripts" page in another tab (and stay signed in), then click Send again.')
      return
    }
    busy = true
    sendBtn.disabled = true
    const results = []
    const todo = items.filter(i => !i.sent)
    try {
      for (let n = 0; n < todo.length; n++) {
        const item = todo[n]
        setStatus(`Working on ${n + 1} of ${todo.length}…`)
        if (n) await sleep(PACE_MS)
        try {
          // A link can look like a file but open a message page (or the other way round), so
          // open it once and decide by what actually comes back.
          let done = false
          {
            const page = await readPdf(item.url)
            if (page.pdf) {
              done = await sendOne(item.url, item.name, results, page)
            } else {
              const doc = new DOMParser().parseFromString(page.html, 'text/html')
              const inner = pdfLinksIn(doc, page.finalUrl)
              if (!inner.length) { results.push({ name: item.name || 'message', status: 'skipped', detail: 'no transcript file in this message' }); done = true }
              let allOk = true
              for (const file of inner) {
                await sleep(PACE_MS)
                const key = await hashText(file.url)
                const already = await ask({ type: 'was-sent', key })
                if (already && already.sent) continue
                const ok = await sendOne(file.url, file.name, results)
                if (ok) await ask({ type: 'mark-sent', key })
                allOk = allOk && ok
              }
              done = done || allOk
            }
          }
          if (done) await ask({ type: 'mark-sent', key: item.key })
        } catch (err) {
          results.push({ name: item.name || 'file', status: 'error', detail: err && err.message ? err.message : 'could not open' })
        }
      }
    } finally {
      busy = false
    }
    const count = s => results.filter(r => r.status === s).length
    const lines = [
      `Done. Filed: ${count('filed')}, already in CRM: ${count('duplicate')}, needs a client: ${count('unmatched')}, problems: ${count('error') + count('no-crm') + count('timeout')}`,
      ...results.filter(r => r.status !== 'filed' && r.status !== 'duplicate').slice(0, 6).map(r => `• ${r.name}: ${r.status}${r.detail ? ' – ' + r.detail : ''}`)
    ]
    setStatus(lines.join('\n'))
    await refresh()
  }

  sendBtn.addEventListener('click', sendAll)
  $('.rescan').addEventListener('click', () => { setStatus(''); refresh() })
  $('.hide').addEventListener('click', () => host.remove())

  let timer = null
  new MutationObserver(mutations => {
    if (mutations.every(m => host.contains(m.target) || m.target === host)) return
    clearTimeout(timer)
    timer = setTimeout(refresh, 600)
  }).observe(document.documentElement, { childList: true, subtree: true })

  document.documentElement.appendChild(host)
  refresh()
})()
