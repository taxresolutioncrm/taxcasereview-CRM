import { extractPdfText } from './irsTranscriptParser.js'

// Extract information from user-provided Florida Sunbiz PDFs. This is a text
// consistency check, NOT an authenticity check against Florida's live registry.
const norm = value => String(value || '').toUpperCase().replace(/&/g, ' AND ')
  .replace(/\bL\s*\.?\s*L\s*\.?\s*C\s*\.?\b/g, ' LLC')
  .replace(/\bLIMITED LIABILITY COMPANY\b/g, ' LLC')
  .replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
const clean = value => String(value || '').replace(/\s{2,}/g, ' ').trim()
const first = (text, patterns) => {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return clean(match[1])
  }
  return ''
}
const lineAfter = (lines, expression) => {
  for (let i = 0; i < lines.length; i++) {
    if (expression.test(lines[i])) {
      const sameLine = clean(lines[i].replace(expression, ''))
      if (sameLine && !/^(?:NAME|OF|THE|LLC|LIMITED LIABILITY)$/i.test(sameLine)) return sameLine
      if (lines[i + 1] && !/^(?:DOCUMENT|DATE|FEI|EIN|ADDRESS|FILED)/i.test(lines[i + 1])) return clean(lines[i + 1])
    }
  }
  return ''
}
export function parseFloridaSunbizText(text, expectedName) {
  const source=String(text || '').replace(/\r/g, '')
  const lines=source.split('\n').map(clean).filter(Boolean)
  const companyName=first(source, [
    /(?:LIMITED LIABILITY COMPANY NAME|CORPORATION NAME|ENTITY NAME|LEGAL NAME)\s*[:\-]?\s*([^\n]+)/i,
    /(?:NAME OF (?:THE )?(?:LIMITED LIABILITY COMPANY|CORPORATION))\s*[:\-]?\s*([^\n]+)/i,
  ]) || lineAfter(lines, /^(?:NAME OF (?:THE )?(?:LIMITED LIABILITY COMPANY|CORPORATION)|ENTITY NAME|CORPORATION NAME)\s*[:\-]?/i)
  const documentNumber=first(source, [
    /(?:DOCUMENT (?:NO\.?|NUMBER)|DOC(?:UMENT)?\s*#)\s*[:#\-]?\s*([A-Z][0-9]{8,12})\b/i,
  ])
  const filedDate=first(source, [
    /(?:DATE FILED|FILED ON|FILED DATE|FILING DATE)\s*[:\-]?\s*((?:0?[1-9]|1[0-2])[-\/](?:[0-2]?\d|3[01])[-\/](?:20\d{2}|\d{2})|20\d{2}-\d{2}-\d{2})/i,
  ])
  // Only fields with explicit government labels can populate the company file.
  // Different filing forms and receipts expose different subsets of information.
  const labelValue = (patterns, opts={}) => {
    for (let i=0;i<lines.length;i++) {
      for (const p of patterns) {
        const match=lines[i].match(p)
        if(!match) continue
        const inline=clean((match[1]||'').replace(/^[:#\s-]+/,''))
        if(inline && !/^(?:N\/A|NONE|NOT APPLICABLE)$/i.test(inline)) return inline
        const next=lines[i+1]||''
        if(next && !/^(?:REGISTERED|PRINCIPAL|MAILING|DOCUMENT|FILED|DATE|EFFECTIVE|ENTITY|NAME OF|AGENT|ADDRESS|TITLE|SIGNATURE|ARTICLE)\b/i.test(next))return next
      }
    }
    return ''
  }
  const principalAddress=labelValue([
    /^PRINCIPAL (?:OFFICE )?(?:STREET )?ADDRESS\s*[:#-]?\s*(.*)$/i,
    /^PRINCIPAL PLACE OF BUSINESS\s*[:#-]?\s*(.*)$/i,
  ])
  const mailingAddress=labelValue([
    /^MAILING (?:STREET )?ADDRESS\s*[:#-]?\s*(.*)$/i,
  ])
  const registeredAgent=labelValue([
    /^REGISTERED AGENT (?:NAME|PERSON)\s*[:#-]?\s*(.*)$/i,
    /^NAME OF REGISTERED AGENT\s*[:#-]?\s*(.*)$/i,
  ])
  const registeredAgentAddress=labelValue([
    /^REGISTERED AGENT (?:STREET )?ADDRESS\s*[:#-]?\s*(.*)$/i,
    /^STREET ADDRESS OF REGISTERED AGENT\s*[:#-]?\s*(.*)$/i,
  ])
  const effectiveDate=labelValue([
    /^EFFECTIVE DATE\s*[:#-]?\s*(.*)$/i,
  ])
  const entityType=/\b(?:ARTICLES OF ORGANIZATION|LIMITED LIABILITY COMPANY)\b/i.test(source)
    ? 'LLC'
    : /\bARTICLES OF INCORPORATION\b/i.test(source) ? 'C-Corp' : ''
  const floridaHeader=/FLORIDA\s+DEPARTMENT\s+OF\s+STATE|DIVISION\s+OF\s+CORPORATIONS/i.test(source)
  const expected=norm(expectedName)
  const extracted=norm(companyName)
  return {
    companyName,documentNumber,filedDate,principalAddress,mailingAddress,
    registeredAgent,registeredAgentAddress,effectiveDate,entityType,
    floridaHeader,
    nameMatches:!!expected && !!extracted && expected === extracted,
    canVerify:!!expected && !!extracted && expected === extracted && floridaHeader,
    readable:source.replace(/\s/g,'').length>=30,
  }
}
export async function parseFloridaSunbizPdf(file,expectedName) {
  if (!file || file.size > 12*1024*1024 || !/\.pdf$/i.test(file.name)) {
    throw new Error('Select a PDF up to 12 MB')
  }
  const header=new Uint8Array(await file.slice(0,5).arrayBuffer())
  if (String.fromCharCode(...header)!=='%PDF-') throw new Error('Selected file is not a PDF')
  const text=await extractPdfText(file)
  const result=parseFloridaSunbizText(text,expectedName)
  if (!result.readable) throw new Error('PDF contains no extractable text. Obtain a searchable Sunbiz PDF; scanned images need manual review.')
  return result
}

export function normalizeFloridaFilingDate(value) {
  const input=String(value||'').trim()
  let year,month,day
  let m=input.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if(m){year=+m[1];month=+m[2];day=+m[3]}
  else {
    m=input.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/)
    if(!m) return ''
    month=+m[1];day=+m[2];year=+m[3]
    if(year<100) year+=2000
  }
  const date=new Date(Date.UTC(year,month-1,day))
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return ''
  if(year<1900||year>2100)return ''
  return [year,String(month).padStart(2,'0'),String(day).padStart(2,'0')].join('-')
}

// Never replace CRM edits silently, and never treat an imported PDF as proof
// of an approved formation or a successful government payment.
export function planFloridaSunbizBusinessUpdate(parsed,existing={},kind='Filed Articles') {
  if(!parsed?.canVerify) throw new Error('Florida PDF name and agency header must match first')
  const isArticles=kind==='Filed Articles'||kind==='Certified Copy'
  if(!isArticles) return {patch:{},conflicts:[]}
  if(parsed.entityType && existing.entity_type &&
    parsed.entityType!==existing.entity_type && !(parsed.entityType==='LLC' && existing.entity_type==='Professional LLC (PLLC)')) {
    throw new Error('PDF entity type does not match this FormaCorp case')
  }
  const patch={}, conflicts=[]
  const candidate={
    principal_address:parsed.principalAddress,
    mailing_address:parsed.mailingAddress,
    registered_agent:parsed.registeredAgent,
    registered_agent_address:parsed.registeredAgentAddress,
    effective_date:normalizeFloridaFilingDate(parsed.effectiveDate),
    state_file_num:parsed.documentNumber,
    formation_date:normalizeFloridaFilingDate(parsed.filedDate),
  }
  for(const [field,value] of Object.entries(candidate)){
    const next=String(value||'').trim(),current=String(existing[field]||'').trim()
    if(!next)continue
    if(!current)patch[field]=next
    else if(current.toUpperCase().replace(/\s+/g,' ')!==next.toUpperCase().replace(/\s+/g,' ')) {
      conflicts.push({field,current,fromPdf:next})
    }
  }
  return {patch,conflicts}
}
