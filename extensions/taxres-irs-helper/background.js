// TaxRes IRS Helper — background worker.
// Routes transcript PDFs from an IRS window to the ONE TaxRes CRM tab (and office) that opened that
// IRS window. It never picks "the most recent CRM tab": an IRS window that was not opened from a CRM
// tab, or whose CRM tab/office can't be found unambiguously, gets nothing delivered.
// It never reads, stores or sends IRS / ID.me passwords, cookies, tokens or session IDs. It only keeps
// tab numbers, which office each CRM tab said it belongs to, and SHA-256 hashes of files already sent.

const MAX_PDF_BYTES = 15 * 1024 * 1024
const SENT_CAP = 500
const CLICK_MATCH_MS = 2 * 60 * 1000
const RECENT_CLICK_MS = 30 * 1000

// ---- small registries in session storage (survive the worker sleeping, cleared when Chrome closes) ----
async function getReg(key) {
  const got = await chrome.storage.session.get(key)
  return got[key] || {}
}
async function setReg(key, value) { await chrome.storage.session.set({ [key]: value }) }
async function updateReg(key, fn) {
  const reg = await getReg(key)
  const out = fn(reg) || reg
  await setReg(key, out)
  return out
}
function originOf(url) { try { return new URL(url).origin } catch { return '' } }
function isIrsUrl(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'irs.gov' || u.hostname.endsWith('.irs.gov'))
  } catch { return false }
}
async function sendToTab(tabId, msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }) } catch { return null }
}

// ---- pairing an IRS window with the CRM tab that opened it ----
// The CRM adds a one-time pairing code after "#" in the IRS address it opens (#taxres-bind=…). Browsers never
// send the part after "#" to the IRS. When the helper sees that code on an IRS page, it knows exactly which
// CRM tab opened that window. Codes are single-use and expire after 2 minutes.
const BIND_RE = /[#&]taxres-bind=([A-Za-z0-9-]{16,64})/
const NONCE_TTL_MS = 2 * 60 * 1000
async function pairWithCode(irsTabId, url) {
  const m = BIND_RE.exec(url || '')
  if (!m) return
  const code = m[1]
  const nonces = await getReg('nonces')
  const hit = nonces[code]
  if (hit && Date.now() - hit.at < NONCE_TTL_MS) {
    await updateReg('nonces', reg => { delete reg[code] })
    await updateReg('openers', reg => { reg[irsTabId] = hit.crmTabId })
  } else if ((await getReg('openers'))[irsTabId] == null) {
    // The page loaded before the CRM's message arrived: hold the code briefly for the CRM to claim.
    await updateReg('seenCodes', reg => {
      for (const k of Object.keys(reg)) if (Date.now() - reg[k].at > NONCE_TTL_MS) delete reg[k]
      reg[code] = { tabId: irsTabId, at: Date.now() }
    })
  }
}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  const url = info.url || (tab && tab.url) || ''
  if (isIrsUrl(url) && BIND_RE.test(url)) pairWithCode(tabId, url)
})

// Which tab opened which (tab numbers only), for new tabs an IRS window opens itself.
chrome.tabs.onCreated.addListener(tab => {
  if (typeof tab.openerTabId !== 'number') return
  updateReg('openers', reg => { reg[tab.id] = tab.openerTabId })
})
chrome.tabs.onRemoved.addListener(tabId => {
  updateReg('crmTabs', reg => { delete reg[tabId] })
  updateReg('irsTabs', reg => { delete reg[tabId] })
  updateReg('catching', reg => { delete reg[tabId] })
  updateReg('openers', reg => { delete reg[tabId] })
})

// ---- binding: IRS window → the CRM tab + office that opened it ----
// Walk up "opened by" links until we reach a CRM tab that told us its office (crm-bind).
async function ownerOf(tabId) {
  const [openers, binds] = await Promise.all([getReg('openers'), getReg('binds')])
  let id = tabId
  for (let hops = 0; hops < 6 && typeof id === 'number'; hops++) {
    if (binds[id]) return { crmTabId: id, bind: binds[id] }
    id = openers[id]
  }
  return null
}

// The CRM tab to hand a file to: the bound tab itself if it still shows the same office, otherwise the
// single other CRM tab on the same site signed in to the same office. More than one, or none → refuse.
async function crmTabFor(owner) {
  const { crmTabId, bind } = owner
  const crmTabs = await getReg('crmTabs')
  const same = async id => {
    const info = crmTabs[id]
    if (!info || info.origin !== bind.origin) return false
    const answer = await sendToTab(Number(id), { type: 'ping' })
    return !!(answer && answer.ready && answer.tenantId === bind.tenantId)
  }
  if (await same(crmTabId)) return crmTabId
  const others = []
  for (const id of Object.keys(crmTabs)) {
    if (Number(id) !== crmTabId && await same(id)) others.push(Number(id))
  }
  return others.length === 1 ? others[0] : null
}

async function bindingFor(irsTabId) {
  const owner = await ownerOf(irsTabId)
  if (!owner) return { bound: false }
  const target = await crmTabFor(owner)
  return { bound: true, ready: target != null, label: owner.bind.label || owner.bind.origin, owner, target }
}

async function deliverFor(irsTabId, { id, name, base64 }) {
  if (typeof base64 !== 'string' || base64.length > MAX_PDF_BYTES * 1.4) return { ok: false, status: 'error', detail: 'file too large' }
  const b = await bindingFor(irsTabId)
  if (!b.bound) return { ok: false, status: 'unbound' }
  if (b.target == null) return { ok: false, status: 'no-crm', detail: b.label }
  const answer = await sendToTab(b.target, {
    type: 'transcript-pdf', id: String(id), name: String(name || 'irs-transcript.pdf'), base64,
    tenantId: b.owner.bind.tenantId, requestIds: b.owner.bind.requestIds || [],
  })
  return answer || { ok: false, status: 'no-crm', detail: b.label }
}

async function tellCrm(irsTabId, msg) {
  const b = await bindingFor(irsTabId)
  if (b.bound && b.target != null) await sendToTab(b.target, msg)
}

// ---- "already sent" memory: SHA-256 of a file's address, never the address itself (a convenience only;
// the CRM's check on the PDF bytes is what really stops duplicates) ----
async function hashText(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
async function wasSent(key) {
  const { sent = [] } = await chrome.storage.local.get('sent')
  return sent.includes(key)
}
async function markSent(key) {
  const { sent = [] } = await chrome.storage.local.get('sent')
  if (sent.includes(key)) return
  sent.push(key)
  await chrome.storage.local.set({ sent: sent.slice(-SENT_CAP) })
}
const inFlight = new Set()

// ---- messages from the helper's own content scripts ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || sender.id !== chrome.runtime.id) return false
  const tabId = sender.tab && sender.tab.id
  if (typeof tabId !== 'number') return false
  const fromCrm = !isIrsUrl(sender.url || '')
  switch (msg.type) {
    case 'crm-ready':
      if (!fromCrm) return false
      updateReg('crmTabs', reg => { reg[tabId] = { at: Date.now(), origin: sender.origin || originOf(sender.url), tenantId: msg.tenantId ? String(msg.tenantId) : null } })
      return false
    case 'crm-gone':
      if (!fromCrm) return false
      updateReg('crmTabs', reg => { delete reg[tabId] })
      return false
    case 'crm-bind': {
      if (!fromCrm || !msg.tenantId) return false
      const ids = Array.isArray(msg.requestIds) ? msg.requestIds.map(String).slice(0, 200) : []
      updateReg('binds', reg => {
        const prev = reg[tabId] && reg[tabId].tenantId === String(msg.tenantId) ? reg[tabId].requestIds : []
        reg[tabId] = { tenantId: String(msg.tenantId), label: String(msg.label || '').slice(0, 120), origin: sender.origin || originOf(sender.url), requestIds: [...new Set([...prev, ...ids])].slice(-200), at: Date.now() }
      }).then(async () => {
        const code = typeof msg.nonce === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(msg.nonce) ? msg.nonce : null
        if (!code) return
        const seen = (await getReg('seenCodes'))[code]
        if (seen && Date.now() - seen.at < NONCE_TTL_MS) {
          await updateReg('seenCodes', reg => { delete reg[code] })
          await updateReg('openers', reg => { reg[seen.tabId] = tabId })
          return
        }
        await updateReg('nonces', reg => {
          for (const k of Object.keys(reg)) if (Date.now() - reg[k].at > NONCE_TTL_MS) delete reg[k]
          reg[code] = { crmTabId: tabId, at: Date.now() }
        })
      })
      return false
    }
    case 'irs-ready':
      if (fromCrm) return false
      updateReg('irsTabs', reg => { reg[tabId] = { at: Date.now(), origin: originOf(sender.url) } })
      if (BIND_RE.test(sender.url || '')) pairWithCode(tabId, sender.url)
      return false
    case 'file-tab':
      if (fromCrm || !isIrsUrl(sender.url || '')) return false
      updateReg('irsTabs', reg => { delete reg[tabId] }).then(() => captureFileTab(tabId, sender.url))
      return false
    case 'binding':
      bindingFor(tabId).then(b => sendResponse({ bound: b.bound, ready: !!b.ready, label: b.label || '' }))
      return true
    case 'user-click':
      if (fromCrm) return false
      hashText(String(msg.url || '')).then(h => updateReg('clicks', reg => { reg[tabId] = { at: Date.now(), urlHash: msg.url ? h : '' } }))
      return false
    case 'catch':
      if (fromCrm) return false
      updateReg('catching', reg => { if (msg.ms > 0) reg[tabId] = Date.now() + Math.min(Number(msg.ms), 15 * 60 * 1000); else delete reg[tabId] })
        .then(() => sendResponse({ ok: true }))
      return true
    case 'was-sent':
      wasSent(String(msg.key || '')).then(sent => sendResponse({ sent }))
      return true
    case 'mark-sent':
      markSent(String(msg.key || '')).then(() => sendResponse({ ok: true }))
      return true
    case 'deliver':
      if (fromCrm) return false
      deliverFor(tabId, msg).then(sendResponse)
      return true
    default:
      return false
  }
})

// ---- files the IRS page opens itself (a click the helper made for the rep, or the rep's own download) ----
// The file is fetched again BY THE IRS PAGE that opened it (same site, same browser session), so the helper
// never touches cookies or tokens, and it goes only to the CRM tab bound to that IRS window.
async function capture(irsTabId, url, name, { fromDownload = false } = {}) {
  const key = await hashText(url)
  if (inFlight.has(key)) return
  inFlight.add(key)
  try {
    // No "already sent" skip here: the CRM's check on the PDF bytes decides duplicates.
    const got = await sendToTab(irsTabId, { type: 'refetch', url })
    if (!got || !got.ok) {
      if (!fromDownload) return // a new tab that turned out to be a normal page, not a file
      await tellCrm(irsTabId, { type: 'download-unreadable', name: String(name || '') })
      await sendToTab(irsTabId, { type: 'captured', status: 'unreadable', name })
      return
    }
    const answer = await deliverFor(irsTabId, { id: key.slice(0, 16) + '-' + Date.now(), name, base64: got.base64 })
    if (answer && answer.ok && answer.status !== 'error') await markSent(key)
    await sendToTab(irsTabId, { type: 'captured', status: (answer && answer.status) || 'no-crm', name, detail: (answer && answer.detail) || '' })
  } finally {
    setTimeout(() => inFlight.delete(key), 5000)
  }
}

// A new tab opened from an IRS window that is waiting for a file (helper clicked an attachment for the rep).
// Pop-up IRS windows open new tabs in a different window, where Chrome gives no "opened by" link; then the
// file is credited only if exactly one IRS window on that site is waiting for a file.
async function waitingParentOf(tabId, url) {
  const [openers, catching, irsReg] = await Promise.all([getReg('openers'), getReg('catching'), getReg('irsTabs')])
  let parent = openers[tabId]
  if (typeof parent !== 'number') {
    const origin = originOf(url)
    const waiting = Object.keys(catching).map(Number).filter(id => id !== tabId && catching[id] > Date.now() && irsReg[id] && irsReg[id].origin === origin)
    if (waiting.length !== 1) return null
    parent = waiting[0]
  }
  return catching[parent] > Date.now() ? parent : null
}
async function captureFileTab(tabId, url) {
  const parent = await waitingParentOf(tabId, url)
  if (parent == null) return
  const path = new URL(url).pathname
  await capture(parent, url, path.split('/').pop() || 'irs-transcript.pdf')
}
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab || !isIrsUrl(tab.url || '')) return
  const irsTabs = await getReg('irsTabs')
  if (irsTabs[tabId]) return // an ordinary IRS page (the helper runs there itself), not a file
  await captureFileTab(tabId, tab.url)
})

// Which IRS window a finished download came from. Downloads carry no tab number, so this uses only what
// is certain: the page where that exact link was clicked, else the single IRS window waiting for a file,
// else the single IRS window clicked in the last 30 seconds. Anything else is ambiguous → not sent.
async function downloadSourceTab(url) {
  const origin = originOf(url)
  const [irsTabs, clicks, catching] = await Promise.all([getReg('irsTabs'), getReg('clicks'), getReg('catching')])
  const now = Date.now()
  const urlHash = await hashText(url)
  const same = Object.keys(irsTabs).map(Number).filter(id => irsTabs[id].origin === origin)
  const exact = same.filter(id => clicks[id] && clicks[id].urlHash === urlHash && now - clicks[id].at < CLICK_MATCH_MS)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null
  const waiting = same.filter(id => catching[id] > now)
  if (waiting.length === 1) return waiting[0]
  if (waiting.length > 1) return null
  const recent = same.filter(id => clicks[id] && now - clicks[id].at < RECENT_CLICK_MS)
  return recent.length === 1 ? recent[0] : null
}
function looksLikePdf(item) {
  return /pdf/i.test(item.mime || '') || /\.pdf$/i.test(item.filename || '') || /\.pdf(\?|$)/i.test(item.finalUrl || item.url || '')
}
function baseName(path) {
  const parts = String(path || '').split(/[\\/]/)
  return parts[parts.length - 1] || 'irs-transcript.pdf'
}

chrome.downloads.onChanged.addListener(async delta => {
  if (!delta.state || delta.state.current !== 'complete') return
  const [item] = await chrome.downloads.search({ id: delta.id })
  if (!item) return
  const url = item.finalUrl || item.url || ''
  if (!isIrsUrl(url) || !looksLikePdf(item)) return
  const name = baseName(item.filename)
  const tabId = await downloadSourceTab(url)
  if (tabId == null) return // can't tell which IRS window → never guess an office
  const b = await bindingFor(tabId)
  if (!b.bound) { await sendToTab(tabId, { type: 'captured', status: 'unbound', name }); return }
  if (item.fileSize && item.fileSize > MAX_PDF_BYTES) { await tellCrm(tabId, { type: 'download-unreadable', name }); return }
  await capture(tabId, url, name, { fromDownload: true })
})
