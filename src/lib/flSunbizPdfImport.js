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
