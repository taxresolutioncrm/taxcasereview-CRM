import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

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
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate
      else {
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

function nameLast(full) {
  const parts = String(full || '').trim().split(/\s+/)
  if (parts.length < 2) return safe(full)
  const last = parts.pop()
  return `${last}, ${parts.join(' ')}`
}

export async function buildFlArticlesPdf(c) {
  if (!c?.entity_name) throw new Error('Entity name is required')
  if (!c?.principal_address) throw new Error('Principal office address is required')
  if (!c?.registered_agent) throw new Error('Registered agent is required')
  if (!c?.registered_agent_address) throw new Error('Registered agent Florida street address is required')
  if (!c?.authorized_representative) throw new Error('Authorized representative is required')
  if (!c?.correspondence_email) throw new Error('Correspondence email is required')
  if (!c?.registered_agent_accepted) throw new Error('Registered agent acceptance must be confirmed')

  const pdf = await PDFDocument.create()
  const reg  = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const ital = await pdf.embedFont(StandardFonts.HelveticaOblique)
  const ink   = rgb(0.05, 0.06, 0.09)
  const muted = rgb(0.4, 0.42, 0.5)

  let page = pdf.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - 60

  function newPage() { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - 60 }
  function ensure(space) { if (y - space < 60) newPage() }
  function heading(t, size = 11) { ensure(size + 12); page.drawText(t, { x: MARGIN, y, size, font: bold, color: ink }); y -= size + 8 }
  function label(t) { ensure(14); page.drawText(t, { x: MARGIN, y, size: 8.5, font: bold, color: muted }); y -= 12 }
  function body(t, opts = {}) {
    const size = opts.size ?? 10
    const font = opts.font ?? reg
    for (const ln of wrap(t, font, size, BODY_W)) {
      ensure(size + 4)
      page.drawText(ln, { x: MARGIN, y, size, font, color: ink })
      y -= size + 4
    }
  }
  function rule() { ensure(10); page.drawLine({ start:{x:MARGIN,y:y-2}, end:{x:MARGIN+BODY_W,y:y-2}, thickness:0.6, color:muted }); y -= 10 }
  function gap(n = 6) { y -= n }

  page.drawText('FLORIDA DIVISION OF CORPORATIONS', { x:MARGIN, y, size:9, font:bold, color:muted })
  y -= 12
  page.drawText('Articles of Organization', { x:MARGIN, y, size:16, font:bold, color:ink })
  y -= 18
  page.drawText('for a Florida Limited Liability Company', { x:MARGIN, y, size:10, font:ital, color:muted })
  y -= 22
  rule(); gap(4)

  body('The undersigned, for the purpose of forming a limited liability company under chapter 605, Florida Statutes, hereby submits the following Articles of Organization to the Florida Department of State, Division of Corporations.', { size:9 })
  gap(10)

  heading('ARTICLE I — Name')
  label('Name of Limited Liability Company')
  body(safe(c.entity_name)); gap(6)

  heading('ARTICLE II — Principal Place of Business')
  label('Street Address (P.O. Box not acceptable)')
  body(safe(c.principal_address)); gap(2)
  label('Mailing Address (if different from Principal)')
  body(safe(c.mailing_address, '(same as principal address)')); gap(6)

  heading('ARTICLE III — Registered Agent Name and Address')
  label('Name of Registered Agent')
  body(safe(c.registered_agent)); gap(2)
  label('Florida Street Address (P.O. Box not acceptable)')
  body(safe(c.registered_agent_address)); gap(8)
  body('Having been named as registered agent to accept service of process for the above stated limited liability company at the place designated in this certificate, I hereby accept the appointment as registered agent and agree to act in this capacity. I further agree to comply with the provisions of all statutes relating to the proper and complete performance of my duties, and I am familiar with and accept the obligations of my position as registered agent.', { size:8.5 })
  gap(18)
  label('Registered Agent Signature')
  ensure(30)
  page.drawLine({ start:{x:MARGIN,y}, end:{x:MARGIN+300,y}, thickness:0.6, color:ink })
  y -= 22
  body('Acceptance confirmed in FormaCorp case: YES', { size:8, font:ital })

  heading('ARTICLE IV — Name and Address of Person(s) Authorized to Manage LLC')
  body('Title designations: MGR = Manager · MGRM = Managing Member · AMBR = Authorized Member', { size:8, font:ital })
  gap(4)
  const owners = String(c.owners || '').split(/[,\n;]/).map(s=>s.trim()).filter(Boolean)
  if (owners.length === 0) {
    label('Title / Name / Address')
    body(`${safe(c.authorized_representative_title || 'AMBR')} — ${nameLast(c.authorized_representative)}`)
    body(safe(c.principal_address), { size:9 })
  } else {
    for (const o of owners) {
      label('Title / Name / Address')
      body(`${safe(c.authorized_representative_title || 'AMBR')} — ${nameLast(o)}`)
      body(safe(c.principal_address), { size:9 })
      gap(4)
    }
  }
  gap(4)

  heading('ARTICLE V — Effective Date')
  body(`Effective date of this filing: ${safe(c.effective_date, 'Upon filing')}`)
  body('(An effective date may be specified up to five business days prior to, or ninety days after, the date this document is filed by the Division of Corporations.)', { size:8, font:ital })
  gap(10)

  heading('Signature of Member or Authorized Representative')
  gap(20)
  page.drawLine({ start:{x:MARGIN,y}, end:{x:MARGIN+300,y}, thickness:0.6, color:ink })
  y -= 12
  page.drawText('Signature', { x:MARGIN, y, size:8, font:reg, color:muted })
  y -= 24
  page.drawText(safe(c.authorized_representative), { x:MARGIN, y, size:10, font:reg, color:ink })
  y -= 12
  page.drawText('Printed Name', { x:MARGIN, y, size:8, font:reg, color:muted })
  y -= 18
  body(`Title: ${safe(c.authorized_representative_title || 'AMBR')}`, { size:9 })
  body(`Correspondence email: ${safe(c.correspondence_email)}`, { size:9 })
  gap(8)

  ensure(60)
  rule(); gap(4)
  page.drawText('FILING FEE', { x:MARGIN, y, size:9, font:bold, color:muted })
  y -= 12
  body('$125.00 total ($100 filing fee + $25 registered agent designation).', { size:9 })
  body('Make check payable to: Florida Department of State. Mail with these Articles to: Registration Section, Division of Corporations, P.O. Box 6327, Tallahassee, FL 32314.', { size:8.5 })
  gap(4)
  body('This packet was prepared by ' + safe(c.prepared_by || 'the firm') + ' and is provided for client review and filing. It is not itself a state filing or acceptance.', { size:7.5, font:ital })

  const bytes = await pdf.save()
  return new Blob([bytes], { type:'application/pdf' })
}
