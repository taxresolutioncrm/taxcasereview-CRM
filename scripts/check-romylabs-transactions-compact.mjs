import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const processor=readFileSync('src/components/admin/RomyLabsProcessorDashboard.jsx','utf8')
assert(processor.includes("const [historyOpen,setHistoryOpen]=useState(false)"),'Transaction history must be collapsed by default')
assert(processor.includes("const showTransactionTable=view!=='payments'||historyOpen||Boolean(search.trim())"),'Collapse must hide payment rows, while search opens matching records')
assert(processor.includes('▾ Show transactions'),'History disclosure control required')
assert(processor.includes('aria-expanded={historyOpen}'),'History disclosure must expose accessible state')
assert(processor.includes('maxHeight:view===\'payments\'&&historyOpen?480'),'Expanded history must be scroll-constrained')
assert(processor.includes('Show 20 more transactions'),'History must support progressive reveal')
assert(processor.includes('{showTransactionTable&&<div id="romylabs-stripe-transaction-list"'),'Transaction table must not render while collapsed')
assert(processor.includes("rows.slice(0,historyLimit):rows"),'History pagination must not truncate search results')
assert(processor.includes('Showing the 50 most recent Stripe records only'),"Do not represent Stripe's capped snapshot as all-time history")
console.log('PASS compact RomyLabs Stripe transaction history')
