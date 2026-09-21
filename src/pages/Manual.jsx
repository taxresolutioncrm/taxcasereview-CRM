import { useState } from 'react'
import { FIRM } from '../lib/firmBranding'

const MANUAL_SECTIONS = [
  // ─── GETTING STARTED ────────────────────────────────────────────────────────
  {
    id: 'overview', icon: '🏠', label: 'Overview', category: 'Getting Started',
    title: 'What TaxRes CRM does',
    content: [
      { type: 'lead', text: 'TaxRes CRM is the shared operating platform for the TaxRes family of tax-resolution offices. The same core workflows, controls, release standards, and CRM Manual apply across Tax Case Review, Nashville Tax Solutions, CloudCPA, Demo, and future TaxRes-family offices, with office-specific branding, providers, permissions, and integrations documented where they differ.' },
      { type: 'flow', items: ['New Lead', 'Financial Intake', 'Send Full Package', 'Client Signs ⭐', 'Tasks Auto-Created', 'Active Client', 'Resolution ✓'] },
      { type: 'h3', text: 'Core features' },
      { type: 'cards', items: [
        { icon: '🎯', title: 'Lead pipeline', body: 'Capture leads, send investigation packages, collect e-signatures, and convert to active clients — the pipeline tracks every stage automatically.' },
        { icon: '📄', title: 'IRS form generation', body: 'Pre-fill Form 2848, 8821, state POAs, and the 433-F from the client record. Rep name, CAF, PTIN, and signature block all populate automatically.' },
        { icon: '📞', title: 'Built-in phone system', body: 'Inbound call routing, IVR by extension, hold music, transfer, add-caller, voicemail, and AI-generated call summaries with auto-created tasks.' },
        { icon: '💳', title: 'Payments & AR', body: 'Charge cards, set up 3-installment plans from the signed addendum, track AR, and send Stripe payment links — all from the client file.' },
        { icon: '⚡', title: 'Automated workflows', body: 'When a client signs the Full Package, 6 tasks auto-create and assign to the right rep and associate based on role — no manual setup needed.' },
        { icon: '🔐', title: 'Client & employee portals', body: 'Clients sign docs, pay invoices, and upload files. Employees clock in and see their assigned cases from any device.' },
        { icon: '🤖', title: 'AI assistant', body: 'The 🤖 button on every page reads what\'s on screen and answers tax resolution questions, drafts emails, and explains IRS processes.' },
        { icon: '💬', title: 'Team chat & huddles', body: 'Slack-style channels, direct messages, and full-screen video huddles with screen share, raise hand, emoji reactions, and a thread panel.' },
        { icon: '🖥️', title: 'Live training sessions', body: 'Host live screen-share training sessions for new offices. Participants join via link — no install. Session recording, chat, and virtual backgrounds all built in.' },
        { icon: '📊', title: 'Reports', body: 'Revenue, production, call volume, timeclock, AR aging, and pipeline reports — filterable by rep, date range, and status.' },
      ]},
      { type: 'h3', text: 'TaxRes family office model' },
      { type: 'table', headers: ['Office type', 'Manual behavior', 'Office-specific configuration'], rows: [
        ['Tax Case Review (TCR)', 'Uses this shared TaxRes CRM Manual', 'TCR branding, tenant data, and configured communications/payments'],
        ['Nashville Tax Solutions', 'Uses this shared TaxRes CRM Manual', 'Nashville branding, per-rep mailbox configuration, Verizon Business calling where mapped, office fax/accounting configuration'],
        ['CloudCPA', 'Uses this shared TaxRes CRM Manual', 'CloudCPA branding, tenant-scoped employee access, communications, booking, payments, and office integrations'],
        ['Demo Office', 'Uses this shared TaxRes CRM Manual', 'Demo branding and safe/demo provider behavior where applicable'],
        ['Future TaxRes-family offices', 'Inherit the shared manual and release gates', 'Their tenant branding, providers, staff, permissions, and integrations must be documented when they differ from the shared workflow'],
      ]},
      { type: 'info', text: 'Every TaxRes-family office is a separate tenant. Office data, employees, clients, cases, documents, communications, payments, and settings must remain tenant-isolated. Shared code and a shared manual do not mean shared office data.' },
      { type: 'tip', text: 'Every communication — call, email, SMS, fax, booking, document sent — creates a note automatically on the client or lead file. You never need to manually log anything the system already captures.' },
    ]
  },
  {
    id: 'roles', icon: '👥', label: 'Roles & Access', category: 'Getting Started',
    title: 'Roles & access levels',
    content: [
      { type: 'lead', text: 'Every employee has one of six access levels. The CRM shows or hides features based on role. Nashville uses the labels Associate (Tax Advisor) and Para (Tax Associate) for their role naming.' },
      { type: 'table', headers: ['Role', 'Who it\'s for', 'What they can do'], rows: [
        ['Super Admin', 'Firm owner, lead EA', 'Everything — all settings, all clients, all billing, employee management, all reports, multi-office admin'],
        ['Admin', 'Office manager', 'All clients and leads, tasks, payments, calendar, most reports — no firm settings or employee pay'],
        ['Tax Advisor / Associate', 'EAs, CPAs, preparers', 'Assigned clients and leads, tasks, documents, IRS forms, calling, all communications'],
        ['Tax Associate / Para', 'Paralegals, support staff', 'Clients/leads assigned to them, tasks, documents — no billing settings'],
        ['Sales', 'Sales reps', 'Leads and communications — no billing, no client documents, no IRS forms'],
        ['Read Only', 'Observers', 'View everything in their scope — no edits, no payments, no sending'],
      ]},
      { type: 'h3', text: 'Nashville phone extensions' },
      { type: 'table', headers: ['Extension', 'Employee', 'Role'], rows: [
        ['101', 'Christopher Bennett', 'Super Admin'],
        ['102', 'Adam Barr', 'Associate'],
        ['103', 'Amber Fischer', 'Associate'],
        ['104', 'Camille Loose', 'Associate'],
        ['105', 'Lucille Thomas-Menard', 'Associate'],
        ['106', 'Isabela Fuentes-Pettingill', 'Associate'],
        ['107', 'Art Sapunar', 'Associate'],
        ['108', 'Virginia Jiwa', 'Associate'],
        ['109', 'Averie Austin', 'Para'],
        ['110', 'Amanda Barrows', 'Para'],
      ]},
      { type: 'h3', text: 'Adding a new employee' },
      { type: 'steps', items: [
        { title: 'Firm → Employees → + Add Employee', desc: 'Enter name, email, role, phone, and extension. Extension must be unique within your office.' },
        { title: 'Set CAF number and PTIN (if applicable)', desc: 'These auto-populate on every 2848 and 8821 when this employee is the assigned rep.' },
        { title: 'Upload a profile photo', desc: 'Shows on the kiosk, employee directory, and client file assignments.' },
        { title: 'Set a portal PIN', desc: '4-digit PIN for the employee portal — separate from the main CRM login.' },
        { title: 'Send the CRM invitation', desc: 'From the employee card, click ✉️ Invite. TCR, CloudCPA, Demo, and other central TaxRes-family offices use the authenticated invite-employee service; Nashville automatically uses its employee-access-link bridge into the same TaxRes family identity. The employee receives a branded setup/reset email and creates one TaxRes family password.' },
        { title: 'Existing employee accounts use recovery, not duplicate users', desc: 'If the employee already has an Auth login, Invite generates a secure recovery/setup link for that same account. It does not create a second employee or second Auth identity.' },
        { title: 'Resend access when needed', desc: 'Click Invite again or use the password/reset control. Both now use the same TaxRes family access flow rather than a separate Supabase reset-email path.' },
        { title: 'Email transport fallback', desc: 'If the office mail transport is temporarily unavailable, the CRM prepares the secure setup link and copies it for authorized staff instead of losing the invite. Do not create another employee record.' },
        { title: 'Test the actual employee login', desc: 'Confirm email + newly created password opens the correct office and the employee only sees the permissions assigned on their profile. Nashville must land in Nashville; TCR/CloudCPA/Demo remain tenant-isolated.' },
      ]},
      { type: 'warn', text: 'Deleting an employee does not delete their clients or notes. It marks them inactive and unassigns them from future tasks. Always reassign their open tasks before deactivating.' },
    ]
  },
  {
    id: 'dashboard', icon: '📊', label: 'Dashboard', category: 'Getting Started',
    title: 'Dashboard',
    content: [
      { type: 'lead', text: 'The dashboard is your daily command center. Every tile is a live metric. Clicking any tile navigates to the filtered list it represents. Tiles are draggable — rearrange them to match your workflow. The layout saves automatically per employee.' },
      { type: 'table', headers: ['Tile', 'What it shows', 'Filters to'], rows: [
        ['Open Leads', 'Leads not yet converted or closed', 'Leads page — Open status only'],
        ['Clients', 'Total active clients', 'Clients page — Active status'],
        ['Active Cases', 'Cases in active resolution stages', 'Cases page — Active filter'],
        ['MTD 1st Trades', 'Investigation fees sold this month (from leads.taxFee)', 'Leads page'],
        ['MTD 2nd Trades', 'Resolution fees collected this month (from payments)', 'Payments page'],
        ['Unpaid Invoices', 'Outstanding invoice count', 'Invoices/AR page'],
        ['Open Tasks', 'Incomplete tasks assigned to you (or all, if Admin)', 'Tasks page'],
        ['Upcoming DL', 'IRS/state deadlines in next 14 days', 'Cases page — deadline view'],
        ['Overdue DL', 'Deadlines already past due date', 'Cases page — overdue filter'],
        ['AR Outstanding', 'Total unpaid balance across all clients', 'AR page'],
      ]},
      { type: 'h3', text: '1st Trades vs 2nd Trades' },
      { type: 'info', text: '1st Trades = investigation fees from leads converted this month. 2nd Trades = resolution payments actually collected this month. They measure different things by design — a client can sign in March (1st Trade) but resolution payments continue for 6 months (2nd Trades). They will not match — that is correct.' },
      { type: 'h3', text: 'Time zone clocks' },
      { type: 'info', text: 'The top-right corner shows Eastern, Central, Mountain, Pacific, Alaska, and Hawaii time simultaneously — useful when calling clients across time zones.' },
      { type: 'h3', text: 'IRS.gov Updates feed' },
      { type: 'info', text: 'The top-right panel pulls real IRS news and taxpayer advocate updates from IRS.gov RSS feeds. New announcements, enforcement notices, and policy changes appear within 24 hours of publication.' },
      { type: 'h3', text: 'CRM Tips' },
      { type: 'info', text: 'The bottom-right panel shows rotating CRM tips — one new tip per day covering features, shortcuts, and best practices specific to tax resolution workflows.' },
    ]
  },

  // ─── CLIENT PIPELINE ────────────────────────────────────────────────────────
  {
    id: 'leads', icon: '🎯', label: 'Leads', category: 'Client Pipeline',
    title: 'Leads',
    content: [
      { type: 'lead', text: 'A lead is anyone who has not yet signed an investigation agreement. Every new inquiry starts here. The pipeline tracks where each lead is, every action taken, and every communication sent — automatically.' },
      { type: 'h3', text: 'Creating a lead' },
      { type: 'steps', items: [
        { title: 'Leads → + New Lead', desc: 'Fill in name, phone, email, and client type: Individual, Business, or Individual & Business. For Individual & Business, both the person\'s name AND the business name are stored separately.' },
        { title: 'Set the tax issue and investigation fee', desc: 'Enter the issue type (IRS balance, payroll tax, state, unfiled returns, etc.), estimated tax owed, and the investigation fee. This fee populates MTD 1st Trades on the dashboard when the lead converts.' },
        { title: 'Nashville: service checkboxes and contract details', desc: 'Nashville leads include 12 service checkboxes (IA, OIC, Penalty Abatement, CNC, CDP, Compliance, etc.), Sales Rep, Contract Fee, and a 3-trade payment schedule. These pre-fill the Fee Agreement Addendum.' },
        { title: 'Assign Tax Advisor and Tax Associate', desc: 'Assigned To = Tax Advisor who owns this lead. Tax Associate = the support person. Workflow tasks auto-assign to these roles when the Full Package is signed.' },
        { title: 'Set the source', desc: 'Track where the lead came from: Referral, Google, Facebook, Cold Call, Walk-In, Website, etc. Feeds the Source report.' },
        { title: 'Save — lead enters the pipeline', desc: 'Appears on the Leads page, dashboard, and the assigned rep\'s view. A note is logged automatically with who created the lead and when.' },
      ]},
      { type: 'h3', text: 'Lead pipeline statuses' },
      { type: 'table', headers: ['Status', 'Meaning', 'Set how'], rows: [
        ['New Lead', 'Just entered the system', 'Auto on create'],
        ['Contacted', 'First outreach made', 'Manual'],
        ['Consultation Scheduled', 'Booking confirmed', 'Auto when booking created from this lead'],
        ['Consultation Completed', 'The consult happened', 'Manual after appointment'],
        ['Full Package Sent', 'E-sign package sent', 'Auto when package sent'],
        ['Tax Inv Agreement Signed', 'Package signed — triggers 6 workflow tasks', 'Auto when signed'],
        ['Tax Investigation Active', 'Investigation underway', 'Manual'],
        ['Converted to Client', 'Now a full client record', 'Auto on conversion'],
        ['Not Interested', 'Closed — no sale', 'Manual'],
        ['Lost', 'Chose another firm or went silent', 'Manual'],
      ]},
      { type: 'h3', text: 'Lead quick actions' },
      { type: 'cards', items: [
        { icon: '📦', title: 'Send Full Package', body: 'Sends 2848 + 8821 + State POA + Tax Service Agreement in one e-sign envelope. When signed, status advances and 6 workflow tasks auto-create.' },
        { icon: '📋', title: 'Send Financial Intake', body: 'Sends a secure link to the 433-F financial intake wizard. Client fills it online — data lands in the Financial Profile tab and pre-fills the 433-F PDF.' },
        { icon: '✍️', title: 'E-Signature', body: 'Send any individual document for e-signature: Tax Service Agreement, 2848, 8821, Fee Agreement Addendum, 9465, OIC Application, or custom upload.' },
        { icon: '💰', title: 'Send Payment Link', body: 'Sends a secure Stripe checkout link via email or SMS. Client pays on their device. Payment captured and logged automatically.' },
        { icon: '📅', title: 'Send Booking Link', body: 'Sends the online scheduling link. Client picks their own time. Confirmation and reminders (24h + 1h) fire automatically.' },
        { icon: '📠', title: 'Send Fax', body: 'Fax a document from the lead file. Enter the recipient fax number manually — it starts blank since phone ≠ fax.' },
        { icon: '📧', title: 'Send Email', body: 'Send from pre-built templates or compose custom. Sends from your firm\'s connected email. Logged as a note automatically.' },
        { icon: '💬', title: 'Send SMS', body: 'Text the client directly. Templates include {name}, {firm}, {phone} placeholders. Reply thread tracked on the file.' },
        { icon: '🏢', title: 'Convert to Client', body: 'Converts to a full client record. All notes, documents, tasks, and payment methods carry over. Cannot be undone.' },
      ]},
      { type: 'warn', text: 'Every action on a lead auto-logs a note. Never manually duplicate what the system already captures — calls, emails, texts, faxes, documents sent, bookings. The Notes tab is the complete file history.' },
    ]
  },
  {
    id: 'esign', icon: '✍️', label: 'E-Signatures', category: 'Client Pipeline',
    title: 'E-Signatures',
    content: [
      { type: 'lead', text: 'Send documents for electronic signature directly from any lead or client file. No DocuSign account needed. The client receives a secure email link, signs with a typed signature, and the signed PDF is filed automatically.' },
      { type: 'h3', text: 'Available document types' },
      { type: 'table', headers: ['Document', 'What it contains', 'Special behavior on sign'], rows: [
        ['Full Package', '2848 + 8821 + State POA + Tax Service Agreement bundled', 'Advances pipeline + creates 6 workflow tasks'],
        ['Tax Service Agreement', 'Investigation agreement only', 'Advances pipeline to "Tax Inv Agreement Signed"'],
        ['Form 2848 (POA)', 'IRS Power of Attorney — pre-filled with rep credentials', 'File only'],
        ['Form 8821 (Tax Auth)', 'IRS Tax Information Authorization', 'File only'],
        ['Fee Agreement Addendum', 'Resolution fee, payment schedule, services — pre-filled from lead', 'Creates 3 installment payment records automatically'],
        ['Form 9465', 'Installment Agreement Request', 'File only'],
        ['OIC Application (656)', 'Offer in Compromise application', 'File only'],
        ['Custom Document', 'Any PDF you upload', 'File only'],
      ]},
      { type: 'h3', text: 'How to send an e-sign request' },
      { type: 'steps', items: [
        { title: 'Open lead or client → E-Signatures tab or Quick Actions', desc: '"Send Full Package" is the most common path — bundles all four required forms into one envelope.' },
        { title: 'Review the pre-fill', desc: 'Rep CAF, PTIN, phone, fax, and address pre-fill from the employee record. Client name, SSN/EIN, and address pre-fill from the lead. Review before sending.' },
        { title: 'Add a message (optional)', desc: 'Appears in the email body. Default message explains what they\'re signing and why.' },
        { title: 'Send — client receives a secure email link', desc: 'Email comes from your firm\'s connected address. Link is single-use and expires after 30 days.' },
        { title: 'Client signs at the SignPage', desc: 'Signing page shows your firm\'s branding. Client types their name. No account needed. Works on any phone or computer.' },
        { title: 'Signed PDF filed automatically', desc: 'Saved to Documents tab. Note created with timestamp. Automated actions fire based on document type.' },
      ]},
      { type: 'h3', text: 'Tracking e-sign status' },
      { type: 'table', headers: ['Column', 'What it tells you'], rows: [
        ['Sent', 'When the e-sign request was sent'],
        ['Opened', 'When the client first opened the link — blank = haven\'t seen it yet'],
        ['Last Viewed / Progress', 'Tracks repeat views and signing progress. Detailed envelope/audit views can show progress percentage and the approximate page reached.'],
        ['Reminders', 'How many automated reminders have gone out for an unsigned request'],
        ['Status', 'Pending / Signed / Expired (after 30 days unsigned)'],
        ['Signed', 'Date and time signature was completed'],
      ]},
      { type: 'tip', text: 'Check Opened, Last Viewed, and progress before following up. If Opened is blank, verify delivery/spam. If it was viewed but not completed, the audit trail tells you whether the signer stopped partway through the document so staff can follow up accurately.' },
      { type: 'info', text: 'E-sign lifecycle events are audit data. Sent, delivered/viewed, progress, completed/signed, resend/reminder, decline/void, timestamps, and available recipient metadata must remain attached to the envelope instead of being reduced to a single status label.' },
      { type: 'h3', text: 'What fires when the Full Package is signed' },
      { type: 'flow', items: ['Client Signs', 'Status → Signed', 'Pipeline → Tax Inv Agreement Signed', '6 Tasks Created', 'Documents Filed', 'Note Logged ✓'] },
    ]
  },
  {
    id: 'conversion', icon: '🔄', label: 'Converting to Client', category: 'Client Pipeline',
    title: 'Converting a lead to a client',
    content: [
      { type: 'lead', text: 'Once the investigation agreement is signed and the investigation fee is collected, convert the lead to a full client. Everything carries over — no re-entry of any information.' },
      { type: 'h3', text: 'Steps to convert' },
      { type: 'steps', items: [
        { title: 'Confirm agreement signed and investigation fee collected', desc: 'E-Signatures tab: status should show "Signed." Payments tab: investigation fee recorded. Both must be complete before conversion.' },
        { title: 'Click "Convert to Client" from the lead quick actions', desc: 'System checks for duplicate clients by name first. Double-click protection built in — a second click within 3 seconds is ignored.' },
        { title: 'Client record and case created automatically', desc: 'You land on the new client file. Pipeline stage defaults to "Investigation." All lead data carries.' },
        { title: 'Update the pipeline stage', desc: 'Move to wherever the case actually stands. The 6 workflow tasks already exist from the signature event.' },
      ]},
      { type: 'h3', text: 'What carries over automatically' },
      { type: 'cards', items: [
        { icon: '📝', title: 'All notes & activity', body: 'Every call log, email, SMS, fax, manual note, and status change — the complete file history from day one.' },
        { icon: '📄', title: 'Documents', body: 'Signed agreements, POAs, financial intake PDFs, and uploaded files — already in the Documents tab.' },
        { icon: '💳', title: 'Payment methods', body: 'Saved cards re-link to the new client. The 3 installment records from the addendum also carry.' },
        { icon: '✅', title: 'Workflow tasks', body: 'The 6 investigation tasks from the signature event remain open and re-link to the client file.' },
        { icon: '📋', title: 'Financial intake data', body: 'All 433-F data the client completed online is on the Financial Profile tab, ready to generate the form.' },
        { icon: '🏢', title: 'Business info', body: 'Business name, EIN, entity type, and address all carry for Individual & Business clients.' },
      ]},
      { type: 'warn', text: 'Conversion cannot be undone. If you convert accidentally, the client record must be deleted manually by a Super Admin. Confirm the lead is ready before converting.' },
    ]
  },
  {
    id: 'clients', icon: '🏢', label: 'Clients & Cases', category: 'Client Pipeline',
    title: 'Clients & Cases',
    content: [
      { type: 'lead', text: 'The client file is the single source of truth for everything about that taxpayer. Every tab is a different lens on the same record.' },
      { type: 'h3', text: 'Client file tabs' },
      { type: 'table', headers: ['Tab', 'What\'s there'], rows: [
        ['Overview', 'Contact info, case summary, pipeline stage, assigned reps, quick actions, service details'],
        ['Notes & Activity', 'Every communication, document sent, status change, and manual note — the complete file history'],
        ['Documents', 'Signed agreements, POAs, uploaded files, generated forms — organized by folder'],
        ['Tasks', 'Open and completed tasks — due dates, assigned reps, completion timestamps'],
        ['E-Signatures', 'All e-sign requests — status, sent, opened, reminders, signed date'],
        ['Payments', 'Payment history, saved cards, installment plan, invoices, AR balance'],
        ['Transactions', 'Full imported QuickBooks payment history — matched to this client'],
        ['Financial Profile', 'Completed 433-F / financial intake data — income, expenses, assets'],
        ['IRS Portal', 'Transcript uploads, POA/CAF tracker, compliance records, CSED dates'],
        ['Calls', 'Call logs with duration, AI transcript summary, and auto-created action items'],
        ['Cases', 'Linked case record — resolution stage, deadlines, compliance status'],
        ['State Forms', 'State POA tracker, state-specific forms, generated state documents'],
      ]},
      { type: 'h3', text: 'Case pipeline stages' },
      { type: 'table', headers: ['Stage', 'What\'s happening', 'Next step'], rows: [
        ['Investigation', 'Pulling transcripts, contacting IRS/state', 'Move to Financials when income/expense data ready'],
        ['Financials', 'Financial intake received, building the resolution analysis', 'Move to Negotiation when resolution type selected'],
        ['POA Sent', 'Power of attorney submitted — waiting for IRS to process', 'Move to Investigation when IRS confirms POA on file'],
        ['Docs Needed', 'Waiting for client to provide documents', 'Follow up — move forward when docs received'],
        ['Collection Hold', 'Protected from collection action', 'Monitor compliance — next deadline drives next action'],
        ['Compliance Filing/Payment', 'Filing delinquent returns or making compliance payments', 'Move to Negotiation when compliant'],
        ['Negotiation', 'Actively negotiating with IRS or state', 'Move to Resolution Pending when proposal submitted'],
        ['Resolution Pending', 'Proposal submitted — awaiting IRS decision', 'Monitor — OIC: up to 24 months. IA: 4-6 weeks.'],
        ['Active Plan', 'IA or payment plan accepted and active', 'Monitor compliance — alert if payment missed'],
        ['Under Review', 'IRS reviewing submitted documents or proposal', 'Follow up every 30 days'],
        ['Penalty Abatement', 'Abatement request submitted and pending', 'Move to Monitoring when accepted'],
        ['Monitoring/Review', 'Post-resolution compliance monitoring', 'Close File when monitoring period ends'],
        ['Resolved', 'Resolution accepted by IRS/state', 'Move to Monitoring or Close File'],
        ['Closed', 'Case complete — all actions finished', 'Archive'],
      ]},
      { type: 'h3', text: 'Searching clients' },
      { type: 'info', text: 'The global search bar and the Clients page search both cover: name, spouse name, phone, email, city, business name, SSN (last 4), EIN, tags, assigned associate, and para. Each office\'s data is isolated — you only see your office\'s clients.' },
    ]
  },

  // ─── BUSINESS FORMATION ────────────────────────────────────────────────────
  {
    id: 'formacorp', icon: '🏛️', label: 'FormaCorp', category: 'Business Formation',
    title: 'FormaCorp — A-to-Z business formation',
    content: [
      { type: 'lead', text: 'FormaCorp keeps the formation workflow in the CRM from intake through state approval, EIN, governing documents, banking, compliance, company services, and permanent document storage. For supported Florida formations, staff can prepare the filing, collect the government filing amount inside the CRM, submit through the supported Sunbiz workflow, and track every state milestone on one record.' },
      { type: 'info', text: 'FormaCorp is a shared TaxRes-family module. The same current workflow and filing/payment/lifecycle steps apply in Tax Case Review, Nashville Tax Solutions, CloudCPA, Demo, and future TaxRes-family offices; each office remains tenant-isolated and sees only its own formation records.' },
      { type: 'flow', items: ['Draft', 'Ready to Submit', 'Filing Queue', 'Submitted to Florida', 'Under State Review', 'Action Required', 'Approved / Active'] },
      { type: 'h3', text: 'Supported Florida formation types' },
      { type: 'table', headers: ['Entity type', 'Formation document', 'Governing document'], rows: [
        ['LLC', 'Florida Articles of Organization', 'Operating Agreement'],
        ['Professional LLC (PLLC)', 'Florida Articles of Organization', 'Operating Agreement'],
        ['C-Corporation', 'Florida Articles of Incorporation', 'Corporate Bylaws'],
        ['Non-Profit corporation', 'Florida Articles of Incorporation with nonprofit organizational language', 'Nonprofit Bylaws'],
      ]},
      { type: 'info', text: 'The CRM may label a nonprofit workflow as 501(c)(3), but state formation does not itself grant federal 501(c)(3) tax-exempt status. Federal exemption is a separate IRS process.' },
      { type: 'h3', text: '1. Create and review the formation record' },
      { type: 'steps', items: [
        { title: 'FormaCorp → New Corp / formation case', desc: 'Select the entity type and Florida as the formation state, then enter the exact proposed legal name and the client/company details.' },
        { title: 'Enter principal and mailing addresses', desc: 'The principal address must be a physical address, not a P.O. Box. Mailing address may be entered separately when needed.' },
        { title: 'Enter the registered agent', desc: 'Use the registered agent’s actual legal name and a physical Florida street address. The company being formed cannot be entered as its own registered agent.' },
        { title: 'Enter authorized representative / incorporator information', desc: 'LLCs use the authorized representative fields. Corporations require incorporator information. Profit corporations also require authorized shares. Nonprofits require the nonprofit purpose and director election/appointment method.' },
        { title: 'Set correspondence email and effective date', desc: 'Use the email where state correspondence should be received. Leave effective date blank for the normal filing-date result, or enter an allowed alternate date when intentionally needed.' },
        { title: 'Save the draft', desc: 'The case remains at Draft until the filing details, required signatures/acceptances, and filing authorization are complete.' },
      ]},
      { type: 'h3', text: '2. Preview and validate the state filing' },
      { type: 'steps', items: [
        { title: 'Click Preview Articles', desc: 'Review the generated Florida Articles before paying or submitting. Confirm the legal name, addresses, registered agent, ownership/incorporator information, purpose language where applicable, and signature blocks.' },
        { title: 'Correct anything before submission', desc: 'Use Edit Filing Details. FormaCorp blocks common filing problems such as an invalid Florida entity suffix, missing registered-agent acceptance, P.O. Box principal/agent addresses, missing corporation shares/incorporator, and incomplete nonprofit fields.' },
        { title: 'Confirm signatures and authorization', desc: 'Registered-agent acceptance is required. LLCs require the authorized representative signature; corporations require the incorporator signature. Filing authorization must also be confirmed.' },
      ]},
      { type: 'h3', text: '3. Collect the government filing amount inside the CRM' },
      { type: 'steps', items: [
        { title: 'Click Pay Government Filing Amount', desc: 'The payment form opens inside FormaCorp using the embedded Stripe Payment Element. It must not redirect the user to an outside checkout page.' },
        { title: 'Enter the payment card in the FormaCorp modal', desc: 'The CRM creates the Stripe PaymentIntent through the authenticated FormaCorp payment service and verifies the exact government amount for this case.' },
        { title: 'Confirm payment status', desc: 'Successful payment is stored as government filing funds received. The PaymentIntent reference, collected amount, and audit event stay attached to the formation case.' },
      ]},
      { type: 'warn', text: 'Government funds collected from the client inside FormaCorp and funds remitted to the state are two different accounting events. “Received” means the CRM collected the filing money. “Remitted” should only be recorded when the government filing channel has actually been funded/submitted.' },
      { type: 'h3', text: '4. Move the case to Ready to Submit' },
      { type: 'steps', items: [
        { title: 'Click Ready to Submit', desc: 'Use this only after the Articles are correct, required signatures/acceptance are present, filing authorization is confirmed, and the government filing amount has been collected.' },
        { title: 'Verify the filing packet', desc: 'The Florida submission area requires the official Electronic Filing Cover Sheet, the signed Florida Articles PDF, and the fax number printed on the Sunbiz cover sheet.' },
      ]},
      { type: 'h3', text: '5. Submit to Florida through the supported Sunbiz path' },
      { type: 'steps', items: [
        { title: 'Obtain the official Sunbiz Electronic Filing Cover Sheet', desc: 'Use the current cover sheet for the prepaid Sunbiz E-File / fax filing. Enter the Florida fax number printed on that cover sheet into FormaCorp.' },
        { title: 'Upload the Electronic Filing Cover Sheet', desc: 'Attach the exact cover sheet for this filing.' },
        { title: 'Upload the signed Florida Articles PDF', desc: 'Unsigned Articles are blocked. Use the final reviewed and signed filing document.' },
        { title: 'Confirm the prepaid Sunbiz E-File account has sufficient funds', desc: 'This checkbox is required because the actual state remittance is handled through the prepaid Sunbiz account. The client card payment collected in FormaCorp does not automatically load money into the Sunbiz prepaid account.' },
        { title: 'Click Staff: Submit via Prepaid Sunbiz Fax', desc: 'FormaCorp combines the filing packet, sends it through the authenticated CRM fax service, and stores the provider submission/tracking reference on the case.' },
      ]},
      { type: 'h3', text: '6. Track Florida review and decision' },
      { type: 'table', headers: ['Stage', 'Use it when'], rows: [
        ['Filing Queue', 'Packet is ready and waiting for staff transmission'],
        ['Submitted to Florida', 'The filing packet has been transmitted and a submission reference is recorded'],
        ['Under State Review', 'Florida is processing the submission'],
        ['Action Required', 'Florida returned a correction, rejection, or other item that must be addressed'],
        ['Approved / Active', 'Florida accepted the filing and the state document number / formation date have been recorded'],
      ]},
      { type: 'warn', text: 'Do not treat a business as approved or active merely because the packet was transmitted. Record approval only after Florida accepts the filing and provides the state acknowledgment/document number.' },
      { type: 'h3', text: '7. Complete the EIN workflow' },
      { type: 'steps', items: [
        { title: 'Open Company Lifecycle → EIN', desc: 'Complete the responsible-party and EIN application information after the entity is formed or when the filing workflow permits preparation.' },
        { title: 'Generate / prepare Form SS-4', desc: 'Review the legal name, responsible party, entity type, addresses, and filing answers before signature.' },
        { title: 'Submit the signed SS-4 from FormaCorp', desc: 'Upload the completed signed SS-4 and use the built-in fax action when the fax filing method applies. FormaCorp stores the submission reference.' },
        { title: 'Record the EIN when received', desc: 'Enter the EIN and confirmation details so they become part of the permanent company lifecycle record.' },
      ]},
      { type: 'h3', text: '8. Governing documents' },
      { type: 'steps', items: [
        { title: 'LLC / PLLC → Operating Agreement', desc: 'Generate the agreement from the company record, review ownership/management provisions, send for signature, and store the signed document.' },
        { title: 'Corporation → Corporate Bylaws', desc: 'Generate the corporation-specific bylaws and initial organizational action, then complete the signature/approval workflow.' },
        { title: 'Nonprofit → Nonprofit Bylaws', desc: 'Use the nonprofit version containing the nonprofit governance provisions tied to the formation record.' },
      ]},
      { type: 'h3', text: '9. Banking' },
      { type: 'steps', items: [
        { title: 'Open Company Lifecycle → Banking', desc: 'Generate the banking resolution and track bank-account setup after the entity and EIN are available.' },
        { title: 'Store only the permitted banking details', desc: 'FormaCorp tracks status, supporting documents, institution information when appropriate, and limited account identifiers. Do not store full online-banking credentials or full routing/account credentials in the lifecycle dashboard.' },
      ]},
      { type: 'h3', text: '10. Compliance and company services' },
      { type: 'steps', items: [
        { title: 'Open Compliance', desc: 'Track annual-report status, due dates, good standing, registered-agent items, and other recurring company obligations.' },
        { title: 'Open Company Services', desc: 'Create and track requests such as amendments, DBA/fictitious name work, certificates, foreign qualification, S-election workflow, licenses, or other supported company services.' },
        { title: 'Use Documents as the permanent record', desc: 'Formation documents, state acknowledgments, EIN letters, signed governing documents, banking resolutions, registered-agent notices, and compliance correspondence remain attached to the company record and indexed in CRM Documents.' },
      ]},
      { type: 'h3', text: 'Florida formation fees shown by FormaCorp' },
      { type: 'table', headers: ['Item', 'Current CRM amount / behavior'], rows: [
        ['Florida LLC / PLLC base filing', '$125 government filing amount before optional copies/status certificates'],
        ['Florida profit corporation base filing', '$70 government filing amount before optional copies/status certificates'],
        ['Certificate / certified copy options', 'Added only when selected in the filing details; they are not silently included'],
        ['FormaCorp add-on fee', '$0.00 — no separate formation-platform surcharge'],
      ]},
      { type: 'info', text: 'State fees and filing procedures can change. FormaCorp should be updated when Florida changes an official amount or filing rule; the manual must be updated in the same release whenever the workflow changes.' },
      { type: 'h3', text: 'Before calling a formation complete' },
      { type: 'steps', items: [
        { title: 'State filing accepted', desc: 'Florida document number and formation date recorded; case is Approved / Active.' },
        { title: 'EIN completed', desc: 'EIN and confirmation evidence stored when an EIN is required.' },
        { title: 'Governing document completed', desc: 'Operating Agreement or Bylaws generated and signed/approved as appropriate.' },
        { title: 'Banking setup tracked', desc: 'Banking resolution and setup status completed without storing prohibited credentials.' },
        { title: 'Compliance activated', desc: 'Annual report and ongoing compliance tracking are set for the new entity.' },
        { title: 'Documents filed to the company record', desc: 'Final Articles, state acknowledgment, EIN evidence, governing documents, and related records are indexed in Documents.' },
      ]},
    ]
  },

  // ─── DOCUMENTS ──────────────────────────────────────────────────────────────
  {
    id: 'forms', icon: '📄', label: 'IRS & State Forms', category: 'Documents',
    title: 'IRS & State Forms',
    content: [
      { type: 'lead', text: 'Generate pre-filled IRS authorization forms from the client record. Rep credentials, client tax info, and firm details all populate automatically — no manual form-filling.' },
      { type: 'h3', text: 'Forms available' },
      { type: 'table', headers: ['Form', 'Purpose', 'Auto-filled from'], rows: [
        ['Form 2848 (Individual)', 'POA — authorizes you to represent the client before IRS', 'Client SSN, tax years, rep CAF/PTIN, firm phone/fax, rep signature block'],
        ['Form 2848 (Business)', 'Business POA — managing member signs', 'Client EIN, business name, same rep block'],
        ['Form 8821', 'Tax Information Authorization', 'Same as 2848'],
        ['State POA (FL DR-835)', 'Florida state POA for state tax matters', 'Client info, state-specific fields, rep credentials'],
        ['Form 433-F', 'Collection Information Statement for OIC/IA', 'Populated from the online financial intake'],
        ['Form 9465', 'Installment Agreement Request', 'Client info, proposed payment amount, rep credentials'],
        ['FL Articles of Organization', 'Florida LLC formation for business clients', 'FormaCorp wizard — client business name, registered agent, members'],
      ]},
      { type: 'h3', text: 'How to generate a form' },
      { type: 'steps', items: [
        { title: 'Open client → IRS Portal tab or State Forms tab', desc: 'Each form has its own Generate button. For the 433-F, go to Financial Profile → Generate 433-F.' },
        { title: 'Click Generate', desc: 'The system pulls client data, rep block (CAF, PTIN, signature), and firm info. PDF renders via pdf-lib in the browser — no server round-trip.' },
        { title: 'Review in the print window', desc: 'Check all fields before printing. Opens in a new tab.' },
        { title: 'Print, fax, or send for signature', desc: 'Use Send Fax from quick actions to fax the form. Or use E-Sign to collect the client\'s signature electronically first.' },
      ]},
      { type: 'warn', text: 'State forms print the full SSN — states reject masked identifiers. IRS forms show only the last 4 digits. This matches IRS/state requirements and is not configurable.' },
      { type: 'h3', text: 'Form 2848 — key details' },
      { type: 'info', text: 'Both individual and business 2848 variants available. Business variant uses "Managing Member" as signer title by default — change this if needed. The signature date always matches the date the client signed the e-sign document, not the prep date.' },
      { type: 'h3', text: 'Tax years to include' },
      { type: 'info', text: 'The 2848 and 8821 include tax years from the lead\'s "tax years affected" field. Always include at least 3 years back from the oldest unpaid balance year, plus any open unfiled years. IRS will reject a POA that doesn\'t cover the specific year they\'re calling about.' },
    ]
  },
  {
    id: 'financial', icon: '📊', label: 'Financial Intake & 433-F', category: 'Documents',
    title: 'Financial Intake & Form 433-F',
    content: [
      { type: 'lead', text: 'The Financial Intake is a digital 433-F that clients complete online through a secure link. Their answers flow directly into the Financial Profile tab and pre-fill the 433-F PDF — no manual transcription.' },
      { type: 'h3', text: 'How it works' },
      { type: 'steps', items: [
        { title: 'Lead or client quick actions → Send Financial Intake', desc: 'An email with a secure branded link goes to the client. The link is tied to their record.' },
        { title: 'Client completes the wizard', desc: 'Multi-step form covering: filing status, dependents, employment (W-2 and self-employment), business income, monthly expenses (housing, utilities, food, transportation, insurance, childcare, medical), bank accounts, assets (real property, vehicles, retirement), credit cards, and other liabilities.' },
        { title: 'Data lands in the Financial Profile tab instantly', desc: 'You can watch it populate in real time as the client completes each section. Saves as they go — no final submit needed.' },
        { title: 'Generate the 433-F', desc: 'Financial Profile tab → Generate 433-F. All fields pre-fill from their intake answers. Review and print.' },
      ]},
      { type: 'h3', text: 'Withholding estimates' },
      { type: 'info', text: 'When the client enters gross pay, the intake automatically estimates federal withholding (based on current-year tax rates and standard deduction for their filing status), FICA (6.2% SS to wage base + 1.45% Medicare), and state withholding (FL and TX = 0%). These are estimates — actual withholding depends on W-4 elections.' },
      { type: 'h3', text: '433-F vs 433-A vs 433-B' },
      { type: 'table', headers: ['Form', 'Who it\'s for', 'When to use'], rows: [
        ['433-F', 'Individual taxpayers', 'Standard disclosure for most cases — OIC, IA, CNC'],
        ['433-A', 'Individual taxpayers — more detailed', 'OIC cases — IRS requires 433-A for OIC, not 433-F'],
        ['433-B', 'Business entities', 'Business cases — partnerships, corps, sole proprietors with business debt'],
      ]},
      { type: 'info', text: 'The CRM generates the 433-F. For OIC, use the 433-F data as reference and complete the 433-A manually in the IRS fillable PDF — 433-A has additional questions not in the 433-F.' },
      { type: 'warn', text: 'If the office has no email connected, sending the financial intake copies the link to the clipboard. Paste it into your own email or text it to the client.' },
    ]
  },
  {
    id: 'documents', icon: '📁', label: 'Documents', category: 'Documents',
    title: 'Documents',
    content: [
      { type: 'lead', text: 'Every document related to a client lives in the Documents tab — signed agreements, generated forms, uploaded files, fax confirmations, and imported records. Documents are attached to the authoritative client ID and then organized into that client’s folders; matching by display name alone is not considered sufficient.' },
      { type: 'h3', text: 'Document folders' },
      { type: 'table', headers: ['Folder', 'What goes here'], rows: [
        ['POA & Forms', 'Signed 2848s, 8821s, state POAs, and IRS authorization forms'],
        ['Agreements', 'Signed Tax Service Agreements, Fee Agreement Addendums, OIC applications'],
        ['Financial', '433-F, financial intake PDFs, bank statements, tax returns provided by client'],
        ['Correspondence', 'IRS notices, CP letters, levy notices, lien documents'],
        ['Uploads', 'Anything uploaded by you or the client through the portal'],
        ['Generated', 'Forms generated directly by the CRM (2848 PDFs, state forms)'],
      ]},
      { type: 'h3', text: 'Uploading documents' },
      { type: 'steps', items: [
        { title: 'Client file → Documents tab → Upload', desc: 'Drag and drop or click to browse. Supported: PDF, Word, Excel, JPG, PNG. Max 50MB per file.' },
        { title: 'Choose the folder', desc: 'Select which folder the document belongs in. Movable later. When imported or generated documents are linked to a client, verify they resolve to that client’s ID-backed folder rather than a similarly named client.' },
        { title: 'Add a label (optional)', desc: 'Add a description like "IRS Notice CP-503 dated 3/15/2026" to make it searchable.' },
        { title: 'Upload — filed and logged as a note', desc: 'The client can see their documents in the portal if you choose to share them.' },
      ]},
      { type: 'h3', text: 'Client-uploaded documents' },
      { type: 'info', text: 'When a client uploads through their portal, the file lands in the Uploads folder of their Documents tab immediately. A note logs automatically. A browser notification fires to the assigned rep.' },
      { type: 'h3', text: 'Fax confirmations' },
      { type: 'info', text: 'Every fax sent through the CRM generates a confirmation PDF — automatically saved to the Documents tab with fax number, timestamp, and page count. Always log the confirmation number in notes as a record of transmission.' },
    ]
  },

  // ─── TASKS & WORKFLOWS ──────────────────────────────────────────────────────
  {
    id: 'workflows', icon: '⚡', label: 'Workflow Templates', category: 'Tasks & Workflows',
    title: 'Workflow templates',
    content: [
      { type: 'lead', text: 'Workflow templates are pre-built task checklists that fire automatically when triggered. The Tax Investigation templates fire the moment a client signs the Full Package — no manual setup needed.' },
      { type: 'h3', text: 'Available templates' },
      { type: 'table', headers: ['Template', 'Trigger', 'Steps', 'Assigned to'], rows: [
        ['Tax Investigation — Personal (IRS)', 'Full Package signed by Individual or Individual & Business client', '6', 'Steps 1-5: Para. Step 6: Advisor.'],
        ['Tax Investigation — Business (IRS)', 'Manual apply only', '6', 'Same role split'],
        ['Tax Investigation — State', 'Manual apply only', '6', 'Same — "Contact IRS" becomes "Contact State Agency"'],
      ]},
      { type: 'h3', text: 'The 6-step investigation checklist' },
      { type: 'steps', items: [
        { title: 'Download signed POA & file', desc: 'Retrieve the signed 2848/8821 from Documents tab. Save locally for fax submission. Due: Day 1.' },
        { title: 'Fax to IRS CAF unit', desc: 'Fax the signed POA to the IRS CAF unit fax number for your region. Log the fax confirmation number in notes. Due: Day 1.' },
        { title: 'Contact IRS / State agency', desc: 'Call IRS Practitioner Priority Service (PPS): 866-860-4259. Confirm POA receipt, pull full case history — balance, CSED dates, collection status, open periods, pending levies. For state: call state DOR practitioner line. Due: Day 2.' },
        { title: 'Request transcripts & records', desc: 'Pull IMFOL, BMFOL, ACSS, and IRPTR via IRS e-Services or A2A. Upload to the client\'s IRS Portal tab. Due: Day 3.' },
        { title: 'Update info & notify Tax Advisor', desc: 'Update pipeline stage, CSED dates, compliance status in the case record. Notify the advisor. Due: Day 4.' },
        { title: 'Review financial intake & build resolution plan', desc: 'Advisor reviews 433-F data, CSED dates, and collection status. Determines resolution path: OIC, IA, CNC, Penalty Abatement, CDP hearing, Compliance, etc. Due: Day 7.' },
      ]},
      { type: 'h3', text: 'Role assignment rules' },
      { type: 'table', headers: ['Role in template', 'Who gets the task at Nashville'], rows: [
        ['ADVISOR', 'The Associate listed in the "Assigned To" field on the client/lead'],
        ['ASSOCIATE', 'The Para listed on the client/lead. If none set, auto round-robins to the next available Para.'],
      ]},
      { type: 'h3', text: 'Why Business and State templates are manual-only' },
      { type: 'info', text: 'Every Full Package triggers the same e-sign event. If all three templates fired on every signature, business clients would get both Personal AND Business investigation tasks — a duplicate. Reps apply Business or State templates manually after reviewing the case type.' },
      { type: 'h3', text: 'Applying a template manually' },
      { type: 'steps', items: [
        { title: 'Client file → Tasks tab → "Apply a workflow template"', desc: 'Link at the bottom of the tasks list.' },
        { title: 'Select the template', desc: 'Choose from available templates for your office.' },
        { title: 'Tasks created instantly', desc: 'Assigned by role, spaced 1 second apart to preserve sort order. Due dates calculated from today.' },
      ]},
      { type: 'h3', text: 'Creating a new workflow template' },
      { type: 'steps', items: [
        { title: 'Firm → Workflows → + New Workflow', desc: 'Name the workflow and write a description (shows in the template picker).' },
        { title: 'Set Entity Type and Trigger Event', desc: 'Entity: Lead, Client, Case, Document, Payment, etc. Trigger: status change, document signed, payment received, etc.' },
        { title: 'Add steps', desc: 'Each step needs a title, role (Advisor/Associate/Admin/Para/Sales), and due date in days from trigger. Section headings group related steps.' },
        { title: 'Save and activate', desc: 'Check "Active" to make it available. Inactive templates don\'t fire but stay in the library.' },
      ]},
      { type: 'warn', text: 'Editing a template does NOT update tasks already created from it. To use updated steps on an existing client, delete the old tasks and apply the template again.' },
    ]
  },
  {
    id: 'tasks', icon: '✅', label: 'Tasks', category: 'Tasks & Workflows',
    title: 'Tasks',
    content: [
      { type: 'lead', text: 'Tasks keep cases moving. Every task links to a client or lead, has a due date, and assigns to a specific person. Completed tasks stay on the file permanently — soft-deleted and visible in the completed view.' },
      { type: 'h3', text: 'Creating a task' },
      { type: 'cards', items: [
        { icon: '👤', title: 'From the client file', body: 'Tasks tab → Add Task. Client link pre-fills. Or use the ⚡ quick-pick dropdown for common tasks without opening the full modal.' },
        { icon: '📋', title: 'From the Tasks page', body: 'Global Tasks → + Add Task. Type the client or lead name to link it.' },
        { icon: '⚡', title: 'From workflow templates', body: 'Apply a template from the client\'s Tasks tab to create a full checklist — 6 tasks, pre-assigned by role, due dates spaced out.' },
      ]},
      { type: 'h3', text: 'Quick-pick common tasks' },
      { type: 'table', headers: ['Task', 'Icon', 'Typical assignee'], rows: [
        ['Call Client', '📞', 'Advisor'],
        ['Fax to IRS', '📠', 'Para'],
        ['Send Email', '📧', 'Advisor or Para'],
        ['Pull Transcripts', '📄', 'Para'],
        ['Review Financial Intake', '✅', 'Advisor'],
        ['File Return', '📑', 'Advisor'],
        ['Review OIC', '⚖️', 'Advisor'],
        ['Follow Up', '🔔', 'Advisor or Para'],
        ['Send Letter', '📬', 'Para'],
        ['Update Case Notes', '📋', 'Para'],
      ]},
      { type: 'h3', text: 'Task fields' },
      { type: 'table', headers: ['Field', 'What it does'], rows: [
        ['Title', 'What needs to be done — be specific enough that anyone can pick it up'],
        ['Due Date', 'When it must be completed — drives the Upcoming DL and Overdue DL dashboard tiles'],
        ['Assigned To', 'The employee responsible — they see it in their view and get notified'],
        ['Client/Lead', 'The file this task belongs to'],
        ['Priority', 'Low / Normal / High / Urgent — sorts in the task list'],
        ['Notes', 'Instructions or context for the assignee'],
        ['Section', 'Groups related tasks under a heading (from workflow templates)'],
      ]},
      { type: 'h3', text: 'Sort order and notifications' },
      { type: 'info', text: 'Tasks sort by due date ascending, then by creation time. Workflow templates space tasks 1 second apart so they appear in correct order even when due dates match. When a task is assigned to you, you get a browser notification and it appears in your task count badge in the sidebar. Overdue tasks show red; due today show orange.' },
    ]
  },

  // ─── COMMUNICATIONS ─────────────────────────────────────────────────────────
  {
    id: 'calling', icon: '📞', label: 'Calling', category: 'Communications',
    title: 'Calling',
    content: [
      { type: 'lead', text: 'The CRM includes a full phone system powered by SignalWire. Make and receive calls in the browser — no desk phone needed. Every call logs automatically on the client or lead file with duration, outcome, and AI transcript.' },
      { type: 'h3', text: 'Making an outbound call' },
      { type: 'steps', items: [
        { title: 'Click any phone number in the CRM', desc: 'Phone numbers on leads, clients, and the employee directory are clickable. One click dials from the Dialer.' },
        { title: 'The Active Call Bar appears at the bottom', desc: 'Shows the number, elapsed time, and all call controls. Navigate anywhere in the CRM while the call is active.' },
        { title: 'Use call controls while connected', desc: 'Mute, hold (parks caller with hold music), transfer to another rep by extension, or add a third caller to conference.' },
        { title: 'Hang up — call logs automatically', desc: 'Note added to Notes & Activity with duration and outcome. Also appears in the Calls tab with recording.' },
      ]},
      { type: 'h3', text: 'Inbound call flow' },
      { type: 'flow', items: ['Client calls main number', 'IVR answers', 'Client presses extension', 'Rep\'s browser rings', 'Rep answers or voicemail'] },
      { type: 'h3', text: 'Call controls' },
      { type: 'table', headers: ['Control', 'What it does', 'Notes'], rows: [
        ['Mute', 'Silences your mic — caller stays connected', 'Toggle — click again to unmute'],
        ['Hold', 'Parks caller with hold music', 'Toggle — click again to take off hold'],
        ['Transfer', 'Transfer to another rep by extension', 'Warm: speak to recipient first. Cold: immediate handoff.'],
        ['Add Caller', 'Add a third party — creates a conference', 'Useful for 3-way calls with IRS or state agents'],
        ['Hang Up', 'Ends the call for all parties', 'Recording stops and processes immediately'],
      ]},
      { type: 'h3', text: 'AI Call Summaries' },
      { type: 'info', text: 'After every recorded call, Groq Whisper transcribes the audio and LLaMA analyzes it. The Calls tab shows: full transcript, AI-generated summary of key points and client concerns, and action items — which are auto-created as tasks on the file.' },
      { type: 'h3', text: 'Voicemail' },
      { type: 'info', text: 'If no rep answers after 4 rings, the call rolls to voicemail. Recordings appear in the Dialer → Voicemails tab. Voicemail transcripts are generated automatically. A notification fires to the assigned rep.' },
      { type: 'warn', text: 'Nashville\'s SignalWire calling credentials must be configured in Settings → Calling & Communications before calling goes live. Until credentials are set, outbound calls will not place and inbound calls will not route.' },
    ]
  },
  {
    id: 'email', icon: '📧', label: 'Email', category: 'Communications',
    title: 'Email',
    content: [
      { type: 'lead', text: 'Send and receive email directly in the CRM. Every email sent from a client file logs as a note automatically. Inbound emails from clients match to their file by email address and log as notes too.' },
      { type: 'h3', text: 'Email systems by office' },
      { type: 'table', headers: ['Office', 'Email system', 'Connection method'], rows: [
        ['Tax Case Review', 'Gmail', 'Google OAuth per employee — Settings → Email → Connect Gmail'],
        ['Nashville Tax Solutions', 'Microsoft 365', 'Azure + M365 OAuth per employee — Settings → Email → Connect M365'],
        ['TaxRes CRM (admin)', 'SnappyMail', 'Built-in webmail — webmail.taxrescrm.net:7443'],
      ]},
      { type: 'h3', text: 'Connecting Gmail (TCR)' },
      { type: 'steps', items: [
        { title: 'Settings → Email & Calendar → Connect Gmail', desc: 'Google OAuth consent screen opens.' },
        { title: 'Sign in with your work Google account', desc: 'Use the Gmail address that receives client emails — not a personal account.' },
        { title: 'Grant permissions', desc: 'The CRM requests read, send, and label permissions — required for two-way sync and auto-logging.' },
        { title: 'If token expires', desc: 'The Email tab shows a "Reconnect" button when the token is dead. Click and re-authorize. Gmail tokens expire periodically — this is a Google security requirement.' },
      ]},
      { type: 'h3', text: 'Connecting Microsoft 365 (Nashville)' },
      { type: 'steps', items: [
        { title: 'Settings → Email & Calendar → Connect Microsoft 365', desc: 'Microsoft OAuth consent screen opens.' },
        { title: 'Sign in with your M365 work account', desc: 'Use the @nashvilletaxsolutions.com address.' },
        { title: 'Grant permissions', desc: 'The CRM requests Mail.ReadWrite, Mail.Send, and Calendars.ReadWrite.' },
        { title: 'Chris connects first as admin', desc: 'The admin account (Chris) establishes M365 app consent for the tenant. Other reps then connect individually.' },
      ]},
      { type: 'h3', text: 'Employee invite and password email delivery' },
      { type: 'info', text: 'Employee CRM invite and password-reset emails are system messages. Across the TaxRes family they are delivered through the TaxRes Stalwart system-mail transport, not through the recipient employee\'s own connected Gmail mailbox. This prevents same-address Gmail tests from appearing only in Sent and gives the employee a normal inbound message in Inbox or Spam/Junk.' },
      { type: 'tip', text: 'For a real delivery test, send the employee invite/reset from Employees and confirm the recipient receives the TaxRes family password link in Inbox or Spam/Junk. The CRM should not require the recipient\'s mailbox to be the sender.' },
      { type: 'h3', text: 'Spam / Junk folder' },
      { type: 'steps', items: [
        { title: 'Open Email → Spam', desc: 'The CRM shows provider-classified junk mail in a dedicated Spam folder instead of hiding it. Gmail SPAM, Microsoft 365 Junk Email, and connected IMAP Junk/Spam folders are synchronized into this view.' },
        { title: 'Check Spam when an expected message is missing', desc: 'If an employee invite, password reset, client reply, provider notice, or other expected email is not in Inbox, check Spam before assuming it was not delivered.' },
        { title: 'Move a legitimate message back to Inbox', desc: 'Drag the message to Inbox. For Gmail and Microsoft 365 connections the CRM also moves the provider-side message out of Spam/Junk so the mailbox stays synchronized.' },
        { title: 'Unread badge stays visible', desc: 'Spam has its own unread count so newly synchronized junk messages are visible without opening the folder first.' },
      ]},
      { type: 'warn', text: 'Spam/Junk is mailbox-specific. Each employee only sees the Spam/Junk messages from their own connected mailbox; tenant isolation and per-employee mailbox isolation still apply.' },
      { type: 'h3', text: 'Email templates' },
      { type: 'table', headers: ['Template', 'When to use', 'Tone'], rows: [
        ['1st Strike — Payment', 'First missed payment reminder', 'Courteous'],
        ['2nd Strike — Payment', 'Second missed payment — more urgent', 'Firm'],
        ['3rd Strike — Payment', 'Final warning before account action', 'Very firm'],
        ['1st Strike — Documents', 'First reminder for missing documents', 'Courteous'],
        ['2nd Strike — Documents', 'Second reminder — escalated', 'Firm'],
        ['3rd Strike — Documents', 'Final request before escalation', 'Very firm'],
        ['Not Responsible Notice', 'Notify client they\'re not responsible for a liability', 'Informative'],
        ['Revoke POA', 'Notify client and IRS of POA revocation', 'Formal'],
        ['Welcome / Onboarding', 'First communication after signing', 'Warm'],
        ['Resolution Update', 'Status update during active negotiation', 'Professional'],
      ]},
      { type: 'info', text: '{name} = client\'s first name. {firm} = your office name. {phone} = your firm\'s main phone. {rep} = your name. All placeholders substitute automatically when the template loads.' },
    ]
  },
  {
    id: 'sms', icon: '💬', label: 'SMS', category: 'Communications',
    title: 'SMS',
    content: [
      { type: 'lead', text: 'Send and receive text messages directly from any client or lead file. SMS threads are tracked on the file and logged as notes. Replies from clients come in to the same thread.' },
      { type: 'h3', text: 'Sending an SMS' },
      { type: 'steps', items: [
        { title: 'Open lead or client → Quick Actions → Send SMS', desc: 'Or click the SMS icon next to the client\'s phone number.' },
        { title: 'Choose a template or compose', desc: 'Templates include {name}, {firm}, and {phone} placeholders that fill from the client record.' },
        { title: 'Send — logged as a note immediately', desc: 'Shows as "SMS sent" in Notes & Activity with the message text, timestamp, and delivery status.' },
      ]},
      { type: 'h3', text: 'SMS templates' },
      { type: 'table', headers: ['Template', 'When to use'], rows: [
        ['Appointment Reminder', 'Before a scheduled consultation'],
        ['Payment Reminder', 'When a payment is due or past due'],
        ['Document Request', 'When you need the client to send or upload a document'],
        ['Follow Up', 'General check-in when no response to calls or emails'],
        ['Resolution Update', 'Brief status update'],
        ['Signing Reminder', 'Reminder to sign the e-sign package'],
        ['Custom', 'Compose from scratch'],
      ]},
      { type: 'h3', text: 'Inbound SMS' },
      { type: 'info', text: 'When a client replies, the reply appears in the SMS thread on their file and triggers a notification. The CRM matches inbound messages to client records by phone number. If the phone number isn\'t in the system, the message lands in the Unmatched SMS queue in the Dialer page.' },
      { type: 'warn', text: 'Nashville SMS requires SignalWire credentials to be configured. Until credentials are set, SMS sending is blocked.' },
    ]
  },
  {
    id: 'fax', icon: '📠', label: 'Fax', category: 'Communications',
    title: 'Fax',
    content: [
      { type: 'lead', text: 'Send faxes directly from any client or lead file. No fax machine needed. Every fax generates a confirmation PDF saved automatically to the client\'s Documents tab.' },
      { type: 'h3', text: 'Sending a fax' },
      { type: 'steps', items: [
        { title: 'Open lead or client → Quick Actions → Send Fax', desc: 'Or from the IRS Portal tab for forms going directly to IRS.' },
        { title: 'Enter the recipient fax number', desc: 'Starts blank intentionally — phone number ≠ fax number. Enter the specific fax number for the recipient.' },
        { title: 'Select or upload the document', desc: 'Choose from existing documents in the client\'s file, or upload a new PDF.' },
        { title: 'Add a cover page (optional)', desc: 'Cover page pre-fills with your firm name, phone, and the client name.' },
        { title: 'Send — confirmation logged as a note', desc: 'Fax confirmation PDF saved to Documents tab with timestamp, fax number, pages sent, and confirmation number.' },
      ]},
      { type: 'h3', text: 'Common fax recipients' },
      { type: 'table', headers: ['Recipient', 'Fax number', 'What to send'], rows: [
        ['IRS CAF Unit (East)', '855-820-3000', 'Form 2848 and 8821 for clients east of the Mississippi'],
        ['IRS CAF Unit (West)', '855-820-3001', 'Form 2848 and 8821 for clients west of the Mississippi'],
        ['IRS ACS (collections)', 'Varies by notice', 'Correspondence in response to ACS balance due notices'],
        ['IRS Appeals', 'Per notice', 'CDP hearing requests, appeals correspondence'],
        ['FL Dept of Revenue', '850-922-9398', 'Florida state tax correspondence, state POAs'],
      ]},
      { type: 'info', text: 'Always log the fax confirmation number in notes. If IRS claims they didn\'t receive a POA, the confirmation number proves transmission. The CRM stores the confirmation PDF — keep a separate log of confirmation numbers for fast reference during IRS calls.' },
    ]
  },
  {
    id: 'chat', icon: '🗨️', label: 'Team Chat & Huddles', category: 'Communications',
    title: 'Team Chat & Huddles',
    content: [
      { type: 'lead', text: 'Team Chat is your internal communication hub — Slack-style channels, direct messages, and full video huddles, all without leaving the CRM.' },
      { type: 'h3', text: 'Channels & direct messages' },
      { type: 'info', text: '#general is the default channel for all employees. Admins can create additional channels — #collections, #payroll, #intake, etc. Click any employee name in the sidebar to open a direct message. DMs are private — only the two participants can read them.' },
      { type: 'h3', text: 'Starting a huddle' },
      { type: 'steps', items: [
        { title: 'Click "Start Huddle" in the sidebar or right-click any employee name', desc: 'Right-click → Start Huddle opens a direct video call immediately.' },
        { title: 'The full-screen huddle opens', desc: 'Large video tiles for everyone in the call. Controls at the bottom.' },
        { title: 'Invite others with the 👥 Invite button', desc: 'Teammates get a notification and a join button in their chat.' },
        { title: 'Minimize to keep using the CRM', desc: 'Click ⬇ Minimize to collapse to a small bar. The huddle stays live while minimized.' },
      ]},
      { type: 'h3', text: 'Huddle controls' },
      { type: 'table', headers: ['Button', 'What it does'], rows: [
        ['🎤 Mic', 'Toggle microphone on/off'],
        ['📹 Camera', 'Toggle camera on/off'],
        ['🖥️ Share', 'Share your screen — all participants see it immediately'],
        ['🖼️ BG', 'Change or blur your video background — presets, solid colors, or custom image upload'],
        ['✋ Raise', 'Raise your hand — badge appears on your video tile visible to all'],
        ['😊 React', 'Send a floating emoji reaction that animates across the screen'],
        ['💬 Thread', 'Open the huddle thread — messages saved after the call ends'],
        ['⬇ Minimize', 'Shrink to a small bar to keep using the CRM while on the call'],
        ['📵 Leave', 'Leave the huddle — others stay connected'],
      ]},
      { type: 'h3', text: 'Slack integration' },
      { type: 'info', text: 'Team Chat bridges to your Slack workspace. Messages sent in the CRM forward to a mapped Slack channel, and Slack replies come back into the CRM thread. Configure in Settings → Team Chat → Connect Slack.' },
    ]
  },

  // ─── MONEY ──────────────────────────────────────────────────────────────────
  {
    id: 'payments', icon: '💳', label: 'Payments & AR', category: 'Money',
    title: 'Payments & AR',
    content: [
      { type: 'lead', text: 'Collect payments by card, set up installment plans, track AR, and send payment links — all from the client file. Each office has its own Stripe merchant account.' },
      { type: 'h3', text: 'Charging a card' },
      { type: 'steps', items: [
        { title: 'Open client → Payments tab → Charge', desc: 'Or "Charge Resolution Fee" from the Overview quick actions.' },
        { title: 'Enter amount and select card', desc: 'Saved cards appear. Or enter a new card — saves securely in Stripe for future charges.' },
        { title: 'Confirm — Stripe processes the payment', desc: 'Receipt emailed to client. Payment appears in the Payments page and Payments tab. Note logs automatically with amount, last 4 digits, and timestamp.' },
      ]},
      { type: 'h3', text: 'Installment plans from the Fee Agreement Addendum' },
      { type: 'info', text: 'When the Fee Agreement Addendum is signed, the system reads the contract fee and 3-trade payment schedule from the lead record and creates 3 scheduled installment records automatically — no manual data entry.' },
      { type: 'h3', text: 'Nashville: Two merchant accounts' },
      { type: 'info', text: 'Nashville has two Stripe accounts: one for Nashville Tax Solutions clients and one for Nationwide Professionals clients. Select the correct merchant account from the dropdown before charging — selecting the wrong account routes funds to the wrong entity.' },
      { type: 'h3', text: 'Send Payment Link' },
      { type: 'info', text: 'Quick Actions → Send Payment Link sends a secure Stripe checkout link via email or SMS. Client pays on their device. Payment captured in Stripe and logged automatically as a note.' },
      { type: 'h3', text: 'QuickBooks sync' },
      { type: 'info', text: 'When QuickBooks is connected (Settings → Accounting), payments sync bi-directionally. Nashville\'s $9.47M historical payment data was imported from QuickBooks — 4,031 transactions, 2,642 matched to clients, displayed in the Transactions tab.' },
    ]
  },
  {
    id: 'invoices', icon: '📃', label: 'Invoices', category: 'Money',
    title: 'Invoices',
    content: [
      { type: 'lead', text: 'Create invoices directly from client files, track payment status, and send reminders — all linked to the client record.' },
      { type: 'h3', text: 'Creating an invoice' },
      { type: 'steps', items: [
        { title: 'Open client → Payments tab → New Invoice', desc: 'Or from the global Invoices page → + New Invoice.' },
        { title: 'Add line items', desc: 'Each line item has a description, quantity, and unit price. Common items: Investigation Fee, Resolution Fee, Tax Return Preparation, Payroll Filing.' },
        { title: 'Set due date and terms', desc: 'Due date drives the overdue calculation. Net 30 is the default.' },
        { title: 'Save and send', desc: 'Click Send to email the invoice — client receives a PDF with a Stripe payment link embedded.' },
      ]},
      { type: 'h3', text: 'Invoice statuses' },
      { type: 'table', headers: ['Status', 'Meaning'], rows: [
        ['Draft', 'Created but not yet sent'],
        ['Sent', 'Emailed to client — awaiting payment'],
        ['Paid', 'Payment received and recorded'],
        ['Overdue', 'Past due date and unpaid'],
        ['Void', 'Cancelled — no longer billable'],
      ]},
      { type: 'info', text: 'The system does not auto-send payment reminders. Use the email strike templates (1st Strike — Payment, etc.) manually when invoices become overdue.' },
    ]
  },

  // ─── IRS TOOLS ──────────────────────────────────────────────────────────────
  {
    id: 'transcripts', icon: '📜', label: 'Transcripts & IRS Portal', category: 'IRS Tools',
    title: 'Transcripts & IRS Portal',
    content: [
      { type: 'lead', text: 'Pull IRS transcripts, track your POAs, and manage compliance records from the IRS Portal tab on each client file.' },
      { type: 'h3', text: 'Transcript types' },
      { type: 'table', headers: ['Transcript', 'IRS Code', 'What it shows', 'Best for'], rows: [
        ['Account Transcript', 'IMFOL (individual)', 'Payments, assessments, penalty & interest, TC codes, CSED dates', 'Balance owed, collection status, lien filing'],
        ['Account Transcript', 'BMFOL (business)', 'Same as IMFOL for business tax periods', 'Payroll tax, business income tax'],
        ['Wage & Income', 'IRPTR', 'All W-2s, 1099s, income documents filed for the year', 'Compare to client-reported income'],
        ['Tax Return', 'RTVUE', 'The filed return as IRS received it', 'Verify what was filed, confirm deductions'],
        ['Record of Account', 'TRDBV', 'Combined return + account in one transcript', 'Comprehensive single-year snapshot'],
        ['Civil Penalty', 'ACSS', 'Civil penalty assessments and TFRP', 'Trust Fund Recovery Penalty research'],
      ]},
      { type: 'h3', text: 'Pulling transcripts inside the CRM' },
      { type: 'steps', items: [
        { title: 'IRS Portal → Pull Transcripts', desc: 'Start from the Pull Transcripts workflow. The direct IRS workflow is the primary path; manual PDF upload is only the fallback.' },
        { title: 'Connect IRS / ID.me', desc: 'Use the IRS / ID.me connection card. Authentication opens in the secure IRS authorization window and returns the authorized practitioner session to the CRM.' },
        { title: 'Choose the client and verify POA', desc: 'Select the client record. A POA/TIA must be On File for the client and must cover every requested tax year before the Request Transcripts button is enabled.' },
        { title: 'Choose transcript types and tax years', desc: 'Select one or more transcript types, then use the Add a tax year dropdown repeatedly to add every needed year. The selector supports years back to 1996; actual IRS availability depends on transcript type and IRS retention.' },
        { title: 'Request transcripts from IRS', desc: 'Submit the request from the CRM. The request remains visible in Recent Transcript Requests while the IRS delivery is pending.' },
        { title: 'Returned PDFs file automatically', desc: 'Delivered transcript PDFs are parsed and filed to the selected client under Documents → Transcripts. Coverage is not marked complete until the requested year/type matrix has actually been received.' },
        { title: 'Use Manual PDF fallback only when needed', desc: 'If direct IRS delivery is unavailable, upload the PDF manually. The same parser and client-document filing rules apply.' },
      ]},
      { type: 'h3', text: 'Key TC codes' },
      { type: 'table', headers: ['TC Code', 'Meaning', 'Action needed'], rows: [
        ['TC 150', 'Tax return filed', 'Baseline — return on record'],
        ['TC 290', 'Additional assessment', 'Review — IRS added to balance'],
        ['TC 420', 'Examination indicator', 'Return selected for audit'],
        ['TC 530', 'Hardship/CNC status', 'Client in Currently Not Collectible — monitor compliance'],
        ['TC 582', 'Federal tax lien filed', 'Lien on record — affects credit and asset sales'],
        ['TC 670', 'Payment received', 'Balance reduced'],
        ['TC 780', 'Offer in Compromise accepted', 'OIC resolved — confirm compliance period'],
        ['TC 971', 'Miscellaneous action', 'Check action code — often CDP, CNC, or IA'],
      ]},
      { type: 'h3', text: 'CSED calculation' },
      { type: 'info', text: 'The CSED is 10 years from the assessment date (TC 150 or TC 290). The CRM calculates it from the assessment date on the transcript. Tolling events (OIC filing, CDP hearing, bankruptcy, military service) extend the CSED — the parser identifies common indicators but manual review is required for complex tolling situations.' },
    ]
  },
  {
    id: 'ai', icon: '🤖', label: 'AI Assistant', category: 'IRS Tools',
    title: 'AI Assistant',
    content: [
      { type: 'lead', text: 'The 🤖 button in the bottom-right corner of every page is your AI assistant — powered by Groq LLaMA. It reads what\'s on your screen and answers questions, drafts text, and looks up live data.' },
      { type: 'h3', text: 'What it can do' },
      { type: 'cards', items: [
        { icon: '⚖️', title: 'Resolution strategy', body: 'Reads the client\'s pipeline stage, financial profile, and case details on screen. Ask "What resolution options fit this client?" for an analysis based on their actual numbers.' },
        { icon: '📅', title: 'CSED calculations', body: 'Ask "What\'s the CSED on this assessment?" with transcript dates visible — calculates the 10-year expiration and identifies common tolling events.' },
        { icon: '📧', title: 'Draft communications', body: 'Ask "Draft a follow-up email for this client" — uses the client\'s name, case stage, and current status from the visible page.' },
        { icon: '📜', title: 'IRS processes', body: 'OIC acceptance criteria, CDP hearing timelines, TFRP procedures, IA thresholds, CNC qualification, penalty abatement arguments — detailed IRS procedure knowledge.' },
        { icon: '🌤️', title: 'Live info', body: 'Fetches live weather, current IRS news, and real-time info from DuckDuckGo. Ask about current events or live data.' },
        { icon: '📝', title: 'Anything on screen', body: 'The AI reads visible text from the current page. Ask about specific clients, balances, or cases you see without re-typing.' },
      ]},
      { type: 'warn', text: 'The AI permanently refuses: displaying full SSNs/EINs/CAF numbers, showing credit card details, changing passwords or settings, bulk-exporting client data, generating authentication tokens, or modifying payroll records. These refusals cannot be overridden.' },
      { type: 'tips', items: [
        'Navigate to the client\'s file before asking about them — the AI reads the page for context',
        'For CSED calculations, open the IRS Portal tab with transcript data visible first',
        'Click Clear to start a fresh conversation — the AI keeps context within a session',
        'Suggested prompts appear when you first open it — try them to understand what\'s possible',
      ]},
    ]
  },

  // ─── PORTALS ────────────────────────────────────────────────────────────────
  {
    id: 'booking', icon: '📅', label: 'Online Booking', category: 'Portals',
    title: 'Online Booking',
    content: [
      { type: 'lead', text: 'Clients book consultations online from your available calendar slots — like Calendly, built in. Every booking creates a lead, logs notes, and fires email + SMS reminders automatically.' },
      { type: 'h3', text: 'How booking works' },
      { type: 'steps', items: [
        { title: 'Client receives a booking link', desc: 'Send via quick action "Send Booking Link" from any lead, or share the public booking URL. The URL includes your tenant code (?t=...) so it shows your firm\'s branding.' },
        { title: 'Client picks their time', desc: 'Available slots pull from your calendar settings — real-time availability, no double-booking possible.' },
        { title: 'Client fills pre-booking questions', desc: 'Configure required questions in Settings → Booking: name, phone, email, issue type, tax amount owed, etc. Answers pre-fill the lead record.' },
        { title: 'Appointment confirms automatically', desc: 'Calendar event created. New lead created if client doesn\'t exist. Branded confirmation email sent immediately.' },
        { title: 'Reminders fire automatically', desc: '24-hour reminder (email + SMS) and 1-hour reminder (email + SMS) — no action needed.' },
      ]},
      { type: 'h3', text: 'Booking settings' },
      { type: 'table', headers: ['Setting', 'What it controls', 'Default'], rows: [
        ['Available days', 'Which weekdays clients can book', 'Mon–Fri'],
        ['Available hours', 'Start and end time for booking slots', '9:00 AM – 5:00 PM ET'],
        ['Appointment duration', 'How long each slot is', '30 minutes'],
        ['Buffer time', 'Gap between appointments', '0 minutes'],
        ['Max advance booking', 'How far out clients can book', '30 days'],
      ]},
      { type: 'h3', text: 'Public booking URLs' },
      { type: 'info', text: 'Nashville: taxrescrm.app/book?t=489ace07-1a6b-4864-833a-4f8420568b40. TCR: taxrescrm.app/book?t=61a89aef-0e7e-4ea2-b222-44ab2024655a. Share in your website, email signature, and social media.' },
    ]
  },
  {
    id: 'portal', icon: '🔐', label: 'Client Portal', category: 'Portals',
    title: 'Client Portal',
    content: [
      { type: 'lead', text: 'The Client Portal gives clients a secure, private view of their own case. No account creation — they log in with a magic link. RLS ensures each client sees only their own data at the database level.' },
      { type: 'h3', text: 'What clients can do' },
      { type: 'cards', items: [
        { icon: '📄', title: 'View documents', body: 'See all signed agreements, POAs, and files you\'ve shared. Download anything.' },
        { icon: '💳', title: 'Pay invoices', body: 'View outstanding balance and pay with saved card or new card. Stripe processes the payment — PCI compliant.' },
        { icon: '📤', title: 'Upload documents', body: 'Upload W-2s, 1099s, bank statements, or anything requested. Files land in their Documents tab immediately with a notification to the assigned rep.' },
        { icon: '💬', title: 'Send messages', body: 'Message the office directly. Replies appear in the CRM and log as notes on their file.' },
        { icon: '📋', title: 'View case status', body: 'See their current pipeline stage and active case summary.' },
      ]},
      { type: 'h3', text: 'How clients log in' },
      { type: 'steps', items: [
        { title: 'Client visits taxrescrm.app/portal', desc: 'Login page shows your firm\'s branding based on their email domain.' },
        { title: 'Client enters their email address', desc: 'System matches email to their client record. If no match, access is denied.' },
        { title: 'Magic link sent', desc: 'Secure link emailed. No password needed. Valid for 15 minutes, single-use.' },
        { title: 'Client accesses their file', desc: 'Sees only their own documents, invoices, messages, and case status.' },
      ]},
      { type: 'warn', text: 'The client portal uses the client\'s email address for authentication. Make sure the email on the client record is correct and reachable before sending the portal link.' },
    ]
  },
  {
    id: 'empportal', icon: '👷', label: 'Employee Portal', category: 'Portals',
    title: 'Employee Portal',
    content: [
      { type: 'lead', text: 'The Employee Portal is a simplified, mobile-friendly view for staff who need to check their assigned work without logging into the full CRM.' },
      { type: 'h3', text: 'Portal tabs' },
      { type: 'table', headers: ['Tab', 'What\'s shown'], rows: [
        ['Clients', 'All clients assigned to this employee as advisor or associate — with pipeline stage and recent note'],
        ['Cases', 'Active cases where this employee is the advisor or para — with current stage and upcoming deadlines'],
        ['Messages', 'SMS conversations involving this employee\'s clients'],
        ['Tasks', 'Open tasks assigned to this employee — due date, client, and completion checkbox'],
      ]},
      { type: 'h3', text: 'Accessing the portal' },
      { type: 'info', text: 'Employees log in at taxrescrm.app/emp with their work email and the 4-digit PIN set by an admin in their employee record. Employees see only their assigned clients — no cross-access between reps.' },
      { type: 'h3', text: 'Setting up portal access' },
      { type: 'steps', items: [
        { title: 'Firm → Employees → Edit the employee record', desc: 'Scroll to "Portal PIN" field — enter any 4-digit number.' },
        { title: 'Share the portal URL and PIN with the employee', desc: 'URL: taxrescrm.app/emp. They enter their email + PIN.' },
        { title: 'Employee tests login on their device', desc: 'Works on any smartphone browser — no app download needed.' },
      ]},
    ]
  },
  {
    id: 'kiosk', icon: '🖥️', label: 'Clock-In Kiosk', category: 'Portals',
    title: 'Clock-In Kiosk',
    content: [
      { type: 'lead', text: 'The kiosk lets employees clock in and out from a shared office tablet or computer — no individual login required.' },
      { type: 'h3', text: 'Setting up the kiosk' },
      { type: 'steps', items: [
        { title: 'Open the kiosk URL on the office device', desc: 'Nashville: taxrescrm.app/kiosk?t=489ace07-1a6b-4864-833a-4f8420568b40. The ?t= parameter loads Nashville\'s branding and staff list automatically.' },
        { title: 'Bookmark or pin the URL', desc: 'Set as the home page or pin the tab. The page requires no login and auto-refreshes.' },
        { title: 'Employees tap their name', desc: 'All active employees appear with their photo and current clock-in status.' },
        { title: 'Tap Clock In or Clock Out', desc: 'Timestamp logged in the timeclock system. Hours visible in Firm → Reports → Timeclock.' },
      ]},
      { type: 'info', text: 'Admins can edit time entries if an employee forgot to clock in or out — edit from Firm → Employees → the employee\'s time entries.' },
    ]
  },

  // ─── OPERATIONS / BILLING / TAX RETURNS ─────────────────────────────────────
  {
    id: 'calendar', icon: '📅', label: 'Calendar', category: 'Operations',
    title: 'Calendar & appointments',
    content: [
      { type: 'lead', text: 'The Calendar is the office schedule for consultations, client appointments, internal events, and imported meetings. Calendar records remain tenant-scoped and can link back to the client or lead.' },
      { type: 'steps', items: [
        { title: 'Calendar → New Event', desc: 'Enter title, date/time, event type, attendee/client, assigned staff, notes, and meeting information when applicable.' },
        { title: 'Use the linked client/lead when available', desc: 'Linking the event keeps appointment history attached to the correct record and allows follow-up communication from the event.' },
        { title: 'Respect external meeting links', desc: 'Imported Teams, Google Meet, Zoom, or Webex invitations keep the organizer’s original meeting URL. The CRM must not replace an external organizer link with an internal room.' },
        { title: 'Complete or update the appointment', desc: 'After the appointment, update the event status and the related lead/client stage when the workflow requires it.' },
      ]},
    ]
  },
  {
    id: 'transactions', icon: '💳', label: 'Transactions', category: 'Money',
    title: 'Transactions',
    content: [
      { type: 'lead', text: 'Transactions is the detailed money ledger used to review imported and CRM payment activity by client, associate, service, deposit account, amount, and status.' },
      { type: 'table', headers: ['Status / field', 'Use'], rows: [
        ['Posted / Cleared', 'Money confirmed as posted or cleared'],
        ['No Status / TBD / New Agmt', 'Needs review or is not yet finalized'],
        ['Refunded / Chargeback / Disputed / Check Returned / Failed', 'Exception states that require follow-up and reconciliation'],
        ['Client + client ID', 'Keep the transaction tied to the authoritative client record, not only a name match'],
      ]},
      { type: 'tip', text: 'Use Transactions for reconciliation and history. Use Payments/AR for collection workflow, scheduled trades, and outstanding client balances.' },
    ]
  },
  {
    id: 'timebilling', icon: '⏱️', label: 'Time & Billing', category: 'Money',
    title: 'Time & Billing',
    content: [
      { type: 'lead', text: 'Time & Billing records billable or internal work against clients, calculates WIP, and distinguishes billed from unbilled entries.' },
      { type: 'steps', items: [
        { title: 'Billing → Time & Billing → Log Time', desc: 'Select the client, activity type, date, hours, rate, and work description.' },
        { title: 'Review WIP', desc: 'Unbilled entries remain in work-in-progress until staff marks them billed or includes them in the appropriate billing workflow.' },
        { title: 'Use the Billing Report', desc: 'Filter and review entries by client/activity and compare hours, rate, amount, billed status, and WIP totals.' },
      ]},
    ]
  },
  {
    id: 'books', icon: '📚', label: 'Books & Ledger', category: 'Money',
    title: 'Books & Ledger',
    content: [
      { type: 'lead', text: 'Books & Ledger is the internal office ledger for income, expenses, accounts, and period review. It is separate from the client case ledger and can coexist with a connected accounting platform.' },
      { type: 'steps', items: [
        { title: 'Add a ledger entry', desc: 'Choose income or expense, date, description, category, amount, and the applicable account.' },
        { title: 'Use consistent categories', desc: 'Examples include Revenue, Retainer, Payment Plan, Rent, Payroll, Software, Marketing, Taxes, Utilities, Legal, and Other Expense.' },
        { title: 'Reconcile with the connected accounting platform', desc: 'When QuickBooks or Xero is connected, use the CRM connection and sync status rather than creating duplicate disconnected records.' },
      ]},
    ]
  },
  {
    id: 'taxreturns', icon: '🧾', label: 'Tax Returns', category: 'Tax Returns & Entities',
    title: 'Tax Returns',
    content: [
      { type: 'lead', text: 'Tax Returns tracks return preparation from draft through filing and acceptance, with the supporting tax documents, preparer information, review status, and client record kept together.' },
      { type: 'flow', items: ['Draft', 'In Review', 'Client Review', 'Ready to File', 'Filed', 'Accepted / Rejected', 'Amended if needed'] },
      { type: 'steps', items: [
        { title: 'Create or open the return', desc: 'Confirm taxpayer/client, year, return type, filing status, preparer, and the required tax documents.' },
        { title: 'Work through preparation and review', desc: 'Use the return’s status to show whether it is being prepared, reviewed internally, waiting on the client, or ready to file.' },
        { title: 'E-file through the configured transmitter', desc: 'Each office uses its own EFIN. The EFIN identifies the authorized firm/ERO; actual electronic transmission must use the configured IRS-approved/tested software or authorized transmitter connection. Save the return and set it to Ready to File before sending.' },
        { title: 'Record filing accurately', desc: 'Mark Filed only after the filing event occurred. Record acceptance/rejection separately so “filed” is not mistaken for “accepted.”' },
        { title: 'Keep the source documents attached', desc: 'W-2s, K-1s, supporting schedules, organizer material, and filing evidence stay attached to the taxpayer/client record.' },
      ]},
    ]
  },
  {
    id: 'stateforms', icon: '🏛️', label: 'State Forms & Docs', category: 'IRS Tools',
    title: 'State Forms & documents',
    content: [
      { type: 'lead', text: 'State Forms & Docs provides state-specific authorization and tax forms. Select the client and state, use the supported official form, review every populated field, then route the final document through e-sign/fax/storage as required.' },
      { type: 'steps', items: [
        { title: 'Select the correct state and form', desc: 'The library contains state-specific POA/authorization forms; form names and requirements vary by jurisdiction.' },
        { title: 'Pre-fill from the client and representative record', desc: 'Review taxpayer identifiers, business/individual name, address, representative information, tax types, periods, and signature requirements.' },
        { title: 'Review before sending', desc: 'State forms may require full identifiers or fields that differ from IRS forms. Never assume an IRS form rule applies to a state form.' },
        { title: 'Send and file the final copy', desc: 'Use the CRM fax/e-sign/document workflow when supported and keep confirmation evidence with the client record.' },
      ]},
    ]
  },
  {
    id: 'irsreference', icon: '☎️', label: 'IRS & State Reference', category: 'IRS Tools',
    title: 'IRS & State Reference',
    content: [
      { type: 'lead', text: 'The reference page is the operational lookup for IRS phone numbers, mailing addresses, state information, representative information, and procedure notes.' },
      { type: 'warn', text: 'Reference information can change. For a filing deadline, address, fax number, fee, or procedure that could have changed, verify the current agency instruction before relying on an older saved reference.' },
    ]
  },
  {
    id: 'timeclock', icon: '🕒', label: 'Time Clock', category: 'HR & Payroll',
    title: 'Time Clock',
    content: [
      { type: 'lead', text: 'Time Clock is the administrative punch-history view. It shows who is clocked in, daily entries, calculated hours, and allows authorized staff to correct missing or incorrect entries.' },
      { type: 'steps', items: [
        { title: 'Review current status', desc: 'Use Today / active status to see who is currently clocked in and who has completed a shift.' },
        { title: 'Correct an entry only when necessary', desc: 'Authorized staff can edit or add a missed punch. Keep notes explaining manual corrections.' },
        { title: 'Recalculate when required', desc: 'The recalculation control handles incomplete/overnight timing cases after the underlying in/out times are corrected.' },
      ]},
    ]
  },
  {
    id: 'timeoff', icon: '🏖️', label: 'Time Off', category: 'HR & Payroll',
    title: 'Time Off',
    content: [
      { type: 'lead', text: 'Time Off tracks PTO, sick-day, and vacation requests through pending, approved, or denied status.' },
      { type: 'steps', items: [
        { title: 'Employee submits the request', desc: 'Choose leave type and dates and provide the required note/details.' },
        { title: 'Manager reviews Pending requests', desc: 'Approve or deny from the Time Off area; the decision remains part of the employee record.' },
        { title: 'Review YTD totals', desc: 'Use the totals to monitor approved leave and avoid treating pending requests as approved time.' },
      ]},
    ]
  },
  {
    id: 'payroll', icon: '💵', label: 'Payroll', category: 'HR & Payroll',
    title: 'Payroll',
    content: [
      { type: 'lead', text: 'Payroll uses employee/pay-period data and timeclock entries to calculate and track payroll records, deductions, gross/net amounts, payment method, and pay stubs according to the configuration available to the office.' },
      { type: 'warn', text: 'Do not process payroll from an incomplete pay period. Review missed punches, regular/overtime hours, pay rates, deductions, and payment method before marking payroll completed.' },
    ]
  },
  {
    id: 'activityreport', icon: '📈', label: 'Activity Report', category: 'HR & Payroll',
    title: 'Employee Activity Report',
    content: [
      { type: 'lead', text: 'Activity Report summarizes staff activity by date range, employee, action, category, description, and related client/lead. Use it for operational review rather than reconstructing work from separate pages.' },
      { type: 'table', headers: ['Metric', 'Meaning'], rows: [
        ['Total Actions', 'Recorded staff/system activity in the selected range'],
        ['Calls Logged', 'Call-related activity recorded for staff'],
        ['Leads Touched', 'Lead records with activity'],
        ['Payments', 'Payment-related actions'],
        ['E-Signs Sent', 'Signature requests initiated'],
        ['Active Staff', 'Staff with recorded activity/login data in the selected view'],
      ]},
    ]
  },

  // ─── SETTINGS & REPORTS ─────────────────────────────────────────────────────
  {
    id: 'settings', icon: '⚙️', label: 'Firm Settings', category: 'Settings & Reports',
    title: 'Firm Settings',
    content: [
      { type: 'lead', text: 'Settings control how the CRM is configured for your office. Only Super Admins have access to all settings. Changes affect your office only.' },
      { type: 'h3', text: 'Settings tabs' },
      { type: 'table', headers: ['Tab', 'What you configure', 'Who can edit'], rows: [
        ['Firm Profile', 'Firm name, logo, phone, email, address, brand color', 'Super Admin'],
        ['Email & Calendar', 'Connect Gmail (TCR) or Microsoft 365 (Nashville) — per employee', 'Each employee connects their own'],
        ['Calling & Communications', 'SignalWire credentials, phone numbers, IVR recording, voicemail settings', 'Super Admin'],
        ['Team Chat', 'Slack workspace connection for two-way bridging', 'Super Admin'],
        ['Payments', 'Stripe Connect — link your firm\'s Stripe account', 'Super Admin'],
        ['Accounting', 'QuickBooks Online / Xero OAuth connection', 'Super Admin'],
        ['Storage', 'Document storage usage', 'Super Admin (view), All (upload)'],
        ['Booking', 'Available days/hours, appointment duration, buffer time, pre-booking questions', 'Admin or Super Admin'],
        ['Workflows', 'Create, edit, and manage workflow templates', 'Admin or Super Admin'],
        ['Uptime', 'Live status of all connected services', 'All roles (view only)'],
      ]},
      { type: 'h3', text: 'Logo upload' },
      { type: 'info', text: 'Upload your logo in Firm Profile. It propagates to: sidebar, all generated documents, client portal, employee portal login, email signatures, appointment confirmation emails, and booking page. PNG with transparent background works best. Recommended size: 400 × 120px.' },
      { type: 'h3', text: 'Uptime page — what each service does' },
      { type: 'table', headers: ['Service', 'If it shows red'], rows: [
        ['Supabase', 'CRM will not load — check Supabase status page'],
        ['Email server', 'Admin webmail down — use Gmail/M365 directly'],
        ['Cloudflare', 'Site may load slowly or not at all'],
        ['Stripe', 'Card charges will fail — do not attempt payments'],
        ['M365', 'Nashville email sync paused — M365 outage'],
        ['Groq', 'AI button will error — rest of CRM unaffected'],
        ['SignalWire', 'Calling and SMS down — use personal phones temporarily'],
      ]},
      { type: 'h3', text: 'Office-specific communications providers' },
      { type: 'info', text: 'Do not assume every TaxRes office uses the same phone, fax, or mailbox provider. The CRM routes communications according to that office’s configured provider/mapping. Nashville calling is mapped to Verizon Business One Talk where configured; fax may use the office-configured fax integration/import path; other TaxRes offices may use different providers.' },
      { type: 'warn', text: 'Carrier application activation and CRM routing are different things. A mapped Verizon One Talk number can be launched/routed by the CRM only after the underlying Verizon user/line is activated and the required carrier-side capability is available.' },
      { type: 'h3', text: 'QuickBooks Online connection' },
      { type: 'steps', items: [
        { title: 'Settings → Accounting → QuickBooks', desc: 'Start the authenticated QuickBooks connection for the current office.' },
        { title: 'Complete Intuit authorization', desc: 'Authorize the correct QuickBooks company. The OAuth callback returns to the CRM and stores the connection for this tenant.' },
        { title: 'Verify the connected company before syncing', desc: 'Confirm the office is connected to the intended QuickBooks company; never reuse another tenant’s connection.' },
        { title: 'Run/monitor sync', desc: 'Use the CRM accounting sync to import or reconcile supported accounting records and watch connection/sync status for errors.' },
      ]},
    ]
  },
  {
    id: 'reports', icon: '📈', label: 'Reports', category: 'Settings & Reports',
    title: 'Reports',
    content: [
      { type: 'lead', text: 'Reports give you a complete operational picture of the firm — revenue, production, call volume, timeclock, AR aging, pipeline, and source tracking. All reports filter by rep, date range, and status.' },
      { type: 'h3', text: 'Available reports' },
      { type: 'table', headers: ['Report', 'What it shows', 'Key filters'], rows: [
        ['Revenue', 'Total payments collected by period — by rep, payment type, and client', 'Date range, Rep, Payment type'],
        ['Production (1st Trades)', 'Investigation fees sold from leads this period', 'Date range, Rep, Source'],
        ['Production (2nd Trades)', 'Resolution fees collected this period', 'Date range, Rep'],
        ['Pipeline', 'Lead and client counts by pipeline stage — snapshot of where everything stands', 'Rep, Stage, Date'],
        ['Source', 'Where leads came from — referral, Google, Facebook, cold call, etc.', 'Date range, Source'],
        ['Call Volume', 'Inbound and outbound call counts by rep and day', 'Date range, Rep, Direction'],
        ['Timeclock', 'Hours worked per employee for any date range', 'Date range, Employee'],
        ['AR Aging', 'Outstanding balances bucketed: 0-30, 31-60, 61-90, 90+ days', 'Rep, Amount range'],
        ['Task Completion', 'Tasks completed vs overdue by rep', 'Date range, Rep, Status'],
        ['Client Activity', 'Clients with no activity in X days — find stale cases', 'Days inactive, Rep'],
      ]},
      { type: 'h3', text: 'Book Whip' },
      { type: 'info', text: 'Book Whip is the monthly client/associate/para production review for tax offices. Select the snapshot month, review the full office list, and use the sortable/clickable columns to verify each client is assigned and progressing correctly. It is tenant-scoped: each office sees its own Book Whip data.' },
      { type: 'tip', text: 'Book Whip is a monthly operational snapshot, not a replacement for the client file. Open the client from the report when you need the authoritative documents, notes, payments, assignments, or case history.' },
      { type: 'h3', text: 'Exporting reports' },
      { type: 'info', text: 'Every report has a Print button (PDF) and a CSV Export button. The CSV opens in Excel or Google Sheets. For payroll, use the Timeclock report exported as CSV — includes employee name, clock-in time, clock-out time, and total hours per day.' },
      { type: 'h3', text: 'Client Activity Report' },
      { type: 'info', text: 'Shows every client who has had no activity (no notes, calls, or tasks completed) in the last 30, 60, or 90 days. Use it to identify stale cases and follow up proactively before clients ask where things stand. This is your primary tool for case management discipline.' },
    ]
  },
  {
    id: 'hr', icon: '👔', label: 'HR & Payroll', category: 'Settings & Reports',
    title: 'HR & Payroll',
    content: [
      { type: 'lead', text: 'The HR & Payroll module tracks timeclock data, manages employee records, and feeds the payroll export for processing.' },
      { type: 'h3', text: 'Payroll export' },
      { type: 'steps', items: [
        { title: 'Reports → Timeclock → set the pay period date range', desc: 'Set the start and end of the pay period (weekly, bi-weekly, or semi-monthly).' },
        { title: 'Export to CSV', desc: 'Includes: employee name, total regular hours, overtime hours (over 40/week), days worked, and daily breakdown.' },
        { title: 'Review for missed clock-ins', desc: 'Look for days with no clock-in record. Edit from Employees → the employee record → Time Entries.' },
        { title: 'Process in your payroll system', desc: 'Import the CSV into ADP, Gusto, Paychex, or process manually. The CRM exports hours only — payroll calculations happen in your payroll system.' },
      ]},
      { type: 'h3', text: 'Employee record fields' },
      { type: 'table', headers: ['Field', 'Used where'], rows: [
        ['Name', 'Client files, task assignments, directory'],
        ['Email', 'Authentication, email connect'],
        ['Role / Access', 'Feature visibility, data access'],
        ['Extension', 'IVR routing, directory'],
        ['CAF Number', 'Pre-fills on 2848 and 8821 forms'],
        ['PTIN', 'Pre-fills on return-related forms'],
        ['Portal PIN', 'taxrescrm.app/emp login'],
        ['Avatar', 'Kiosk, directory, client file header'],
      ]},
      { type: 'warn', text: 'CAF numbers and PTINs pre-fill on every IRS form for that rep\'s clients. Keep these current — an expired PTIN will cause IRS to reject submitted forms. Update in Employees when the rep renews annually.' },
    ]
  },
  {
    id: 'deadlines', icon: '⏰', label: 'Deadlines & Compliance', category: 'Settings & Reports',
    title: 'Deadlines & Compliance',
    content: [
      { type: 'lead', text: 'IRS and state deadlines are tracked on each case and surface on the dashboard, the Deadlines page, and in task reminders. Never miss a CDP hearing deadline or CSED date.' },
      { type: 'h3', text: 'Types of deadlines tracked' },
      { type: 'table', headers: ['Deadline type', 'Days to act', 'Consequence of missing'], rows: [
        ['CDP Hearing Request', '30 days from notice date', 'Lose right to appeal collection — usually permanent'],
        ['Installment Agreement review', '30 days from IRS notice of default', 'IA defaults — lien/levy reinstated'],
        ['Tax return filing deadline', 'Per extension granted', 'Late filing penalty (5% per month, max 25%)'],
        ['CSED expiration', '10 years from assessment', 'IRS loses legal authority to collect — balance expires'],
        ['OIC response deadline', 'Per IRS notice', 'OIC rejected — must refile'],
        ['State DOR deadline', 'Per state notice', 'Varies by state — often same severity as IRS'],
        ['Audit IDR response', '30-45 days per IDR', 'Summons or income reconstruction'],
      ]},
      { type: 'h3', text: 'Adding a deadline' },
      { type: 'steps', items: [
        { title: 'Client file → Cases tab → Add Deadline', desc: 'Or from the global Deadlines page → + New Deadline.' },
        { title: 'Select deadline type', desc: 'CDP, CSED, Filing, Payment, Review, or Custom.' },
        { title: 'Set the date', desc: 'Enter the exact due date from the IRS/state notice. System calculates days remaining automatically.' },
        { title: 'Add notes', desc: 'Record the notice number, notice date, and context. Link to the notice document in Documents.' },
      ]},
      { type: 'h3', text: 'Dashboard deadline tiles' },
      { type: 'info', text: 'Upcoming DL shows deadlines in the next 14 days. Overdue DL shows past-due deadlines. Red = overdue. Yellow = within 7 days. Green = 8-14 days. Both tiles are clickable and filter the Cases page.' },
      { type: 'warn', text: 'CDP hearing deadlines are the most critical. A missed CDP hearing request permanently forfeits the client\'s right to appeal — this cannot be fixed after the deadline passes. Set a task reminder 2 weeks before every CDP deadline.' },
    ]
  },

  // ─── TRAINING ───────────────────────────────────────────────────────────────
  {
    id: 'training', icon: '🖥️', label: 'Live Training Sessions', category: 'Training',
    title: 'Live Training Sessions',
    content: [
      { type: 'lead', text: 'Host live screen-share training sessions for new offices, onboarding staff, or walkthroughs. Participants join from any browser — no install, no account.' },
      { type: 'h3', text: 'Starting a session' },
      { type: 'steps', items: [
        { title: 'Training tab → Start training session', desc: 'A 5-character room code generates instantly. The session is live — you\'re already the host.' },
        { title: 'Click "Share screen"', desc: 'Choose: Entire Screen (recommended — participants see everything), a specific Window, or a Browser Tab.' },
        { title: 'Send the invite link or email invite', desc: 'Copy the link or click ✉️ Email Invite to send a branded invitation. Staff click the link and join in their browser.' },
        { title: 'Click "Pop out"', desc: 'Opens the host controls in a separate window. Navigate the full CRM in your main window while the controls are in the pop-out.' },
        { title: 'Train — navigate the CRM normally', desc: 'The session follows you across every page. Participants see your screen in real time.' },
        { title: 'End the session', desc: 'Click "End session" in the host window. All participants are disconnected immediately.' },
      ]},
      { type: 'h3', text: 'Host window controls' },
      { type: 'table', headers: ['Control', 'What it does'], rows: [
        ['⏺ Record', 'Starts recording the screen share. Shows a live timer and REC indicator. Click ⏹ Stop — file auto-downloads and uploads to Supabase storage.'],
        ['🎙️ Mute / Unmute', 'Toggle your microphone'],
        ['📷 Stop cam / Start cam', 'Toggle your camera — affects what participants see in your camera tile'],
        ['🎨 Background', 'Open the background picker — blur, presets, gradient, or upload a custom image. Transmits to participants.'],
        ['💬 Chat', 'Open the session chat panel — participants can type questions if muted. Unread badge shows new messages.'],
        ['End session', 'Disconnects all participants and closes the room'],
      ]},
      { type: 'h3', text: 'Session recordings' },
      { type: 'steps', items: [
        { title: 'Click ⏺ Record in the host window', desc: 'Recording captures the screen share stream. Timer shows elapsed time.' },
        { title: 'Click ⏹ Stop when done', desc: 'Auto-downloads as a .webm file AND uploads to Supabase storage (training-recordings bucket).' },
        { title: 'Find recordings in the Recordings tab', desc: 'Training page → 🎬 Recordings tab. Lists all saved sessions with room code, date, and file size.' },
        { title: 'Play, download, or delete', desc: '▶ Play streams in the browser. ↓ Download saves to your computer. 🗑 Delete removes from storage permanently.' },
      ]},
      { type: 'h3', text: 'Virtual backgrounds' },
      { type: 'info', text: 'Click 🎨 Background to choose a background: Blur, Office presets, Gradient, Dark solid, your Firm Logo, or upload a custom image. The background applies to your camera and transmits to participants via WebRTC track replacement.' },
      { type: 'tip', text: 'For best results: share "Entire Screen" so you can navigate freely. Start the pop-out before sharing so it\'s in a separate window. If a participant\'s camera shows black, have them reload the join page and allow camera/mic when prompted.' },
    ]
  },
  {
    id: 'tcr-reference', icon: '🏛️', label: 'TCR Quick Reference', category: 'Training',
    title: 'Tax Case Review — Quick Reference',
    content: [
      { type: 'lead', text: 'Office-specific details for Tax Case Review (TCR). These apply only to the TCR tenant — not Nashville.' },
      { type: 'h3', text: 'TCR office details' },
      { type: 'table', headers: ['Item', 'Value'], rows: [
        ['CRM URL', 'taxrescrm.app'],
        ['Booking URL', 'taxrescrm.app/book?t=61a89aef-0e7e-4ea2-b222-44ab2024655a'],
        ['Kiosk URL', 'taxrescrm.app/kiosk?t=61a89aef-0e7e-4ea2-b222-44ab2024655a'],
        ['Employee portal', 'taxrescrm.app/emp'],
        ['Client portal', 'taxrescrm.app/portal'],
        ['Admin webmail', 'webmail.taxrescrm.net:7443 (SnappyMail)'],
        ['Email system', 'Gmail — connected per employee via Google OAuth'],
        ['Phone system', 'SignalWire'],
        ['Payment processor', 'TCR Stripe account'],
        ['Video relay', 'taxcasereview.metered.live (Metered TURN)'],
        ['Work email', 'romy@taxcasereview.org'],
        ['Domains', 'taxrescrm.app · taxrescrm.net (Porkbun)'],
      ]},
      { type: 'h3', text: 'TCR team' },
      { type: 'table', headers: ['Name', 'Role', 'Email'], rows: [
        ['Romy Cruz', 'Super Admin / Owner / Lead EA', 'romy@taxcasereview.org'],
        ['Dana Richard', 'Tax Associate', 'TCR email'],
        ['Yesenia Gonzalez', 'Tax Associate', 'TCR email'],
      ]},
      { type: 'h3', text: 'Gmail reconnect — TCR' },
      { type: 'info', text: 'Gmail OAuth tokens expire periodically. When the Email tab shows "Reconnect," click it and re-authorize with your Google account. This is a Google security requirement — the token must be refreshed every few months. Takes about 30 seconds.' },
      { type: 'h3', text: 'TCR Stripe' },
      { type: 'info', text: 'TCR uses its own Stripe account separate from Nashville\'s. All payments from TCR clients go to TCR\'s Stripe. The Stripe account is connected in Settings → Payments. If Stripe shows disconnected, reconnect via Stripe OAuth in Settings.' },
      { type: 'h3', text: 'QuickBooks — TCR' },
      { type: 'info', text: 'TCR\'s QuickBooks integration is pending Intuit Production approval. Once approved, invoices and payments will sync bi-directionally. No action needed until Intuit completes their review.' },
      { type: 'h3', text: 'TCR Metered TURN (video relay)' },
      { type: 'info', text: 'TCR\'s training sessions use taxcasereview.metered.live for cross-network WebRTC video relay. If participants on different networks cannot see the screen share, verify the Metered credentials are still active in the Supabase settings row for the TCR tenant.' },
    ]
  },
  {
    id: 'manual-about', icon: '📖', label: 'About This Manual', category: 'Training',
    title: 'About This Manual',
    content: [
      { type: 'lead', text: 'This is the shared operating manual for the entire TaxRes family — Tax Case Review, Nashville Tax Solutions, CloudCPA, Demo, and future TaxRes-family offices. Core workflows apply across the family; when a tenant has different branding, providers, permissions, or integrations, the office-specific behavior is called out in the relevant section.' },
      { type: 'h3', text: 'Quick reference: most common tasks' },
      { type: 'table', headers: ['Task', 'Where to do it', 'Time'], rows: [
        ['Create a new lead', 'Leads → + New Lead', '2 min'],
        ['Send Full Package', 'Lead file → Quick Actions → Send Full Package', '1 min'],
        ['Convert lead to client', 'Lead file → Quick Actions → Convert to Client', '30 sec'],
        ['Apply workflow tasks', 'Client file → Tasks → Apply workflow template', '30 sec'],
        ['Generate a 2848', 'Client file → IRS Portal → Generate 2848', '1 min'],
        ['Fax to IRS CAF unit', 'Client file → Quick Actions → Send Fax', '2 min'],
        ['Upload a transcript', 'Client file → IRS Portal → Upload Transcript', '3 min'],
        ['Charge a card', 'Client file → Payments → Charge', '1 min'],
        ['Send a payment link', 'Client file → Quick Actions → Send Payment Link', '30 sec'],
        ['Start a training session', 'Training tab → Start training session', '30 sec'],
        ['Run a report', 'Firm → Reports → select report type', '1 min'],
        ['Check overdue tasks', 'Tasks page → filter by Overdue', '1 min'],
        ['Find a client', 'Search bar top of any page', '10 sec'],
      ]},
      { type: 'h3', text: 'IRS contact numbers' },
      { type: 'table', headers: ['IRS Line', 'Number', 'When to call'], rows: [
        ['Practitioner Priority Service (PPS)', '866-860-4259', 'General POA questions, transcript pulls, account info'],
        ['ACS Collections', '800-829-3903', 'Collection holds, installment agreements, lien/levy issues'],
        ['OIC Unit', '800-829-1040', 'OIC status inquiries'],
        ['IRS CAF Unit (East fax)', '855-820-3000', 'Submit 2848/8821 for eastern US clients'],
        ['IRS CAF Unit (West fax)', '855-820-3001', 'Submit 2848/8821 for western US clients'],
        ['Tax Practitioner Hotline', '800-829-4059', 'Technical tax law questions'],
        ['TEGE (Tax-Exempt/Gov)', '877-829-5500', 'Nonprofit and government entity issues'],
      ]},
      { type: 'h3', text: 'Key CSED tolling events' },
      { type: 'table', headers: ['Event', 'Tolling period', 'Notes'], rows: [
        ['OIC filing', 'While OIC is pending + 30 days after rejection', 'Includes appeal period'],
        ['CDP hearing request', 'While CDP is pending in Tax Court', 'Can be significant — months to years'],
        ['Bankruptcy filing', 'Duration of bankruptcy + 6 months', 'All collection suspended'],
        ['Military active duty', 'Duration of service + 270 days', 'SCRA protections apply'],
        ['Innocent spouse request', 'While request pending + 90 days', 'Partial tolling'],
        ['Voluntary extension', 'Per signed waiver', 'Never recommended — almost never in client\'s interest'],
        ['Living outside US', '6+ months absence', 'Tolls entire CSED while abroad'],
      ]},
      { type: 'h3', text: 'Manual synchronization rule' },
      { type: 'warn', text: 'The CRM Manual is part of the release scope across the entire TaxRes family. Any user-facing workflow, button, integration, status, role/access rule, document path, payment behavior, provider behavior, or operational procedure changed for TCR, Nashville, CloudCPA, Demo, or any future TaxRes-family office must have the corresponding shared or office-specific manual instructions updated in the same release. A feature change is not considered release-complete when its manual is stale.' },
      { type: 'tip', text: 'The CRM manual is searchable — use the search bar in the left sidebar to find any topic instantly. Navigation arrows at the bottom of each page move through sections in order.' },
    ]
  },
]

const CATEGORIES = [
  'Getting Started',
  'Operations',
  'Client Pipeline',
  'Documents',
  'Tasks & Workflows',
  'Communications',
  'Money',
  'IRS Tools',
  'Tax Returns & Entities',
  'Business Formation',
  'Portals',
  'Settings & Reports',
  'HR & Payroll',
  'Training',
]

function ManualPage({ standalone }) {
  const [selected, setSelected] = useState('overview')
  const [search,   setSearch]   = useState('')

  const filtered = search
    ? MANUAL_SECTIONS.filter(s =>
        s.label.toLowerCase().includes(search.toLowerCase()) ||
        s.title.toLowerCase().includes(search.toLowerCase()) ||
        s.content.some(b =>
          b.text?.toLowerCase().includes(search.toLowerCase()) ||
          b.items?.some(i =>
            (i.title||'').toLowerCase().includes(search.toLowerCase()) ||
            (i.body||i.desc||'').toLowerCase().includes(search.toLowerCase())
          )
        )
      )
    : MANUAL_SECTIONS

  const sec = MANUAL_SECTIONS.find(s => s.id === selected) || MANUAL_SECTIONS[0]
  const sidebarH = standalone ? '100vh' : 'calc(100vh - 120px)'

  const S = {
    sidebar: { width: 210, flexShrink: 0, borderRight: '1px solid var(--br)', display: 'flex', flexDirection: 'column', overflowY: 'auto', background: 'var(--sf)', height: sidebarH },
    navItem: (active) => ({ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: active ? 700 : 400, color: active ? '#a5b4fc' : 'var(--t2)', background: active ? 'rgba(99,102,241,.18)' : 'transparent', marginBottom: 1 }),
    content: { flex: 1, overflowY: 'auto', padding: standalone ? '28px 40px 60px' : '4px 28px 40px', height: sidebarH },
    lead: { fontSize: 14, color: 'var(--t2)', lineHeight: 1.75, marginBottom: 20 },
    h3: { fontSize: 15, fontWeight: 700, color: 'var(--tx)', margin: '24px 0 10px' },
    card: { background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 10, padding: '13px 15px', flex: '1 1 200px' },
    stepNum: { width: 26, height: 26, borderRadius: '50%', background: 'rgba(99,102,241,.18)', border: '1px solid rgba(99,102,241,.35)', color: '#a5b4fc', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
    flowBox: (special) => ({ background: special ? 'rgba(16,185,129,.12)' : 'rgba(99,102,241,.12)', border: `1px solid ${special ? 'rgba(16,185,129,.3)' : 'rgba(99,102,241,.25)'}`, borderRadius: 7, padding: '6px 12px', fontSize: 11, fontWeight: 700, color: special ? '#6ee7b7' : '#a5b4fc', whiteSpace: 'nowrap' }),
    th: { textAlign: 'left', padding: '7px 10px', background: 'rgba(99,102,241,.1)', color: '#818cf8', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid var(--br)' },
    td: { padding: '8px 10px', borderBottom: '1px solid rgba(99,102,241,.06)', fontSize: 12, color: 'var(--t2)', verticalAlign: 'top', lineHeight: 1.5 },
    callout: (type) => ({
      borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, lineHeight: 1.6, display: 'flex', gap: 8, alignItems: 'flex-start',
      ...(type === 'tip'  ? { background: 'rgba(16,185,129,.1)',  border: '1px solid rgba(16,185,129,.25)',  color: '#6ee7b7' } : {}),
      ...(type === 'warn' ? { background: 'rgba(245,158,11,.1)',  border: '1px solid rgba(245,158,11,.25)',  color: '#fde68a' } : {}),
      ...(type === 'info' ? { background: 'rgba(99,102,241,.1)',  border: '1px solid rgba(99,102,241,.25)', color: '#c7d2fe' } : {}),
    }),
  }

  function renderBlock(block, i) {
    switch (block.type) {
      case 'lead':  return <p key={i} style={S.lead}>{block.text}</p>
      case 'h3':    return <div key={i} className="manual-h3" style={S.h3}>{block.text}</div>
      case 'tip':   return <div key={i} style={S.callout('tip')}><span style={{flexShrink:0}}>💡</span><span>{block.text}</span></div>
      case 'warn':  return <div key={i} style={S.callout('warn')}><span style={{flexShrink:0}}>⚠️</span><span>{block.text}</span></div>
      case 'info':  return <div key={i} style={S.callout('info')}><span style={{flexShrink:0}}>ℹ️</span><span>{block.text}</span></div>
      case 'tips':  return (
        <div key={i} style={{ ...S.callout('tip'), flexDirection:'column', gap:6 }}>
          {block.items.map((t,j) => <div key={j} style={{display:'flex',gap:8}}><span>💡</span><span>{t}</span></div>)}
        </div>
      )
      case 'flow':  return (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:0, flexWrap:'wrap', margin:'14px 0 20px', rowGap:8 }}>
          {block.items.map((item, j) => [
            <div key={j} style={S.flowBox(item.includes('✓') || item.includes('⭐'))}>{item}</div>,
            j < block.items.length - 1 && <span key={'a'+j} style={{ color:'var(--t3)', fontSize:14, margin:'0 4px' }}>→</span>
          ])}
        </div>
      )
      case 'cards': return (
        <div key={i} style={{ display:'flex', flexWrap:'wrap', gap:10, margin:'12px 0 20px' }}>
          {block.items.map((c, j) => (
            <div key={j} className="manual-card" style={S.card}>
              <div style={{ fontSize:18, marginBottom:6 }}>{c.icon}</div>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--tx)', marginBottom:4 }}>{c.title}</div>
              <div style={{ fontSize:11, color:'var(--t2)', lineHeight:1.55 }}>{c.body}</div>
            </div>
          ))}
        </div>
      )
      case 'steps': return (
        <div key={i} style={{ margin:'12px 0 20px' }}>
          {block.items.map((step, j) => (
            <div key={j} style={{ display:'flex', gap:14, padding:'12px 0', borderBottom: j < block.items.length - 1 ? '1px solid rgba(99,102,241,.07)' : 'none' }}>
              <div style={S.stepNum}>{j + 1}</div>
              <div style={{flex:1}}>
                <div style={{ fontSize:13, fontWeight:700, color:'var(--tx)', marginBottom:4 }}>{step.title}</div>
                <div style={{ fontSize:12, color:'var(--t2)', lineHeight:1.6 }}>{step.desc}</div>
              </div>
            </div>
          ))}
        </div>
      )
      case 'table': return (
        <div key={i} className="manual-table-wrap" style={{ overflowX:'auto', margin:'12px 0 20px' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead><tr>{block.headers.map((h, j) => <th key={j} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{block.rows.map((row, j) => (
              <tr key={j}>{row.map((cell, k) => <td key={k} style={{ ...S.td, ...(k === 0 ? { fontWeight:600, color:'var(--tx)', whiteSpace:'nowrap' } : {}) }}>{cell}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      )
      default: return null
    }
  }

  return (
    <div className="manual-shell" style={{ display:'flex', height: sidebarH, overflow:'hidden', ...(standalone ? {} : { margin:'0 -32px', padding:'0 0 0 32px' }) }}>
      <div className="manual-sidebar" style={S.sidebar}>
        <div style={{ padding:'10px 10px 6px' }}>
          <div style={{ position:'relative' }}>
            <span style={{ position:'absolute', left:8, top:'50%', transform:'translateY(-50%)', fontSize:11, color:'var(--t3)' }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the manual…"
              style={{ width:'100%', background:'var(--s2)', border:'1px solid var(--br)', borderRadius:7, padding:'5px 8px 5px 24px', color:'var(--tx)', fontSize:11, outline:'none', boxSizing:'border-box' }}/>
          </div>
        </div>
        <div style={{ padding:'4px 6px 12px', overflowY:'auto', flex:1 }}>
          {search ? (
            filtered.length === 0
              ? <div style={{ padding:'12px 8px', fontSize:11, color:'var(--t3)' }}>No results</div>
              : filtered.map(s => (
                <div key={s.id} onClick={() => { setSelected(s.id); setSearch('') }} className="manual-nav-item" style={S.navItem(selected === s.id)}>
                  <span style={{ fontSize:13 }}>{s.icon}</span>{s.label}
                </div>
              ))
          ) : (
            CATEGORIES.map(cat => {
              const items = MANUAL_SECTIONS.filter(s => s.category === cat)
              if (!items.length) return null
              return (
                <div key={cat}>
                  <div style={{ fontSize:9, fontWeight:800, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.08em', padding:'10px 8px 4px' }}>{cat}</div>
                  {items.map(s => (
                    <div key={s.id} onClick={() => setSelected(s.id)} className="manual-nav-item" style={S.navItem(selected === s.id)}>
                      <span style={{ fontSize:13 }}>{s.icon}</span>{s.label}
                    </div>
                  ))}
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="manual-content" style={S.content}>
        <section className="manual-hero">
          <div className="manual-kicker">▣ {FIRM.name || 'TaxRes CRM'} Help Center</div>
          <h1>Know the system. Run the office faster.</h1>
          <p>Search the current operating guide, jump into the workflows your team uses most, or browse by the part of the office you’re working in.</p>
          <div className="manual-hero-search">
            <span>⌕</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search leads, payroll, email, IRS forms, reports…" />
          </div>
        </section>

        <section className="manual-popular">
          <div className="manual-popular-head">
            <div><div className="manual-popular-eyebrow">Popular workflows</div><div className="manual-popular-title">Jump right in</div></div>
            <div className="manual-popular-note">Built for the current CRM release</div>
          </div>
          <div className="manual-popular-grid">
            <button className="manual-jump" onClick={() => setSelected('leads')}><span className="manual-jump-icon">🎯</span><div className="manual-jump-title">New lead → active client</div><div className="manual-jump-body">Capture, qualify, send the package, collect payment and convert.</div></button>
            <button className="manual-jump" onClick={() => setSelected('esign')}><span className="manual-jump-icon">✍️</span><div className="manual-jump-title">Send & track signatures</div><div className="manual-jump-body">Full package, IRS authorizations and client agreements.</div></button>
            <button className="manual-jump" onClick={() => setSelected('dashboard')}><span className="manual-jump-icon">📊</span><div className="manual-jump-title">Run the daily dashboard</div><div className="manual-jump-body">Cases, tasks, deadlines, AR and production at a glance.</div></button>
            <button className="manual-jump" onClick={() => setSelected('reports')}><span className="manual-jump-icon">⚡</span><div className="manual-jump-title">Reports & office controls</div><div className="manual-jump-body">Production, billing, activity, employees and operational health.</div></button>
          </div>
        </section>
        <div className="manual-section-head" style={{ paddingTop:4, marginBottom:20, paddingBottom:16, borderBottom:'1px solid var(--br)' }}>
          <div style={{ fontSize:22, fontWeight:800, color:'var(--tx)', marginBottom:4 }}>{sec.title}</div>
          <div style={{ fontSize:10, fontWeight:700, color:'#6366f1', textTransform:'uppercase', letterSpacing:'.07em' }}>
            {sec.category} · {MANUAL_SECTIONS.findIndex(s => s.id === sec.id) + 1} of {MANUAL_SECTIONS.length}
          </div>
        </div>
        {sec.content.map((block, i) => renderBlock(block, i))}
        <div style={{ marginTop:32, paddingTop:16, borderTop:'1px solid var(--br)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:11, color:'var(--t3)' }}>TaxRes CRM Manual · {MANUAL_SECTIONS.length} sections</span>
          <div style={{ display:'flex', gap:8 }}>
            {(() => {
              const idx = MANUAL_SECTIONS.findIndex(s => s.id === selected)
              return [
                idx > 0 && <button key='prev' onClick={() => setSelected(MANUAL_SECTIONS[idx-1].id)} style={{ background:'var(--s2)', border:'1px solid var(--br)', borderRadius:7, padding:'5px 12px', color:'var(--t2)', cursor:'pointer', fontSize:11 }}>← {MANUAL_SECTIONS[idx-1].label}</button>,
                idx < MANUAL_SECTIONS.length - 1 && <button key='next' onClick={() => setSelected(MANUAL_SECTIONS[idx+1].id)} style={{ background:'rgba(99,102,241,.12)', border:'1px solid rgba(99,102,241,.25)', borderRadius:7, padding:'5px 12px', color:'#a5b4fc', cursor:'pointer', fontSize:11, fontWeight:700 }}>{MANUAL_SECTIONS[idx+1].label} →</button>
              ]
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Manual() {
  return (
    <div style={{ height:'100%', overflow:'hidden' }}>
      <ManualPage standalone />
    </div>
  )
}
