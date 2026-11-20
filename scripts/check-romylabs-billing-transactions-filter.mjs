import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const billing=readFileSync('src/components/admin/RomyLabsBilling.jsx','utf8')
const ledger=readFileSync('src/components/admin/RomyLabsLedgerExplorer.jsx','utf8')
for(const [code,description] of [
  ["'trial','transactions'","Transactions pill must sit next to account status filters"],
  ["v==='transactions'?'Transactions ('+payments.length+')'","Transactions pill must display real payment count"],
  ["filter==='transactions' ? <RomyLabsLedgerExplorer","Clicking Transactions replaces account table with payment ledger"],
  ["transactionsOnly/>","Focused ledger must not expose unrelated invoice view"],
  ["filter!=='transactions'&&<RomyLabsLedgerExplorer","Do not render duplicate ledger below Transactions view"],
  ["filter!=='transactions'&&registeredWithoutBilling","Do not show unrelated registered-office list in Transactions view"]
])assert(billing.includes(code),description)
assert(ledger.includes('transactionsOnly=false'),'Ledger must preserve existing uses by default')
assert(ledger.includes('{!transactionsOnly&&<div'),'Focused Transactions view hides Payments/Invoices switch')
assert(ledger.includes("setTab('payments')")||ledger.includes("useState('payments')"),'Focused view must start on payments')
assert(ledger.includes('romylabs-payment-transactions.csv'),'Transaction export must remain available')
assert(ledger.includes('aria-label="From date"'),'Date filters must remain accessible')
console.log('PASS RomyLabs dedicated Transactions account-filter navigation and ledger parity')
