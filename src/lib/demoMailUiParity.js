// Demo mailbox copy parity.
// The legacy Email page still contains the old sandbox wording, but Demo mail
// is now delivered through the real TaxRes CRM Stalwart gateway. Keep the UI
// aligned with the real behavior without changing any non-Demo mailbox text.

const replacements = new Map([
  ['✅ Demo Mailbox', '✅ TaxRes CRM Mailbox'],
  ['Sandbox inbox ready', 'TaxRes CRM mailbox ready'],
  ['✅ Demo email sent — sandbox only', '✅ Email sent via TaxRes CRM!'],
  ['✅ Demo inbox refreshed', '✅ TaxRes CRM inbox refreshed'],
])

function rewriteText(root = document.body) {
  if (!root) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    const current = node.nodeValue || ''
    let next = current
    for (const [from, to] of replacements) next = next.replaceAll(from, to)
    if (next !== current) node.nodeValue = next
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const run = () => rewriteText(document.body)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true })
  else run()
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.parentNode) rewriteText(node.parentNode)
        else if (node.nodeType === Node.ELEMENT_NODE) rewriteText(node)
      }
    }
  })
  const start = () => document.body && observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  if (document.body) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
}
