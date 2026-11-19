# RomyLabs Stripe Billing: operator setup and production release checklist

**Merchant**: Romy Labs, LLC · **Stripe Account**: `acct_1UaFszFomt0HrzTf` · **Settlement bank**: Mercury business checking. RomyLabs office subscription money only; each CRM tenant's customers' funds remain separate.

## Before running a live charge
- This release is in a draft PR. Follow **sandbox-first** protocol, run the existing `check-romylabs-stripe-merchant` and new `check-romylabs-billing-ledger` checks plus full Vite build locally/sandbox, manually verify test mode and one consolidated Cloud deployment only after green. Do not enable a charge in a partial deployment.
- Sign in to Stripe as Romy Labs, LLC, and confirm merchant account is fully verified and eligible to accept online card payments. Select **test mode** first.

### 1. Restricted API key
Stripe Dashboard → Developers → API keys → Create a secret key → Building your own integration → Custom permissions.
- Name: **RomyLabs Admin Portal – Billing (Test)**, then later create a separate **(Live)** key.
- Minimum code paths currently exercised: `GET /v1/account` and `POST /v1/checkout/sessions`. Grant **Account: Read** and **Checkout Sessions: Write**. Stripe may require related granular price/product access for inline Checkout Price data; resolve actual test-mode permission errors by adding the least privilege that is proven necessary.
- Result starts with `rk_test_` (test) / `rk_live_` (live). Never use unrestricted `sk_`, never paste secrets into chat or a repository.
- Admin Portal → Billing → Stripe Payment Settings → Environment test → paste the restricted key → **Verify & Save Stripe Key**. Backend verifies the exact account and encrypts the key in Supabase Vault.

### 2. Signed webhook
Stripe Dashboard → Developers / Workbench → Webhooks → Add destination for the current environment:
`https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/romylabs-stripe-webhook`
Subscribe to:
- `account.updated` (signed, merchant-specific delivery verification; test using an event with the actual RomyLabs merchant Account object)
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `charge.refunded`
- `charge.dispute.created`
- `radar.early_fraud_warning.created`

Copy its **signing secret `whsec_`**, not the endpoint ID. Paste it in the corresponding Admin Portal **Webhook signing secret** field → **Save Signing Secret**. Do not paste `whsec_` in chat. Use Stripe's test event delivery or Stripe CLI to deliver a properly signed `account.updated` for RomyLabs. Check the function's webhook history and verify **Webhook Verified**, **Checkout Ready** and internal billing adapter readiness. The same steps are required separately in live mode; do not reuse a test secret in live.

### 3. Test an end-to-end invoice before accepting customer payments
1. Ensure a sandbox CRM office exists in the office registry.
2. Admin Portal → Billing → **Create Billing Account / Invoice** → select real registered office → enter billing email and the price.
3. New billing accounts have `auto_invoice=false` and `auto_suspend=false`, so they do not silently start indefinite billing or suspend CRM access.
4. Issue the current-month invoice. Check the amount, business, contact and open status before continuing.
5. Stripe panel → **Copy Checkout Link** or **Email Payment Link**. The latter opens an email draft and requires the operator to click Send in their email app. It does not send unattended.
6. Test card payment in Stripe test mode, confirm exactly one succeeded record in the shared RomyLabs ledger, correct invoice paid status, correct recipient and no impact on other CRM customer payments.
7. Repeat failed and duplicate webhook event tests; verify signed-event only, no double posting, financial alerts and CSV exports. Check one manual/Zelle regression.
8. Once green, make one consolidated Cloud deployment and confirm live merchant status and live webhook delivery.

### 4. Onboard the second office
Provision/register the second CRM office (tenant) first. In Admin Portal → Billing → **Create Billing Account / Invoice**, link that registered office and its billing email; do not invent a tenant ID. For Restore Relay Professional, the current approved price is **$399.00 monthly** for up to ten users, with a **six-month signed agreement totaling $2,394.00**. Ensure public marketing price, contract and invoice match. Collect contract signature through existing Admin Portal → Office → Documents & E-Sign (Restore Relay template staged separately in PR #8484).
Generate the first invoice, send secure Checkout URL, have customer enter their card in Stripe-hosted payment form, then verify ledger and signed agreement before activation.

### 5. Important recurring subscription limitation (do not misrepresent)
**This code accepts one-time payments on RomyLabs invoices; it does not create a Stripe subscription or stop one after six periods.** Automatic charging for the six-month contract, Stripe Billing customer portal, emailed invoice transport that sends unattended, automatic merchant payout reconciliation, and fully automated refunds/chargeback ledger adjustments must pass their own tested implementation gates. Never tell a customer six automatic payments have been set up if only an invoice Checkout was used. No general-purpose subscription Payment Link is finite just because the agreement has a six-month term. Keep the second deal payable by explicit monthly invoices until a properly end-dated subscription is verified.

## Operational checks
- Admin Billing transaction ledger: all offices; Stripe/manual/ACH; dates, statuses, references, totals, exports, collection reviews.
- Stripe merchant settings panel: correct restricted key mode, signed webhook event processed, checkout ready.
- Refund/dispute: alerts are generated for finance review; do not assume chargebacks automatically lower ledger totals. Follow finance reconciliation procedure.
- Do not share payment card details, restricted keys, webhook signing secret, Supabase service-role key or Mercury banking credentials in chat.
