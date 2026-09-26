(() => {
  const DELIVERY_KEY = 'taxresSorDeliveries'
  const MAX_DELIVERIES = 25

  function text(el) { return String(el?.textContent || '').replace(/\s+/g, ' ').trim() }
  function subjectText() {
    const rows = [...document.querySelectorAll('tr')]
    for (const row of rows) {
      const cells = [...row.querySelectorAll('td')]
      if (cells.length >= 2 && /^Subject$/i.test(text(cells[0]))) return text(cells[1])
    }
    return text(document.body)
  }

  function metadata(subject) {
    const txn = subject.match(/TDS\s+Transaction\s+ID\s*-\s*([A-Za-z0-9_-]+)/i)?.[1] || ''
    const tin = subject.match(/\bTIN\s*-\s*([0-9X*\-]+)/i)?.[1] || ''
    const period = subject.match(/Tax\s+Period\s*-\s*([0-9]{4,8})/i)?.[1] || ''
    const digits = tin.replace(/\D/g, '')
    return {
      transactionId: txn,
      tinLast4: digits.length >= 4 ? digits.slice(-4) : '',
      taxPeriod: period,
      taxYear: period.length >= 4 ? period.slice(0, 4) : '',
    }
  }

  function attachment() {
    const links = [...document.querySelectorAll('a[onclick]')]
    for (const link of links) {
      const code = link.getAttribute('onclick') || ''
      const m = code.match(/openWin\(['"]([^'"]*\/semail\/views\/view_file\.jsp\?[^'"]+)['"]\)/i)
      if (!m) continue
      const url = new URL(m[1], location.origin)
      if (url.searchParams.get('action') !== 'download') continue
      const cell = link.closest('td')
      const raw = text(cell)
      const fileName = raw.match(/([^\s]+\.(?:html?|pdf))\s*--/i)?.[1] || `IRS-TDS-${Date.now()}.html`
      return { url: url.toString(), fileName }
    }
    return null
  }

  async function digest(value) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
  }

  async function capture() {
    if (!/\/semail\/views\/read_content\.jsp$/i.test(location.pathname)) return
    const subject = subjectText()
    if (!/TDS\s+Transaction\s+ID/i.test(subject)) return
    const file = attachment()
    if (!file) return

    const response = await fetch(file.url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
    })
    if (!response.ok) throw new Error(`SOR attachment returned HTTP ${response.status}`)
    const contentType = (response.headers.get('content-type') || 'text/html').split(';')[0].trim()
    let content = ''
    let contentEncoding = 'utf8'
    if (/application\/pdf/i.test(contentType) || /\.pdf$/i.test(file.fileName)) {
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength < 40) throw new Error('SOR PDF attachment was empty.')
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      }
      content = btoa(binary)
      contentEncoding = 'base64'
    } else {
      content = await response.text()
      if (content.trim().length < 40) throw new Error('SOR attachment was empty.')
    }

    const meta = metadata(subject)
    const bridgeId = await digest([meta.transactionId, meta.taxPeriod, file.fileName, contentType, content].join('|'))
    const current = await chrome.storage.local.get(DELIVERY_KEY)
    const rows = Array.isArray(current[DELIVERY_KEY]) ? current[DELIVERY_KEY] : []
    if (rows.some(x => x.bridgeId === bridgeId)) return
    rows.push({
      bridgeId,
      source: 'irs-sor',
      capturedAt: new Date().toISOString(),
      subject,
      fileName: file.fileName,
      contentType,
      contentEncoding,
      content,
      ...meta,
    })
    await chrome.storage.local.set({ [DELIVERY_KEY]: rows.slice(-MAX_DELIVERIES) })
  }

  capture().catch(err => console.warn('[TaxRes SOR Bridge]', err?.message || err))
})()
