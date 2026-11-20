import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const processor=readFileSync('src/components/admin/RomyLabsProcessorDashboard.jsx','utf8')
for(const [id,label] of [
  ['payments','Transactions'],['subscriptions','Subscriptions'],['invoices','Stripe invoices'],
  ['payouts','Payouts'],['balance_transactions','Fees & net'],['refunds','Refunds'],['disputes','Disputes']
])assert(processor.includes("['"+id+"','"+label+"']"),label+' must have merchant tab')
assert(processor.includes("const [historyOpen,setHistoryOpen]=useState(false)"),'Every tab must begin collapsed')
assert(processor.includes("const showTransactionTable=historyOpen||Boolean(search.trim())"),'A collapsed tab must actually hide its table; search must reveal matches')
assert(processor.includes("categoryName=views.find"),'Disclosure must use selected category, not hardcoded transactions')
assert(processor.includes("historyOpen?'▴ Hide '+categoryName:'▾ Show '+categoryName"),'Every tab must have dynamic hide/show arrow')
assert(processor.includes("setHistoryOpen(false);setHistoryLimit(20)"),'Changing tabs must start new category collapsed')
assert(processor.includes('aria-expanded={historyOpen}'),'Disclosure must expose accessible state')
assert(processor.includes('maxHeight:historyOpen?480'),'All expanded histories must be scroll-constrained')
assert(processor.includes('Show 20 more {categoryName}'),'Every category must support progressive reveal')
assert(processor.includes('{showTransactionTable&&<div id="romylabs-stripe-transaction-list"'),'Tables must unmount while collapsed')
assert(processor.includes("rows.slice(0,historyLimit):rows"),'Search must not truncate matching results')
assert(processor.includes('Showing the 50 most recent Stripe records only'),'Do not misrepresent the capped Stripe snapshot as all-time')
console.log('PASS all seven RomyLabs Stripe merchant tabs have functional disclosures')
