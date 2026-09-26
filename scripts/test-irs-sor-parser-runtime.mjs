import { extractTranscriptText, parseIrsTranscript } from '../src/lib/irsTranscriptParser.js'

const html = `<!doctype html>
<html><body>
<h1>Account Transcript</h1>
<div>Taxpayer Name: Jane Doe</div>
<div>Tax Period Ending: Dec. 31, 2022</div>
<div>ACCOUNT BALANCE: 1,234.56</div>
<div>FILING STATUS: Single</div>
<div>TRANSACTIONS</div>
<div>150 Tax return filed 20223405 08-30-2023 1,234.56</div>
</body></html>`

const file={
  type:'text/html',
  name:'IRS-TDS-TX123.html',
  text:async()=>html,
}

const text=await extractTranscriptText(file)
const parsed=parseIrsTranscript(text)

const fail=(m)=>{ throw new Error(m) }
if(!text.includes('Account Transcript')) fail('HTML transcript text extraction failed')
if(parsed.transcript_type!=='Account Transcript') fail('transcript type parse failed')
if(parsed.tax_year!=='2022') fail('tax year parse failed')
if(parsed.taxpayer_name!=='Jane Doe') fail('taxpayer name parse failed')
if(parsed.account_balance!==1234.56) fail('account balance parse failed')

console.log('PASS: IRS SOR HTML transcript parser runtime contract')
