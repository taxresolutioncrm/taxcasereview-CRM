// Keep Team Chat right-click menus fully visible at every roster position.
// Chat's ContextMenu is rendered with fixed coordinates from the pointer; this
// guard clamps the rendered menu back inside the viewport after React mounts it.
// Shared TaxRes family behavior: applies to rep and channel context menus.

const EDGE = 12

function isChatContextMenu(el) {
  if (!(el instanceof HTMLElement)) return false
  const s = el.style
  return s.position === 'fixed' && String(s.zIndex) === '2000' && s.minWidth === '220px'
}

function clampMenu(el) {
  if (!isChatContextMenu(el)) return

  // Restore the raw click coordinates first so repeated resize/scroll passes do
  // not compound a prior correction.
  const rawLeft = Number(el.dataset.rawMenuLeft ?? parseFloat(el.style.left) ?? 0)
  const rawTop = Number(el.dataset.rawMenuTop ?? parseFloat(el.style.top) ?? 0)
  el.dataset.rawMenuLeft = String(rawLeft)
  el.dataset.rawMenuTop = String(rawTop)

  el.style.left = `${rawLeft}px`
  el.style.top = `${rawTop}px`
  el.style.right = 'auto'
  el.style.bottom = 'auto'
  el.style.maxHeight = `calc(100vh - ${EDGE * 2}px)`
  el.style.overflowY = 'auto'
  el.style.overscrollBehavior = 'contain'

  requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect()
    const maxLeft = Math.max(EDGE, window.innerWidth - rect.width - EDGE)
    const maxTop = Math.max(EDGE, window.innerHeight - rect.height - EDGE)
    const left = Math.min(Math.max(EDGE, rawLeft), maxLeft)
    const top = Math.min(Math.max(EDGE, rawTop), maxTop)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  })
}

function clampAllMenus() {
  document.querySelectorAll('div').forEach(el => {
    if (isChatContextMenu(el)) clampMenu(el)
  })
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (isChatContextMenu(node)) clampMenu(node)
        node.querySelectorAll?.('div').forEach(el => {
          if (isChatContextMenu(el)) clampMenu(el)
        })
      }
    }
  })

  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', clampAllMenus, { passive: true })
  }

  if (document.body) start()
  else window.addEventListener('DOMContentLoaded', start, { once: true })
}
