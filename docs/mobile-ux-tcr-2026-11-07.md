# Tax Case Review (TCR) — mobile UX audit

**Office:** TRC-001 / `61a89aef-0e7e-4ea2-b222-44ab2024655a`
**Candidate:** TCR v3.2.74
**Reference:** Nashville v3.1.80, PR #572 — used for intent, not copied wholesale.

## Actual source root causes
- `taxres-mobile.css` hid `.topbar .search-input` at 900px and below; the existing `GlobalSearch` still queries clients, cases and leads, but the control was inaccessible on phones.
- Header `.page-title` was cut to 46/38/34vw with `overflow:hidden; text-overflow:ellipsis`, and nested client/case/lead routes resolved to a generic fallback.
- `taxres-dashboard.css` and `tax-office-dashboard-cards.css` both collapsed phone KPIs to a single column, overriding two-column tablet rules.
- `Clients.jsx` Quick Actions are an eleven-column inline grid with no matching responsive class. The generic `.quick-actions-row` styling applies to a different element.
- `Sidebar.jsx` already closes its drawer on route changes. `Clients.jsx` already uses `client-detail-tabs-scroll`; rewriting either would risk losing navigation state.
- Source CSS is loaded from `main.jsx` in the order `index.css`, `taxres-mobile.css`, `taxres-dashboard.css`, `tax-office-dashboard-cards.css`, `tax-office-shell-parity.css` and `taxres-light-polish.css`. Explicit phone-level card conflicts were corrected in their owning stylesheet, with a tenant opt-in class.

## Fixes staged
- Scoped search icon beside New, original GlobalSearch (client/case/lead queries and destinations unchanged), keyboard focus on open, reset on route changes.
- Full section title (including nested routes) with wrapping at narrow widths; search and New grouped to prevent flex splitting, language controls retained.
- Two compact Dashboard cards per row at <=640px (still two at 320px).
- Eleven Client Quick Actions laid out in three readable phone columns, with original onClick handlers unchanged.
- Desktop and other tenants preserve original layouts. The opt-in class is calculated from the authenticated office tenant ID; Nashville is explicitly excluded.

## Checks and blockers
- GitHub frontend build and source contract script passed at candidate commit (see PR checks).
- Shared database read-only check: TRC-001 active and client records exist; this change made no database modifications.
- **Not yet verified:** actual authenticated 320/375/390/430px device/browser screenshots, touch across lead/case/client pages, keyboard search navigation, light/dark contrast, horizontal scroll audit, and desktop screenshot regression. No Cloudflare release until explicit authorization.
- Source-level CI passing does not imply live browser/mobile certification. No paid testing provider added.
