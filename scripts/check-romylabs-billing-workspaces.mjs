import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transform} from 'esbuild'
const read=p=>readFileSync(p,'utf8')
const billing=read('src/components/admin/RomyLabsBilling.jsx')
const editor=read('src/components/admin/RomyLabsMonthlyReminderEditor.jsx')
const stripe=read('src/components/admin/RomyLabsStripeSettings.jsx')
const processor=read('src/components/admin/RomyLabsProcessorDashboard.jsx')
await transform(billing,{loader:'jsx',target:'es2022'})
for(const [needle,explanation] of [
  ["const [workspace,setWorkspace] = useState('accounts')",'Office Accounts is default billing workspace'],
  ["['accounts','Office Accounts'",'Separate accounts workspace'],
  ["['stripe','Stripe Activity'",'Separate Stripe reporting workspace'],
  ["['reminders','Monthly Reminders'",'Separate branded reminder workspace'],
  ["['tools','Payment Tools'",'Separate merchant and invoice setup workspace'],
  ["aria-label=\"Billing workspaces\"",'Workspace navigation is accessible'],
  ["aria-current={workspace===id?'page':undefined}",'Active workspace is identifiable'],
  ["{workspace==='stripe'&&<section",'Stripe view is conditionally rendered'],
  ["{workspace==='reminders'&&<section",'Reminders do not crowd the accounts view'],
  ["{workspace==='tools'&&<section",'Setup controls do not crowd the merchant reporting view'],
  ["{workspace==='accounts'&&<section",'Account KPIs and tables are isolated'],
  ['<RomyLabsProcessorDashboard onRefresh={load}/>','Existing Stripe reporting preserved'],
  ['<RomyLabsStripeSettings invoices={invoices} onRefresh={load}/>','Existing verified Stripe merchant setup preserved'],
  ['<RomyLabsMonthlyReminderEditor products={products} accounts={accounts} officeRegistry={officeRegistry}/>','Office-specific reminder editor preserved'],
  ['<RomyLabsInvoiceSetup accounts={accounts} invoices={invoices} officeRegistry={officeRegistry} onRefresh={load}/>','Existing invoice setup preserved'],
  ["filter==='transactions' ? <div",'Transactions workspace retains compact history disclosure'],
  ["const [transactionsOpen,setTransactionsOpen] = useState(false)",'Transaction history starts closed'],
  ["aria-expanded={transactionsOpen}",'Transaction history exposes correct expanded state'],
  ["onClick={()=>setTransactionsOpen(open=>!open)}",'Transaction history can be opened and closed'],
  ['transactionsOpen&&<div id="romylabs-office-transactions-history"','Transaction history mounts only on expansion'],
  ['<RomyLabsLedgerExplorer accounts={accounts} invoices={invoices} payments={payments} events={events} transactionsOnly/>','Expanded Transactions displays real filtered payment ledger'],
  ["{paymentOpen &&",'Manual payment modal persists across views'],
  ["{selected &&",'Account detail drawer persists'],
  ["supabase.rpc('admin_record_manual_subscription_payment'",'Manual payment database logic unchanged'],
  ["supabase.rpc('romylabs_billing_dashboard')",'Billing dashboard source unchanged'],
  ["supabase.rpc('admin_romylabs_office_registry')",'Registry source unchanged']
])assert(billing.includes(needle),explanation)
const ledger=read('src/components/admin/RomyLabsLedgerExplorer.jsx')
for(const [needle,explanation] of [
  ['aria-label="Search billing transactions"','History search remains available'],
  ['aria-label="Filter payment method"','Payment method filter remains available'],
  ['aria-label="Filter billing status"','Payment status filter remains available'],
  ['aria-label="From date"','Start date filter remains available'],
  ['aria-label="To date"','End date filter remains available'],
  ['romylabs-payment-transactions.csv','Full filtered transaction CSV export remains available'],
  ['transactionsOnly?25:100','Focused transaction ledger keeps compact pagination']
])assert(ledger.includes(needle),explanation)
assert(editor.includes('Select reminder office'),'Office reminder control unchanged')
assert(processor.includes('Stripe processing fees'),'Stripe finance read-only metrics unchanged')
assert(stripe.includes("action:'checkout_ach'"),'ACH checkout handling unchanged')
assert((billing.match(/<RomyLabsProcessorDashboard onRefresh={load}\/>/g)||[]).length===1,'Render merchant reporting once only')
assert((billing.match(/<RomyLabsMonthlyReminderEditor products={products} accounts={accounts} officeRegistry={officeRegistry}\/>/g)||[]).length===1,'Render reminder editor once only')
console.log('PASS RomyLabs Billing workspace separation, JSX syntax and retained payment operations')
