// TaxRes-family production release manifest.
// Each office keeps an independent semantic version line.
// Shared code does not make Nashville part of a central release.

const OFFICE_ACCESS_CHANGES = [
  'TaxRes and TCR login screens recover from temporary initial session failures instead of remaining stuck on Loading',
  'Centurion sign-in and password recovery route to its separate authentication project',
  'Centurion login refuses to post credentials against the wrong Supabase project',
  'Employee lookup matches verified office membership case-insensitively and never grants Admin access on missing membership',
  'CloudCPA is retired from the active office directory, manual, release listing and platform metrics routing',
]

const CLIENT_DOCUMENT_FOLDER_CHANGES = [
  'Client Documents: create tenant- and client-scoped custom folders using the verified canonical client ID',
  'Correct CAP regression in both folder creation and rename: common folder names accepted, ASCII controls rejected before trimming',
  'General Documents folder creation also accepts CAP and rejects duplicates, control characters and names over 80 characters',
  'Custom folders can be renamed without losing linked documents, or deleted only when empty',
  'Folder maintenance uses permission-checked atomic server RPCs and blocks ambiguous legacy documents',
  'Existing default folders, Canopy imports, secure previews, downloads, fax and AI Analyze remain preserved',
  'Client Documents manual now explains authorized custom-folder maintenance, legacy document restrictions and empty-only deletion',
  'Empty-folder deletion uses an accessible in-app confirmation instead of a browser popup',
  'Folder migrations block imported-category name collisions and serialize concurrent canonical and name-only document writes',
]

const IRS_WORKFLOW_CHANGES = [
  ...CLIENT_DOCUMENT_FOLDER_CHANGES,
  ...OFFICE_ACCESS_CHANGES,
  'Live calls can be placed on hold with original audible music and clear recovery when the provider cannot start playback',
  'RomyLabs direct calls stop their provider hold audio before resuming and conference holds use the same looped soundtrack',
  'FormaCorp official Sunbiz filing workspace now maximizes the government page and opens it automatically',
  'Saved CRM filing details are compact and collapsible; new filings no longer display an empty sidebar',
  'Government disclosure and state-receipt entry are now collapsible, with responsive mobile layout',
  'FormaCorp primary Florida filing button opens the official Sunbiz filing workspace directly, with optional CRM case preparation retained',
  'Official state confirmation is recorded only against an existing tenant-scoped FormaCorp case',
  'FormaCorp adds an official Sunbiz filing workspace inside the CRM, including same-page government website display where Florida permits it',
  'Saved formation details are copyable alongside the official government application; agency iframe restrictions may require a direct government tab',
  'Official Florida tracking and payment references can be recorded with tenant checks without falsely claiming state acceptance',
  'FormaCorp opens a native six-step Florida LLC Articles of Organization intake instead of the generic formation wizard',
  'Florida LLC intake captures street, suite, city, ZIP, registered-agent acceptance, authorized persons, signatures and filing options',
  'Draft Florida LLC filing cases can be reopened and edited safely before submission; Articles PDF reflects captured filing details',
  'Saving an intake does not submit an online filing to Sunbiz or pay the Florida filing fee',
  'FormaCorp corrects official Florida LLC, profit and nonprofit Sunbiz filing links, with no undocumented direct filing claim',
  'FormaCorp includes AMBR title, registered agent address reuse and complete prefiling review',
  'FormaCorp fax-provider acceptance remains pending state receipt and never falsely marks government fees paid',
  'FormaCorp fax packet storage verifies active tenant and cleans failed uploads',
  'Invited conference guests answer in an isolated waiting room; only an explicit Merge Calls action connects them to the original conversation',
  'On-demand three-way calling verifies invitation signatures and caller ownership, supports cancelling unmerged guests and disconnecting merged guests',
  'RomyLabs direct outbound calls can be upgraded to an on-demand three-way call only when Add Caller is clicked; the original call is provider-verified before any transition',
  'Additional participants are dialed after both the original caller and agent reconnect, with provider-confirmed guest presence and guest-only disconnect',
  'Personal LinkedIn autopilot restores eight upcoming Tuesday/Thursday 9 AM ET posts with an independent personal-profile publisher',
  'Disconnected company pages no longer starve personal LinkedIn posts; overdue historical posts never publish outside their time window',
  'Direct outbound dialing discards late results after cancellation and resolves hangup updates by provider call ID to avoid unintended follow-on calls',
  'RomyLabs outbound calls now dial directly from the browser to the destination with one provider call leg, not a server call plus conference self-dial',
  'Direct-call Hold and Resume use the real SignalWire browser call state; direct calls retain RomyLabs-specific call history and request native provider recording',
  'Outbound conference waits for the browser agent to join and uses provider-native waiting audio, never a hold prompt branded to a different CRM',
  'Invoice-issued, payment-reminder and final-notice billing emails now use their CRM-specific official sender, logo, domain and signature; mismatched credentials block sending',
  'Every SaaS billing email is locked to its own CRM logo, website, signature, mailbox domain, and private MIME identifiers; no cross-company fallbacks',
  'Official embedded CID PNG logos and corrected dark/navy email styling now render for nine CRM brands in the RomyLabs office payment reminder system',
  'RomyLabs office payment reminder emails now render the correct CRM logo, brand colors, website, responsive balance summary and system-sender details; unbranded or personal-sender notices remain blocked',
  'Monthly office subscription reminders use CRM-specific verified nonpersonal system mailboxes and never fall back to a personal email identity',
  'RomyLabs office payment reminders now send using TaxRes email with System Reminder as the sender display name',
  'RomyLabs office subscription billing checks outstanding monthly payments after the third and sends one audited morning reminder to each unpaid billing account',
  'Admin Portal calendar event editor selects a CRM product and preserves the chosen product for branded calendar display',
  'RomyLabs Admin Portal meeting reminders show 30, 15 and 5-minute in-app pop-ups with optional desktop notifications when the portal is open',
  'RomyLabs Admin calendar displays legacy admin-owned appointments missing a product tag, with new events tagged to the correct product',
  'Restore Relay central support HMAC verification no longer uses the Edge WebCrypto path that EarlyDrop-hung live training mail before Stalwart submission',
  'Restore Relay live training and client-meeting email invites now use the central Stalwart/JMAP vault relay instead of Brevo acceptance',
  'Restore Relay booking mail is authorized through the central RomyLabs Stalwart/JMAP vault relay instead of duplicating mailbox credentials in the product project',
  'FormaCorp draft Articles archive enforces tenant-scoped storage paths and active-office access',
  'All RomyLabs public demo bookings now create durable central Admin Portal alerts, independent of email delivery',
  'Business demo owner alerts use the registered RomyLabs Stalwart sender with audited submission and visible failures',
  'Booking identity includes all 11 active products and legacy PoolVerge URL alias',
  'Product demos are calendar-branded by their requested business instead of the TaxRes scheduling tenant',
  'TaxRes Biz company-page OAuth and verification added as a separate destination from the personal LinkedIn profile',
  'Arcvena LinkedIn organization authorization requests identity and page-admin scopes',
  'LinkedIn OAuth now uses separate registered applications for TaxRes and Arcvena',
  'LinkedIn callback authorization is processed by the signed-in Admin Portal, with state validation',
  'TaxRes LinkedIn personal-profile scheduling and queue readiness restored',
  'Arcvena company-page publishing remains gated until LinkedIn grants w_organization_social',
  'POA file upload in IRS portal now generates a secure signed URL for the private documents bucket instead of an always-broken public URL',
  'LinkedIn OAuth callback route on admin.romylabs.com fixed to redirect through AdminPortalGuard instead of the CRM bridge, preventing infinite OAuth loop',
  'LinkedIn personal-profile publishing restored for TaxRes CRM using w_member_social scope',
  'LinkedIn scope corrected for Arcvena company-page: r_organization_admin (rw_organization_admin is not a valid LinkedIn v2 scope)',
  'LinkedIn Admin Portal connection badge shows Profile Connected for personal-profile products and Company Page Connected for org products',
  'Camvella metrics batch timeout extended to 11 seconds to accommodate multi-query response time and prevent false Partial status',
  'LinkedIn company-page admin verification updated for versioned REST API and organizationTarget results',
  'Release accountability finalized for IRS/state Fax Document actions, inline client fax, SignalWire callback updates and sales/client dashboard cards',
  'IRS and State form cards support inline SignalWire Fax Document actions with the selected client and accurate form descriptions',
  'Client document fax composer stays over the active client record and validates office/document ownership',
  'Dashboard displays Recent Leads to authorized sales staff and Recent Clients to non-sales roles',
  'Training invitation panel polish, responsive join link, Copy Link and Email Invite controls',
  'Training host screen-share canvas prioritizes presentation with floating cameras and browser fullscreen',
  'All eleven Quick Actions remain in original order and fit the client-file width without clipping or a forced minimum row width',
  'Quick Actions restored to their original eleven-button order on one horizontally scrollable row, with readable compact labels',
  'Client Quick Actions now fit available width with readable labels and compact responsive tiles while preserving all eleven actions',
  'Client-file tab arrows replaced by a mouse/touch-friendly horizontal slider matching each office’s active theme',
  'Client file tabs have visible left/right scrolling arrows and keep Tax Organizer fully accessible on smaller screens',
  'Fax existing stored client documents from the client Documents preview using the existing outbound fax provider and composer',
  'Reuse private client document storage without downloading or uploading a duplicate file',
  'Client document previews and Open support historic private Supabase file links using fresh short-lived signed URLs',
  'LinkedIn OAuth callback routing restored across TaxRes and RomyLabs Admin Portal',
  'LinkedIn authorization opens separately and preserves the active workspace and draft',
  'IRS TDS request form inputs, tax-year selector, transcript choices, spacing and responsive layouts match Nashville practitioner form styling',
  'IRS TDS portal sign-in presentation and transcript/POA navigation counts polished toward Nashville parity',
  'Production build release-version verification corrected to read Git revision history accurately',
  'Client Documents now retain an inline three-column folder, file list and preview workspace with optional expanded viewing',
  'Document loading includes deterministic pagination and protection against stale responses when switching clients',
  'Client files have an independent Active / Not Active status selector',
  'Outgoing Gmail email composition supports multiple attachments, removal and validated sizes for supported mailboxes',
  'IRS TDS/SOR workflow retains local-file cleanup safeguards and in-app instructions',
]

const TRAINING_RELEASE_CHANGES = [
  'Training Center adds eight self-paced lessons, knowledge checks, and browser-local employee progress tracking',
  'Live training restores floating participant camera tiles over screen sharing while preserving session controls',
  ...IRS_WORKFLOW_CHANGES,
]

const EMAIL_PARITY_CHANGES = [
  'Gmail compose, reply and forward messages have independent browser-local draft recovery per employee and office',
  'Email reading links directly to the client profile when a unique exact email address matches',
  'Client Overview Log Time shortcut appears directly below IRS / State status and opens existing Time & Billing',
  ...TRAINING_RELEASE_CHANGES,
]

const ADMIN_DEMO_TASK_CHANGES = [
  'Admin email and SMS alerts play the existing sound cues, honoring the user sound preference while avoiding a duplicate incoming-call ringtone',
  'Notification polling now surfaces unexpected backend errors instead of silently dropping call, email or SMS status',
  'Admin notification alerts now provide an actionable in-app banner even when browser-level desktop notifications are disabled',
  'RomyLabs Admin Portal keeps call, email and SMS notification badges available across admin pages, with quick links to their respective inboxes',
  'New inbound communications trigger visible notifications, optional browser alerts and explicit connection warnings using authorized backend sources',
  'RomyLabs phone Hold now requests audible original music, with automatic stop-on-resume and no changes to existing call routing',
  'Admin Demo Leads & Tasks adds a clickable Completed card with persisted completion timestamps and full contact activity history, separate from the open queue',
  'Oculivo website demo requests offer distinct Open and Completed views without hiding active follow-ups behind completed records',
  'Admin Portal v3.2.65 independently verifies its exact Cloudflare booking-selector build marker after the approved release',
  'Send Booking Link now lets RomyLabs Admin choose any supported CRM from its product registry; copy and email use the same product-specific branded booking page, and unconfigured products are disabled. Duplicate booking and appointment actions are removed from the selected-day sidebar.',
  'Admin Portal dashboard Product Portfolio now places SettleLift immediately below Health Insurance and directly above ChairStyle, consistent with the Products tab instead of leaving SettleLift below Research',
  'Admin Portal Products keeps SettleLift directly below Health Insurance Agency CRM and ahead of ChairStyle, with research-only concepts below the active Building group even after connection status sorting',
  'ChairStyle replaces the Barbers & Salons working name in the Admin Portal, booking choices and billing labels; the unlaunched chairstyle.net site is described without a live link and existing product IDs and office versions remain unchanged',
  'Admin Portal Building products now follow central registry sort order; SettleLift appears directly below Health Insurance and above Barbers & Salons',
  'Production calendar v3.2.58 release verifies the exact Admin Portal Cloudflare build marker for click-to-add and CRM/office identity on appointment chips',
  'Calendar event chips show the CRM/product name and logo beneath the time/title; if a distinct office name is provided it is displayed too, without inventing an office for unlabeled events',
  'Clicking any empty part of a calendar day or its date number opens the existing Add Event form for that exact date, matching the plus button; clicking an existing appointment still opens details and More retains day navigation',
  'Calendar Command Center fixes a clipped month view by making the Admin Portal calendar viewport scrollable with hidden scrollbar chrome; compresses header and KPI tiles while sizing month rows dynamically so all weeks can be reached',
  'Calendar Command Center replaces the old Unified Calendar layout with a prominent scheduling header, booking and appointment actions, three live CRM KPI tiles, searchable product filters, larger accessible calendar dates, color-coded appointments, responsive day agenda and explicit on-screen build version',
  'Unified Calendar restores classic day actions (New Event, View Day, View Week) and collapsible upcoming appointments, reusing the existing booking and event handlers',
  'Unified Calendar product filter now lists every active product in the Admin Portal registry, including products with zero appointments and separately hosted Nashville, and clicking any date opens its day view with a visible Add Appointment action',
  'RomyLabs Admin Unified Calendar defaults to the new searchable month/week/day layout, retains the classic event editor and booking workflows, supports CRM branding and filtering, selected-day agenda, upcoming appointments, deadlines and mobile scrolling, with one-click classic fallback',
  'Three-way calling protects unattended guests with a bounded consult waiting room and verified cleanup when a call ends or a bridge fails',
  'RomyLabs Admin Portal Add Caller now supports an explicitly requested three-way call with real guest connection status and safe guest removal',
  'RomyLabs Admin Portal adds a new responsive calendar preview with month, week and day views, appointment search, and existing CRM event editing, appointment creation and booking links; Stalwart synchronization stays disabled until certified',
  'Admin Calendar visual preview release is limited to the RomyLabs Admin Portal and verified against its unique Cloudflare production build marker',
  'Manual subscription payments now include all registered CRM products and separately hosted billing offices such as Nashville Tax Solutions',
  'Selecting an existing subscription loads its billing email, seats and contracted rate; changing products clears stale payment details',
  'RomyLabs Admin Portal direct outbound calling connects without an artificial conference or automatic hold and does not change inbound routing',
  'RomyLabs outbound calls use provider-native conference waiting until the browser agent joins, then automatically start two-way audio',
  'Camvella billing enforcement and office metrics endpoints now target the dedicated Camvella Supabase project',
  'Oculivo website demo requests create an admin follow-up task independently of scheduled appointments',
  'Oculivo demo lead notifications use the existing Stalwart transport, with submission IDs and visible errors',
  'Oculivo lead alerts use official Oculivo branding, practice details and the Admin Portal task link',
  'Browser retries retain a single Oculivo lead record through an idempotent request key',
  'Only a successfully stored demo request is acknowledged to the website; notification failure does not discard the lead',
  'PoolVerge reuses its registered generic mailbox for office billing notices, while products without verified nonpersonal mailboxes remain blocked',
  'TaxRes now registers its existing generic info@ sender for system billing reminders without altering personal mailbox routes',
  'System payment notices are branded per CRM, use only a secure service-only mail transport, and are withheld if the CRM has no verified nonpersonal sender',
  'System Reminder <TaxRes sender> is used for monthly SaaS office payment notices, rather than the RomyLabs mail identity',
  'Every active paying CRM office is eligible for one day-four payment reminder regardless of invoice automation or billing-day configuration',
  'Office payment reminders use the existing RomyLabs Stalwart JMAP mailbox, without Brevo or an additional paid mail provider',
  'Office subscription reminder checks the current-month paid ledger before sending on the fourth at 9 AM Eastern, avoiding duplicates and paid accounts',
  'Admin calendar Create and Edit Event now include a CRM/Product selector sourced from active booking products; unrelated CRMs remain unchanged',
  'Admin Portal reminder module resolves its Supabase client correctly in the nested component bundle',
  'Calendar reminders now appear throughout the Admin Portal at 30, 15 and 5 minutes before each meeting (desktop notifications optional)',
  'Admin calendar restores missing historic RomyLabs appointments and records product identity on new events',
  'Camvella proxy uses its dedicated support credential and reports actionable downstream errors without leaking secrets',
  'Central hub-proxy routes Camvella metrics to its dedicated Supabase project; requires separately configured matching credentials',
  'All task status dropdown options remain selectable; contact-required transitions show actionable validation',
  'Demo Tasks Edit task includes task status Open, In progress, Contacted and Done / Closed with validation and explicit Save',
  'Tasks queue defaults to compact expandable lead rows with all contact controls retained',
  'Task lead cards expose current contact status and a clearly labeled activity logging action',
  'Demo lead activity timeline records timestamped emails, calls, outcomes and next follow-up without losing previous contact notes',
  'Demo Tasks metric cards filter follow-ups by open, needs-contact and overdue status',
  'Edit Task exposes a clickable calendar picker and time selector with explicit Save and Cancel',
  'Dedicated Tasks page redesigned with responsive follow-up cards, overdue summaries and styled editor controls',
  'Removed the duplicate global booking banner from Admin Portal pages',
  'TaxRes demo booking tab icon remains TaxRes-branded when public tenant metadata loads',
  'Task edit panel JSX and prebuild checks corrected before release certification',
  'RomyLabs Admin Portal adds a dedicated Demo Leads & Tasks page with editable ownership and follow-up deadlines',
  'Demo follow-ups remain visible until contact is recorded and can be reviewed after completion',
  ...EMAIL_PARITY_CHANGES,
]

const FORMACORP_PREPARATION_CHANGES = [
  'FormaCorp records Florida formation intake and explicitly archives generated draft Articles to the existing document vault',
  'Standard Florida filings do not charge through CRM Stripe; unreconciled previous payment attempts block duplicate payment paths',
  'Filing preparation is distinguished from confirmed state submission and acceptance',
  ...ADMIN_DEMO_TASK_CHANGES,
]

const FORMACORP_VAULT_FIX_CHANGES = [
  'FormaCorp draft Articles use tenant-scoped document storage paths and verify the active office',
  'Incomplete document archives are cleaned up and storage errors are identified',
  ...FORMACORP_PREPARATION_CHANGES,
]

const DEFAULT_RELEASE = {
  version: '3.2.71',
  releasedAt: 'Pending production deployment',
  title: 'RomyLabs Admin Portal 3.2.71 — Custom Client Document Folders',
  changes: [...CLIENT_DOCUMENT_FOLDER_CHANGES, ...OFFICE_ACCESS_CHANGES, ...ADMIN_DEMO_TASK_CHANGES],
}

const OFFICE_RELEASES = {
  // Tax Case Review
  '61a89aef-0e7e-4ea2-b222-44ab2024655a': {
    version: '3.2.71',
    releasedAt: 'Pending sandbox verification',
    title: 'CRM 3.2.71 — Client Document Folder Management',
    changes: IRS_WORKFLOW_CHANGES,
  },

  // TaxRes administrative/default office
  'a0000000-0000-0000-0000-000000000001': {
    ...DEFAULT_RELEASE,
  },

  // Nashville Tax Solutions remains on its independently deployed release line.
  '489ace07-1a6b-4864-833a-4f8420568b40': {
    version: '3.0.0',
    releasedAt: '2026-10-23',
    title: 'Nashville Tax Solutions CRM 3.0 — Formal Versioning Baseline',
    changes: [
      'Formal semantic versioning begins with this release baseline',
      'Release notes dialog opens above CRM page content without overlap',
    ],
  },

  // Centurion Firm
  '8fd9a2ac-95df-4bf0-99e9-cda4b20eae4a': {
    version: '3.2.71',
    releasedAt: 'Pending sandbox verification',
    title: 'CRM 3.2.71 — Client Document Folder Management',
    changes: IRS_WORKFLOW_CHANGES,
  },
}

export function getReleaseInfo(tenantId) {
  return OFFICE_RELEASES[tenantId] || DEFAULT_RELEASE
}

export { DEFAULT_RELEASE, OFFICE_RELEASES }
