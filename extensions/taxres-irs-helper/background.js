// TaxRes IRS Helper — background worker.
// Routes transcript PDFs from IRS pages (in the rep's own browser) to an open TaxRes CRM tab.
// It never reads, stores or sends IRS / ID.me passwords, cookies, tokens or session IDs.
// It only remembers which tabs are CRM pages / IRS pages, and a hash of each file it already sent.

const MAX_PDF_BYTES = 15 * 1024 * 1024
const SENT_CAP = 500

// ---- tab registry (tab ids only, kept in session storage so it survives the worker sleeping) ----
async function getReg(key) {
  const got = await chrome.storage.session.get(key)
  return got[key] || {}
}
async function setReg(key, value) { await chrome.storage.session.set({ [key]: value }) }

async function registerTab(key, tabId, extra) {
  if (typeof tabId !== 'number') return
  const reg = await getReg(key)
  reg[tabId] = { at: Date.now(), ...(extra || {}) }
  await setReg(key, reg)
}
async function unregisterTab(key, tabId) {
  const reg = await getReg(key)
  if (reg[tabId]) { delete reg[tabId]; await setReg(key, reg) }
}

chrome.tabs.onRemoved.addListener(tabId => {
  unregisterTab('crmTabs', tabId)
  unregisterTab('irsTabs', tabId)
})

async function sendToTab(tabId, msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg) } catch { return null }
}

// Most recently active CRM tab that answers "ready".
async function findCrmTab() {
  const reg = await getReg('crmTabs')
  const ids = Object.keys(reg).map(Number).sort((a, b) => reg[b].at - reg[a].at)
  for (const id of ids) {
    const answer = await sendToTab(id, { type: 'ping' })
    if (answer && answer.ready) return id
    if (!answer) await unregisterTab('crmTabs', id)
  }
  return null
}

async function deliver({ id, name, base64 }) {
  const tabId = await findCrmTab()
  if (tabId == null) return { ok: false, status: 'no-crm' }
  const answer = await sendToTab(tabId, { type: 'transcript-pdf', id: String(id), name: String(name || 'irs-transcript.pdf'), base64 })
  return answer || { ok: false, status: 'no-crm' }
}

async function tellCrmUnreadable(name) {
  const tabId = await findCrmTab()
  if (tabId != null) await sendToTab(tabId, { type: 'download-unreadable', name: String(name || '') })
}

// ---- "already sent" memory: SHA-256 of the file's address, never the address itself ----
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

// ---- messages from the helper's own content scripts ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || sender.id !== chrome.runtime.id) return false
  const tabId = sender.tab && sender.tab.id
  switch (msg.type) {
    case 'crm-ready': registerTab('crmTabs', tabId); return false
    case 'crm-gone': unregisterTab('crmTabs', tabId); return false
    case 'irs-ready': {
      let origin = ''
      try { origin = new URL(sender.url || sender.tab.url).origin } catch { /* ignore */ }
      registerTab('irsTabs', tabId, { origin })
      return false
    }
    case 'crm-status':
      findCrmTab().then(id => sendResponse({ ready: id != null }))
      return true
    case 'was-sent':
      wasSent(String(msg.key || '')).then(sent => sendResponse({ sent }))
      return true
    case 'mark-sent':
      markSent(String(msg.key || '')).then(() => sendResponse({ ok: true }))
      return true
    case 'deliver':
      deliver(msg).then(sendResponse)
      return true
    default:
      return false
  }
})

// ---- Option 1 (fallback): the rep downloads a transcript PDF from an IRS page ----
// The file is fetched again by the IRS page itself (same site, same browser session), so the
// helper never touches cookies or tokens. If that can't be done, the CRM is told to ask for the file.
function isIrsUrl(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'irs.gov' || u.hostname.endsWith('.irs.gov'))
  } catch { return false }
}
function looksLikePdf(item) {
  return /pdf/i.test(item.mime || '') || /\.pdf$/i.test(item.filename || '') || /\.pdf(\?|$)/i.test(item.finalUrl || item.url || '')
}
function baseName(path) {
  const parts = String(path || '').split(/[\\/]/)
  return parts[parts.length - 1] || 'irs-transcript.pdf'
}

async function refetchInIrsTab(url) {
  const origin = new URL(url).origin
  const reg = await getReg('irsTabs')
  const ids = Object.keys(reg).map(Number)
    .filter(id => reg[id].origin === origin)
    .sort((a, b) => reg[b].at - reg[a].at)
  for (const id of ids) {
    const answer = await sendToTab(id, { type: 'refetch', url })
    if (answer && answer.ok) return answer
    if (!answer) await unregisterTab('irsTabs', id)
  }
  return null
}

chrome.downloads.onChanged.addListener(async delta => {
  if (!delta.state || delta.state.current !== 'complete') return
  const [item] = await chrome.downloads.search({ id: delta.id })
  if (!item) return
  const url = item.finalUrl || item.url || ''
  const fromIrs = isIrsUrl(url) || isIrsUrl(item.referrer || '')
  if (!fromIrs || !looksLikePdf(item)) return
  const name = baseName(item.filename)
  if (!isIrsUrl(url) || (item.fileSize && item.fileSize > MAX_PDF_BYTES)) { await tellCrmUnreadable(name); return }

  const key = await hashText(url)
  if (await wasSent(key)) return
  const got = await refetchInIrsTab(url)
  if (!got) { await tellCrmUnreadable(name); return }
  const answer = await deliver({ id: key.slice(0, 16) + '-' + Date.now(), name, base64: got.base64 })
  if (answer && answer.ok && answer.status !== 'error') await markSent(key)
  else if (!answer || answer.status === 'no-crm') await tellCrmUnreadable(name)
})
