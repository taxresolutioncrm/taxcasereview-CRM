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
  // What makes something an attachment: its address, or a label that names a file / attachment.
  const ATTACH_URL = /\.pdf\b|attach|download|view_?file|get_?file|file_?id|fileid|doc_?id|document_?id/i
  const ATTACH_NAME = /\.pdf\b|attachment|download|📎/i
  const FILE_FIELD = /^(file_?id|attach(ment)?_?id|doc(ument)?_?id)$/i
  const MESSAGE_LINK = /view.?mail|read.?mail|message_?id|messageid|mail_?id|msg_?id|view_?message|viewmessage|open_?message/i
  const DANGER = /delete|remove|trash|log.?out|log.?off|sign.?out|sign.?in|log.?in|logon|archive|reply|compose|forward|\bmove\b|mark.?(as|un)|unread|settings|preferences|password|cancel|withdraw|submit.?request|request.?transcript|\bauth|oauth|saml/i
  const SECRET_FIELD = /token|csrf|xsrf|nonce|session|viewstate|eventvalidation|auth/i
  // The panel only appears on mailbox / message pages — never on the TDS request pages.
  const MAILBOX_PAGE = /semail|\/sor(\/|\b)|secure.?mail|mailbox|inbox|message/i

  const ask = msg => new Promise(resolve => {
    try { chrome.runtime.sendMessage(msg, answer => { void chrome.runtime.lastError; resolve(answer || null) }) } catch { resolve(null) }
  })
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const randomCode = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''))
  let busy = false
  let captured = []

  // A file (PDF) shown in its own tab: tell the helper, and tell the exact IRS window that opened this tab
  // (window.opener) a one-time code, so the helper can pair them without guessing.
  const isFileTab = !!(document.contentType && !/html/i.test(document.contentType))
  if (isFileTab) {
    const code = randomCode()
    ask({ type: 'file-tab', code })
    try { if (window.opener) window.opener.postMessage({ source: 'taxres-irs-helper-file', code }, location.origin) } catch { /* no opener */ }
  } else {
    ask({ type: 'irs-ready' })
    // A file tab this window opened says hello: claim it (the helper only accepts it while this window is waiting).
    window.addEventListener('message', event => {
      if (event.origin !== location.origin || !event.data || event.data.source !== 'taxres-irs-helper-file') return
      if (typeof event.data.code === 'string') ask({ type: 'claim-file', code: event.data.code })
    })
  }

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
    if (DANGER.test(u.pathname + u.search)) throw new Error('Not an attachment address')
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
  // Open a target; if the IRS answers with a page that only wraps the file (one frame / embed, or an
  // immediate redirect), follow it up to two steps. Otherwise treat it as a message page and list its attachments.
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
    const safe = u => u && !DANGER.test(u.pathname + u.search) ? { url: u.href } : null
    const frames = doc.querySelectorAll('iframe[src], frame[src], embed[src], object[data]')
    if (frames.length === 1) {
      const el = frames[0]
      const hit = safe(sameSite(el.getAttribute('src') || el.getAttribute('data'), base))
      if (hit) return hit
    }
    const refresh = doc.querySelector('meta[http-equiv="refresh" i]')
    const m = refresh && /^\s*0\s*;\s*url\s*=\s*['"]?([^'";]+)/i.exec(refresh.getAttribute('content') || '')
    return m ? safe(sameSite(m[1].trim(), base)) : null
  }
  async function hashText(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  }

  // Background asks this page to re-open a file (one this page opened, or this file tab's own file).
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

  if (isFileTab) return // a PDF or other file, not a page

  // Remember what the rep clicks here (as a fingerprint, for telling which window a download came from).
  // Clicks on the helper's own panel don't count.
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

  // ---- find attachments on a page (the live page, or a message page opened in the background) ----
  function fullText(el) {
    return [el.textContent, el.getAttribute('title'), el.getAttribute('aria-label'), el.getAttribute('value'), el.getAttribute('alt')]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  }
  const shortName = el => fullText(el).slice(0, 140)
  // A plain file name: never carries ";jsessionid=…", a query or anything after "#".
  const fileNameOf = u => {
    const last = String(u.pathname || '').split('/').pop().split(/[;?#]/)[0]
    try { return decodeURIComponent(last) || 'irs-transcript.pdf' } catch { return last || 'irs-transcript.pdf' }
  }
  const addrOf = url => { const u = new URL(url); return u.pathname + u.search }
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
  // Only simple attachment forms: hidden fields + a button, an attachment address or file-id field,
  // no sign-in box, no drop-downs or typed fields, nothing that reads like delete/move/request.
  function formTarget(form, base) {
    if (form.querySelector('input[type="password" i], select, textarea')) return null
    const method = String(form.getAttribute('method') || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET'
    const u = sameSite(form.getAttribute('action') || base, base)
    if (!u || DANGER.test(u.pathname + u.search)) return null
    const pairs = []
    const keyPairs = []
    let fileField = false
    for (const el of form.querySelectorAll('input[name]')) {
      const type = String(el.getAttribute('type') || 'text').toLowerCase()
      if (['submit', 'button', 'image', 'reset'].includes(type)) continue
      if (type !== 'hidden') return null
      const name = el.getAttribute('name')
      const value = el.getAttribute('value') ?? ''
      if (DANGER.test(name) || DANGER.test(value)) return null
      if (FILE_FIELD.test(name)) fileField = true
      pairs.push([name, value])
      if (!SECRET_FIELD.test(name)) keyPairs.push(name + '=' + value)
    }
    if (!ATTACH_URL.test(u.pathname + u.search) && !fileField) return null
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
      const text = fullText(a)
      const raw = a.getAttribute('href') || ''
      const onclick = a.getAttribute('onclick') || ''
      if (DANGER.test(text) || DANGER.test(raw) || DANGER.test(onclick)) continue
      const scripted = /^javascript:/i.test(raw) || raw === '#' || raw === ''
      const url = scripted ? urlInScript(raw + ' ' + onclick, base) : (sameSite(raw, base) || {}).href
      const name = shortName(a)
      if (url && (ATTACH_URL.test(addrOf(url)) || ATTACH_NAME.test(text))) add({ kind: 'file', url, name })
      else if (!url && scripted && live && (ATTACH_NAME.test(text) || ATTACH_URL.test(onclick))) add({ kind: 'click', el: a, name, clickKey: 'click:' + name + onclick })
    }
    // 2) buttons / rows / icons that open the file from code, and data-* addresses
    for (const el of root.querySelectorAll('[onclick], [data-href], [data-url], [data-file-url]')) {
      if (el.matches('a[href], area[href]')) continue
      if (el.closest('form') && el.matches('button, input')) continue // buttons inside forms are handled with their form
      const text = fullText(el)
      const onclick = el.getAttribute('onclick') || ''
      if (DANGER.test(text) || DANGER.test(onclick)) continue
      const dataUrl = el.getAttribute('data-href') || el.getAttribute('data-url') || el.getAttribute('data-file-url')
      const url = (dataUrl && (sameSite(dataUrl, base) || {}).href) || urlInScript(onclick, base)
      const name = shortName(el)
      if (url && (ATTACH_URL.test(addrOf(url)) || ATTACH_NAME.test(text))) add({ kind: 'file', url, name })
      else if (!url && live && (ATTACH_NAME.test(text) || ATTACH_URL.test(onclick))) add({ kind: 'click', el, name, clickKey: 'click:' + name + onclick })
    }
    // 3) simple attachment forms
    for (const form of root.querySelectorAll('form')) {
      const label = [...form.querySelectorAll('button, input[type="submit" i], input[type="image" i]')].map(fullText).join(' ') || fullText(form)
      if (DANGER.test(label)) continue
      const t = formTarget(form, base)
      if (t) add({ kind: 'file', ...t, name: label.slice(0, 140) || 'attachment' })
    }
    // 4) files shown inside the page (frames / embeds)
    for (const el of root.querySelectorAll('iframe[src], frame[src], embed[src], object[data]')) {
      const u = sameSite(el.getAttribute('src') || el.getAttribute('data'), base)
      if (u && ATTACH_URL.test(u.pathname + u.search) && !DANGER.test(u.pathname + u.search)) add({ kind: 'file', url: u.href, name: fileNameOf(u) })
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
        const text = fullText(a)
        if (u && MESSAGE_LINK.test(u.pathname + u.search) && u.href !== location.href && !DANGER.test(u.pathname + u.search + ' ' + text)) add({ kind: 'message', url: u.href, name: shortName(a) })
      }
    }
    return items
  }

  const isMailboxPage = () => MAILBOX_PAGE.test(location.pathname + location.search) && !/\/esrv\/tds/i.test(location.pathname)
  if (!isMailboxPage()) return // TDS request pages and other IRS pages: no panel, never scanned or clicked

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
  let hidden = false
  const DELIVERED = s => s === 'filed' || s === 'duplicate'
  const PROBLEM = s => ['no-crm', 'timeout', 'error', 'unbound', 'unreadable'].includes(s)

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
      dest.textContent = `Sends to: ${binding.label} — that CRM tab is closed or signed in to a different office. Open Secure Mailbox again from the right CRM tab.`
    } else {
      dest.className = 'dest'
      dest.textContent = `Sends to: ${binding.label}`
    }
  }

  async function refresh() {
    if (busy || hidden) return
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
    if (!host.isConnected) document.documentElement.appendChild(host)
  }

  async function sendFile(target, name, results) {
    const got = await openFollowing(target)
    if (!got.pdf) return { html: true, items: got.items || [] }
    const id = (await hashText(got.finalUrl)).slice(0, 16) + '-' + Date.now()
    const base = String(name || '').split(/[;?#]/)[0].replace(/[^\w .()-]+/g, '').trim().slice(0, 80)
    const fileName = /\.pdf$/i.test(base) ? base : (base || 'irs-transcript') + '.pdf'
    const answer = await ask({ type: 'deliver', id, name: fileName, base64: got.base64 })
    const status = answer && answer.status ? answer.status : 'no-crm'
    results.push({ name: fileName, status, detail: (answer && answer.detail) || '' })
    // Only files the CRM actually filed (or already had) count as sent. "Needs a client" is offered again next time.
    return { ok: DELIVERED(status) }
  }

  async function clickAndCatch(item, results) {
    // The attachment only opens from the IRS page's own code: click it for the rep and catch the file it opens.
    const before = captured.length
    await ask({ type: 'catch', ms: CLICK_WAIT_MS + 1000 })
    item.el.click()
    const until = Date.now() + CLICK_WAIT_MS
    while (Date.now() < until && captured.length === before) await sleep(250)
    await ask({ type: 'catch', ms: 0 })
    if (captured.length === before) {
      results.push({ name: item.name || 'attachment', status: 'needs-click', detail: 'click it yourself — the helper sends it when it opens' })
      return false
    }
    for (const c of captured.slice(before)) results.push({ name: c.name, status: c.status, detail: c.detail })
    return captured.slice(before).every(c => DELIVERED(c.status))
  }

  async function sendAll(everything = false) {
    if (busy) return
    await refreshBinding()
    if (!binding.bound) { setStatus('Nothing sent. Open Secure Mailbox from the CRM\'s IRS Transcripts page so the helper knows which office these transcripts belong to.'); return }
    if (!binding.ready) { setStatus(`Nothing sent. Open the CRM tab for ${binding.label} (IRS Transcripts page, signed in to that office), then click Send again.`); return }
    busy = true
    sendBtn.disabled = true
    const results = []
    const todo = everything ? items.slice() : items.filter(i => !i.sent)
    let needsClick = false
    try {
      for (let n = 0; n < todo.length; n++) {
        const item = todo[n]
        setStatus(`Working on ${n + 1} of ${todo.length}…`)
        if (n) await sleep(PACE_MS)
        try {
          if (item.kind === 'click') {
            if (await clickAndCatch(item, results)) await ask({ type: 'mark-sent', key: item.sentKey })
            else if (results[results.length - 1] && results[results.length - 1].status === 'needs-click') needsClick = true
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
      // Attachments the helper couldn't open: wait up to 2 minutes for the rep to click them in this window.
      if (needsClick) await ask({ type: 'catch', ms: 2 * 60 * 1000 })
    }
    const count = s => results.filter(r => r.status === s).length
    const lines = [
      `Done. Filed: ${count('filed')}, already in CRM: ${count('duplicate')}, needs a client: ${count('unmatched')}, problems: ${results.filter(r => PROBLEM(r.status)).length}`,
      ...(needsClick ? ['Some attachments only open when you click them yourself. Click each one now in this window — the helper sends it when it opens (for the next 2 minutes).'] : []),
      ...results.filter(r => !DELIVERED(r.status)).slice(0, 6).map(r => `• ${r.name}: ${r.status}${r.detail ? ' – ' + r.detail : ''}`),
    ]
    setStatus(lines.join('\n'))
    await refresh()
  }

  sendBtn.addEventListener('click', () => sendAll(false))
  $('.again').addEventListener('click', () => sendAll(true))
  $('.rescan').addEventListener('click', () => { setStatus(''); refresh() })
  $('.hide').addEventListener('click', () => { hidden = true; host.remove() })

  let timer = null
  new MutationObserver(mutations => {
    if (mutations.every(m => host.contains(m.target) || m.target === host)) return
    clearTimeout(timer)
    timer = setTimeout(refresh, 600)
  }).observe(document.documentElement, { childList: true, subtree: true })

  refresh()
})()
