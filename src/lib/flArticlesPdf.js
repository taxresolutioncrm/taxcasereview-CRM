import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const PAGE_W=612, PAGE_H=792, MARGIN=54, BODY_W=PAGE_W-MARGIN*2
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LLC_NAME_RE=/(\bLLC\b|\bL\.L\.C\.\b|LIMITED LIABILITY COMPANY\b|\bPLLC\b|\bP\.L\.L\.C\.\b|PROFESSIONAL LIMITED LIABILITY COMPANY\b)/i
const PO_BOX_RE=/\bP\.?\s*O\.?\s*BOX\b/i

export function validateFloridaLlcFiling(c={}){
  const issues=[]
  const entity=String(c.entity_name||'').trim()
  const principal=String(c.principal_address||'').trim()
  const ra=String(c.registered_agent||'').trim()
  const raAddress=String(c.registered_agent_address||'').trim()
  const signer=String(c.authorized_representative||'').trim()
  const title=String(c.authorized_representative_title||'').trim()
  const email=String(c.correspondence_email||'').trim()
  const type=String(c.entity_type||'LLC')
  if(!entity)issues.push('Entity name is required.')
  else if(!LLC_NAME_RE.test(entity))issues.push('Florida LLC name must include LLC, L.L.C., Limited Liability Company, PLLC, P.L.L.C. or Professional Limited Liability Company.')
  if(!principal)issues.push('Principal street address is required.')
  else if(PO_BOX_RE.test(principal))issues.push('Principal address cannot be a P.O. Box.')
  if(!ra)issues.push('Registered agent name is required.')
  if(!raAddress)issues.push('Registered agent Florida street address is required.')
  else if(PO_BOX_RE.test(raAddress))issues.push('Registered agent address cannot be a P.O. Box.')
  if(!c.registered_agent_accepted)issues.push('Registered agent acceptance must be confirmed before filing.')
  if(!signer)issues.push('Authorized representative / filer name is required.')
  if(!['AR','MGR'].includes(title))issues.push('Authorized representative title must be AR or MGR.')
  if(!email)issues.push('Correspondence email is required.')
  else if(!EMAIL_RE.test(email))issues.push('Correspondence email is not valid.')
  if(type==='Professional LLC (PLLC)'&&!String(c.business_purpose||'').trim())issues.push('A specific professional purpose is required for a Florida PLLC.')
  return issues
}

function wrap(text,font,size,maxWidth){
  const out=[]
  for(const raw of String(text||'').split('\n')){
    if(!raw.trim()){out.push('');continue}
    let line=''
    for(const word of raw.split(/\s+/)){
      const candidate=line?`${line} ${word}`:word
      if(font.widthOfTextAtSize(candidate,size)<=maxWidth)line=candidate
      else{if(line)out.push(line);line=word}
    }
    if(line)out.push(line)
  }
  return out
}
const safe=(v,f='__________________________')=>String(v??'').trim()||f

export async function buildFlArticlesPdf(c){
  const issues=validateFloridaLlcFiling(c)
  if(issues.length)throw new Error('Florida filing packet is incomplete: '+issues.join(' '))

  const pdf=await PDFDocument.create()
  const reg=await pdf.embedFont(StandardFonts.Helvetica)
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold)
  const ital=await pdf.embedFont(StandardFonts.HelveticaOblique)
  const ink=rgb(.05,.06,.09), muted=rgb(.4,.42,.5)
  let page=pdf.addPage([PAGE_W,PAGE_H]), y=PAGE_H-60
  const newPage=()=>{page=pdf.addPage([PAGE_W,PAGE_H]);y=PAGE_H-60}
  const ensure=space=>{if(y-space<60)newPage()}
  const heading=(t,size=11)=>{ensure(size+12);page.drawText(t,{x:MARGIN,y,size,font:bold,color:ink});y-=size+8}
  const label=t=>{ensure(14);page.drawText(t,{x:MARGIN,y,size:8.5,font:bold,color:muted});y-=12}
  const body=(t,opts={})=>{const size=opts.size??10,font=opts.font??reg;for(const ln of wrap(t,font,size,BODY_W)){ensure(size+4);page.drawText(ln,{x:MARGIN,y,size,font,color:ink});y-=size+4}}
  const rule=()=>{ensure(10);page.drawLine({start:{x:MARGIN,y:y-2},end:{x:MARGIN+BODY_W,y:y-2},thickness:.6,color:muted});y-=10}
  const gap=(n=6)=>{y-=n}

  page.drawText('FLORIDA DIVISION OF CORPORATIONS',{x:MARGIN,y,size:9,font:bold,color:muted});y-=12
  page.drawText('Articles of Organization',{x:MARGIN,y,size:16,font:bold,color:ink});y-=18
  page.drawText('for a Florida Limited Liability Company',{x:MARGIN,y,size:10,font:ital,color:muted});y-=22
  rule();gap(4)
  body('Prepared from the TaxRes FormaCorp filing record for review before submission to the Florida Department of State, Division of Corporations.',{size:9});gap(10)

  heading('ARTICLE I — Name')
  label('Name of Limited Liability Company');body(c.entity_name);gap(6)

  heading('ARTICLE II — Principal Place of Business')
  label('Street Address (P.O. Box not acceptable)');body(c.principal_address);gap(2)
  label('Mailing Address (if different from Principal)');body(safe(c.mailing_address,c.principal_address));gap(6)

  heading('ARTICLE III — Registered Agent Name and Address')
  label('Name of Registered Agent');body(c.registered_agent);gap(2)
  label('Florida Street Address (P.O. Box not acceptable)');body(c.registered_agent_address);gap(8)
  body('Registered agent acceptance must be signed/typed by the registered agent on the actual Sunbiz filing. The CRM confirmation records that the filer has confirmed the agent agreed to serve; it does not substitute for that signature.',{size:8.5});gap(18)
  label('Registered Agent Signature / Typed Acceptance on Sunbiz')
  ensure(30);page.drawLine({start:{x:MARGIN,y},end:{x:MARGIN+300,y},thickness:.6,color:ink});y-=22

  heading('ARTICLE IV — Manager / Authorized Representative')
  body('Florida permits a Manager (MGR) or Authorized Representative (AR) to be listed. Members are not listed merely because they are members.',{size:8.5,font:ital});gap(4)
  label('Title / Name');body(`${c.authorized_representative_title} — ${c.authorized_representative}`);gap(2)
  label('Street Address');body(c.principal_address);gap(6)

  if(String(c.business_purpose||'').trim()){
    heading('Purpose')
    body(c.business_purpose);gap(6)
  }

  heading('Effective Date')
  if(c.effective_date)body(`Requested effective date: ${c.effective_date}`)
  else body('Effective upon filing by the Division of Corporations.')
  body('If an alternate effective date is used, Florida limits it to an allowable statutory window. Verify the date on Sunbiz at filing time.',{size:8,font:ital});gap(10)

  heading('Signature of Authorized Representative')
  gap(20);page.drawLine({start:{x:MARGIN,y},end:{x:MARGIN+300,y},thickness:.6,color:ink});y-=12
  page.drawText('Signature / typed signature on Sunbiz',{x:MARGIN,y,size:8,font:reg,color:muted});y-=24
  body(c.authorized_representative);body(`Title: ${c.authorized_representative_title}`,{size:9});gap(8)

  heading('Correspondence')
  label('Email for filing acknowledgement and future communications');body(c.correspondence_email);gap(10)

  ensure(80);rule();gap(4)
  page.drawText('FLORIDA LLC FEES',{x:MARGIN,y,size:9,font:bold,color:muted});y-=12
  body('$125.00 required total ($100 Articles of Organization + $25 registered agent designation).',{size:9})
  body('Optional: Certificate of Status $5.00; Certified Copy $30.00. If both optional items are selected, total is $160.00.',{size:8.5})
  gap(4)
  body('This packet is preparation support only. The filing is not submitted until the filer completes the official Sunbiz filing and payment. Florida makes the final determination on name availability and statutory acceptance.',{size:7.5,font:ital})

  const bytes=await pdf.save()
  return new Blob([bytes],{type:'application/pdf'})
}
