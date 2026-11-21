import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const billing=readFileSync('src/components/admin/RomyLabsBilling.jsx','utf8')
const ledger=readFileSync('src/components/admin/RomyLabsLedgerExplorer.jsx','utf8')
for(const [code,description] of [
  ["'trial','transactions'","Transactions pill must sit next to account status filters"],
  ["v==='transactions'?'Transactions ('+payments.length+')'","Transactions pill must display real payment count"],
  ["filter==='transactions' ? <div","Clicking Transactions shows a collapsed history control"],
  ["transactionsOnly/>","Focused ledger must not expose unrelated invoice view"],
  ["filter!=='transactions'&&<details","Office ledger is collapsed unless explicitly opened outside Transactions view"],
  ["filter!=='transactions'&&registeredWithoutBilling","Do not show unrelated registered-office list in Transactions view"]
])assert(billing.includes(code),description)
assert(billing.includes("const [transactionsOpen,setTransactionsOpen] = useState(false)"),'Transaction history starts collapsed')
assert(billing.includes("if(v==='transactions')setTransactionsOpen(false)"),'Switching back to Transactions resets closed state')
assert(billing.includes('aria-expanded={transactionsOpen}'),'Disclosure exposes expanded state')
assert(billing.includes("transactionsOpen?'▾ Hide transactions':'▸ Show transactions'"),'Disclosure label is clear')
assert(billing.includes('transactionsOpen&&<div id="romylabs-office-transactions-history"'),'Transaction ledger only mounts when expanded')
assert(ledger.includes('useState(transactionsOnly?25:100)'),'Dedicated transaction history initially shows 25 not 100 rows')
assert(ledger.includes('maxHeight:transactionsOnly?460:undefined'),'Transaction history height bounded')
assert(ledger.includes("position:transactionsOnly?'sticky':undefined"),'Transaction table headers remain visible when scrolling')
assert(ledger.includes('n+(transactionsOnly?25:100)'),'Progressive transaction paging adds 25 rows at a time')
assert(ledger.includes('transactionsOnly=false'),'Ledger must preserve existing uses by default')
assert(ledger.includes('{!transactionsOnly&&<div'),'Focused Transactions view hides Payments/Invoices switch')
assert(ledger.includes("setTab('payments')")||ledger.includes("useState('payments')"),'Focused view must start on payments')
assert(ledger.includes('romylabs-payment-transactions.csv'),'Transaction export must remain available')
assert(ledger.includes('aria-label="From date"'),'Date filters must remain accessible')
console.log('PASS RomyLabs dedicated Transactions account-filter navigation and ledger parity')
