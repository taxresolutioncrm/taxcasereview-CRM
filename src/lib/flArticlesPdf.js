import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// ─── FL Articles of Organization (LLC) → PDF ──────────────────────────────────
// Prepares a typewritten Florida LLC filing packet from the FormaCorp case.
// This is NOT an electronic filing. The client/firm still submits through
// Sunbiz (or by mail) and must provide any required signatures/consents.

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

  heading('ARTICLE I — Name')
  label('Name of Limited Liability Company')
  body(safe(c.entity_name))
  gap(6)

  heading('ARTICLE II — Principal Place of Business')
  label('Street Address (P.O. Box not acceptable)')
  body(safe(c.principal_address || c.business_address))
  gap(2)
  label('Mailing Address (P.O. Box acceptable)')
  body(safe(c.mailing_address || c.principal_address || c.business_address))
  gap(6)

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
  gap(14)
  label('Registered Agent Signature (required for paper filing)')
  ensure(30)
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: MARGIN + 300, y },
    thickness: 0.6, color: ink,
  })
  y -= 10
  body(
    c.registered_agent_accepted
      ? 'CRM confirmation: registered agent acceptance/permission has been confirmed. This confirmation is not a signature.'
      : 'CRM confirmation: registered agent acceptance/permission has NOT been confirmed.',
    { size: 7.5, font: ital }
  )
  gap(8)

  heading('MANAGER / AUTHORIZED REPRESENTATIVE (optional public listing)')
  body(
    'Florida currently uses MGR for Manager and AR for Authorized Representative. ' +
    'The manager/authorized-representative listing is optional; this packet does not ' +
    'invent a street address for that optional public listing.',
    { size: 8, font: ital }
  )
  gap(4)
  label('Title / Name')
  const repTitle = safe(c.authorized_representative_title, 'AR')
  const repName = safe(c.authorized_representative)
  body(`${repTitle} — ${repName}`)
  gap(8)

  heading('EFFECTIVE DATE')
  const effective = safe(c.effective_date, 'Upon filing')
  body(`Effective date of this filing: ${effective}`)
  body(
    '(An effective date may be specified up to five business days prior to, or ' +
    'ninety days after, the date the document is received by the Division of Corporations.)',
    { size: 8, font: ital }
  )
  gap(10)

  heading('CORRESPONDENCE')
  label('Correspondence Name')
  body(safe(c.client_name || c.authorized_representative))
  gap(2)
  label('Correspondence Email')
  body(safe(c.correspondence_email))
  gap(10)

  heading('Signature of Authorized Representative')
  gap(20)
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: MARGIN + 300, y },
    thickness: 0.6, color: ink,
  })
  y -= 12
  page.drawText('Signature', { x: MARGIN, y, size: 8, font: reg, color: muted })
  y -= 24
  page.drawText(safe(c.authorized_representative || c.client_name), {
    x: MARGIN, y, size: 10, font: reg, color: ink,
  })
  y -= 12
  page.drawText('Typed / Printed Name', { x: MARGIN, y, size: 8, font: reg, color: muted })
  y -= 24

  ensure(76)
  rule()
  gap(4)
  page.drawText('FILING FEES', { x: MARGIN, y, size: 9, font: bold, color: muted })
  y -= 12
  body('$125.00 required base filing ($100 Articles + $25 registered agent designation).', { size: 9 })
  body('Optional: Certified Copy $30.00; Certificate of Status $5.00.', { size: 8.5 })
  body(
    'For filing by mail: make payment payable to Florida Department of State and mail to ' +
    'New Filing Section, Division of Corporations, P.O. Box 6327, Tallahassee, FL 32314.',
    { size: 8.5 }
  )
  gap(4)
  body(
    'This packet was prepared by ' + safe(c.prepared_by || 'the firm') +
    ' for review. It is not itself a filing and does not represent Sunbiz acceptance.',
    { size: 7.5, font: ital }
  )

  const bytes = await pdf.save()
  return new Blob([bytes], { type: 'application/pdf' })
}

export async function buildFlFaxPacket(coverSheetFile, signedArticlesFile) {
  if (!coverSheetFile) throw new Error('Electronic Filing Cover Sheet is required')
  if (!signedArticlesFile) throw new Error('Signed Florida Articles PDF is required')
  const [coverBytes, articlesBytes] = await Promise.all([
    coverSheetFile.arrayBuffer(),
    signedArticlesFile.arrayBuffer(),
  ])
  const [coverPdf, articlesPdf] = await Promise.all([
    PDFDocument.load(coverBytes),
    PDFDocument.load(articlesBytes),
  ])
  const out = await PDFDocument.create()
  const coverPages = await out.copyPages(coverPdf, coverPdf.getPageIndices())
  for (const pg of coverPages) out.addPage(pg)
  const articlePages = await out.copyPages(articlesPdf, articlesPdf.getPageIndices())
  for (const pg of articlePages) out.addPage(pg)
  const bytes = await out.save()
  return new Blob([bytes], { type:'application/pdf' })
}

export async function buildFlProfitArticlesPdf(c) {
  const doc = await PDFDocument.create()
  const reg = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ital = await doc.embedFont(StandardFonts.HelveticaOblique)
  const ink = rgb(0.05,0.06,0.09), muted = rgb(0.4,0.42,0.5)
  let page = doc.addPage([PAGE_W,PAGE_H]), y = PAGE_H - 60
  const newPage=()=>{page=doc.addPage([PAGE_W,PAGE_H]);y=PAGE_H-60}
  const ensure=n=>{if(y-n<60)newPage()}
  const heading=(t,size=11)=>{ensure(size+12);page.drawText(t,{x:MARGIN,y,size,font:bold,color:ink});y-=size+8}
  const label=t=>{ensure(14);page.drawText(t,{x:MARGIN,y,size:8.5,font:bold,color:muted});y-=12}
  const body=(t,opts={})=>{const size=opts.size??10,font=opts.font??reg;for(const ln of wrap(t,font,size,BODY_W)){ensure(size+4);page.drawText(ln,{x:MARGIN,y,size,font,color:ink});y-=size+4}}
  const gap=(n=6)=>{y-=n}
  const rule=()=>{ensure(10);page.drawLine({start:{x:MARGIN,y:y-2},end:{x:MARGIN+BODY_W,y:y-2},thickness:.6,color:muted});y-=10}

  page.drawText('FLORIDA DIVISION OF CORPORATIONS',{x:MARGIN,y,size:9,font:bold,color:muted});y-=12
  page.drawText('Articles of Incorporation',{x:MARGIN,y,size:16,font:bold,color:ink});y-=18
  page.drawText('for a Florida Profit Corporation',{x:MARGIN,y,size:10,font:ital,color:muted});y-=22
  rule();gap(4)
  heading('ARTICLE I — Corporate Name');body(safe(c.entity_name));gap(6)
  heading('ARTICLE II — Principal and Mailing Addresses');label('Principal Street Address');body(safe(c.principal_address));gap(2);label('Mailing Address');body(safe(c.mailing_address||c.principal_address));gap(6)
  heading('ARTICLE III — Registered Agent');label('Registered Agent Name');body(safe(c.registered_agent));gap(2);label('Florida Street Address');body(safe(c.registered_agent_address));gap(6);label('Registered Agent Typed Signature');body(safe(c.fl_registered_agent_signature));gap(8)
  heading('ARTICLE IV — Purpose');body(safe(c.business_purpose,'Any and all lawful business'));gap(8)
  heading('ARTICLE V — Authorized Stock');const shares=Number(c.fl_authorized_shares);body(Number.isInteger(shares)&&shares>0?String(shares)+' authorized share'+(shares===1?'':'s'):'AUTHORIZED SHARE COUNT REQUIRED');gap(8)
  heading('ARTICLE VI — Officers / Directors (optional)');body(String(c.fl_officers_directors||'').trim()||'Not listed in the Articles.');gap(8)
  heading('EFFECTIVE DATE');body(c.effective_date?String(c.effective_date):'Upon filing');gap(8)
  heading('INCORPORATOR');label('Name');body(safe(c.authorized_representative||c.client_name));gap(2);label('Typed Signature');body(safe(c.fl_authorized_representative_signature));gap(8)
  heading('CORRESPONDENCE');label('Name');body(safe(c.client_name||c.authorized_representative));gap(2);label('Email');body(safe(c.correspondence_email));gap(10)
  rule();body('$70.00 required base filing ($35 Articles + $35 registered-agent designation). Optional certified copy $8.75; optional certificate of status $8.75.',{size:8.5})
  body('Prepared from the FormaCorp case for authorized submission to the Florida Division of Corporations. State acceptance is not established until the Division files the Articles.',{size:7.5,font:ital})
  const bytes=await doc.save()
  return new Blob([bytes],{type:'application/pdf'})
}
