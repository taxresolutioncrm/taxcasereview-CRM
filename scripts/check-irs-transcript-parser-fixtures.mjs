import { parseIrsTranscript } from '../src/lib/irsTranscriptParser.js'

const failures=[]
const eq=(label,a,b)=>{ if(a!==b) failures.push(`${label}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`) }
const ok=(label,v)=>{ if(!v) failures.push(label) }

const account=`Account Transcript
Tax Period Ending: Dec. 31, 2021
NAME(S) SHOWN ON RETURN: JANE Q TAXPAYER
FILING STATUS: Single
ACCOUNT BALANCE: 12,345.67
ACCRUED PENALTY: 456.78
ACCRUED INTEREST: 123.45
TRANSACTIONS
150 Tax return filed 20213205 08-30-2021 5,231.00
582 Federal tax lien filed 03-14-2022 0.00
530 Account currently not collectible 05-01-2022 0.00
`
const a=parseIrsTranscript(account)
eq('account type',a.transcript_type,'Account Transcript')
eq('account year',a.tax_year,'2021')
eq('account taxpayer',a.taxpayer_name,'JANE Q TAXPAYER')
eq('account balance',a.account_balance,12345.67)
eq('account penalty',a.accrued_penalty,456.78)
eq('account interest',a.accrued_interest,123.45)
eq('assessment date',a.assessment_date,'08/30/2021')
eq('estimated CSED',a.csed_estimate,'08/30/2031')
ok('lien flag',a.flags.lien_filed===true)
ok('CNC flag',a.flags.currently_not_collectible===true)
ok('filed return not unfiled',a.flags.unfiled_return===false)
eq('transaction count',a.transactions.length,3)

const wi=`Wage and Income Transcript
Tax Period Requested: December, 2023
Taxpayer Name: JOHN TAXPAYER
Form W-2 Wage and Tax Statement
Employer: ACME CORP
Wages, tips and other compensation: 52,341.00
Form 1099-NEC
Payer: CLIENT LLC
Nonemployee compensation: 9,500.00
`
const w=parseIrsTranscript(wi)
eq('WI type',w.transcript_type,'Wage and Income')
eq('WI year',w.tax_year,'2023')
eq('WI item count',w.wage_income.length,2)
eq('WI W2 form',w.wage_income[0]?.form,'W-2')
eq('WI W2 amount',w.wage_income[0]?.amount,52341)
eq('WI 1099 amount',w.wage_income[1]?.amount,9500)

const roA=`Record of Account
Tax Period Ending: 12-31-2020
ACCOUNT BALANCE: 0.00
TRANSACTIONS
150 Tax return filed 20203505 09-01-2020 0.00
`
const r=parseIrsTranscript(roA)
eq('ROA type',r.transcript_type,'Record of Account')
eq('ROA year',r.tax_year,'2020')

const nonfile=`Verification of Non-Filing
Tax Period Requested: December, 2022
Taxpayer Name: NO RETURN
No record of a return filed for the tax period shown.
`
const n=parseIrsTranscript(nonfile)
eq('VNF type',n.transcript_type,'Verification of Non-Filing')
eq('VNF year',n.tax_year,'2022')
ok('VNF unfiled flag',n.flags.unfiled_return===true)

const ret=`Tax Return Transcript
Tax Period Ending: Dec. 31, 2024
Taxpayer Name: RETURN TEST
ADJUSTED GROSS INCOME: 101,000.00
TAXABLE INCOME: 80,000.00
`
const t=parseIrsTranscript(ret)
eq('return type',t.transcript_type,'Return Transcript')
eq('return year',t.tax_year,'2024')
eq('AGI',t.adjusted_gross_income,101000)
eq('taxable income',t.taxable_income,80000)

if(failures.length){
  console.error('IRS transcript parser fixture failures:')
  failures.forEach(x=>console.error(' - '+x))
  process.exit(1)
}
console.log('✅ IRS transcript parser fixtures passed')
