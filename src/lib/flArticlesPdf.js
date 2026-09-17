import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// ─── FL Articles of Organization (LLC) → PDF ──────────────────────────────────
// Mirrors the field structure of the Florida Division of Corporations
// "Articles of Organization for Florida Limited Liability Company" form as
// posted at https://dos.fl.gov/media/704383/cr2e047.pdf — Article-by-Article,
// same headings, same signature blocks. It's NOT a literal fillable copy of
// their PDF (their template is a scanned image), it's a typewritten version
// carrying the exact fields Sunbiz accepts.
//
// A filer can either:
//   (a) upload this PDF as documentation alongside their manual Sunbiz e-file, OR
//   (b) hand-copy the values into sunbiz.org's online form.
//
// It is NOT itself a filing. Path 3 explicitly — the packet is prepared here,
// the submission still happens through sunbiz.org until we wire path 2.
//
// Callers pass the FormaCorp case shape. Missing fields render blanks so a
// half-filled packet is still legible.

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 54
const BODY_W = PAGE_W - MARGIN * 2

function wrap(text, font, size, maxWidth) {
  const out = []
  for (const raw of String(text || '').split('\n')) {
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

function safe(v, fallback = '__________________________') {
  const s = String(v ?? '').trim()
  return s || fallback
}

// Split "First M Last" into a naive "Last, First M" for the officer block.
// Sunbiz accepts either but the online form defaults to "Last, First".
function nameLast(full) {
  const parts = String(full || '').trim().split(/\s+/)
  if (parts.length < 2) return safe(full)
  const last = parts.pop()
  return `${last}, ${parts.join(' ')}`
}

export async function buildFlArticlesPdf(c) {
  const pdf = await PDFDocument.create()
  const reg  = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const ital = await pdf.embedFont(StandardFonts.HelveticaOblique)
  const ink   = rgb(0.05, 0.06, 0.09)
  const muted = rgb(0.4, 0.42, 0.5)

  let page = pdf.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - 60

  function newPage() {
    page = pdf.addPage([PAGE_W, PAGE_H])
    y = PAGE_H - 60
  }
  function ensure(space) {
    if (y - space < 60) newPage()
  }
  function heading(t, size = 11) {
    ensure(size + 12)
    page.drawText(t, { x: MARGIN, y, size, font: bold, color: ink })
    y -= size + 8
  }
  function label(t) {
    ensure(14)
    page.drawText(t, { x: MARGIN, y, size: 8.5, font: bold, color: muted })
    y -= 12
  }
  function body(t, opts = {}) {
    const size = opts.size ?? 10
    const font = opts.font ?? reg
    const lines = wrap(t, font, size, BODY_W)
    for (const ln of lines) {
      ensure(size + 4)
      page.drawText(ln, { x: MARGIN, y, size, font, color: ink })
      y -= size + 4
    }
  }
  function rule() {
    ensure(10)
    page.drawLine({
      start: { x: MARGIN, y: y - 2 },
      end:   { x: MARGIN + BODY_W, y: y - 2 },
      thickness: 0.6, color: muted,
    })
    y -= 10
  }
  function gap(n = 6) { y -= n }

  // ── Title block ─────────────────────────────────────────────────────────
  page.drawText('FLORIDA DIVISION OF CORPORATIONS', {
    x: MARGIN, y, size: 9, font: bold, color: muted,
  })
  y -= 12
  page.drawText('Articles of Organization', {
    x: MARGIN, y, size: 16, font: bold, color: ink,
  })
  y -= 18
  page.drawText('for a Florida Limited Liability Company', {
    x: MARGIN, y, size: 10, font: ital, color: muted,
  })
  y -= 22
  rule()
  gap(4)

  body(
    'The undersigned, for the purpose of forming a limited liability company under ' +
    'chapter 605, Florida Statutes, hereby submits the following Articles of Organization ' +
    'to the Florida Department of State, Division of Corporations.',
    { size: 9 }
  )
  gap(10)

  // ── ARTICLE I — Name ─────────────────────────────────────────────────────
  heading('ARTICLE I — Name')
  label('Name of Limited Liability Company')
  body(safe(c.entity_name))
  gap(6)

  // ── ARTICLE II — Principal Place of Business ────────────────────────────
  heading('ARTICLE II — Principal Place of Business')
  label('Street Address (P.O. Box not acceptable)')
  body(safe(c.principal_address || c.business_address))
  gap(2)
  label('Mailing Address (if different from Principal)')
  body(safe(c.mailing_address, '(same as principal address)'))
  gap(6)

  // ── ARTICLE III — Registered Agent ──────────────────────────────────────
  heading('ARTICLE III — Registered Agent Name and Address')
  label('Name of Registered Agent')
  body(safe(c.registered_agent))
  gap(2)
  label('Florida Street Address (P.O. Box not acceptable)')
  body(safe(c.registered_agent_address))
  gap(8)
  body(
    'Having been named as registered agent to accept service of process for the above ' +
    'stated limited liability company at the place designated in this certificate, I ' +
    'hereby accept the appointment as registered agent and agree to act in this ' +
    'capacity. I further agree to comply with the provisions of all statutes relating ' +
    'to the proper and complete performance of my duties, and I am familiar with and ' +
    'accept the obligations of my position as registered agent.',
    { size: 8.5 }
  )
  gap(18)
  label('Registered Agent Signature')
  ensure(30)
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: MARGIN + 300, y },
    thickness: 0.6, color: ink,
  })
  y -= 22

  // ── ARTICLE IV — Authorized Representative(s) ───────────────────────────
  heading('ARTICLE IV — Name and Address of Person(s) Authorized to Manage LLC')
  body(
    'Title designations: MGR = Manager · MGRM = Managing Member · AMBR = Authorized Member',
    { size: 8, font: ital }
  )
  gap(4)
  const owners = String(c.owners || '')
    .split(/[,\n;]/)
    .map(s => s.trim())
    .filter(Boolean)
  if (owners.length === 0) {
    label('Title / Name / Address')
    body('__________________________')
  } else {
    for (const o of owners) {
      label('Title / Name / Address')
      body(`${safe(c.default_owner_title || 'MGRM')}  —  ${nameLast(o)}`)
      body(safe(c.principal_address || c.business_address, '(address on file)'), { size: 9 })
      gap(4)
    }
  }
  gap(4)

  // ── ARTICLE V — Effective Date ──────────────────────────────────────────
  heading('ARTICLE V — Effective Date')
  const effective = safe(c.formation_date, 'Upon filing')
  body(`Effective date of this filing: ${effective}`)
  body(
    '(An effective date may be specified up to five business days prior to, or ' +
    'ninety days after, the date this document is filed by the Division of Corporations.)',
    { size: 8, font: ital }
  )
  gap(10)

  // ── Signature of Authorized Representative ──────────────────────────────
  heading('Signature of Member or Authorized Representative')
  gap(20)
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: MARGIN + 300, y },
    thickness: 0.6, color: ink,
  })
  y -= 12
  page.drawText('Signature', { x: MARGIN, y, size: 8, font: reg, color: muted })
  y -= 24
  page.drawText(safe(owners[0] || c.client_name), {
    x: MARGIN, y, size: 10, font: reg, color: ink,
  })
  y -= 12
  page.drawText('Printed Name', { x: MARGIN, y, size: 8, font: reg, color: muted })
  y -= 24

  // ── Filing fee note ─────────────────────────────────────────────────────
  ensure(60)
  rule()
  gap(4)
  page.drawText('FILING FEE', { x: MARGIN, y, size: 9, font: bold, color: muted })
  y -= 12
  body(
    '$125.00 total ($100 filing fee + $25 registered agent designation).',
    { size: 9 }
  )
  body(
    'Make check payable to: Florida Department of State. Mail with these Articles to: ' +
    'Registration Section, Division of Corporations, P.O. Box 6327, Tallahassee, FL 32314.',
    { size: 8.5 }
  )
  gap(4)
  body(
    'This packet was prepared by ' + safe(c.prepared_by || 'the firm') +
    ' and is provided for the client to review and file. It is not itself a filing.',
    { size: 7.5, font: ital }
  )

  const bytes = await pdf.save()
  return new Blob([bytes], { type: 'application/pdf' })
}
