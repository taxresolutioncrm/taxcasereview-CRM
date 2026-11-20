import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const processor=readFileSync('src/components/admin/RomyLabsProcessorDashboard.jsx','utf8')
assert(processor.includes("const [historyOpen,setHistoryOpen]=useState(false)"),'Transaction history must be collapsed by default')
assert(processor.includes('transactionPreview?5:'),'Transaction preview must show no more than five rows')
assert(processor.includes('▾ View transaction history'),'History disclosure control required')
assert(processor.includes('aria-expanded={historyOpen}'),'History disclosure must expose accessible state')
assert(processor.includes('maxHeight:view===\'payments\'&&historyOpen?480'),'Expanded history must be scroll-constrained')
assert(processor.includes('Show 20 more transactions'),'History must support progressive reveal')
assert(processor.includes("historyOpen?historyLimit:rows.length"),'Search results must remain accessible when history is collapsed')
assert(processor.includes('Showing the 50 most recent Stripe records only'),"Do not represent Stripe's capped snapshot as all-time history")
console.log('PASS compact RomyLabs Stripe transaction history')
