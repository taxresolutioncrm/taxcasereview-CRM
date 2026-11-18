# Helcim RomyLabs SaaS billing — sandbox staging
Scope: RomyLabs office subscriptions only, distinct from CRM tenant customer charges.
- Read-only Helcim API connection verifier is platform-admin gated, never returns the token.
- Admin Billing panel is present. Stripe and manual billing unchanged.
- Checkout and recurring charges remain disabled until Helcim merchant onboarding, webhook authentication and invoice reconciliation are verified.
- Supabase project mpxgxfqdbquzkrvvejkh currently lists 200 Edge Functions. Do NOT delete or overwrite an existing function to make room; decide safe deployment capacity first.
- User needs Helcim merchant approval, bank payout account confirmation (Mercury), and a server-side Helcim API token. Keep token out of chat/GitHub. Webhook verifier token will be needed for payment confirmation later.
- Restore Relay first plan: $400/month, exactly six billing cycles, $2,400 before applicable tax. No indefinite recurring charges.
- Helcim documentation: https://devdocs.helcim.com/reference/connectiontest and https://devdocs.helcim.com/docs/recurring-subscriptions and https://devdocs.helcim.com/docs/webhooks
- Never infer payment from a redirect. Signed provider event + verified transaction & invoice identity must precede any RomyLabs ledger write.
