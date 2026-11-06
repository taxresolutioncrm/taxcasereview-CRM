# RomyLabs communications notification rollout — source-to-inbox certification

Date: 2026-11-06. **No cross-product production release is authorized by this document.**

## Shared product behavior

Reuse the screenshot's compact **Calls · Email · SMS** panel and the product's existing event and unread-state sources. Never copy RomyLabs Admin's platform-owner Edge Functions into an ordinary tenant CRM.

Each channel must meet this complete chain before production:
1. Provider inbound webhook/SDK event is authenticated, idempotent and persisted in the correct product database.
2. Persistence is mapped to exactly the correct office/practice and permitted recipient.
3. An explicit per-user unread/acknowledgement model exists (or label an honest alternative such as "New since last viewed"; do not call a historical 24h count "Unread").
4. Existing event and badge streams are reused. No duplicate bells, Realtime sockets, notification audio, or provider delivery paths.
5. Counts are server-authoritative, not inferred from an arbitrarily limited first page of messages.
6. Failure/offline/unconfigured channels show an explicit unavailable state or are hidden; never misleading zero.
7. Clicking an alert opens the authorized, existing message/call/client route, with permission enforcement at the destination.
8. Tenant membership switching, role changes, signout and account switching invalidate all cached notification state.
9. No provider credentials, service-role keys, PHI/PII or unexpected recipient data are exposed in public notification content.
10. Desktop alerts require browser permission; an in-app alert works without it. Mobile and AI buttons must not cover notification controls.

## Audited product paths and readiness

| Product | Existing source / current finding | Release gate |
| --- | --- | --- |
| **RomyLabs Admin** | `src/components/admin/AdminCommsNotifications.jsx` uses owner-authorized `romylabs-sms`, Stalwart/JMAP `romylabs-mailbox`, and `romylabs-phone-state`; `CallContext` provides ringing. Existing AI floating button at bottom/right overlapped the expanded alert card; a viewport-aware popup fix is staged. The same candidate corrects capped SMS/call unread totals using exact server counts (requires matching Edge Function deployments). | **Deployed baseline; visual fix pending**. Real inbound provider tests still required. |
| **TaxRes / TCR / Centurion CRMs** | Shared `taxcasereview-CRM` source has per-user `AppContext` realtime notifications and Sidebar badges. Centurion has separately configured authentication/data, so Admin-owner functions cannot be reused directly. | **Not released to tenant CRM shells**. Certify each office's project, mailbox routing, RLS, audio and routes. |
| **Nashville Tax Solutions** | `get_sidebar_badges` is the existing permission-aware per-employee aggregate; `AppContext.showOperationalNotification` already handles sounds and desktop alerts. Staged **PR #553 / v3.1.64** reuses those sources with no extra polling. | **Preview green; production held**. Verify each role, M365 mailbox isolation and a real inbound call/SMS. |
| **Arcvena** | `internal_notifications` is scoped by `tenant_id + member_id`, with EMAIL, SMS, CALL, VOICEMAIL. Existing top-bar `NotificationBell` must remain the only bell. Staged **PR #138 / v3.2.2** adds category totals and filtering. | **Preview green; production held**. Check provider-to-notification delivery and office switch. |
| **Restore Relay** | Live `communication_messages` is RLS-protected and has inbound email/SMS history; `notifications` has user-level read state and RLS. Read-only inspection found **no notification records**; inbound messages alone are not proof an alert is generated. | **NO-GO until server fanout is traced**. Confirm idempotent notification creation and office/user targeting, then UI. |
| **BocaSync** | `patient_communications`, `inbox_conversations` and `inbox_conversation_reads.last_read_at` already support practice/user-scoped inbox workflows. | **Adapter needed**. Test read-cursor behavior, patient privacy, correct practice, Spanish locale and mobile. |
| **Camvella** | `communications` stores outbound email/SMS campaigns; `comm-webhook-handler` processes delivery statuses; `signalwire-webhook` handles voice/fax. No inbound email/SMS persistence was established in this source trace. | **NO-GO for incoming email/SMS counters** until verified ingress, recipient state and actual deliveries exist. |
| **PoolVerge** | `communication_threads` / `communication_messages` store channel/direction and are loaded by `loadCommunicationsLive`. SQL model lacks a confirmed per-user read marker. | **NO-GO for unread badges**. Add/test organization-scoped read receipts before UI claims unread. |
| **GroundIVO** | `call_logs` and `sms_logs` are organization-scoped, but base schemas have no per-user read marker; inbound SMS webhook could not be confirmed from repository search. | **NO-GO for unread badges**. Verify inbound integration, acknowledgement and mobile layouts first. |

For products still marked NO-GO, **do not** ship a decorative bell showing three zeros. The correct sequence is provider → persisted event → recipient isolation → read state → UI → live test.

## Release certification — required for every CRM

- [ ] Two real incoming calls: ring/answer and missed/voicemail, with exactly one alert.
- [ ] Two inbound emails (different recipients) and two inbound SMS (different offices): only authorized recipients receive a notification.
- [ ] Two simultaneous users in one office: read acknowledgement updates only the intended user, without suppressing legitimate shared inbox work.
- [ ] Office A/Office B, permission denied, signed out and switched accounts: no cross-office data or counts; stale badges clear.
- [ ] Delayed/retried provider webhooks: no duplicate messages or notification fanout.
- [ ] 100+ unread items and cursor/pagination: count does not cap at message-list limit.
- [ ] Missing credentials, revoked mailbox, failed provider and Realtime disconnect: visible problem, never false zero.
- [ ] Mobile, tablet, desktop, light/dark mode, AI assistant and active-call bar: no obscured or unclickable control.
- [ ] Open a notification and verify correct route/record and browser back behavior.
- [ ] Desktop permission granted/denied, sound muted/unmuted and backgrounded window: no extra sound or duplicate toast.
- [ ] Green full build, regression tests, independent preview, explicit deploy authorization, and production verification for the precise release SHA.

## Cost and operations

No new paid notification provider. Prefer existing Realtime/badge RPC streams with bounded reload/focus reconciliation. Avoid adding several polling loops per user (particularly Nashville's 25+ daily staff sessions). The app only delivers notifications while open unless the browser/provider has a separately configured, authorized push service; do not claim offline push.
