# TaxRes administration — mobile UX audit and release gate

**Office:** ADMIN / `a0000000-0000-0000-0000-000000000001`
**Application:** Shared TaxResCRM React app; same UI module paths as TCR but different tenant context and permitted functionality.
**Candidate:** TaxRes v3.2.75 (dependent on TCR shared mobile branch).

## Verified source root causes
1. `src/taxres-mobile.css` concealed `.topbar .search-input` and constrained titles to 38vw/34vw. Search component itself still includes client, case and lead RLS queries; the UI hid it on phones.
2. `src/tax-office-dashboard-cards.css` phone media query overrode the earlier 2-column desktop/tablet grid to one column; card typography and icon sizes consumed unnecessary vertical space.
3. `src/pages/Clients.jsx` renders all eleven Quick Actions in an inline eleven-column desktop grid without a mobile selector; the pre-existing generic `.quick-actions-row` rule never matched this actual grid.
4. `src/components/layout/Sidebar.jsx` already closes on navigation. `Clients.jsx` has an independently scrollable detail-tab strip; no routing or tab state rewrite is justified.
5. `src/tax-office-shell-parity.css` and `src/index.css` define competing shell/card rules. Changes are scoped to the actual selectors in the component, with a parity-tenant gate; no global CSS reset.

## Changes prepared
- Full title, accessible mobile search toggle beside New and original `GlobalSearch` results/navigation.
- Two-up, compact dashboard KPI layout on phones.
- Three-per-row client Quick Actions with readable wrapping and tap areas.
- Existing sidebar close, tab scrolling, auth, role guards, database access and desktop grid untouched.
- The three-office opt-in class is computed from the actual authenticated tenant context. Other office tenants (including Nashville) do not receive this mobile UI override.

## Verified / outstanding
- Source-level mobile invariants run in CI (not viewport screenshots).
- Shared database read-only confirmation: ADMIN tenant active, and client rows present; no record modification.
- **Pending before merge:** real TaxRes authenticated browser at 320, 375, 390, 430 and tablet/desktop widths; search and click-through for clients/cases/leads, complete text, scroll and touch on Client Details, Cases, Leads, quick actions, all relevant role restrictions; Cloudflare preview SHA check.
- No E2E or device certification is claimed by this document.

## Release discipline
Dependent on first-stage shared PR #8367. Separate TaxRes version; do not merge/deploy before explicit approval. No paid tools and no Nashville changes.

## Viewport certification matrix (required before release)

| Width | Dashboard 2-up | Header / search / New | Client actions / tabs | Page scrolling | Authenticated test |
|---|---|---|---|---|---|
| 320px | Pending | Pending | Pending | Pending | Pending |
| 375px | Pending | Pending | Pending | Pending | Pending |
| 390px | Pending | Pending | Pending | Pending | Pending |
| 430px | Pending | Pending | Pending | Pending | Pending |
| 768px | Pending | Pending | Pending | Pending | Pending |
| 1024px+ | Desktop regression pending | Pending | Pending | Pending | Pending |

These checks must run with an actual signed-in office session and populated sample clients/cases/leads. Source-only GitHub build success is not visual/browser certification.
