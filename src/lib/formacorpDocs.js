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


export async function buildCorporateBylawsPdf(c, l = {}) {
  const pdf = await PDFDocument.create()
  const reg = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([PAGE_W,PAGE_H])
  let y = header(page,bold,'CORPORATE BYLAWS',clean(c.entity_name,'Corporation'))
  y = paragraph(page,`These Bylaws are adopted for ${clean(c.entity_name)} (the "Corporation"), organized under the laws of ${clean(c.state,'the formation state')}. The Corporation was formed on ${clean(c.formation_date,'the date accepted by the state')} and maintains its principal office at ${clean(c.principal_address)}.`,M,y,reg)
  y -= 8
  const isNonProfit = c.entity_type === 'Non-Profit 501(c)(3)'
  const sections = isNonProfit ? [
    ['ARTICLE I — OFFICES', 'The Corporation will maintain a principal office and registered office as required by applicable law. The board may establish additional offices as business needs require.'],
    ['ARTICLE II — EXEMPT PURPOSE', 'The Corporation will be operated exclusively in furtherance of its purposes stated in the Articles of Incorporation and consistent with Section 501(c)(3) of the Internal Revenue Code. No part of its net earnings will inure to the benefit of private persons except for reasonable compensation and payments furthering exempt purposes.'],
    ['ARTICLE III — BOARD OF DIRECTORS', `The affairs of the Corporation are managed under the direction of its board of directors. Initial officer/director information supplied to FormaCorp: ${clean(c.fl_officers_directors,'To be completed in the organizational action.')}`],
    ['ARTICLE IV — OFFICERS', 'The board may appoint a President, Secretary, Treasurer, and any other officers it considers appropriate. Officers have the authority assigned by the board and may be removed or replaced as permitted by law.'],
    ['ARTICLE V — MEETINGS AND ACTION', 'Director meetings, notices, quorum, voting, and written consents will be handled in accordance with the Articles of Incorporation, these Bylaws, and applicable law. Directors will be elected or appointed as provided by these Bylaws and board action.'],
    ['ARTICLE VI — BANKING AND CONTRACTS', 'Corporate funds must be kept separate from personal funds. The board may authorize bank accounts, signers, contracts, grants, and other transactions through resolutions or written consents.'],
    ['ARTICLE VII — RECORDS AND TAX EXEMPTION', 'The Corporation will maintain its Articles, Bylaws, minutes or written consents, financial and tax records, and other records required by law. Applications and ongoing filings related to federal or state tax-exempt status will be documented separately.'],
    ['ARTICLE VIII — DISSOLUTION', 'Upon dissolution, assets will be distributed only as provided in the Articles of Incorporation and applicable law for one or more exempt purposes within the meaning of Section 501(c)(3), or to government for a public purpose.'],
    ['ARTICLE IX — AMENDMENTS', 'These Bylaws may be amended through the approval process permitted by the Articles of Incorporation and applicable law, provided no amendment authorizes activity inconsistent with the Corporation\'s exempt purposes.'],
  ] : [
    ['ARTICLE I — OFFICES', 'The Corporation will maintain a principal office and registered office as required by applicable law. The board may establish additional offices as business needs require.'],
    ['ARTICLE II — SHAREHOLDERS', 'Shareholder meetings, notices, voting, proxies, quorum, and written consents will be handled in accordance with the Articles of Incorporation, these Bylaws, and applicable state law.'],
    ['ARTICLE III — BOARD OF DIRECTORS', `The business and affairs of the Corporation are managed under the direction of its board of directors. Initial officer/director information supplied to FormaCorp: ${clean(c.fl_officers_directors,'To be completed in the organizational action.')}`],
    ['ARTICLE IV — OFFICERS', 'The board may appoint a President, Secretary, Treasurer, and any other officers it considers appropriate. Officers have the authority assigned by the board and may be removed or replaced as permitted by law.'],
    ['ARTICLE V — SHARES', `The Corporation may issue shares within the authorization stated in its Articles of Incorporation. FormaCorp formation record: ${clean(c.fl_authorized_shares,'1')} authorized share(s). Stock issuance must be approved and documented in the corporate records.`],
    ['ARTICLE VI — BANKING AND CONTRACTS', 'Corporate funds must be kept separate from personal funds. The board may authorize bank accounts, signers, contracts, loans, and other ordinary business transactions through resolutions or written consents.'],
    ['ARTICLE VII — RECORDS AND TAX', 'The Corporation will maintain its Articles, Bylaws, minutes or written consents, stock records, tax records, and other records required by law. Federal and state tax elections will be documented separately.'],
    ['ARTICLE VIII — AMENDMENTS', 'These Bylaws may be amended through the approval process permitted by the Articles of Incorporation and applicable law.'],
  ]
  for (const [title,body] of sections) {
    if (y < 140) break
    addText(page,title,M,y,bold,10); y-=16
    y=paragraph(page,body,M,y,reg,9.3,14); y-=7
  }
  if (y < 285) { y = 285 }
  addText(page,'INITIAL ORGANIZATIONAL ACTION',M,y,bold,10); y-=18
  const orgActions = isNonProfit ? [
    'The filed Articles of Incorporation and state acknowledgement are accepted and ordered placed in the corporate records.',
    'These Bylaws are adopted as the initial bylaws of the Corporation.',
    `The initial officers/directors are recorded as: ${clean(c.fl_officers_directors,'To be completed by organizational action')}.`,
    `The Corporation is authorized to obtain and use EIN ${clean(c.ein,'when issued')} and to establish banking in the corporate name.`,
    'The officers are authorized to complete federal and state tax-exemption applications, registrations, licenses, insurance, bookkeeping, grant, contract, and launch steps approved by the board.',
  ] : [
    'The filed Articles of Incorporation and state acknowledgement are accepted and ordered placed in the corporate records.',
    'These Bylaws are adopted as the initial bylaws of the Corporation.',
    `The initial officers/directors are recorded as: ${clean(c.fl_officers_directors,'To be completed by organizational action')}.`,
    `The Corporation is authorized to issue shares within the ${clean(c.fl_authorized_shares,'authorized')} share limit stated in the Articles; each issuance must be separately documented in the stock ledger.`,
    `The Corporation is authorized to obtain and use EIN ${clean(c.ein,'when issued')} and to establish banking in the corporate name.`,
    'The officers are authorized to complete registrations, licenses, insurance, bookkeeping, contracts, tax elections, and other launch steps approved by the board.',
  ]
  for (const action of orgActions) {
    y=paragraph(page,'• '+action,M,y,reg,8.7,12.5); y-=3
  }
  y -= 6
  y = Math.max(y,125)
  addText(page,'ADOPTION',M,y,bold,10); y-=22
  addText(page,`Authorized Signer / Incorporator: ${clean(c.fl_incorporator || c.authorized_representative || c.client_name)}`,M,y,reg,10); y-=22
  addText(page,'Signature: ________________________________________',M,y,reg,10)
  addText(page,'Date: __________________',370,y,reg,10)
  addText(page,'This is a corporate-record template generated from information supplied to FormaCorp. Review before adoption and signing.',M,50,reg,7.5,{color:rgb(.45,.48,.54)})
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
  const governingDocument = (c.entity_type === 'C-Corp' || c.entity_type === 'Non-Profit 501(c)(3)') ? 'Corporate Bylaws / organizational action' : 'Operating Agreement'
  for(const item of ['Filed formation document / Articles','EIN confirmation (CP 575 or equivalent)',governingDocument,'Government-issued signer ID','State document number / good-standing evidence if requested']) {
    addText(page,'☐ '+item,M,y,reg,9.5);y-=18
  }
  addText(page,'Security note: FormaCorp intentionally stores only the account last four digits, not full bank account or routing numbers.',M,50,reg,7.5,{color:rgb(.45,.48,.54)})
  const bytes=await pdf.save()
  return new Blob([bytes],{type:'application/pdf'})
}
