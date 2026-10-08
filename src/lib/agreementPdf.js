import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// ─── Tax Service Agreement → PDF ─────────────────────────────────────────────
// The agreement has only ever existed as printBase() HTML fired at a print
// window, which meant the client never received a copy of the thing they
// actually signed — only the IRS forms, which are real PDFs. This renders the
// same agreement text with pdf-lib, matching how every other document in the
// package is produced, so it can be attached, stamped and filed like the rest.
//
// The signature block is anchored at a FIXED position on the last page (a new
// page is started if the body doesn't leave room) so SIGNATURE_POSITIONS can
// carry a static entry for 'agreement' the way it does for every other form.

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 54
const BODY_W = PAGE_W - MARGIN * 2

// Signature block anchors — must match SIGNATURE_POSITIONS['agreement'].
// Headroom above the client line is deliberate: stampSignature draws a 26pt
// signature image anchored just above it, which collided with the SIGNATURES
// heading at a tighter spacing.
const SIG_BLOCK_TOP = 230   // body must end above this on the final page
const CLIENT_LINE_Y = 168
const REP_LINE_Y = 104

function wrap(text, font, size, maxWidth) {
  const out = []
  for (const raw of String(text).split('\n')) {
    if (!raw.trim()) { out.push(''); continue }
    let line = ''
    for (const word of raw.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate
      } else {
        if (line) out.push(line)
        line = word
      }
    }
    if (line) out.push(line)
  }
  return out
}

/**
 * @param {object} opts
 * @param {string} opts.bodyText   Full agreement text (from getAgreementMessageText)
 * @param {string} opts.firmName
 * @param {string} opts.firmAddress
 * @param {string} opts.clientName
 * @param {Uint8Array|ArrayBuffer} [opts.repSignature]  PNG bytes for the rep line
 * @returns {Promise<Uint8Array>}
 */
export async function buildAgreementPdf({ bodyText, firmName, firmAddress, firmLogoUrl, clientName, repSignature }) {
  const pdf = await PDFDocument.create()
  const reg = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let logoImg = null, logoW = 0, logoH = 0
  if (firmLogoUrl) {
    try {
      const res = await fetch(firmLogoUrl)
      const bytes = await res.arrayBuffer()
      try { logoImg = await pdf.embedPng(bytes) } catch { logoImg = await pdf.embedJpg(bytes) }
      logoH = 34
      logoW = Math.min(120, (logoImg.width / logoImg.height) * logoH)
    } catch (_) {}
  }

  const ink = rgb(0.09, 0.11, 0.15)
  const muted = rgb(0.55, 0.58, 0.63)
  const rule = rgb(0.75, 0.77, 0.80)

  const pages = []
  let page = null
  let y = 0

  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H])
    pages.push(page)
    // Tenant letterhead
    let textX = MARGIN
    if (logoImg) {
      page.drawImage(logoImg, { x:MARGIN, y:PAGE_H-70, width:logoW, height:logoH })
      textX = MARGIN + logoW + 12
    }
    page.drawText(firmName || 'Firm', { x: textX, y: PAGE_H - 52, size: 13, font: bold, color: ink })
    page.drawText(firmAddress || '', { x: textX, y: PAGE_H - 66, size: 8, font: reg, color: muted })
    page.drawLine({
      start: { x: MARGIN, y: PAGE_H - 76 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - 76 },
      thickness: 0.75, color: rule,
    })
    y = PAGE_H - 100
  }

  newPage()

  // Body. Numbered clause headings ("1. COMPANY OBLIGATIONS") and the document
  // title are set in bold; bullets get a hanging indent.
  const lines = String(bodyText || '').split('\n')
  for (const raw of lines) {
    const trimmed = raw.trim()

    if (!trimmed) { y -= 7; continue }

    const isTitle = /^TAX SERVICE AGREEMENT$/.test(trimmed)
    const isHeading = /^\d+\.\s+[A-Z]/.test(trimmed)
    const isBullet = trimmed.startsWith('- ')

    const font = isTitle || isHeading ? bold : reg
    const size = isTitle ? 15 : isHeading ? 10 : 9.5
    const leading = isTitle ? 22 : 13
    const indent = isBullet ? 12 : 0
    const text = isBullet ? trimmed.slice(2) : trimmed

    if (isHeading) y -= 6

    const wrapped = wrap(text, font, size, BODY_W - indent)
    for (let i = 0; i < wrapped.length; i++) {
      if (y < MARGIN + 40) newPage()
      const x = MARGIN + indent
      if (isBullet && i === 0) {
        page.drawText('\u2022', { x: MARGIN + 2, y, size, font: reg, color: ink })
      }
      page.drawText(wrapped[i], { x, y, size, font, color: ink })
      y -= leading
    }
    if (isTitle) y -= 6
  }

  // Signature block goes on the last page if there's room, otherwise its own.
  if (y < SIG_BLOCK_TOP) newPage()

  page.drawLine({
    start: { x: MARGIN, y: SIG_BLOCK_TOP }, end: { x: PAGE_W - MARGIN, y: SIG_BLOCK_TOP },
    thickness: 0.75, color: rule,
  })
  page.drawText('SIGNATURES', { x: MARGIN, y: SIG_BLOCK_TOP - 18, size: 10, font: bold, color: ink })

  const sigLine = (lineY, label, who) => {
    page.drawLine({ start: { x: MARGIN + 6, y: lineY - 4 }, end: { x: 330, y: lineY - 4 }, thickness: 0.75, color: rule })
    page.drawLine({ start: { x: 380, y: lineY - 4 }, end: { x: PAGE_W - MARGIN, y: lineY - 4 }, thickness: 0.75, color: rule })
    page.drawText(label, { x: MARGIN + 6, y: lineY - 15, size: 7.5, font: reg, color: muted })
    page.drawText('Date', { x: 380, y: lineY - 15, size: 7.5, font: reg, color: muted })
    if (who) page.drawText(who, { x: MARGIN + 6, y: lineY - 27, size: 9, font: reg, color: ink })
  }

  sigLine(CLIENT_LINE_Y, 'Client Signature', clientName || '')
  sigLine(REP_LINE_Y, 'Authorized Representative', firmName)

  // The representative's side is pre-executed, same as the IRS templates.
  if (repSignature) {
    try {
      const png = await pdf.embedPng(repSignature)
      const h = 24
      const w = (png.width / png.height) * h
      page.drawImage(png, { x: MARGIN + 10, y: REP_LINE_Y - 2, width: w, height: h })
    } catch (_) { /* signature asset unavailable — leave the line blank */ }
  }

  // Footer on every page
  pages.forEach((p, i) => {
    p.drawText(`${firmName} \u00b7 Tax Service Agreement \u00b7 Page ${i + 1} of ${pages.length}`, {
      x: MARGIN, y: 30, size: 7.5, font: reg, color: muted,
    })
  })

  return pdf.save()
}
