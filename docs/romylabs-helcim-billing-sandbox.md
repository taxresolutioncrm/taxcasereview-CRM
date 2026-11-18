# RomyLabs Helcim merchant onboarding + release gates (sandbox only)

## Production scope
- RomyLabs SaaS office subscriptions and invoices **only**. Do not redirect money belonging to customer offices' end clients.
- Keep Stripe, Mercury/manual/Zelle, existing ledger and all CRMs functional. Do not alter their settings during Helcim rollout.
- Primary account: Romy Labs, LLC; settlement bank: RomyLabs Mercury business account after merchant approval.

## What owner must do when Helcim account is approved
1. Confirm Helcim merchant approved and able to accept USD online card payments and intended ACH options.
2. All Tools → Integrations → API Access Configurations → New API Access; name `RomyLabs Admin Portal Billing`. Limit permissions to account/connection testing, checkout initialization, customer, recurring plan/subscription and transaction reads as later validated. Never enable unnecessary money movement.
3. When enabling HelcimPay.js, whitelist actual hosted payer checkout domain(s); `https://admin.romylabs.com` is **only** an allowed origin if a cardholder checkout actually renders there. We will confirm any public-facing payer URL before configuration.
4. Store API token in **Supabase Edge Function secret** `HELCIM_API_TOKEN` (do not paste into chat, browser local storage, source, or GitHub).
5. All Tools → Integrations → Webhooks; configure an HTTPS delivery URL with **no substring Helcim in the URL**. Candidate only after deployment: `https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/romylabs-merchant-events`. Enable Card Transaction event. Store base64 webhook verifier token securely as `HELCIM_WEBHOOK_VERIFIER_TOKEN`; never send it in chat.
6. Confirm Merchant Mercury payout setup directly in Helcim; bank account details never needed in chat.

## Code already staged
- `RomyLabsHelcimSettings.jsx`: visible from Billing once merged + Cloud deployed; never exposes API token.
- `romylabs-helcim-admin`: admin-only API credential connectivity test; no charges.
- `romylabs-merchant-events`: Helcim v1 HMAC signature verification, 5-minute freshness, event/size validation, retrieves card transaction from API. **It deliberately returns 503 for verified events** until invoice attribution and idempotent ledger reconciliation are implemented; do NOT deploy as the configured merchant webhook or advertise it as production ready.

## Still required before production
- HelcimPay.js secure checkout session initialized server-side; card details never transit our server.
- Store invoice-to-provider payment session and customer mappings with least-privilege RLS; enforce correct amount/currency/office ownership, paid status and idempotency.
- Card transaction webhook -> exact RomyLabs invoice -> central `romylabs-billing-payment` (provider `helcim`) after independently checking provider transaction approval, amount and account mapping. No ledger writes from browser callbacks or redirect.
- Build six-cycle $400/month Calico GC LLC Restore Relay plan ($2,400 before any applicable tax), payment method setup through secure checkout, e-sign prerequisite, explicit no-auto-renew.
- Test webhook signature negatives, replay, wrong amount, unknown invoice, duplicate events, refund, dispute/failure workflow, subscription end and existing Stripe/manual regression.
- Supabase `mpxgxfqdbquzkrvvejkh` currently has 200 Edge Functions. Choose a documented safe capacity/deployment plan; do **not** silently overwrite or delete another function or merge before checks are green.
- Follow existing protocol: sandbox verification → consolidated PR review → green build/tests → one Cloud deployment → production functional confirmation.

## Official API references
- https://devdocs.helcim.com/reference/connectiontest
- https://devdocs.helcim.com/docs/initialize-helcimpayjs
- https://devdocs.helcim.com/docs/recurring-api
- https://devdocs.helcim.com/docs/webhooks
- https://devdocs.helcim.com/docs/authentication-with-the-helcim-api-and-helcimpayjs
