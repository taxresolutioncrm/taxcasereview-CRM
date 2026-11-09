# Centurion Payments final verification — shared TaxRes SaaS

**Source:** current `main` plus scoped changes. **Centurion:** tenant `TRC-004` inside the active TaxResolution-CRM Supabase project `mpxgxfqdbquzkrvvejkh`. TaxRes ADMIN and TCR TRC-001 use the same project; Nashville uses its own project. The retired dedicated Centurion database is not used.

**Verified backend:** Centurion tenant and settings exist; 3 active employees map to 3 shared Auth accounts. The Payments table has tenant-isolating RLS. The user's actual Centurion Cloudflare settings point to the common Supabase URL, and the user confirms login works. The full Cloudflare anon key and live build commit are not accessible through the current tools; those remain deployment checks.

**Payments changes:** inclusive From/To selection; payment business-date or `created_at` fallback; matching transaction list, collected/pending/payment count/failed/collected-by-method date scopes; current sorted/filtered rows exported through existing SheetJS helper as .xlsx, with numerical Amount cells and sheet filtering; labeled search/date row and status/method/Clear Dates/Export second row with responsive wrapping. Existing search, methods, statuses, Autopay, invoicing and payment processing preserved.

**Auth source correction:** Centurion login uses shared SaaS endpoint verification and server-authorized tenant membership; old deleted Supabase guard removed; Nashville routing unchanged. No schema, SQL, payroll, payment gateway or user mutations.

**Tests:** Existing `check-three-office-auth` updated; `check-centurion-saas-routing` and `check-payments-date-excel` added to prebuild. Fresh PR #8395 GitHub workflow run 42630200956 completed successfully on commit 5e5fcfef66609f405fa78f019fb497194b63f0df: SaaS routing, real Excel export, three-office Auth checks, release version accountability and Cloudflare-equivalent frontend build passed. Authenticated viewport 320/375/390/430, tablet and desktop, real xlsx opening, and Cloudflare live SHA verification remain necessary before declaring deployed.

**Candidate versions:** TaxRes 3.2.89, TCR 3.2.75, Centurion 3.2.76. The upstream Admin Portal v3.2.88 Credential Vault alphabetical product list and its regression coverage remain intact. Release remains unmerged until explicit authorization.
