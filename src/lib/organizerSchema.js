// ─── Tax Case Review — Tax Organizer Question Schema ──────────────────────────
// Config-driven schema for the multi-step client tax organizer wizard.
// Each step renders via OrganizerWizard.jsx. Answers are stored as JSON keyed
// by question `id` in the `tax_organizer_responses` table (one row per
// client + tax year).
//
// Field types:
//  - 'yesno'      : Yes/No toggle
//  - 'select'     : single choice from `options`
//  - 'multiselect' : choose any number of `options` (checkboxes)
//  - 'text'       : free text
//  - 'textarea'   : multi-line text
//  - 'number'     : numeric input
//  - 'date'       : date picker
//  - 'upload'     : file upload (stored in Supabase `documents` bucket)
//  - 'entries'    : repeatable group (businesses, rentals, farms, dependents, foreign accounts)
//  - 'info'       : static informational text, no input

export const ORGANIZER_STEPS = [
  {
    id: 'intro',
    title: 'Welcome',
    questions: [
      { id: 'intro_text', type: 'info', text:
        `Welcome to your online tax organizer. The information you provide helps us prepare your {{year}} tax return accurately and minimizes the chance of overlooking important details.

You'll be prompted to upload relevant documents as you go. If you don't have a document right now, you can skip it and come back later — your progress is saved automatically.

We may not begin preparing your return until all questions are answered and all requested documents are received.` },
    ]
  },
  {
    id: 'personal',
    title: 'Personal Information',
    questions: [
      { id: 'filed_before', label: 'Have you previously filed with our office?', type: 'yesno' },
      { id: 'claimed_dependent', label: 'Can you and/or your spouse be claimed as a dependent by another taxpayer?', type: 'yesno' },
      { id: 'claimed_dependent_explain', label: 'Please explain.', type: 'textarea', showIf: { claimed_dependent: 'Yes' } },
      { id: 'refund_pref', label: 'In case of an overpayment, would you like it refunded or applied to next year\'s estimated tax payments?', type: 'select', options: ['Refunded','Apply Next Year'] },
      { id: 'apply_amount_type', label: 'How much would you like to apply to next year?', type: 'select', options: ['Apply all refund to next year','Apply a specific amount'], showIf: { refund_pref: 'Apply Next Year' } },
      { id: 'apply_specific_amount', label: 'Please provide the exact amount to apply to next year.', type: 'number', showIf: { apply_amount_type: 'Apply a specific amount' } },
      { id: 'direct_deposit_withdrawal', label: 'Do you want to set up direct deposit for tax refunds or direct withdrawal for taxes due?', type: 'yesno' },
      { id: 'dd_dw_method', label: 'Please choose one of the following.', type: 'select', options: ['Direct deposit only','Direct withdrawal only','Both direct deposit and direct withdrawal','Same as last year'], showIf: { direct_deposit_withdrawal: 'Yes' } },
      { id: 'bank_name', label: 'Bank Name', type: 'text', showIf: { dd_dw_method: ['Direct deposit only','Direct withdrawal only','Both direct deposit and direct withdrawal'] } },
      { id: 'bank_account_number', label: 'Account Number', type: 'text', sensitive: true, showIf: { dd_dw_method: ['Direct deposit only','Direct withdrawal only','Both direct deposit and direct withdrawal'] } },
      { id: 'bank_routing_number', label: 'Routing Number', type: 'text', sensitive: true, showIf: { dd_dw_method: ['Direct deposit only','Direct withdrawal only','Both direct deposit and direct withdrawal'] } },
      { id: 'bank_account_type', label: 'Checking or savings account?', type: 'select', options: ['Checking','Savings'], showIf: { dd_dw_method: ['Direct deposit only','Direct withdrawal only','Both direct deposit and direct withdrawal'] } },
      { id: 'identity_theft', label: 'Did you (or anyone in your household) receive an Identity Protection PIN (IP PIN) from the IRS, or have you been a victim of identity theft?', type: 'yesno' },
      { id: 'identity_theft_date', label: 'When did the identity theft occur?', type: 'date', showIf: { identity_theft: 'Yes' } },
      { id: 'has_ip_pin_letter', label: 'Do you have a copy of the IRS letter about your IP PIN?', type: 'yesno', showIf: { identity_theft: 'Yes' } },
      { id: 'ip_pin_letter_upload', label: 'Upload the IRS IP PIN letter.', type: 'upload', showIf: { has_ip_pin_letter: 'Yes' } },
      { id: 'ip_pin_manual', label: 'Provide the name and PIN for each person assigned one.', type: 'textarea', showIf: { has_ip_pin_letter: 'No' } },
      { id: 'applicable_items', label: 'Select all that apply to you and/or your spouse this year.', type: 'multiselect', options: [
        'I/We have dependents',
        'Retirement-related items (contributions, distributions, Social Security, etc.)',
        'Education-related items (expenses, 529 plan, student loan interest, etc.)',
        'Healthcare-related items (coverage, exemptions, HSA, long-term care, ABLE, credits, etc.)'
      ]},
    ]
  },
  {
    id: 'new_client_info',
    title: 'New Client Information',
    questions: [
      { id: 'full_name', label: 'Full legal name', type: 'text' },
      { id: 'ssn', label: 'Social Security Number', type: 'text', sensitive: true },
      { id: 'phone', label: 'Phone number', type: 'text' },
      { id: 'occupation', label: 'Occupation', type: 'text' },
      { id: 'current_address', label: 'Current address (Street, Unit/Apt, City, State, ZIP)', type: 'textarea' },
      { id: 'has_valid_id', label: 'Do you and/or your spouse have a valid ID (Driver\'s License or State ID)?', type: 'yesno' },
      { id: 'id_method', label: 'Upload a picture of your ID, or provide the ID information?', type: 'select', options: ['Upload a picture of ID','Provide ID information'], showIf: { has_valid_id: 'Yes' } },
      { id: 'id_upload', label: 'Upload a picture of your ID.', type: 'upload', showIf: { id_method: 'Upload a picture of ID' } },
      { id: 'id_type', label: 'Type of ID', type: 'select', options: ['Driver\'s License','State ID'], showIf: { id_method: 'Provide ID information' } },
      { id: 'id_number', label: 'ID Number', type: 'text', sensitive: true, showIf: { id_method: 'Provide ID information' } },
      { id: 'id_issue_date', label: 'Issue date', type: 'date', showIf: { id_method: 'Provide ID information' } },
      { id: 'id_expiration_date', label: 'Expiration date', type: 'date', showIf: { id_method: 'Provide ID information' } },
      { id: 'id_dob', label: 'Date of birth', type: 'date', showIf: { id_method: 'Provide ID information' } },
      { id: 'id_state', label: 'State (if state-issued)', type: 'text', showIf: { id_method: 'Provide ID information' } },
      { id: 'marital_status_change', label: 'Did your marital status change this year?', type: 'select', options: [
        'No, single all year','No, married all year','Yes, got married','Yes, got divorced','Yes, separated','Yes, widowed','Other'
      ]},
      { id: 'marital_explain', label: 'Please explain.', type: 'textarea', showIf: { marital_status_change: 'Other' } },
      { id: 'filing_jointly', label: 'Will you be filing jointly with your spouse?', type: 'yesno', showIf: { marital_status_change: ['Yes, got married','No, married all year'] } },
      { id: 'spouse_first_name', label: 'Spouse\'s first name', type: 'text', showIf: { filing_jointly: 'Yes' } },
      { id: 'spouse_last_name', label: 'Spouse\'s last name', type: 'text', showIf: { filing_jointly: 'Yes' } },
      { id: 'spouse_dob', label: 'Spouse\'s date of birth', type: 'date', showIf: { filing_jointly: 'Yes' } },
      { id: 'spouse_ssn', label: 'Spouse\'s SSN or TIN', type: 'text', sensitive: true, showIf: { filing_jointly: 'Yes' } },
      { id: 'spouse_phone', label: 'Spouse\'s phone number', type: 'text', showIf: { filing_jointly: 'Yes' } },
      { id: 'spouse_occupation', label: 'Spouse\'s occupation', type: 'text', showIf: { filing_jointly: 'Yes' } },
      { id: 'divorce_date', label: 'Date of divorce', type: 'date', showIf: { marital_status_change: 'Yes, got divorced' } },
      { id: 'divorced_with_children', label: 'Were you divorced with child(ren) this year?', type: 'yesno', showIf: { marital_status_change: 'Yes, got divorced' } },
      { id: 'divorce_decree_upload', label: 'Upload your divorce decree.', type: 'upload', showIf: { marital_status_change: 'Yes, got divorced' } },
      { id: 'separation_date', label: 'Date of separation', type: 'date', showIf: { marital_status_change: 'Yes, separated' } },
      { id: 'separation_agreement_upload', label: 'Upload your separation agreement.', type: 'upload', showIf: { marital_status_change: 'Yes, separated' } },
      { id: 'spouse_death_date', label: 'Date of spouse\'s death', type: 'date', showIf: { marital_status_change: 'Yes, widowed' } },
      { id: 'filed_last_year', label: 'Did you file a tax return last year?', type: 'yesno' },
      { id: 'prior_returns_upload', label: 'Upload prior-year tax return(s) if available.', type: 'upload', optional: true, showIf: { filed_last_year: 'Yes' } },
    ]
  },
  {
    id: 'dependents',
    title: 'Dependents',
    questions: [
      { id: 'dependent_situations', label: 'Select all applicable statements regarding your dependents this year.', type: 'multiselect', options: [
        'Had a child under 19 (or 24 if full-time student) with unearned income over $2,600',
        'Have a dependent who must file a tax return',
        'I provide more than half the support for someone other than my dependent children',
        'Paid for child care while working, looking for work, or as a full-time student',
        'I was divorced or separated with child(ren)',
        'Other'
      ]},
      { id: 'dependent_other_explain', label: 'Please explain.', type: 'textarea', showIf: { dependent_situations: 'Other' } },
      { id: 'dependents_list', label: 'List all dependents (name, relationship, DOB, SSN/TIN).', type: 'entries', entryFields: [
        { id: 'first_name', label: 'First Name', type: 'text' },
        { id: 'last_name', label: 'Last Name', type: 'text' },
        { id: 'ssn_tin', label: 'SSN or TIN', type: 'text', sensitive: true },
        { id: 'relationship', label: 'Relationship', type: 'text' },
        { id: 'dob', label: 'Date of Birth', type: 'date' },
      ]},
    ]
  },
  {
    id: 'income',
    title: 'Income',
    questions: [
      { id: 'income_activities', label: 'Select all that apply to your income this year.', type: 'multiselect', options: [
        'Received W-2 wages and/or contractor payment (1099-NEC)',
        'Had investment income or losses (interest, dividends, capital gains/losses)',
        'Had business income from a sole proprietorship or single-member LLC (Schedule C)',
        'Owned rental properties (Schedule E)',
        'Had farming activities (Schedule F)',
        'Received income from property sold before this year',
        'Had foreign income or paid foreign taxes',
        'Received state payments (refund, unemployment, disability)',
        'Received a K-1',
        'Received awards, prizes, hobby income, gambling, or lottery winnings',
        'Received, sold, or disposed of a digital asset (crypto, NFT)',
        'Had a life insurance policy mature or surrender'
      ]},
      { id: 'w2_1099_upload', label: 'Upload all W-2s and 1099-NECs received.', type: 'upload', showIf: { income_activities: 'Received W-2 wages and/or contractor payment (1099-NEC)' } },
      { id: 'investment_upload', label: 'Upload all 1099-INT, 1099-DIV, and brokerage statements.', type: 'upload', showIf: { income_activities: 'Had investment income or losses (interest, dividends, capital gains/losses)' } },
      { id: 'property_sold_explain', label: 'Provide more information on income from property sold before this year.', type: 'textarea', showIf: { income_activities: 'Received income from property sold before this year' } },
      { id: 'property_sold_upload', label: 'Upload related document(s).', type: 'upload', showIf: { income_activities: 'Received income from property sold before this year' } },
      { id: 'foreign_income_upload', label: 'Upload document(s) related to foreign income or taxes paid.', type: 'upload', showIf: { income_activities: 'Had foreign income or paid foreign taxes' } },
      { id: 'state_payments_upload', label: 'Upload related tax form (e.g. 1099-G).', type: 'upload', showIf: { income_activities: 'Received state payments (refund, unemployment, disability)' } },
      { id: 'k1_upload', label: 'Upload all K-1s received.', type: 'upload', showIf: { income_activities: 'Received a K-1' } },
      { id: 'awards_upload', label: 'Upload document(s) related to awards, prizes, gambling, or lottery winnings.', type: 'upload', showIf: { income_activities: 'Received awards, prizes, hobby income, gambling, or lottery winnings' } },
      { id: 'digital_asset_upload', label: 'Upload tax forms or statements related to digital assets.', type: 'upload', showIf: { income_activities: 'Received, sold, or disposed of a digital asset (crypto, NFT)' } },
      { id: 'life_insurance_upload', label: 'Upload document(s) related to the matured/surrendered policy.', type: 'upload', showIf: { income_activities: 'Had a life insurance policy mature or surrender' } },
    ]
  },
  {
    id: 'business',
    title: 'Business',
    questions: [
      { id: 'has_business', label: 'Did you own a Schedule C business this year?', type: 'yesno' },
      { id: 'businesses_list', label: 'Business details', type: 'entries', showIf: { has_business: 'Yes' }, entryFields: [
        { id: 'business_name', label: 'Business name', type: 'text' },
        { id: 'business_address', label: 'Business address', type: 'text' },
        { id: 'ein', label: 'EIN', type: 'text', sensitive: true },
        { id: 'accounting_method', label: 'Accounting method', type: 'select', options: ['Cash','Accrual'] },
        { id: 'has_quickbooks', label: 'Use QuickBooks or other online bookkeeping software?', type: 'yesno' },
        { id: 'bookkeeping_upload', label: 'Upload bookkeeping file / P&L / spreadsheet', type: 'upload', optional: true },
        { id: 'total_receipts', label: 'Total Receipts or Sales', type: 'number' },
        { id: 'expenses_notes', label: 'Expense categories & notes (advertising, contract labor, supplies, etc.)', type: 'textarea' },
        { id: 'made_1099_payments', label: 'Made payments requiring Form 1099?', type: 'yesno' },
      ]},
      { id: 'business_1099_upload', label: 'Upload Form 1099(s) received by the business, if any.', type: 'upload', optional: true, showIf: { has_business: 'Yes' } },
    ]
  },
  {
    id: 'rental',
    title: 'Rental Activity',
    questions: [
      { id: 'has_rental', label: 'Did you own rental property this year?', type: 'yesno' },
      { id: 'rentals_list', label: 'Rental property details', type: 'entries', showIf: { has_rental: 'Yes' }, entryFields: [
        { id: 'description', label: 'Property description', type: 'text' },
        { id: 'address', label: 'Address', type: 'text' },
        { id: 'days_rented', label: 'Days rented at fair market value', type: 'number' },
        { id: 'days_personal_use', label: 'Days of personal use', type: 'number' },
        { id: 'income', label: 'Rental income', type: 'number' },
        { id: 'expenses_notes', label: 'Expense categories & notes (insurance, repairs, mortgage interest, etc.)', type: 'textarea' },
        { id: 'has_quickbooks', label: 'Use QuickBooks or bookkeeping software for this property?', type: 'yesno' },
        { id: 'closing_doc_upload', label: 'Upload closing/appraisal doc if purchased, sold, or inherited this year', type: 'upload', optional: true },
      ]},
    ]
  },
  {
    id: 'farm',
    title: 'Farm',
    questions: [
      { id: 'has_farm', label: 'Did you have farming activity this year (Schedule F)?', type: 'yesno' },
      { id: 'farms_list', label: 'Farm activity details', type: 'entries', showIf: { has_farm: 'Yes' }, entryFields: [
        { id: 'principal_activity', label: 'Principal crop or activity', type: 'text' },
        { id: 'description', label: 'Description', type: 'text' },
        { id: 'ein', label: 'EIN', type: 'text', sensitive: true },
        { id: 'income_notes', label: 'Income (livestock sales, ag program payments, crop insurance, etc.)', type: 'textarea' },
        { id: 'expenses_notes', label: 'Expense categories & notes (feed, fertilizer, labor, etc.)', type: 'textarea' },
      ]},
    ]
  },
  {
    id: 'purchases_sales_debt',
    title: 'Purchases, Sales, and Debt',
    questions: [
      { id: 'psd_activities', label: 'Select all that apply this year.', type: 'multiselect', options: [
        'Started a new business',
        'Sold a business',
        'Sold, exchanged, or purchased business assets',
        'Acquired a new interest in an LLC, partnership, or S-corp',
        'Sold, exchanged, or purchased real estate (business purposes)',
        'Purchased or sold a personal residence',
        'Foreclosed or abandoned a personal residence or property',
        'Took out a home equity loan',
        'Refinanced a principal residence or second home',
        'Had debts canceled or forgiven',
        'Purchased a qualified plug-in electric/fuel cell vehicle',
        'Made energy efficient improvements to a personal residence',
        'Received a PPP loan',
        'Other'
      ]},
      { id: 'psd_new_business_upload', label: 'Upload organizational documents (EIN letter, Articles, Operating Agreement).', type: 'upload', showIf: { psd_activities: 'Started a new business' } },
      { id: 'psd_sold_business_upload', label: 'Upload the sale agreement.', type: 'upload', showIf: { psd_activities: 'Sold a business' } },
      { id: 'psd_real_estate_upload', label: 'Upload HUD/ALTA/closing disclosure.', type: 'upload', showIf: { psd_activities: ['Sold, exchanged, or purchased real estate (business purposes)','Purchased or sold a personal residence','Refinanced a principal residence or second home'] } },
      { id: 'psd_home_equity_explain', label: 'Purpose of the home equity loan', type: 'textarea', showIf: { psd_activities: 'Took out a home equity loan' } },
      { id: 'psd_canceled_debt_explain', label: 'Provide more information on debts canceled or forgiven.', type: 'textarea', showIf: { psd_activities: 'Had debts canceled or forgiven' } },
      { id: 'psd_ppp_amount', label: 'PPP loan amount', type: 'number', showIf: { psd_activities: 'Received a PPP loan' } },
      { id: 'psd_ppp_forgiven', label: 'Was the PPP loan forgiven?', type: 'yesno', showIf: { psd_activities: 'Received a PPP loan' } },
      { id: 'psd_other_explain', label: 'Please explain.', type: 'textarea', showIf: { psd_activities: 'Other' } },
    ]
  },
  {
    id: 'retirement',
    title: 'Retirement',
    questions: [
      { id: 'retirement_activities', label: 'Select all that apply this year.', type: 'multiselect', options: [
        'Received Social Security benefits',
        'Made withdrawal(s) from an IRA, Roth, 401(k), or other retirement plan',
        'Received lump-sum payments from a pension, profit sharing, or 401(k)',
        'Made contribution(s) to an IRA, Roth, 401(k), or other retirement plan'
      ]},
      { id: 'ssa1099_upload', label: 'Upload Form SSA-1099.', type: 'upload', showIf: { retirement_activities: 'Received Social Security benefits' } },
      { id: 'retirement_1099r_upload', label: 'Upload Form 1099-R.', type: 'upload', showIf: { retirement_activities: ['Made withdrawal(s) from an IRA, Roth, 401(k), or other retirement plan','Received lump-sum payments from a pension, profit sharing, or 401(k)'] } },
      { id: 'retirement_disaster_withdrawal', label: 'Was the withdrawal due to a federally declared disaster?', type: 'yesno', showIf: { retirement_activities: 'Made withdrawal(s) from an IRA, Roth, 401(k), or other retirement plan' } },
      { id: 'retirement_5498_upload', label: 'Upload related tax form for contribution (e.g. Form 5498), if received.', type: 'upload', optional: true, showIf: { retirement_activities: 'Made contribution(s) to an IRA, Roth, 401(k), or other retirement plan' } },
    ]
  },
  {
    id: 'education',
    title: 'Education',
    questions: [
      { id: 'education_activities', label: 'Select all that apply this year.', type: 'multiselect', options: [
        'Paid education expenses or received scholarships/grants',
        'Made withdrawal(s) from a 529 Plan or education savings account',
        'Made contribution(s) to a 529 Plan or education savings account',
        'Paid student loan interest',
        'Cashed Series EE or U.S. Savings bonds issued after 1989'
      ]},
      { id: 'tuition_1098t_upload', label: 'Upload Form 1098-T or tuition receipt.', type: 'upload', showIf: { education_activities: 'Paid education expenses or received scholarships/grants' } },
      { id: 'edu_withdrawal_upload', label: 'Upload document(s) for the withdrawal.', type: 'upload', showIf: { education_activities: 'Made withdrawal(s) from a 529 Plan or education savings account' } },
      { id: 'edu_contribution_upload', label: 'Upload document(s) for the contribution.', type: 'upload', showIf: { education_activities: 'Made contribution(s) to a 529 Plan or education savings account' } },
      { id: 'student_loan_1098e_upload', label: 'Upload Form 1098-E.', type: 'upload', showIf: { education_activities: 'Paid student loan interest' } },
    ]
  },
  {
    id: 'healthcare',
    title: 'Health Care',
    questions: [
      { id: 'healthcare_activities', label: 'Select all that apply this year.', type: 'multiselect', options: [
        'Had qualifying health care coverage (employer/government sponsored)',
        'Qualified for an exemption from the health care coverage mandate',
        'Enrolled in Marketplace Coverage (healthcare.gov / ACA)',
        'Made contribution(s) to an HSA or Archer MSA',
        'Received distribution from an HSA, Archer MSA, or Medicare Advantage MSA',
        'Paid long-term care premiums',
        'Made contribution(s) to an ABLE account',
        'Received withdrawal(s) from an ABLE account',
        'Received Health Coverage Tax Credit (HCTC) advance payment'
      ]},
      { id: 'hc_1095_upload', label: 'Upload Form(s) 1095-B/C.', type: 'upload', optional: true, showIf: { healthcare_activities: 'Had qualifying health care coverage (employer/government sponsored)' } },
      { id: 'hc_exemption_number', label: 'Exemption Certificate Number (ECN) and type', type: 'text', showIf: { healthcare_activities: 'Qualified for an exemption from the health care coverage mandate' } },
      { id: 'hc_1095a_upload', label: 'Upload Form 1095-A.', type: 'upload', showIf: { healthcare_activities: 'Enrolled in Marketplace Coverage (healthcare.gov / ACA)' } },
      { id: 'hsa_contribution_upload', label: 'Upload Form 5498-SA or related document.', type: 'upload', showIf: { healthcare_activities: 'Made contribution(s) to an HSA or Archer MSA' } },
      { id: 'hsa_distribution_qualified', label: 'Was the distribution all used for qualified medical expenses?', type: 'yesno', showIf: { healthcare_activities: 'Received distribution from an HSA, Archer MSA, or Medicare Advantage MSA' } },
      { id: 'hsa_distribution_upload', label: 'Upload Form 1099-SA.', type: 'upload', showIf: { healthcare_activities: 'Received distribution from an HSA, Archer MSA, or Medicare Advantage MSA' } },
      { id: 'ltc_premium_amount', label: 'Amount paid for long-term care premiums', type: 'number', showIf: { healthcare_activities: 'Paid long-term care premiums' } },
    ]
  },
  {
    id: 'itemized',
    title: 'Itemized Deductions',
    questions: [
      { id: 'itemized_activities', label: 'Select all that apply this year.', type: 'multiselect', options: [
        'Incurred a casualty or theft loss',
        'Paid out-of-pocket medical expenses',
        'Made cash charitable contribution(s)',
        'Made non-cash charitable contribution(s)',
        'Donated a vehicle or boat',
        'Paid real estate taxes on primary/second home',
        'Paid mortgage interest',
        'Incurred investment account interest expenses',
        'Made major purchases and paid sales tax',
        'Made out-of-state purchases without sales tax collected'
      ]},
      { id: 'casualty_loss_upload', label: 'Upload document(s) related to the casualty or theft loss.', type: 'upload', showIf: { itemized_activities: 'Incurred a casualty or theft loss' } },
      { id: 'medical_expense_amount', label: 'Amount paid out-of-pocket for medical expenses', type: 'number', showIf: { itemized_activities: 'Paid out-of-pocket medical expenses' } },
      { id: 'cash_charity_method', label: 'Upload contribution letter, or enter each contribution?', type: 'select', options: ['Upload Cash Contribution Letter','Enter Each Cash Contribution'], showIf: { itemized_activities: 'Made cash charitable contribution(s)' } },
      { id: 'cash_charity_upload', label: 'Upload cash contribution proof.', type: 'upload', showIf: { cash_charity_method: 'Upload Cash Contribution Letter' } },
      { id: 'cash_charity_entries', label: 'Charitable organization and amount donated', type: 'entries', showIf: { cash_charity_method: 'Enter Each Cash Contribution' }, entryFields: [
        { id: 'org_name', label: 'Organization Name', type: 'text' },
        { id: 'amount', label: 'Amount', type: 'number' },
      ]},
      { id: 'noncash_charity_entries', label: 'Non-cash charitable contributions', type: 'entries', showIf: { itemized_activities: 'Made non-cash charitable contribution(s)' }, entryFields: [
        { id: 'org_name', label: 'Charitable Organization Name', type: 'text' },
        { id: 'org_address', label: 'Address', type: 'text' },
        { id: 'item_description', label: 'Description of Items Donated', type: 'text' },
        { id: 'donation_date', label: 'Date of Donation', type: 'date' },
        { id: 'fair_market_value', label: 'Fair Market Value', type: 'number' },
      ]},
      { id: 'vehicle_donation_upload', label: 'Upload Form 1098-C or written acknowledgment.', type: 'upload', showIf: { itemized_activities: 'Donated a vehicle or boat' } },
      { id: 'mortgage_interest_upload', label: 'Upload Form(s) 1098 for mortgage interest paid.', type: 'upload', showIf: { itemized_activities: 'Paid mortgage interest' } },
      { id: 'major_purchase_upload', label: 'Upload purchase document(s).', type: 'upload', showIf: { itemized_activities: 'Made major purchases and paid sales tax' } },
    ]
  },
  {
    id: 'other_info',
    title: 'Other Information',
    questions: [
      { id: 'other_activities', label: 'Select all that apply this year.', type: 'multiselect', options: [
        'Made gifts of more than $18,000 to any individual',
        'Incurred moving costs due to active military change of station',
        'Had a foreign bank and/or investment account',
        'Owned more than 10% interest in a foreign business entity',
        'Received a distribution from or acted as grantor for a foreign trust',
        'Resided in or operated a business in a federally declared disaster area',
        'Engaged in bartering transactions'
      ]},
      { id: 'foreign_accounts_list', label: 'Foreign bank/investment account details', type: 'entries', showIf: { other_activities: 'Had a foreign bank and/or investment account' }, entryFields: [
        { id: 'institution_name', label: 'Financial Institution Name', type: 'text' },
        { id: 'account_type', label: 'Type of Account', type: 'text' },
        { id: 'account_number', label: 'Account Number', type: 'text', sensitive: true },
        { id: 'max_value', label: 'Maximum Value During Year', type: 'number' },
      ]},
      { id: 'irs_state_notice', label: 'Did you receive any notices from the IRS or any state?', type: 'yesno' },
      { id: 'irs_state_notice_upload', label: 'Upload all notices received.', type: 'upload', showIf: { irs_state_notice: 'Yes' } },
      { id: 'unfiled_balances', label: 'Do you have prior years of tax returns that are unfiled or filed with unpaid balances?', type: 'yesno' },
      { id: 'unfiled_balances_explain', label: 'Please provide more information.', type: 'textarea', showIf: { unfiled_balances: 'Yes' } },
      { id: 'q1_fed_paid', label: 'Paid Q1 estimated federal tax payment?', type: 'yesno' },
      { id: 'q1_fed_amount', label: 'Q1 amount & date paid', type: 'text', showIf: { q1_fed_paid: 'Yes' } },
      { id: 'q2_fed_paid', label: 'Paid Q2 estimated federal tax payment?', type: 'yesno' },
      { id: 'q2_fed_amount', label: 'Q2 amount & date paid', type: 'text', showIf: { q2_fed_paid: 'Yes' } },
      { id: 'q3_fed_paid', label: 'Paid Q3 estimated federal tax payment?', type: 'yesno' },
      { id: 'q3_fed_amount', label: 'Q3 amount & date paid', type: 'text', showIf: { q3_fed_paid: 'Yes' } },
      { id: 'q4_fed_paid', label: 'Paid Q4 estimated federal tax payment?', type: 'yesno' },
      { id: 'q4_fed_amount', label: 'Q4 amount & date paid', type: 'text', showIf: { q4_fed_paid: 'Yes' } },
      { id: 'q_state_paid', label: 'Paid any quarterly estimated state tax payments?', type: 'yesno' },
      { id: 'q_state_amount', label: 'Amount(s) & date(s) paid', type: 'textarea', showIf: { q_state_paid: 'Yes' } },
      { id: 'anything_else', label: 'Is there anything else we should know that wasn\'t addressed above?', type: 'yesno' },
      { id: 'anything_else_explain', label: 'Please explain.', type: 'textarea', showIf: { anything_else: 'Yes' } },
    ]
  },
  {
    id: 'review',
    title: 'Review & Submit',
    questions: [
      { id: 'review_info', type: 'info', text: 'Please review your answers using Back, then submit when ready. Your representative will follow up if anything else is needed.' },
    ]
  },
]

export function flattenQuestions() {
  return ORGANIZER_STEPS.flatMap(s => s.questions)
}

export function shouldShow(q, answers) {
  if (!q.showIf) return true
  return Object.entries(q.showIf).every(([key, expected]) => {
    const val = answers[key]
    if (Array.isArray(expected)) {
      if (Array.isArray(val)) return expected.some(e => val.includes(e))
      return expected.includes(val)
    }
    if (Array.isArray(val)) return val.includes(expected)
    return val === expected
  })
}
