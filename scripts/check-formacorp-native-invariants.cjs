const fs = require('fs')

const files = [
  'src/pages/FormaCorp.jsx',
  'src/components/formacorp/FormaCorpLifecycle.jsx',
  'src/lib/flArticlesPdf.js',
  'src/lib/formacorpDocs.js',
  'src/components/formacorp/FormaCorpStateFeeModal.jsx',
  'supabase/functions/formacorp-state-fee-intent/index.ts',
  'supabase/functions/formacorp-state-fee-confirm/index.ts',
  'supabase/migrations/20260918192500_formacorp_taxres_family_compat.sql',
  'supabase/migrations/20260919012000_formacorp_florida_corporation_fields.sql',
  'supabase/migrations/20260919053500_formacorp_state_fee_payment_audit.sql',
  'src/pages/Manual.jsx',
]
const content = files.map(p => fs.readFileSync(p,'utf8')).join('\n')
const failures = []
const assert = (ok,msg) => { if(!ok) failures.push(msg) }

assert(!/bizee/i.test(content), 'FormaCorp native workflow must not depend on Bizee')
assert(!/target="_blank"|window\.open\(/.test(content), 'FormaCorp must not open any workflow in another browser tab/window')
assert(!/orders\.bizee\.com|bizee\.com/i.test(content), 'External Bizee URL detected')
assert(!/popup=yes|formacorp_bizee_pro|Open Bizee Secure Window/i.test(content), 'External Bizee popup workflow detected')
assert(!/<iframe[^>]+bizee/i.test(content), 'Bizee iframe workflow detected')
assert(!/zapier|make\.com|browserless|proxycurl/i.test(content), 'Paid middleware/add-on detected in FormaCorp scope')
assert(/Start Business Formation/.test(content), 'Native formation entry point is missing')
assert(/FormaCorp native filing workflow/.test(content), 'Native filing workflow card is missing')
assert(/Florida submission inside FormaCorp/.test(content), 'In-CRM Florida submission controls are missing')
assert(/submitFloridaFax/.test(content), 'Existing in-CRM Florida fax submission path is missing')
assert(/isFloridaCorporation/.test(content), 'Florida corporation filing support is missing')
assert(/fl_authorized_shares/.test(content), 'Florida profit corporation share authorization field is missing')
assert(/fl_incorporator_signature/.test(content), 'Florida corporation incorporator signature is missing')
assert(/Articles of Incorporation/.test(content), 'Florida corporation Articles of Incorporation generator is missing')
assert(/buildCorporateBylawsPdf/.test(content), 'Corporate bylaws generator is missing')
assert(/Corporate Bylaws/.test(content), 'Corporation governing-document workflow is missing')
assert(/return 70 \+/.test(content), 'Florida corporation base state fee calculation is missing')
assert(/formacorp-state-fee-intent/.test(content), 'In-CRM government filing payment intent is missing')
assert(/formacorp-state-fee-confirm/.test(content), 'Government filing payment verification is missing')
assert(/state_fee_payment_status/.test(content), 'Government filing payment audit state is missing')
assert(/Government filing amount|Government filing funds/.test(content), 'Government filing payment UI is missing')
assert(/hasStateFilingFunds/.test(content), 'State filing payment gate is missing')
assert(/state_fee_remitted_at/.test(content), 'Government fee remittance audit is missing')
assert(/eq\('tenant_id',tenantId\)/.test(content), 'State-fee Stripe settings are not tenant-scoped')
assert(/stripe_account/.test(content), 'Connected Stripe account routing is missing')
assert(!/from\('settings'\).*stripe_publishable_key/.test(files.map(p => p.includes('FormaCorpStateFeeModal') ? fs.readFileSync(p,'utf8') : '').join('\n')), 'State-fee browser UI must not depend on direct settings-table access')
assert(/platformPublishableKey/.test(content), 'Connected Stripe accounts must use the platform publishable key with Stripe-Account routing')
assert(/Idempotency-Key/.test(content), 'State-fee PaymentIntent creation must be idempotent')
assert(/state_fee_payment_intent_id/.test(content), 'State-fee PaymentIntent recovery reference is missing')
assert(/already_succeeded/.test(content), 'Completed state-fee payment recovery path is missing')
assert(/ensurePaymentAuditEvent/.test(content), 'State-fee payment audit recovery path is missing')
assert(/reused:true/.test(content), 'Existing state-fee PaymentIntent reuse path is missing')
assert(/prepaidFundsConfirmed/.test(content), 'Prepaid Sunbiz sufficient-funds confirmation gate is missing')
assert(/Math\.abs\(collected - required\)/.test(content), 'Exact government-filing amount gate is missing')
assert(/Section 501\(c\)\(3\)/.test(content), '501(c)(3) organizing language is missing from nonprofit documents')
assert(/fl_director_election_method/.test(content), 'Florida nonprofit director election method is missing')
assert(/floridaEntityNameValid/.test(content), 'Florida legal entity suffix validation is missing')
assert(/isPoBox/.test(content), 'Florida physical-address P.O. Box guard is missing')
assert(/looksLikeFloridaAddress/.test(content), 'Florida registered-agent state-address guard is missing')
assert(/floridaEffectiveDateValid/.test(content), 'Florida effective-date statutory window guard is missing')
assert(!/registered_agent:\s*'Self \(Owner\)'/.test(content), 'Florida filing must capture the actual registered-agent legal name')
assert(/At least 3 directors when directors are listed/.test(content), 'Florida nonprofit listed-director minimum guard is missing')
assert(/Record State Submission/.test(content), 'State submission tracking control is missing')
assert(/Record Approval/.test(content), 'State approval tracking control is missing')
assert(/Record Rejection/.test(content), 'State rejection tracking control is missing')
assert(/Operating Agreement/.test(content), 'Operating Agreement workflow is missing')
assert(/Bank Account Setup|Banking/.test(content), 'Banking workflow is missing')
assert(/Compliance/.test(content), 'Compliance workflow is missing')

assert(/id:\s*'formacorp'/.test(content), 'CRM Manual is missing the dedicated FormaCorp section')
assert(/A-to-Z business formation/.test(content), 'CRM Manual is missing the FormaCorp A-to-Z workflow')
assert(/Pay Government Filing Amount/.test(content), 'CRM Manual is missing in-CRM government filing payment instructions')
assert(/Submit via Prepaid Sunbiz Fax/.test(content), 'CRM Manual is missing the prepaid Sunbiz submission instructions')
assert(/Government funds collected from the client inside FormaCorp/.test(content), 'CRM Manual is missing received-vs-remitted filing-funds guidance')
assert(/Record approval only after Florida accepts the filing/.test(content), 'CRM Manual is missing the Florida approval gate')
assert(/Company Lifecycle → EIN/.test(content), 'CRM Manual is missing the EIN lifecycle instructions')
assert(/LLC \/ PLLC → Operating Agreement/.test(content), 'CRM Manual is missing LLC governing-document instructions')
assert(/Corporation → Corporate Bylaws/.test(content), 'CRM Manual is missing corporation bylaws instructions')
assert(/Open Company Lifecycle → Banking/.test(content), 'CRM Manual is missing business-banking instructions')
assert(/Open Compliance/.test(content), 'CRM Manual is missing post-formation compliance instructions')
assert(/manual must be updated in the same release whenever the workflow changes/.test(content), 'CRM Manual update policy is missing')

if(failures.length){
  console.error('FormaCorp native invariant check FAILED:')
  for(const f of failures) console.error(' - '+f)
  process.exit(1)
}
console.log('FormaCorp native invariant check PASS')
