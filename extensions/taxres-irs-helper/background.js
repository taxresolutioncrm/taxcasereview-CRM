// TaxRes IRS Helper — background worker.
// Routes transcript PDFs from an IRS window to the ONE TaxRes CRM tab (and office) that opened that IRS
// window. There is no "most recent CRM tab" and no fallback: an IRS window that was not opened from a
// CRM tab, whose CRM tab is gone, or whose CRM tab is now signed in to a different office, gets nothing
// delivered, and so does any file the helper can't tie to exactly one IRS window.
// It never reads, stores or sends IRS / ID.me passwords, cookies, tokens or session IDs. It keeps only tab
// numbers, office ids, request ids, one-time pairing codes and SHA-256 fingerprints.

const MAX_PDF_BYTES = 15 * 1024 * 1024
const SENT_CAP = 500
const CLICK_MATCH_MS = 2 * 60 * 1000
const RECENT_CLICK_MS = 30 * 1000
const NONCE_TTL_MS = 2 * 60 * 1000
const CODE_RE = /^[A-Za-z0-9-]{16,64}$/

// ---- small registries in session storage (survive the worker sleeping, cleared when Chrome closes) ----
// All writes go through one queue so two events can never overwrite each other's change.
let regChain = Promise.resolve()
async function getReg(key) {
  const got = await chrome.storage.session.get(key)
  return got[key] || {}
}
function updateReg(key, fn) {
  const job = regChain.then(async () => {
    const reg = await getReg(key)
    const out = (await fn(reg)) || reg
    await chrome.storage.session.set({ [key]: out })
    return out
  })
  regChain = job.catch(() => {})
  return job
}
function originOf(url) { try { return new URL(url).origin } catch { return '' } }
function withoutHash(url) { try { const u = new URL(url); u.hash = ''; return u.href } catch { return '' } }
function isIrsUrl(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'irs.gov' || u.hostname.endsWith('.irs.gov'))
  } catch { return false }
}
async function sendToTab(tabId, msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }) } catch { return null }
}
async function hashText(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
// A plain file name only: no path, no ";jsessionid=…", no query, no odd characters.
function cleanName(name) {
  const base = String(name || '').split(/[\\/]/).pop().split(/[;?#]/)[0].replace(/[^\w .()-]/g, '_').replace(/^[ .]+/, '').slice(0, 100)
  return base || 'irs-transcript.pdf'
}

// ---- pairing an IRS window with the CRM tab + office that opened it ----
// The CRM adds a one-time pairing code after "#" in the IRS address it opens (#taxres-bind=…). Browsers never
// send the part after "#" to the IRS. The code carries a snapshot of the office (and open requests) at the
// moment the rep opened the window, so a later sign-in to another office in that CRM tab can't redirect it.
function codeIn(url) {
  try {
    const m = /(?:^#|&)taxres-bind=([A-Za-z0-9-]{16,64})(?:&|$)/.exec(new URL(url).hash)
    return m ? m[1] : null
  } catch { return null }
}
async function pairWithCode(irsTabId, url) {
  const code = codeIn(url)
  if (!code) return
  const nonces = await getReg('nonces')
  const snap = nonces[code]
  if (snap && Date.now() - snap.at < NONCE_TTL_MS) {
    await updateReg('nonces', reg => { delete reg[code] })
    await updateReg('pairs', reg => { reg[irsTabId] = { ...snap, at: Date.now() } })
  } else {
    // The page loaded before the CRM's message arrived: hold the code briefly for the CRM to claim.
    await updateReg('seenCodes', reg => {
      for (const k of Object.keys(reg)) if (Date.now() - reg[k].at > NONCE_TTL_MS) delete reg[k]
      reg[code] = { tabId: irsTabId, at: Date.now() }
    })
  }
}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  const url = info.url || (tab && tab.url) || ''
  if (isIrsUrl(url) && codeIn(url)) pairWithCode(tabId, url)
})
// Same-window tabs an IRS window opens itself inherit its pairing ("opened by" is only known within a window).
chrome.tabs.onCreated.addListener(tab => {
  if (typeof tab.openerTabId !== 'number') return
  updateReg('openers', reg => { reg[tab.id] = tab.openerTabId })
})
chrome.tabs.onRemoved.addListener(tabId => {
  for (const key of ['crmTabs', 'irsTabs', 'catching', 'openers', 'pairs', 'clicks']) updateReg(key, reg => { delete reg[tabId] })
})

async function pairOf(tabId) {
  const [openers, pairs] = await Promise.all([getReg('openers'), getReg('pairs')])
  let id = tabId
  for (let hops = 0; hops < 6 && typeof id === 'number'; hops++) {
    if (pairs[id]) return pairs[id]
    id = openers[id]
  }
  return null
}

// The paired CRM tab, only if it is still open, on the same site, and still signed in to the same office.
async function bindingFor(irsTabId) {
  const pair = await pairOf(irsTabId)
  if (!pair) return { bound: false }
  const crmTabs = await getReg('crmTabs')
  const info = crmTabs[pair.crmTabId]
  let ready = false
  if (info && info.origin === pair.origin) {
    const answer = await sendToTab(pair.crmTabId, { type: 'ping' })
    ready = !!(answer && answer.ready && answer.tenantId === pair.tenantId)
  }
  return { bound: true, ready, label: pair.label || pair.origin, pair }
}

async function deliverFor(irsTabId, { id, name, base64 }) {
  if (typeof base64 !== 'string' || base64.length > MAX_PDF_BYTES * 1.4) return { ok: false, status: 'error', detail: 'file too large' }
  const b = await bindingFor(irsTabId)
  if (!b.bound) return { ok: false, status: 'unbound' }
  if (!b.ready) return { ok: false, status: 'no-crm', detail: b.label }
  const answer = await sendToTab(b.pair.crmTabId, {
    type: 'transcript-pdf', id: String(id), name: cleanName(name), base64,
    tenantId: b.pair.tenantId, requestIds: b.pair.requestIds || [],
  })
  return answer || { ok: false, status: 'no-crm', detail: b.label }
}

async function tellCrm(irsTabId, msg) {
  const b = await bindingFor(irsTabId)
  if (b.bound && b.ready) await sendToTab(b.pair.crmTabId, msg)
}

// ---- "already sent" memory: SHA-256 of a file's address, never the address itself. Only so the button
// doesn't offer the same files twice — the CRM's check on the PDF bytes decides duplicates. ----
async function wasSent(key) {
  const { sent = [] } = await chrome.storage.local.get('sent')
  return sent.includes(key)
}
let sentChain = Promise.resolve()
function markSent(key) {
  const job = sentChain.then(async () => {
    const { sent = [] } = await chrome.storage.local.get('sent')
    if (sent.includes(key)) return
    sent.push(key)
    await chrome.storage.local.set({ sent: sent.slice(-SENT_CAP) })
  })
  sentChain = job.catch(() => {})
  return job
}
const inFlight = new Set()

// ---- messages from the helper's own content scripts ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || sender.id !== chrome.runtime.id) return false
  const tabId = sender.tab && sender.tab.id
  if (typeof tabId !== 'number' || sender.frameId !== 0) return false
  const fromIrs = isIrsUrl(sender.url || '')
  switch (msg.type) {
    case 'crm-ready':
      if (fromIrs) return false
      updateReg('crmTabs', reg => { reg[tabId] = { at: Date.now(), origin: sender.origin || originOf(sender.url), tenantId: msg.tenantId ? String(msg.tenantId) : null } })
      return false
    case 'crm-gone':
      if (fromIrs) return false
      updateReg('crmTabs', reg => { delete reg[tabId] })
      return false
    case 'crm-bind': {
      if (fromIrs || !msg.tenantId || typeof msg.nonce !== 'string' || !CODE_RE.test(msg.nonce)) return false
      const snap = {
        crmTabId: tabId, tenantId: String(msg.tenantId), origin: sender.origin || originOf(sender.url),
        label: String(msg.label || '').slice(0, 120),
        requestIds: Array.isArray(msg.requestIds) ? [...new Set(msg.requestIds.map(String))].slice(0, 200) : [],
        at: Date.now(),
      }
      ;(async () => {
        const seen = (await getReg('seenCodes'))[msg.nonce]
        if (seen && Date.now() - seen.at < NONCE_TTL_MS) {
          await updateReg('seenCodes', reg => { delete reg[msg.nonce] })
          await updateReg('pairs', reg => { reg[seen.tabId] = snap })
          return
        }
        await updateReg('nonces', reg => {
          for (const k of Object.keys(reg)) if (Date.now() - reg[k].at > NONCE_TTL_MS) delete reg[k]
          reg[msg.nonce] = snap
        })
      })()
      return false
    }
    case 'irs-ready':
      if (!fromIrs) return false
      // A new page loaded in this window: it is no longer waiting for a file.
      updateReg('catching', reg => { delete reg[tabId] })
      hashText(withoutHash(sender.url || '')).then(pageHash => updateReg('irsTabs', reg => { reg[tabId] = { at: Date.now(), origin: originOf(sender.url), pageHash } }))
      if (codeIn(sender.url || '')) pairWithCode(tabId, sender.url)
      return false
    case 'file-tab':
      // A PDF opened in a tab. It counts only if it identified the exact IRS window that opened it (claim-file)
      // or it replaced the page of an IRS window that was waiting for this click.
      if (!fromIrs) return false
      onFileTab(tabId, sender.url, typeof msg.code === 'string' && CODE_RE.test(msg.code) ? msg.code : null)
      return false
    case 'claim-file':
      if (!fromIrs || typeof msg.code !== 'string' || !CODE_RE.test(msg.code)) return false
      onClaimFile(tabId, msg.code)
      return false
    case 'binding':
      if (!fromIrs) return false
      bindingFor(tabId).then(b => sendResponse({ bound: b.bound, ready: !!b.ready, label: b.label || '' }))
      return true
    case 'user-click':
      if (!fromIrs) return false
      hashText(String(msg.url || '')).then(h => updateReg('clicks', reg => { reg[tabId] = { at: Date.now(), urlHash: msg.url ? h : '' } }))
      return false
    case 'catch':
      if (!fromIrs) return false
      updateReg('catching', reg => { if (msg.ms > 0) reg[tabId] = Date.now() + Math.min(Number(msg.ms), 2 * 60 * 1000); else delete reg[tabId] })
        .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }))
      return true
    case 'was-sent':
      wasSent(String(msg.key || '')).then(sent => sendResponse({ sent }))
      return true
    case 'mark-sent':
      markSent(String(msg.key || '')).then(() => sendResponse({ ok: true }))
      return true
    case 'deliver':
      if (!fromIrs) return false
      deliverFor(tabId, msg).then(sendResponse)
      return true
    default:
      return false
  }
})

// ---- files the IRS page opens itself (a click the helper made for the rep, or the rep's own download) ----
// The file is fetched again BY THE IRS PAGE it came from (same site, same browser session), so the helper
// never touches cookies or tokens, and it goes only to the CRM tab paired with that IRS window.
async function capture(irsTabId, url, name, { fromDownload = false, fetchTab = irsTabId } = {}) {
  const key = await hashText(url)
  if (inFlight.has(key)) return
  inFlight.add(key)
  try {
    const got = await sendToTab(fetchTab, { type: 'refetch', url })
    if (!got || !got.ok) {
      if (!fromDownload) return
      await tellCrm(irsTabId, { type: 'download-unreadable', name: cleanName(name) })
      await sendToTab(irsTabId, { type: 'captured', status: 'unreadable', name: cleanName(name) })
      return
    }
    const answer = await deliverFor(irsTabId, { id: key.slice(0, 16) + '-' + Date.now(), name, base64: got.base64 })
    if (answer && answer.ok && (answer.status === 'filed' || answer.status === 'duplicate')) await markSent(key)
    await sendToTab(irsTabId, { type: 'captured', status: (answer && answer.status) || 'no-crm', name: cleanName(name), detail: (answer && answer.detail) || '' })
  } finally {
    setTimeout(() => inFlight.delete(key), 5000)
  }
}

// File tabs and the IRS windows that claim them are matched by a one-time code the file tab posts to the exact
// window that opened it (window.opener). Both halves are recorded in ONE queued update, so they always meet.
// Only tab numbers are kept — the file's address is read from the tab when it is captured, never stored.
async function meetFileCode(code, half) {
  let match = null
  await updateReg('fileCodes', reg => {
    for (const k of Object.keys(reg)) if (Date.now() - reg[k].at > NONCE_TTL_MS) delete reg[k]
    const cur = { ...(reg[code] || {}), ...half, at: Date.now() }
    if (typeof cur.fileTab === 'number' && typeof cur.irsTab === 'number') { match = cur; delete reg[code] } else reg[code] = cur
  })
  if (!match) return
  let url = ''
  try { url = (await chrome.tabs.get(match.fileTab)).url || '' } catch { return }
  if (!isIrsUrl(url)) return
  await capture(match.irsTab, url, new URL(url).pathname, { fetchTab: match.fileTab })
}
async function onFileTab(tabId, url, code) {
  await updateReg('irsTabs', reg => { delete reg[tabId] })
  const catching = await getReg('catching')
  if (catching[tabId] > Date.now()) {
    // The waiting IRS window itself navigated to the file.
    await updateReg('catching', reg => { delete reg[tabId] })
    return capture(tabId, url, new URL(url).pathname)
  }
  if (code) await meetFileCode(code, { fileTab: tabId })
}
async function onClaimFile(irsTabId, code) {
  const catching = await getReg('catching')
  if (!(catching[irsTabId] > Date.now())) return // only while this window is waiting for a file it clicked
  await meetFileCode(code, { irsTab: irsTabId })
}

// Which IRS window a finished download came from. Downloads carry no tab number, so only certain evidence counts:
//  1) exactly one IRS window where that exact file link was clicked (last 2 minutes), else
//  2) exactly one IRS window on the whole site that was clicked in the last 30 seconds or is waiting for a
//     file it clicked — and, when Chrome reports the page the download came from, that window is on that page.
// Anything else is ambiguous → nothing is sent.
async function downloadSourceTab(item) {
  const urls = [...new Set([item.url, item.finalUrl].filter(Boolean))]
  const origin = originOf(item.finalUrl || item.url)
  const [irsTabs, clicks, catching] = await Promise.all([getReg('irsTabs'), getReg('clicks'), getReg('catching')])
  const now = Date.now()
  const hashes = await Promise.all(urls.map(hashText))
  const same = Object.keys(irsTabs).map(Number).filter(id => irsTabs[id].origin === origin)
  const exact = same.filter(id => clicks[id] && clicks[id].urlHash && hashes.includes(clicks[id].urlHash) && now - clicks[id].at < CLICK_MATCH_MS)
  if (exact.length) return exact.length === 1 ? exact[0] : null
  const active = same.filter(id => (clicks[id] && now - clicks[id].at < RECENT_CLICK_MS) || catching[id] > now)
  if (active.length !== 1) return null
  if (item.referrer && isIrsUrl(item.referrer)) {
    const refHash = await hashText(withoutHash(item.referrer))
    if (irsTabs[active[0]].pageHash !== refHash) return null
  }
  return active[0]
}
function looksLikePdf(item) {
  return /pdf/i.test(item.mime || '') || /\.pdf$/i.test(item.filename || '') || /\.pdf(\?|$)/i.test(item.finalUrl || item.url || '')
}

chrome.downloads.onChanged.addListener(async delta => {
  if (!delta.state || delta.state.current !== 'complete') return
  const [item] = await chrome.downloads.search({ id: delta.id })
  if (!item) return
  const url = item.finalUrl || item.url || ''
  if (!isIrsUrl(url) || !looksLikePdf(item)) return
  const name = cleanName(item.filename)
  const tabId = await downloadSourceTab(item)
  if (tabId == null) return // can't tell which IRS window → never guess an office
  const b = await bindingFor(tabId)
  if (!b.bound) { await sendToTab(tabId, { type: 'captured', status: 'unbound', name }); return }
  if (item.fileSize && item.fileSize > MAX_PDF_BYTES) { await tellCrm(tabId, { type: 'download-unreadable', name }); return }
  await capture(tabId, url, name, { fromDownload: true })
})
