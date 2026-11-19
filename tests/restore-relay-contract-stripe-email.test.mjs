import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRestoreRelayAgreementPdf} from '../src/lib/restoreRelayAgreementPdf.js'
import {normalizeStripePaymentLink,restoreRelaySigningAndPaymentEmail,RESTORE_RELAY_MONTHLY_CENTS,RESTORE_RELAY_MONTHS,RESTORE_RELAY_TOTAL_CENTS} from '../src/lib/restoreRelayPaymentProtocol.js'

assert.equal(RESTORE_RELAY_MONTHLY_CENTS,39900)
assert.equal(RESTORE_RELAY_MONTHS,6)
assert.equal(RESTORE_RELAY_TOTAL_CENTS,239400)
const agreement=await createRestoreRelayAgreementPdf({customer:'Demo Roofing LLC',monthlyPrice:'399.00',months:6})
assert.ok(agreement.bytes.byteLength>3000)
assert.match(agreement.fileName,/Demo-Roofing-LLC/)
await assert.rejects(()=>createRestoreRelayAgreementPdf({customer:'Demo',monthlyPrice:'399.99',months:6}),/399.00/)
await assert.rejects(()=>createRestoreRelayAgreementPdf({customer:'Demo',monthlyPrice:'399.00',months:7}),/399.00/)
const buy='https://buy.stripe.com/abc123TestLink'
assert.equal(normalizeStripePaymentLink(buy),buy)
for(const invalid of [
  'https://buy.stripe.com/test_12345','http://buy.stripe.com/abc123',
  'https://buy.stripe.com.evil.com/abc','https://checkout.stripe.com/c/pay/abc',
  'https://buy.stripe.com/abc?fake=1','javascript:alert(1)','',
])assert.throws(()=>normalizeStripePaymentLink(invalid))
const sign='https://admin.romylabs.com/office-sign/'+'a'.repeat(64)
const html=restoreRelaySigningAndPaymentEmail({
  signUrl:sign,paymentUrl:buy,recipientName:'<Customer>',customerName:'Calico GC LLC',
  title:'Restore Relay Professional Plan'
})
const saleSign='https://admin.romylabs.com/agreement/'+'b'.repeat(64)
const presaleHtml=restoreRelaySigningAndPaymentEmail({signUrl:saleSign,paymentUrl:buy,customerName:'Calico GC LLC',title:'Restore Relay Agreement'})
assert.ok(presaleHtml.includes(saleSign) && presaleHtml.includes(buy))
const prospectUi=readFileSync('src/components/admin/RomyLabsAgreementPanel.jsx','utf8')
assert.match(prospectUi,/admin_romylabs_set_sales_agreement_stripe_link/)
assert.match(prospectUi,/restoreRelaySigningAndPaymentEmail/)
assert.match(prospectUi,/restore_relay_six_month_link/)
const presaleSql=readFileSync('supabase/migrations/20261118214500_restore_relay_presale_stripe_agreement.sql','utf8')
assert.match(presaleSql,/not public\._is_platform_admin\(\)/)
assert.match(presaleSql,/Restore Relay Professional Plan/)
assert.match(presaleSql,/\$2,394\.00 total/)
assert.ok(html.includes(sign))
assert.ok(html.includes(buy))
assert.match(html,/Start \$399\/month Subscription/)
assert.match(html,/\$2,394.00 total/)
assert.match(html,/five more monthly installments/)
assert.doesNotMatch(html,/<Customer>/)
assert.throws(()=>restoreRelaySigningAndPaymentEmail({signUrl:'https://evil.example/phish',paymentUrl:buy}))
const ui=readFileSync('src/components/admin/UniversalOfficeESign.jsx','utf8')
assert.match(ui,/admin_romylabs_set_restore_relay_signing_payment_link/)
assert.match(ui,/storedStripeLink/)
assert.match(ui,/restore_relay_six_month_link/)
const sql=readFileSync('supabase/migrations/20261118213000_restore_relay_office_esign_stripe_link.sql','utf8')
assert.match(sql,/can_manage_romylabs_office_esign/)
assert.match(sql,/v_row\.product_key <> 'restore_relay'/)
assert.match(sql,/revoke all .* from public, anon/)
assert.match(sql,/grant execute .* to authenticated/)
const composer=readFileSync('src/pages/NewOffice.jsx','utf8')
assert.match(composer,/function RestoreRelayPreSaleComposer/)
assert.match(composer,/admin_romylabs_create_restore_relay_presale_prospect/)
assert.match(composer,/admin_romylabs_restore_relay_presale_prospects/)
assert.match(composer,/<RestoreRelayPreSaleComposer\/>/)
assert.match(composer,/prospect=\{selected\}/)
const composerSql=readFileSync('supabase/migrations/20261118222500_restore_relay_presale_prospect_composer.sql','utf8')
assert.match(composerSql,/not public\._is_platform_admin\(\)/)
assert.match(composerSql,/p\.product='restore_relay'/)
assert.match(composerSql,/v_name,v_contact,v_email,'restore_relay','New Lead',10,399\.00/)
assert.match(composerSql,/revoke all on function public\.admin_romylabs_create_restore_relay_presale_prospect/)

const checkoutFn=readFileSync('supabase/functions/romylabs-stripe-checkout/index.ts','utf8')
const webhookFn=readFileSync('supabase/functions/romylabs-stripe-webhook/index.ts','utf8')
assert.match(checkoutFn,/price_1Ud2Q6Fomt0HrzTfApwGodx0/)
assert.match(checkoutFn,/restore_relay_six_month_link/)
const rrCheckoutBranch=checkoutFn.split("if(action==='restore_relay_six_month_link')")[1]?.split("if(action==='checkout')")[0]||''
assert.ok(rrCheckoutBranch.length>500,'Restore Relay subscription handler must exist')
assert.doesNotMatch(rrCheckoutBranch,/ROMYLABS_BILLING_WEBHOOK_SECRET/,
  'Restore Relay subscription checkout must not require unrelated invoice billing adapter secret')
assert.match(rrCheckoutBranch,/webhook_verified_at/,
  'Restore Relay subscription checkout must still verify signed Stripe webhook')
assert.match(rrCheckoutBranch,/plink_1UdYiUFomt0HrzTfBbOjOI4k/,
  'Calico must reuse verified existing recurring link')
assert.match(rrCheckoutBranch,/permissionProbe\.status!==400/,
  'The existing link must never bypass Subscription Schedules Write permission')
const officeMail=readFileSync('supabase/functions/send-email/index.ts','utf8')
assert.match(officeMail,/\[RomyLabs E-Sign Sent\]/,
  'Admin must receive a delivery copy after recipient mail')
assert.match(officeMail,/ownerCopyTo='romy@romylabs.com'/)
assert.match(officeMail,/owner_copy_sent:ownerCopySent/)


assert.match(checkoutFn,/subscription_schedules/)
assert.match(webhookFn,/signatureOkay\(raw,auth,signing\)/)
assert.match(webhookFn,/from_subscription/)
assert.match(webhookFn,/end_behavior:'cancel'/)
assert.match(webhookFn,/interval_count\]':'6'/)

const lifecycle=readFileSync('supabase/functions/office-agreement-file/index.ts','utf8')
assert.match(lifecycle,/sendOwnerLifecycleNotice\(admin,doc,'viewed'\)/)
assert.match(lifecycle,/sendSignedCopy\(admin,doc,officeFacingSignedBytes\)/)
assert.match(lifecycle,/recipientAddress=String\(recipientOverride\|\|'romy@romylabs.com'\)/)
assert.match(lifecycle,/owner_signed_copy_sent/)
assert.match(lifecycle,/owner_viewed_notification_sent/)
assert.match(lifecycle,/sendSignedCopy\(admin,doc,officeFacingSignedBytes,String\(doc.signer_email\)\)/)

// Unsent Calico envelope must be sent as-is, with the correct live mailbox.
const routedMailMigration=readFileSync('supabase/migrations/20261119195700_restore_relay_esign_mailbox_route.sql','utf8')
assert.doesNotMatch(routedMailMigration,/v_product = 'restore_relay' then/,
  'Do not force a personal mailbox for Restore Relay contract delivery')
assert.match(routedMailMigration,/romylabs_mailboxes m/)
assert.match(routedMailMigration,/m.active = true/)
assert.match(routedMailMigration,/m.outbound_from/)
assert.match(routedMailMigration,/like 'stalwart%'/)
assert.match(ui,/row.status==='pending'\?'Send Now':'Resend'/)
assert.match(ui,/serverError\?\.error/)
console.log('PASS Restore Relay $399/6-month PDF, live Stripe link gating, one-email template, resend persistence and tenant authorization')
