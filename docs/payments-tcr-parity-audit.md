# TCR Payments independent audit — Nashville v3.1.83 parity

**Office:** Tax Case Review, tenant TRC-001.
**Working features found:** client/invoice text search, status and method filters, sortable payment list, editing and deleting with invoice reversal, receipts, summary cards, method totals, Autopay and processor integration.
**Source root causes:** `Payments.jsx` had no From/To state or date filter; it computed totals and method breakdown directly from all `items`; it had no Excel action; its toolbar used a rigid 1fr/auto grid and control heights differed, causing wrapping and overflow.
**Changes:** added isolated pure `paymentsView` helper and existing `exportReportXlsx` (SheetJS) helper. Inclusive payment.date with created_at fallback; matching list/totals/method breakdown date selection; status, method, search and original sorting retained. Toolbar uses two rows and an adaptive grid with date labels above fields. Export contains the final sorted/filtered records and numeric Amount; workbook uses existing spreadsheet format, widths and autofilter.
**Tests:** `npm run check-payments-date-excel` covers date boundaries, same-day and open-ended ranges, created_at fallback, status/method/search combinations, totals, sorting, numeric cells, headers, widths, filter, malicious formula strings and zero record mutations. CI build and browser/device tests tracked separately.
**Security:** no new RPCs or schema changes. Search/export uses existing authorized `payments` SELECT results, with the current tenant's RLS; no elevated keys.
**Browser QA remaining:** authenticated signed-in 320/375/390/430/768/1024+ viewports, responsive toolbar, date filters, sorting, export button, Autopay and payment actions with authorized test data. No merge or deploy until explicit authorization.

## Read-only Payments schema/RLS preflight
The existing `payments` table has `date` (text), `created_at` (timestamptz), `amount` (text), client/invoice and method/status fields. It does **not** have `checkNum` or `reference` columns in the inspected project. The export retains those optional columns as blank when source values do not exist; no data is invented and no database schema is modified. Payments RLS is enabled and its existing authorization rules are unchanged. The on-screen date now uses the same effective-date fallback as filters and Excel.

**Release dependency:** Centurion shared SaaS Auth correction PR #8385 is required first. This Payments PR retains that source and advances the office versions independently: TaxRes 3.2.87, TCR 3.2.76, Centurion 3.2.77. Nashville is excluded.
