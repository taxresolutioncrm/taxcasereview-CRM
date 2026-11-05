# RomyLabs Stalwart Calendar — JMAP-first sandbox certification

## Why this replaces the CalDAV XML prototype
The existing Admin Portal mailbox bridge already authenticates through Stalwart JMAP. Stalwart v1 supports `urn:ietf:params:jmap:calendars`, meaning calendar discovery, event retrieval, and event mutations can use structured JSON instead of hand-parsed WebDAV XML. The earlier `romylabs-calendar` CalDAV prototype is retained only as historical sandbox material; the new path is `romylabs-calendar-jmap`.

## Components (sandbox only)
- `supabase/functions/romylabs-calendar-jmap/index.ts`: platform-admin-only authenticated JMAP access, vault-backed credentials, strict mail host allowlist, account capability checks, calendar discovery, bounded range queries, CRUD with revision checking and explicit deletion confirmation. All server requests are tenant scoped to the RomyLabs transport.
- `src/components/StalwartCalendarWorkspace.jsx`: dedicated branded day/week/month interface, direct JMAP calendar event creation/edit/delete, event source/calendar labels, recurring-series write protection, and explicit separation from CRM appointments until synchronization is certified.
- `src/pages/Calendar.jsx`: only Admin Portal on `admin.romylabs.com` with `VITE_STALWART_CALENDAR_PREVIEW=true` shows a Stalwart Calendar switch. The current CRM calendar remains the default.
- `scripts/check-stalwart-jmap-calendar.mjs`: static security and wiring invariants, integrated with prebuild.

## Must pass before flipping the preview flag
1. Confirm authenticated `/jmap/session` advertises `urn:ietf:params:jmap:calendars` for the existing RomyLabs transport account. A CalDAV OPTIONS 200 alone is insufficient.
2. Test platform admin requests; verify anonymous, user of another tenant, and unprivileged auth are rejected.
3. Test JMAP Calendar/get, event query/get, create, update using ifInState, delete with explicit confirmation, stale-state conflict and recurring event write refusal on sandbox mail test account. Verify existing mailboxes and message send/receive unaffected.
4. Confirm no Stalwart credential or account token appears in the browser. Check service role isn't exposed.
5. Certify event timezone/DST, recurrence, privacy/permissions, invitations and mail handling.
6. Add a durable tenant-scoped UID/ETag or JMAP event-id mapping from `calevents`; simulate and reconcile existing booking events in a dry-run. Only then enable two-way CRM event sync and notifications.
7. Certify all CRM event creation, lead/client notes, reminders, meeting links, scheduling, and product branding before replacing the current calendar.
8. Certbot timer and TLS-reload hook passed local checks but full unattended renewal dry-run has not passed. Keep the mail TLS thread separate and verify staging access before declaring long-term protection certified.

## Release protocol
No production Stalwart restart. No mail account password changes. No new paid provider. No production deploy or merge before sandbox certification, tenant isolation and event-parity checks. Version release gates must pass.

## Session URL correction
Stalwart documents `/.well-known/jmap` as a **307 redirect** to `/jmap/session`. Since the secure Edge Function deliberately uses `redirect: 'manual'` (to prevent credential forwarding), it must call `https://mail.taxrescrm.net/jmap/session` directly. The earlier mock incorrectly made the well-known endpoint return 200; the mock now requires the correct URL. The uncredentialed external probe from this runner could not resolve the server hostname, so authenticated live JMAP remains a separate preflight gate.
