# Centurion — independent mobile UX audit and release gate

**Office:** Centurion Firm / `8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a`
**Frontend:** Shared taxcasereview-CRM source; Centurion branded domain must be checked against dedicated Supabase project `rkniemzmivnuhpdwkduc`.
**Candidate:** Centurion v3.2.75 (dependent on scoped UI PR #8367 and TaxRes release review PR #8368).

## Verified source root causes
1. The shared `TopBar.jsx` routed all mobile searches through the working `GlobalSearch`, but `taxres-mobile.css` hid its input below 900px. That excluded clients, cases and leads from accessible phone search.
2. The mobile title was constrained to 38vw and 34vw in two media rules, hiding longer titles. Nested client/case/lead routes also fell back to the generic CRM title.
3. The dashboard CSS cascade contained competing phone declarations, with the later `tax-office-dashboard-cards.css` overriding two columns to one.
4. The eleven Quick Actions in `Clients.jsx` had no responsive class, so the generic quick-actions styles never matched the inline eleven-column grid.
5. Sidebar navigation already closes on route changes and client section tabs have a real internal horizontal scroll wrapper. Preserve them.

## Centurion-specific safety checks
- Dedicated Supabase project is separate from the TCR shared DB. The dedicated project has existing RLS enabled for `clients`, `cases`, `leads`, and `employees`; neither its records nor policies are modified by this UI branch.
- The shared project also contains a TRC-004 control-plane tenant. This UI must not infer which backend is live from the tenant ID alone. Validate deployed Centurion environment and domain before accepting production.
- Existing Centurion dedicated `current_tenant_id()` still returns a fixed office UUID; the multi-office membership cutover remains separate and incomplete. **Do not claim multi-office isolation was fully certified by these mobile tests.**

## Implemented in prerequisite shared UI branch
- Scoped 2-column phone dashboard KPIs, non-clipped full header title, search toggle adjacent to New, and 3-column client Quick Actions.
- No authentication, login URL, payment, mail, voice, fax, import, document access, or storage changes.
- Desktop styles retained; opt-in class only for TCR, TaxRes and Centurion tenant IDs.

## Pre-release verification required
- On the actual Centurion domain with the dedicated project configured: logged-in owner and regular roles.
- Viewports 320, 375, 390, 430, 768px and desktop >=1024px. Confirm no clipped titles, unusable buttons, sideways page scrolling or lost touch affordances.
- End-to-end search and click-through across clients, cases and leads, including no results and navigation closure; ensure Quick Actions open correct authorized modals and tabs scroll.
- Cloudflare preview commit verification and real tenant-domain mapping. No production deployment until explicit authorization.

**Status:** Static source and RLS preflight reviewed. Browser/device viewport and deployed Centurion backend mapping not verified here. No live user data was changed.

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
