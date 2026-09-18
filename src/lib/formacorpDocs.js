import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const PAGE_W = 612
const PAGE_H = 792
const M = 54
const W = PAGE_W - M * 2

function clean(v, fallback = '____________________________') {
  const s = String(v ?? '').trim()
  return s || fallback
}
function wrap(text, font, size, maxWidth = W) {
  const out = []
  for (const para of String(text || '').split('\n')) {
    if (!para.trim()) { out.push(''); continue }
    let line = ''
    for (const word of para.split(/\s+/)) {
      const next = line ? line + ' ' + word : word
      if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next
      else { if (line) out.push(line); line = word }
    }
    if (line) out.push(line)
  }
  return out
}
function addText(page, text, x, y, font, size = 10, opts = {}) {
  page.drawText(String(text ?? ''), { x, y, font, size, color: opts.color || rgb(0.12,0.16,0.22) })
}
function header(page, bold, title, subtitle='') {
  addText(page, title, M, PAGE_H-66, bold, 18)
  if (subtitle) addText(page, subtitle, M, PAGE_H-86, bold, 9, {color:rgb(.35,.4,.48)})
  page.drawLine({start:{x:M,y:PAGE_H-98},end:{x:PAGE_W-M,y:PAGE_H-98},thickness:1,color:rgb(.82,.84,.88)})
  return PAGE_H-120
}
function paragraph(page, text, x, y, font, size=10, line=15) {
  for (const ln of wrap(text,font,size,W-(x-M))) {
    if (y < 72) break
    addText(page, ln, x, y, font, size)
    y -= line
  }
  return y
}

export async function buildOperatingAgreementPdf(c, l = {}) {
  const pdf = await PDFDocument.create()
  const reg = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([PAGE_W,PAGE_H])
  let y = header(page,bold,'LIMITED LIABILITY COMPANY OPERATING AGREEMENT',clean(c.entity_name,'LLC'))
  y = paragraph(page,`This Operating Agreement is adopted for ${clean(c.entity_name)} (the "Company"), a limited liability company organized under the laws of ${clean(c.state,'the formation state')}. The Company was formed on ${clean(c.formation_date,'the date accepted by the state')} and its principal office is ${clean(c.principal_address)}.`,M,y,reg)
  y -= 8
  const sections = [
    ['1. PURPOSE', clean(c.business_purpose,'The Company may engage in any lawful business for which a limited liability company may be organized.')],
    ['2. MEMBERS AND OWNERSHIP', `The members and ownership interests are: ${clean(c.owners)}. The members may update ownership records only through a written amendment or other company record approved as required by law.`],
    ['3. MANAGEMENT', 'The Company will be managed by its member(s) unless the members approve a manager-managed structure in writing. Each authorized manager or member may act for the Company in the ordinary course of business, subject to any written limits adopted by the members.'],
    ['4. CAPITAL AND DISTRIBUTIONS', 'Initial and additional contributions will be reflected in the Company records. Distributions will be made as determined by the members and consistent with applicable law, tax requirements, and the Company’s ability to pay its obligations.'],
    ['5. BANKING', 'Company funds must be kept separate from personal funds. Bank accounts will be opened in the Company name using the Company EIN. Authorized signers will be documented in the Company records.'],
    ['6. TAX AND RECORDS', 'The Company will maintain complete books and records, preserve formation and tax documents, and make required federal, state, and local filings. The members may elect a tax classification permitted by law.'],
    ['7. LIABILITY AND INDEMNIFICATION', 'No member is personally liable for Company obligations solely by reason of being a member, except as required by law or by a separate personal obligation. The Company may indemnify authorized persons to the fullest extent permitted by law.'],
    ['8. CHANGES AND DISSOLUTION', 'This Agreement may be amended in writing by the members. Dissolution, winding up, and final distributions will be handled under applicable law and the written approval requirements of the members.'],
  ]
  for (const [title,body] of sections) {
    if (y < 145) break
    addText(page,title,M,y,bold,10); y-=16
    y=paragraph(page,body,M,y,reg,9.5,14); y-=8
  }
  if (y < 150) y = 150
  addText(page,'MEMBER APPROVAL',M,y,bold,10); y-=22
  addText(page,`Member / Authorized Signer: ${clean(c.authorized_representative || c.client_name)}`,M,y,reg,10); y-=22
  addText(page,'Signature: ________________________________________',M,y,reg,10)
  addText(page,'Date: __________________',370,y,reg,10); y-=30
  addText(page,'This document is a company-record template generated from information supplied to FormaCorp. Review before signing.',M,50,reg,7.5,{color:rgb(.45,.48,.54)})
  const bytes=await pdf.save()
  return new Blob([bytes],{type:'application/pdf'})
}

export async function buildBankingResolutionPdf(c, l = {}) {
  const pdf = await PDFDocument.create()
  const reg = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page=pdf.addPage([PAGE_W,PAGE_H])
  let y=header(page,bold,'BANKING RESOLUTION & ACCOUNT OPENING RECORD',clean(c.entity_name,'Company'))
  const rows=[
    ['Legal entity',clean(c.entity_name)],
    ['Entity type',clean(c.entity_type)],
    ['Formation state',clean(c.state)],
    ['State document number',clean(c.state_file_num)],
    ['EIN',clean(c.ein)],
    ['Principal address',clean(c.principal_address)],
    ['Authorized signer',clean(l.bank_signer || c.authorized_representative || c.client_name)],
    ['Bank / credit union',clean(l.bank_name)],
    ['Account type',clean(l.bank_account_type,'Business Checking')],
  ]
  for(const [a,b] of rows){addText(page,a,M,y,bold,9);addText(page,b,M+155,y,reg,9);y-=20}
  y-=10
  addText(page,'RESOLUTION',M,y,bold,11);y-=20
  y=paragraph(page,`The undersigned confirms that ${clean(c.entity_name)} is authorized to establish and maintain one or more business deposit accounts and related banking services. The authorized signer identified above may execute customary account-opening documents, deposit and withdraw Company funds, and manage ordinary banking services on behalf of the Company, subject to any limits separately adopted by the Company.`,M,y,reg,9.5,15)
  y-=18
  addText(page,'Authorized Signer: ______________________________________',M,y,reg,10); y-=24
  addText(page,'Title: ______________________________',M,y,reg,10)
  addText(page,'Date: __________________',370,y,reg,10);y-=32
  addText(page,'BANK DOCUMENT CHECKLIST',M,y,bold,10);y-=20
  for(const item of ['Filed formation document / Articles','EIN confirmation (CP 575 or equivalent)','Operating Agreement','Government-issued signer ID','State document number / good-standing evidence if requested']) {
    addText(page,'☐ '+item,M,y,reg,9.5);y-=18
  }
  addText(page,'Security note: FormaCorp intentionally stores only the account last four digits, not full bank account or routing numbers.',M,50,reg,7.5,{color:rgb(.45,.48,.54)})
  const bytes=await pdf.save()
  return new Blob([bytes],{type:'application/pdf'})
}
