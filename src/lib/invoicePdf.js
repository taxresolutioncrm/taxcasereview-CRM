// ─── Invoice PDF generator ────────────────────────────────────────────────
// Builds a single-page, branded PDF for an invoice using pdf-lib (already
// a project dependency — no extra library needed). Used to attach a real
// invoice file to the "email invoice" action instead of just plain text.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const TCR_TENANT = '61a89aef-0e7e-4ea2-b222-44ab2024655a'
const FALLBACK_ADDRESS = '631 US Highway One Ste 304, North Palm Beach, FL 33408'

function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (line && font.widthOfTextAtSize(test, size) > maxWidth) {
      lines.push(line)
      line = w
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

const money = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

// firm: { name, tagline, address, logoUrl, footer } — pass the values from useFirm()
export async function generateInvoicePdfBase64(inv, firm = {}) {
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([612, 792]) // US Letter, points
  const { width, height } = page.getSize()

  const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const blue = rgb(0x1A / 255, 0x7F / 255, 0xD4 / 255)
  const dark = rgb(0.07, 0.09, 0.13)
  const gray = rgb(0.39, 0.45, 0.55)
  const lightLine = rgb(0.9, 0.92, 0.95)

  const marginX = 50
  let y = height - 56

  const isTcr = !firm.tenantId || firm.tenantId === TCR_TENANT
  const name    = firm.name || (isTcr ? 'Tax Case Review' : 'Tax Resolution Office')
  const tagline = firm.tagline || (isTcr ? 'IRS Resolution Services' : '')
  const address = firm.address || (isTcr ? FALLBACK_ADDRESS : '')

  // Try to embed the firm's real logo. If it can't be fetched/decoded for
  // any reason, fall back to a plain text header — never block the PDF.
  let logoImg = null, logoW = 0, logoH = 0
  if (firm.logoUrl) {
    try {
      const res = await fetch(firm.logoUrl)
      const bytes = await res.arrayBuffer()
      try { logoImg = await pdfDoc.embedPng(bytes) }
      catch { logoImg = await pdfDoc.embedJpg(bytes) }
      logoH = 40
      logoW = (logoImg.width / logoImg.height) * logoH
    } catch (e) { /* no logo — header still renders fine without it */ }
  }

  let textX = marginX
  if (logoImg) {
    page.drawImage(logoImg, { x: marginX, y: y - logoH + 8, width: logoW, height: logoH })
    textX = marginX + logoW + 14
  }
  page.drawText(name, { x: textX, y, size: 16, font: fontBold, color: blue })
  if (tagline) page.drawText(tagline, { x: textX, y: y - 16, size: 9, font: fontReg, color: gray })
  if (address) page.drawText(address, { x: textX, y: y - 28, size: 9, font: fontReg, color: gray })

  // Right side: INVOICE / number / status
  const invNum = inv.invNum || (inv.id || '').slice(-6) || 'INV-001'
  const rightX = width - marginX - 150
  page.drawText('INVOICE', { x: rightX, y, size: 20, font: fontBold, color: dark })
  page.drawText(`#${invNum}`, { x: rightX, y: y - 18, size: 10, font: fontReg, color: gray })
  page.drawText(String(inv.status || 'Unpaid').toUpperCase(), { x: rightX, y: y - 32, size: 9, font: fontBold, color: blue })

  y -= 56
  page.drawLine({ start: { x: marginX, y }, end: { x: width - marginX, y }, thickness: 2, color: blue })
  y -= 28

  // Bill To / Date / Due Date / Balance row
  const subtotal = parseFloat(inv.total || 0)
  const taxRate  = parseFloat(inv.taxRate || 0)
  const tax      = subtotal * (taxRate / 100)
  const paid     = parseFloat(inv.paid || 0)
  const balance  = (subtotal + tax) - paid
  const dateStr    = (inv.date ? new Date(inv.date) : new Date()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const dueDateStr = inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Upon Receipt'

  const cols = [
    ['BILL TO', inv.clientName || 'Client', false],
    ['INVOICE DATE', dateStr, false],
    ['DUE DATE', dueDateStr, false],
    ['BALANCE DUE', money(balance), true],
  ]
  const colW = (width - marginX * 2) / 4
  cols.forEach(([label, val, emphasis], i) => {
    const x = marginX + i * colW
    page.drawText(label, { x, y, size: 8, font: fontBold, color: gray })
    page.drawText(String(val), { x, y: y - 16, size: emphasis ? 13 : 11, font: emphasis ? fontBold : fontReg, color: emphasis ? blue : dark })
  })

  y -= 56
  page.drawText('DESCRIPTION', { x: marginX, y, size: 8, font: fontBold, color: gray })
  y -= 8
  page.drawLine({ start: { x: marginX, y }, end: { x: width - marginX, y }, thickness: 1, color: lightLine })
  y -= 18

  const lineItems = (inv.lineItems || 'Professional Tax Resolution Services').split('\n').filter(Boolean)
  for (const item of lineItems) {
    for (const wrapped of wrapText(item, fontReg, 11, width - marginX * 2)) {
      page.drawText(wrapped, { x: marginX, y, size: 11, font: fontReg, color: dark })
      y -= 16
    }
  }

  y -= 14
  const totX = width - marginX - 190
  const valX = width - marginX - 80
  function totalRow(label, val, bold) {
    page.drawText(label, { x: totX, y, size: bold ? 11 : 10, font: bold ? fontBold : fontReg, color: bold ? dark : gray })
    page.drawText(val, { x: valX, y, size: bold ? 13 : 10, font: bold ? fontBold : fontReg, color: bold ? blue : gray })
    y -= 18
  }
  totalRow('Subtotal', money(subtotal))
  if (taxRate > 0) totalRow(`Tax (${taxRate}%)`, money(tax))
  if (paid > 0)    totalRow('Amount Paid', `-${money(paid)}`)
  page.drawLine({ start: { x: totX, y: y + 10 }, end: { x: width - marginX, y: y + 10 }, thickness: 1.5, color: blue })
  totalRow('Balance Due', money(balance), true)

  if (inv.notes) {
    y -= 18
    page.drawText('NOTES', { x: marginX, y, size: 8, font: fontBold, color: gray })
    y -= 14
    for (const wrapped of wrapText(inv.notes, fontReg, 9, width - marginX * 2)) {
      page.drawText(wrapped, { x: marginX, y, size: 9, font: fontReg, color: gray })
      y -= 13
    }
  }

  const footerText = firm.footer ? firm.footer() : `${name} · ${address} · Not a law firm`
  page.drawText(footerText, { x: marginX, y: 40, size: 8, font: fontReg, color: gray })

  const pdfBytes = await pdfDoc.save()
  return bytesToBase64(pdfBytes)
}
