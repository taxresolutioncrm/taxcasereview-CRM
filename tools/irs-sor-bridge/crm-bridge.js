(() => {
  const DELIVERY_KEY = 'taxresSorDeliveries'
  const SOURCE = 'taxres-sor-bridge-extension'

  function post(type, payload = {}) {
    window.postMessage({ source: SOURCE, type, ...payload }, window.location.origin)
  }

  async function publish() {
    post('TAXRES_SOR_BRIDGE_READY', { version: '1.1.0' })
    const current = await chrome.storage.local.get(DELIVERY_KEY)
    const deliveries = Array.isArray(current[DELIVERY_KEY]) ? current[DELIVERY_KEY] : []
    for (const delivery of deliveries) post('TAXRES_SOR_DELIVERY', { delivery })
  }

  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== window.location.origin) return
    const msg = event.data
    if (!msg || msg.source !== 'taxres-crm' || msg.type !== 'TAXRES_SOR_ACK' || !msg.bridgeId) return
    const current = await chrome.storage.local.get(DELIVERY_KEY)
    const deliveries = Array.isArray(current[DELIVERY_KEY]) ? current[DELIVERY_KEY] : []
    await chrome.storage.local.set({ [DELIVERY_KEY]: deliveries.filter(x => x.bridgeId !== msg.bridgeId) })
  })

  publish().catch(() => {})
  setInterval(() => publish().catch(() => {}), 3000)
})()
