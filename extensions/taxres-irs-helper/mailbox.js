// TaxRes IRS Helper — IRS page script.
// On an IRS Secure Mailbox page it shows a small "Send N transcripts to CRM" panel. It does nothing until
// the rep clicks, then opens the transcript files one at a time, like the rep would. Files are opened by
// this IRS page itself, inside the rep's own browser session, and go only to the CRM tab/office that
// opened this IRS window. This script never reads or sends passwords, cookies, tokens or session IDs,
// never fills or submits a sign-in form, and never clicks anything that isn't an attachment.
(() => {
  if (window.top !== window) return
  const MAX_PDF_BYTES = 15 * 1024 * 1024
  const PACE_MS = 1500
  const CLICK_WAIT_MS = 9000
  const ATTACHMENT = /\.pdf\b|attach|download|view_?file|get_?file|file_?id|fileid|doc_?id|transcript|\bpdf\b/i
  const MESSAGE_LINK = /view.?mail|read.?mail|message_?id|messageid|mail_?id|msg_?id|view_?message|viewmessage|open_?message/i
  const DANGER = /delete|remove|trash|log.?out|log.?off|sign.?out|archive|reply|compose|forward|\bmove\b|mark.?(as|un)|unread|settings|preferences|password|cancel|withdraw/i
  const SECRET_FIELD = /token|csrf|xsrf|nonce|session|viewstate|eventvalidation|auth/i
  const MAILBOX_PAGE = /semail|\/sor\b|\/sor\/|secure.?mail|mailbox|inbox|message|mail/i

  const ask = msg => new Promise(resolve => {
    try { chrome.runtime.sendMessage(msg, answer => { void chrome.runtime.lastError; resolve(answer || null) }) } catch { resolve(null) }
  })
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  let busy = false
  let captured = []

  // A file (PDF) shown in its own tab: tell the helper, which decides whether an IRS window is waiting for it.
  const isFileTab = !!(document.contentType && !/html/i.test(document.contentType))
  if (isFileTab) { ask({ type: 'file-tab' }) } else ask({ type: 'irs-ready' })

  // ---- read a file the same way the page would open it (same IRS site, the rep's own session) ----
  function sameSite(url, base) {
    try {
      const u = new URL(url, base || location.href)
      return u.protocol === 'https:' && u.origin === location.origin ? u : null
    } catch { return null }
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
  async function open(target) {
    const u = sameSite(target.url)
    if (!u) throw new Error('Not on this IRS site')
    const init = { credentials: 'same-origin', redirect: 'follow' }
    if (target.method === 'POST') {
      init.method = 'POST'
      init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
      init.body = target.body || ''
    }
    const res = await fetch(u.href, init)
    if (!res.ok) throw new Error('IRS returned ' + res.status)
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_PDF_BYTES) throw new Error('File is too large')
    const finalUrl = res.url || u.href
    if (isPdfBytes(buf)) return { pdf: true, base64: toBase64(buf), finalUrl }
    return { pdf: false, html: new TextDecoder().decode(buf), finalUrl }
  }
  // Open a target; if the IRS answers with a page that wraps the file (frame, embed, redirect, one link),
  // follow it up to two steps. Returns { pdf } or { page, items } for a message page with attachments.
  async function openFollowing(target, depth = 0) {
    const got = await open(target)
    if (got.pdf || depth >= 2) return got
    const doc = new DOMParser().parseFromString(got.html, 'text/html')
    const wrapped = wrapperTarget(doc, got.finalUrl)
    if (wrapped) {
      const inner = await openFollowing(wrapped, depth + 1)
      if (inner.pdf) return inner
    }
    return { pdf: false, items: findItems(doc, got.finalUrl, false).filter(i => i.kind !== 'click' && i.kind !== 'message') }
  }
  function wrapperTarget(doc, base) {
    for (const el of doc.querySelectorAll('iframe[src], frame[src], embed[src], object[data]')) {
      const u = sameSite(el.getAttribute('src') || el.getAttribute('data'), base)
      if (u) return { url: u.href }
    }
    const refresh = doc.querySelector('meta[http-equiv="refresh" i]')
    const m = refresh && /url\s*=\s*['"]?([^'";]+)/i.exec(refresh.getAttribute('content') || '')
    const u = m && sameSite(m[1].trim(), base)
    return u ? { url: u.href } : null
  }
  async function hashText(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  }

  // Background asks this page to re-open a file the page itself opened (a download or a new tab).
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false
    if (msg.type === 'refetch') {
      open({ url: msg.url })
        .then(got => sendResponse(got.pdf ? { ok: true, base64: got.base64 } : { ok: false }))
        .catch(() => sendResponse({ ok: false }))
      return true
    }
    if (msg.type === 'captured') { try { onCaptured(msg) } catch { /* not a mailbox page */ } return false }
    return false
  })

  // Remember what the rep clicks here (address only, for telling which window a download came from).
  // (Clicks on the helper's own panel don't count.)
  document.addEventListener('click', event => {
    if (!event.isTrusted) return
    const t = event.target
    if (!t || !t.closest || t.id === 'taxres-irs-helper') return
    const a = t.closest('a[href], area[href]')
    let u = a ? sameSite(a.getAttribute('href')) : null
    const submit = !a && t.closest('button, input[type="submit" i], input[type="image" i]')
    const form = submit && submit.form
    if (form && !form.querySelector('input[type="password" i]')) u = sameSite(submit.getAttribute('formaction') || form.getAttribute('action') || location.href)
    ask({ type: 'user-click', url: u ? u.href : '' })
  }, true)

  if (isFileTab) return // a PDF or other file, not a page

  // ---- find attachments on a page (the live page, or a message page opened in the background) ----
  function textOf(el) {
    return [el.textContent, el.getAttribute('title'), el.getAttribute('aria-label'), el.getAttribute('value'), el.getAttribute('alt')]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 140)
  }
  function urlInScript(code, base) {
    // A same-site address written into an onclick / javascript: link, e.g. window.open('/semail/view_file.jsp?id=1').
    const re = /['"]((?:https:\/\/[^'"\s]+|\/[^'"\s]*|[\w.-]+\.(?:jsp|do|pdf|aspx?|action)\b[^'"\s]*))['"]/gi
    let m
    while ((m = re.exec(code || ''))) {
      const u = sameSite(m[1], base)
      if (u && !DANGER.test(u.pathname + u.search)) return u.href
    }
    return null
  }
  function formTarget(form, base) {
    if (form.querySelector('input[type="password" i]')) return null // never touch a sign-in form
    const method = String(form.getAttribute('method') || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET'
    const u = sameSite(form.getAttribute('action') || base, base)
    if (!u) return null
    const pairs = []
    const keyPairs = []
    for (const el of form.querySelectorAll('input[name], select[name], textarea[name]')) {
      const type = String(el.getAttribute('type') || '').toLowerCase()
      if (['submit', 'button', 'image', 'reset', 'file', 'password'].includes(type)) continue
      if ((type === 'checkbox' || type === 'radio') && !el.hasAttribute('checked')) continue
      const name = el.getAttribute('name')
      const value = el.tagName === 'SELECT' ? (el.querySelector('option[selected]') || el.querySelector('option') || { value: '' }).value
        : el.tagName === 'TEXTAREA' ? el.textContent : (el.value ?? el.getAttribute('value') ?? '')
      pairs.push([name, value])
      if (!SECRET_FIELD.test(name)) keyPairs.push(name + '=' + value)
    }
    const body = new URLSearchParams(pairs).toString()
    if (method === 'GET') { u.search = body; return { url: u.href, method, key: u.href } }
    return { url: u.href, method, body, key: 'POST ' + u.origin + u.pathname + '?' + keyPairs.sort().join('&') }
  }
  function findItems(root, base, live) {
    const items = []
    const seen = new Set()
    const add = item => { const k = item.key || item.url || item.clickKey; if (k && !seen.has(k)) { seen.add(k); items.push(item) } }
    // 1) links (including javascript: links that carry an address in their code)
    for (const a of root.querySelectorAll('a[href], area[href]')) {
      const name = textOf(a)
      const raw = a.getAttribute('href') || ''
      const onclick = a.getAttribute('onclick') || ''
      if (DANGER.test(name) || DANGER.test(raw) || DANGER.test(onclick)) continue
      const scripted = /^javascript:/i.test(raw) || raw === '#' || raw === ''
      const url = scripted ? urlInScript(raw + ' ' + onclick, base) : (sameSite(raw, base) || {}).href
      if (url && (ATTACHMENT.test(url) || ATTACHMENT.test(name))) add({ kind: 'file', url, name })
      else if (!url && scripted && live && ATTACHMENT.test(name + ' ' + onclick)) add({ kind: 'click', el: a, name, clickKey: 'click:' + name + onclick })
    }
    // 2) buttons / rows / icons that open the file from code, and data-* addresses
    for (const el of root.querySelectorAll('[onclick], [data-href], [data-url], [data-file-url]')) {
      if (el.matches('a[href], area[href]')) continue
      const name = textOf(el)
      const onclick = el.getAttribute('onclick') || ''
      if (DANGER.test(name) || DANGER.test(onclick)) continue
      if (el.closest('form') && el.matches('button, input')) continue // handled with its form below
      const dataUrl = el.getAttribute('data-href') || el.getAttribute('data-url') || el.getAttribute('data-file-url')
      const url = (dataUrl && (sameSite(dataUrl, base) || {}).href) || urlInScript(onclick, base)
      if (url && (ATTACHMENT.test(url) || ATTACHMENT.test(name))) add({ kind: 'file', url, name })
      else if (!url && live && ATTACHMENT.test(name + ' ' + onclick)) add({ kind: 'click', el, name, clickKey: 'click:' + name + onclick })
    }
    // 3) forms whose button / address says it opens a file (never sign-in forms)
    for (const form of root.querySelectorAll('form')) {
      const buttons = [...form.querySelectorAll('button, input[type="submit" i], input[type="image" i]')].map(textOf).join(' ')
      const names = [...form.querySelectorAll('[name]')].map(el => el.getAttribute('name')).join(' ')
      const label = buttons || textOf(form)
      if (DANGER.test(buttons) || DANGER.test(form.getAttribute('action') || '')) continue
      if (!ATTACHMENT.test(`${form.getAttribute('action') || ''} ${label} ${names}`)) continue
      const t = formTarget(form, base)
      if (t) add({ kind: 'file', ...t, name: label || 'attachment' })
    }
    // 4) files shown inside the page (frames / embeds)
    for (const el of root.querySelectorAll('iframe[src], frame[src], embed[src], object[data]')) {
      const u = sameSite(el.getAttribute('src') || el.getAttribute('data'), base)
      if (u && ATTACHMENT.test(u.href) && !DANGER.test(u.href)) add({ kind: 'file', url: u.href, name: u.pathname.split('/').pop() })
    }
    if (live) {
      for (const frame of root.querySelectorAll('iframe, frame')) {
        let doc = null
        try { doc = frame.contentDocument } catch { doc = null }
        if (doc && doc.documentElement) for (const item of findItems(doc, doc.baseURI || base, true)) add(item)
      }
    }
    // 5) nothing attached here: the messages that may hold the transcripts
    if (!items.length) {
      for (const a of root.querySelectorAll('a[href]')) {
        const u = sameSite(a.getAttribute('href'), base)
        const name = textOf(a)
        if (u && MESSAGE_LINK.test(u.href) && u.href !== location.href && !DANGER.test(u.href + ' ' + name)) add({ kind: 'message', url: u.href, name })
      }
    }
    return items
  }

  const isMailboxPage = () => MAILBOX_PAGE.test(location.pathname + location.search)

  // ---- panel (shadow DOM so the IRS page styles are untouched) ----
  const host = document.createElement('div')
  host.id = 'taxres-irs-helper'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `
    <style>
      .box{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:310px;font:13px/1.4 system-ui,sans-serif;
        background:#fff;color:#1f2937;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:12px}
      .title{font-weight:600;color:#1e3a8a;margin-bottom:4px}
      .dest{font-size:12px;color:#374151;margin-bottom:6px}
      .dest.warn{color:#b45309}
      button{font:inherit;border-radius:6px;padding:6px 10px;cursor:pointer;border:1px solid #1e3a8a}
      .send{background:#1e3a8a;color:#fff;width:100%;margin:6px 0}
      .send[disabled]{opacity:.55;cursor:default}
      .row{display:flex;gap:6px;justify-content:space-between;align-items:center}
      .rescan,.again,.hide{background:#fff;color:#1e3a8a}
      .status{white-space:pre-line;color:#374151;margin-top:4px;max-height:170px;overflow:auto}
    </style>
    <div class="box" role="region" aria-label="TaxRes IRS Helper">
      <div class="title">TaxRes IRS Helper</div>
      <div class="dest"></div>
      <div class="found"></div>
      <button class="send" type="button">Send transcripts to CRM</button>
      <div class="row"><button class="rescan" type="button">Rescan</button><button class="again" type="button">Send all again</button><button class="hide" type="button">Hide</button></div>
      <div class="status"></div>
    </div>`
  const $ = sel => shadow.querySelector(sel)
  const sendBtn = $('.send')
  const setStatus = text => { $('.status').textContent = text }
  let items = []
  let binding = { bound: false }

  function onCaptured(msg) {
    captured.push({ name: String(msg.name || 'file'), status: String(msg.status || ''), detail: String(msg.detail || '') })
    if (!busy) {
      const s = msg.status === 'unbound' ? `${msg.name} was downloaded, but this IRS window wasn't opened from the TaxRes CRM, so it was not sent.`
        : `${msg.name}: ${msg.status}${msg.detail ? ' – ' + msg.detail : ''}`
      setStatus(s)
    }
  }

  async function refreshBinding() {
    binding = (await ask({ type: 'binding' })) || { bound: false }
    const dest = $('.dest')
    if (!binding.bound) {
      dest.className = 'dest warn'
      dest.textContent = 'Not linked to a CRM. This IRS window wasn\'t opened from the TaxRes CRM, so the helper won\'t send anything from it. In the CRM, open IRS Transcripts and click "Secure Mailbox".'
    } else if (!binding.ready) {
      dest.className = 'dest warn'
      dest.textContent = `Sends to: ${binding.label} — that CRM tab isn't open right now.`
    } else {
      dest.className = 'dest'
      dest.textContent = `Sends to: ${binding.label}`
    }
  }

  async function refresh() {
    if (busy) return
    await refreshBinding()
    const scanned = findItems(document, location.href, true)
    const withState = []
    for (const item of scanned) {
      const key = await hashText(item.key || item.url || item.clickKey)
      const answer = await ask({ type: 'was-sent', key })
      withState.push({ ...item, sentKey: key, sent: !!(answer && answer.sent) })
    }
    items = withState
    const todo = items.filter(i => !i.sent)
    const files = items.filter(i => i.kind !== 'message').length
    $('.found').textContent = items.length
      ? (files ? `${files} transcript file${files === 1 ? '' : 's'} on this page` : `${items.length} message${items.length === 1 ? '' : 's'} to check`) +
        (items.length - todo.length ? ` (${items.length - todo.length} already sent)` : '')
      : 'No transcript files found on this page yet. Open the message with the transcripts, or click Rescan.'
    sendBtn.textContent = todo.length ? `Send ${todo.length} transcript${todo.length === 1 ? '' : 's'} to CRM` : 'Nothing new to send'
    sendBtn.disabled = !todo.length || !binding.bound
    $('.again').disabled = !items.length || !binding.bound
    if (items.length || isMailboxPage()) { if (!host.isConnected) document.documentElement.appendChild(host) }
  }

  async function sendFile(target, name, results) {
    const got = await openFollowing(target)
    if (!got.pdf) return { html: true, items: got.items || [] }
    const id = (await hashText(got.finalUrl)).slice(0, 16) + '-' + Date.now()
    const fileName = /\.pdf$/i.test(name) ? name : (name ? name.replace(/[^\w .-]+/g, '').slice(0, 60) || 'irs-transcript' : 'irs-transcript') + '.pdf'
    const answer = await ask({ type: 'deliver', id, name: fileName, base64: got.base64 })
    const status = answer && answer.status ? answer.status : 'no-crm'
    results.push({ name: fileName, status, detail: (answer && answer.detail) || '' })
    return { ok: !['no-crm', 'timeout', 'error', 'unbound'].includes(status) }
  }

  async function clickAndCatch(item, results) {
    // The attachment only opens from the IRS page's own code: click it for the rep and catch the file it opens.
    const before = captured.length
    item.el.click()
    const until = Date.now() + CLICK_WAIT_MS
    while (Date.now() < until && captured.length === before) await sleep(250)
    if (captured.length === before) {
      results.push({ name: item.name || 'attachment', status: 'needs-click', detail: 'click it yourself — the helper sends it when it opens' })
      return false
    }
    for (const c of captured.slice(before)) results.push({ name: c.name, status: c.status, detail: c.detail })
    return captured.slice(before).some(c => !['no-crm', 'timeout', 'error', 'unbound', 'unreadable'].includes(c.status))
  }

  async function sendAll(everything = false) {
    if (busy) return
    await refreshBinding()
    if (!binding.bound) { setStatus('Nothing sent. Open Secure Mailbox from the CRM\'s IRS Transcripts page so the helper knows which office these transcripts belong to.'); return }
    if (!binding.ready) { setStatus(`Nothing sent. Open the CRM tab for ${binding.label} (IRS Transcripts page, signed in), then click Send again.`); return }
    busy = true
    sendBtn.disabled = true
    const results = []
    const todo = everything ? items.slice() : items.filter(i => !i.sent)
    let needsClick = false
    await ask({ type: 'catch', ms: (todo.length + 2) * (PACE_MS + CLICK_WAIT_MS) })
    try {
      for (let n = 0; n < todo.length; n++) {
        const item = todo[n]
        setStatus(`Working on ${n + 1} of ${todo.length}…`)
        if (n) await sleep(PACE_MS)
        try {
          if (item.kind === 'click') {
            if (await clickAndCatch(item, results)) await ask({ type: 'mark-sent', key: item.sentKey })
            else needsClick = true
            continue
          }
          const first = await sendFile(item, item.name, results)
          let done = !!first.ok
          if (first.html) {
            // A message page: send the attachments inside it.
            if (!first.items.length) { results.push({ name: item.name || 'message', status: 'skipped', detail: 'no transcript file found in this message — open it and click Send there' }); continue }
            let allOk = true
            for (const inner of first.items) {
              await sleep(PACE_MS)
              const key = await hashText(inner.key || inner.url)
              const already = await ask({ type: 'was-sent', key })
              if (!everything && already && already.sent) continue
              const out = await sendFile(inner, inner.name, results)
              if (out.ok) await ask({ type: 'mark-sent', key })
              allOk = allOk && !!out.ok
            }
            done = allOk
          }
          if (done) await ask({ type: 'mark-sent', key: item.sentKey })
        } catch (err) {
          results.push({ name: item.name || 'file', status: 'error', detail: err && err.message ? err.message : 'could not open' })
        }
      }
    } finally {
      busy = false
      await ask({ type: 'catch', ms: needsClick ? 2 * 60 * 1000 : 0 })
    }
    const count = s => results.filter(r => r.status === s).length
    const lines = [
      `Done. Filed: ${count('filed')}, already in CRM: ${count('duplicate')}, needs a client: ${count('unmatched')}, problems: ${count('error') + count('no-crm') + count('timeout') + count('unbound') + count('unreadable')}`,
      ...(needsClick ? ['Some attachments only open when you click them yourself. Click each one now — the helper sends it when it opens (for the next 2 minutes).'] : []),
      ...results.filter(r => r.status !== 'filed' && r.status !== 'duplicate').slice(0, 6).map(r => `• ${r.name}: ${r.status}${r.detail ? ' – ' + r.detail : ''}`),
    ]
    setStatus(lines.join('\n'))
    await refresh()
  }

  sendBtn.addEventListener('click', () => sendAll(false))
  $('.again').addEventListener('click', () => sendAll(true))
  $('.rescan').addEventListener('click', () => { setStatus(''); refresh() })
  $('.hide').addEventListener('click', () => host.remove())

  let timer = null
  new MutationObserver(mutations => {
    if (mutations.every(m => host.contains(m.target) || m.target === host)) return
    clearTimeout(timer)
    timer = setTimeout(refresh, 600)
  }).observe(document.documentElement, { childList: true, subtree: true })

  refresh()
})()
