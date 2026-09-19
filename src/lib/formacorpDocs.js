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
  y = 150
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


export async function buildCorporateGovernancePdf(c, l = {}) {
  const nonprofit = c.entity_type === 'Non-Profit 501(c)(3)'
  const pdf = await PDFDocument.create()
  const reg = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let page = pdf.addPage([PAGE_W,PAGE_H])
  let y = header(page,bold,nonprofit?'BYLAWS & ORGANIZATIONAL ACTION':'BYLAWS & INITIAL ORGANIZATIONAL ACTION',clean(c.entity_name,'Corporation'))

  const intro = nonprofit
    ? `These bylaws are adopted for ${clean(c.entity_name)} (the "Corporation"), a not-for-profit corporation organized under the laws of ${clean(c.state,'the formation state')}.`
    : `These bylaws are adopted for ${clean(c.entity_name)} (the "Corporation"), a corporation organized under the laws of ${clean(c.state,'the formation state')}.`
  y=paragraph(page,intro,M,y,reg,9.5,14); y-=8

  const sections=[
    ['1. OFFICES AND RECORDS',`The principal office is ${clean(c.principal_address)}. The Corporation will maintain its formation records, minutes, resolutions, tax records, and other records required by law.`],
    ['2. BOARD OF DIRECTORS','The business and affairs of the Corporation are managed under the direction of its board of directors, subject to applicable law and the Articles of Incorporation. Directors may act at meetings or by written consent when permitted.'],
    ['3. OFFICERS','The board may appoint a President, Secretary, Treasurer, and other officers, define their authority, and remove or replace them in accordance with applicable law and these bylaws.'],
    ['4. MEETINGS AND WRITTEN ACTION','Meetings may be held with the notice and quorum required by applicable law and these bylaws. Actions may be documented by minutes or written consents and retained with the corporate records.'],
    ['5. BANKING AND CONTRACT AUTHORITY','Corporate funds must be maintained separately from personal funds. The board may designate authorized bank signers and persons authorized to execute contracts for the Corporation.'],
    ['6. TAX, ACCOUNTING, AND COMPLIANCE','The Corporation will obtain and maintain its EIN, keep complete books and records, file required federal, state, and local returns, and maintain its registered agent and required annual filings.'],
    ['7. INDEMNIFICATION','The Corporation may indemnify directors, officers, employees, and agents to the fullest extent permitted by applicable law.'],
    ['8. AMENDMENTS','These bylaws may be amended in the manner permitted by the Articles of Incorporation, applicable law, and any rights of members or shareholders.'],
  ]
  for(const [title,body] of sections){
    if(y<135){ page=pdf.addPage([PAGE_W,PAGE_H]); y=PAGE_H-64 }
    addText(page,title,M,y,bold,10); y-=16
    y=paragraph(page,body,M,y,reg,9.2,13.5); y-=7
  }

  if(y<260){ page=pdf.addPage([PAGE_W,PAGE_H]); y=PAGE_H-64 }
  addText(page,'INITIAL ORGANIZATIONAL ACTION',M,y,bold,12); y-=20
  const actions=[
    'The Articles of Incorporation and state filing acknowledgement are accepted and ordered placed in the corporate records.',
    'The bylaws above are adopted as the initial bylaws of the Corporation.',
    `The following officers/directors are recorded from the formation file: ${clean(c.officers_directors,'To be completed by organizational action')}.`,
    `The Corporation is authorized to obtain and use EIN ${clean(c.ein,'when issued')} and to establish business banking in the corporate name.`,
    'The officers are authorized to take reasonable actions necessary to complete tax registrations, licenses, insurance, bookkeeping, contracts, and other launch requirements approved by the board.',
  ]
  for(const a of actions){ y=paragraph(page,'• '+a,M,y,reg,9.3,14); y-=4 }
  y-=10
  addText(page,'Authorized Director / Incorporator: '+clean(c.incorporator_name || c.authorized_representative || c.client_name),M,y,reg,9.5); y-=24
  addText(page,'Signature: ________________________________________',M,y,reg,10)
  addText(page,'Date: __________________',370,y,reg,10)
  addText(page,'This document is a company-record template generated from information supplied to FormaCorp. Review for the corporation’s specific governance requirements before adoption.',M,50,reg,7.3,{color:rgb(.45,.48,.54)})
  const bytes=await pdf.save()
  return new Blob([bytes],{type:'application/pdf'})
}

export async function buildGovernanceDocumentPdf(c, l = {}) {
  if (c?.entity_type === 'C-Corp' || c?.entity_type === 'Non-Profit 501(c)(3)') {
    return buildCorporateGovernancePdf(c,l)
  }
  return buildOperatingAgreementPdf(c,l)
}
