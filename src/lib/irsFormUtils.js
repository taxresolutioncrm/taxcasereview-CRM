import { PDFDocument, StandardFonts, PDFName, PDFString, rgb } from 'pdf-lib';
import { FINANCIAL_INTAKE_STEPS, shouldShow as intakeShouldShow } from './financialIntakeSchema';
import { supabase } from './supabase';
import { FIRM } from './firmBranding';

// Firm identity for generated documents. FIRM is populated per signed-in tenant
// at load; the fallbacks only apply if branding hasn't resolved yet, so a
// settings hiccup never leaves a document with a blank letterhead.
const fName = () => FIRM.name || 'Tax Case Review';
const fAddr = () => FIRM.address || '631 US Highway One Ste 304, North Palm Beach, FL 33408';
const fMail = () => FIRM.email || 'info@taxcasereview.org';
const fPhone = () => FIRM.phone || '(888) 334-5052';
const fFax = () => FIRM.fax || '(561) 420-6999';
const fContactLine = () => [fMail(), fPhone(), fFax() ? `Fax ${fFax()}` : null].filter(Boolean).join('  ·  ');
const fFooterLine = () => [fAddr(), fMail(), fPhone(), fFax() ? `Fax ${fFax()}` : null].filter(Boolean).join(' · ');

// ─── Field maps per form type ────────────────────────────────────────────────
// Only the taxpayer section fields are filled — rep info, tax matters, etc.
// are already pre-populated in the blank templates.

export const FIELD_MAPS = {
  // 2848 Personal (Text24/25/26 + Text23 for date on pg2)
  '2848_personal': {
    nameAddress: 'Text24',   // "First Last\r123 Street\rCity ST Zip"
    ssn:         'Text25',   // SSN or EIN
    phone:       'Text26',   // daytime phone
    date:        'Text23',   // signature date (page 2)
    idType:      'ssn',
    // printName has no AcroForm field — drawn directly in fillForm via drawText
  },
  // 2848 Business (named fields)
  '2848_business': {
    name:        'topmostSubform[0].Page1[0].TaxpayerName[0]',
    address:     'topmostSubform[0].Page1[0].TaxpayerAddress[0]',
    ssn:         'topmostSubform[0].Page1[0].TaxpayerIDSSN[0]',
    ein:         'topmostSubform[0].Page1[0].TaxpayerIDEIN[0]',
    phone:       'topmostSubform[0].Page1[0].TaxpayerTelephone[0]',
    // Page 2, line 7. A business POA is signed by an individual with authority,
    // so PrintName is the PERSON and Title is their capacity; the entity goes in
    // "Print name of taxpayer from line 1 if other than individual".
    title:       'topmostSubform[0].Page2[0].Title[0]',
    printName:   'topmostSubform[0].Page2[0].PrintName[0]',
    printNameTaxpayer: 'topmostSubform[0].Page2[0].PrintNameTaxpayer[0]',
    idType:      'split',   // name + address separate
  },
  // 8821 Personal (f1_6/f1_7/f1_8 + f1_32 print name + f1_33 date)
  '8821_personal': {
    nameAddress: 'topmostSubform[0].Page1[0].f1_6[0]',
    ssn:         'topmostSubform[0].Page1[0].f1_7[0]',
    phone:       'topmostSubform[0].Page1[0].f1_8[0]',
    printName:   'topmostSubform[0].Page1[0].f1_32[0]',
    date:        'topmostSubform[0].Page1[0].f1_33[0]',
    idType:      'ssn',
  },
  // 8821 Business (Text1/Text2/Text14/Text3/Text10)
  '8821_business': {
    nameAddress: 'Text1',   // "Name\rAddress"
    ein:         'Text2',   // EIN
    phone:       'Text14',  // daytime phone
    printName:   'Text10',  // print name
    date:        'Text3',   // date
    idType:      'ein',
  },

  // ─── Collection Information Statements ─────────────────────────────────────

  // 433-A (Individual) — Taxpayer section (Lines 1a-1e, Taxpayer block 4a-4h)
  // Line 1a = full name, Line 1b = SSN (split into p1-t4/p1-t5)
  // Line 1c = street address (p1-t6c = street, p1-t7c = apt)
  // Line 1d = city/state/zip (p1-t8d = city, p1-t9d = state/zip combined)
  // Line 1e = home phone (p1-t10e), cell phone (p1-t11e)
  // Taxpayer employment: 4a=last name (p1_t15_4a), 4b=first name (p1_t16_4b)
  '433a': {
    name:        'topmostSubform[0].Page1[0].c1[0].Lines1a-b[0].p1-t4[0]',
    ssn:         'topmostSubform[0].Page1[0].c1[0].Lines1a-b[0].p1-t5[0]',
    street:      'topmostSubform[0].Page1[0].c1[0].Line1c[0].p1-t6c[0]',
    apt:         'topmostSubform[0].Page1[0].c1[0].Line1c[0].p1-t7c[0]',
    cityState:   'topmostSubform[0].Page1[0].c1[0].Line1d[0].p1-t8d[0]',
    zip:         'topmostSubform[0].Page1[0].c1[0].Line1d[0].p1-t9d[0]',
    homePhone:   'topmostSubform[0].Page1[0].c1[0].Line1e[0].p1-t10e[0]',
    cellPhone:   'topmostSubform[0].Page1[0].c1[0].Line1e[0].p1-t11e[0]',
    idType:      'ssn',
  },

  // 433-B (Business) — Line 1a=business name, 1b=EIN, 1b street/city/state/zip
  // EIN is split: first 2 digits (p1_9_1d_3digits) + last 7 (p1_10_1d_7digits)
  // 1e=phone, 1f=cell, 1c=type of business entity
  '433b': {
    bizName:     'topmostSubform[0].Page1[0].Line1a-f[0].p1_1_1a[0]',
    ein:         'topmostSubform[0].Page1[0].Line1a-f[0].p1_3_1b[0]',
    street:      'topmostSubform[0].Page1[0].Line1a-f[0].p1_4_1bMailAdd[0]',
    city:        'topmostSubform[0].Page1[0].Line1a-f[0].p1_5_1bCity[0]',
    state:       'topmostSubform[0].Page1[0].Line1a-f[0].p1_6_1bstate[0]',
    zip:         'topmostSubform[0].Page1[0].Line1a-f[0].p1_7_1bZIP[0]',
    phone3:      'topmostSubform[0].Page1[0].Line1a-f[0].p1_9_1d_3digits[0]',
    phone7:      'topmostSubform[0].Page1[0].Line1a-f[0].p1_10_1d_7digits[0]',
    cellPhone:   'topmostSubform[0].Page1[0].Line1a-f[0].p1_11_1e[0]',
    entityType:  'topmostSubform[0].Page1[0].Line1a-f[0].p1_8_1c[0]',
    idType:      'ein',
  },

  // 433-D (Installment Agreement) — name+address combined, SSN, home/work phone
  '433d': {
    nameAddress: 'form1[0].Page1_Part1[0].NameAddressTaxpayer[0].NameAndAddress[0]',
    ssn:         'form1[0].Page1_Part1[0].SSN_EIN[0].Taxpayer[0]',
    homePhone:   'form1[0].Page1_Part1[0].SSN_EIN[0].Home[0]',
    workPhone:   'form1[0].Page1_Part1[0].SSN_EIN[0].WorkCellBusiness[0]',
    idType:      'ssn',
  },

  // 433-F (Collection Information Statement — General) — uses prefixed field names
  // Master section has name + SSN; ClientInfo has phone numbers
  '433f': {
    name:        'Master.INCOME_EXPENSE_EQUITY_WORKSHEET_ACCOUNT_NAME_NAME',
    ssn:         'Master.INCOME_EXPENSE_EQUITY_WORKSHEET_PRIMARY_SSN',
    homePhone:   'ClientInfo.ACCOUNT_NAME1_PHONE',
    cellPhone:   'ClientInfo.ACCOUNT_NAME1_CELL_PHONE',
    workPhone:   'ClientInfo.ACCOUNT_NAME1_WORK_PHONE',
    idType:      'ssn',
  },

  // 433-H (Installment Agreement Request + CIS) — name+address, SSN, home/work/cell
  '433h': {
    nameAddress: 'form1[0].page_1[0].address[0].NamesAddress[0]',
    ssn:         'form1[0].page_1[0].ssn[0].YourSocialSecurityNu[0]',
    homePhone:   'form1[0].page_1[0].your_telephone[0].Home11[0]',
    workPhone:   'form1[0].page_1[0].your_telephone[0].Work11[0]',
    cellPhone:   'form1[0].page_1[0].your_telephone[0].Cell11[0]',
    county:      'form1[0].page_1[0].address[0].CountyResidence[0]',
    idType:      'ssn',
  },

  // ─── 656-L (OIC Doubt as to Liability) ────────────────────────────────────
  // Page 6 has the taxpayer identity section. SSN is split into 3 parts.
  '656l': {
    name:      'topmostSubform[0].Page_6[0].Your_First_Middle_Last_Name[0]',
    ssn1:      'topmostSubform[0].Page_6[0].YourSSN[0].Your_SSN_1[0]',
    ssn2:      'topmostSubform[0].Page_6[0].YourSSN[0].Your_SSN_2[0]',
    ssn3:      'topmostSubform[0].Page_6[0].YourSSN[0].Your_SSN_3[0]',
    street:    'topmostSubform[0].Page_6[0].Your_Home_Address[0]',
    bizName:   'topmostSubform[0].Page_6[0].Business_Name[0]',
    bizAddr:   'topmostSubform[0].Page_6[0].Business_Address[0]',
    ein1:      'topmostSubform[0].Page_6[0].BusinessEIN[0].Business_EIN_1[0]',
    ein2:      'topmostSubform[0].Page_6[0].BusinessEIN[0].Business_EIN_2[0]',
    phone1:    'topmostSubform[0].Page_6[0].Phone[0].Area_Code[0]',
    phone2:    'topmostSubform[0].Page_6[0].Phone[0].Phone1[0]',
    phone3:    'topmostSubform[0].Page_6[0].Phone[0].Phone2[0]',
    contact:   'topmostSubform[0].Page_6[0].Name_Title_Primary_Contact[0]',
    idType:    'ssn',
  },

  // ─── Form 9465 (Installment Agreement Request) ────────────────────────────
  // Standard XFA form. Line 1a=name, 1b=SSN, 2=address, 3=city/state/zip, 4=home, 5=work
  '9465': {
    name:         'topmostSubform[0].Page1[0].f1_1[0]',
    ssn:          'topmostSubform[0].Page1[0].f1_3[0]',
    street:       'topmostSubform[0].Page1[0].f1_5[0]',
    cityStateZip: 'topmostSubform[0].Page1[0].f1_6[0]',
    homePhone:    'topmostSubform[0].Page1[0].f1_9[0]',
    workPhone:    'topmostSubform[0].Page1[0].f1_10[0]',
    idType:       'ssn',
  },

  // ─── Form 843 (Abatement/Refund) ──────────────────────────────────────────
  // Line 1=name, 2=address, 3=SSN/EIN
  '843': {
    name:         'topmostSubform[0].Page1[0].f1_1[0]',
    street:       'topmostSubform[0].Page1[0].f1_4[0]',
    cityStateZip: 'topmostSubform[0].Page1[0].f1_5[0]',
    ssn:          'topmostSubform[0].Page1[0].f1_2[0]',
    ein:          'topmostSubform[0].Page1[0].f1_3[0]',
    idType:       'ssn',
  },

  // ─── Form 8822 (Change of Address — Individual) ───────────────────────────
  // Lines 1-5: old/new name, SSN, old/new address
  '8822': {
    firstName:    'topmostSubform[0].Page1[0].f1_1[0]',
    lastName:     'topmostSubform[0].Page1[0].f1_2[0]',
    ssn:          'topmostSubform[0].Page1[0].f1_3[0]',
    newStreet:    'topmostSubform[0].Page1[0].f1_9[0]',
    newCityState: 'topmostSubform[0].Page1[0].f1_10[0]',
    newZip:       'topmostSubform[0].Page1[0].f1_11[0]',
    idType:       'ssn',
  },

  // ─── Form 8822-B (Change of Address — Business) ───────────────────────────
  '8822b': {
    bizName: 'topmostSubform[0].Page1[0].Line4aReadOrder[0].f1_1[0]',
    ein: 'topmostSubform[0].Page1[0].Line4bReadOrder[0].f1_2[0]',
    newStreet: 'topmostSubform[0].Page1[0].f1_9[0]',
    newCityState: 'topmostSubform[0].Page1[0].f1_10[0]',
    newZip: 'topmostSubform[0].Page1[0].f1_11[0]',
    idType: 'ein',
  },

  // ─── Form 4506-T (Request for Transcript) ────────────────────────────────
  '4506t': {
    name: 'topmostSubform[0].Page1[0].f1_1[0]',
    ssn: 'topmostSubform[0].Page1[0].f1_2[0]',
    currentAddress: 'topmostSubform[0].Page1[0].f1_5[0]',
    phone: 'topmostSubform[0].Page1[0].f1_20[0]',
    idType: 'ssn',
  },

  // ─── Form 12153 (CDP Hearing Request) ────────────────────────────────────
  '12153': {
    name: 'topmostSubform[0].Page1[0].TaxpayerName1[0]',
    tin: 'topmostSubform[0].Page1[0].TIN_1[0]',
    street: 'topmostSubform[0].Page1[0].CurrentAddress1[0]',
    city: 'topmostSubform[0].Page1[0].City1[0]',
    state: 'topmostSubform[0].Page1[0].State1[0]',
    zip: 'topmostSubform[0].Page1[0].ZIPCode1[0]',
    phone: 'topmostSubform[0].Page1[0].TelephoneNumberBestTime1[0].TelephoneNumber[0]',
    idType: 'ssn',
  },

  // ─── Form 656 (Offer in Compromise) ──────────────────────────────────────
  '656': {
    name: 'topmostSubform[0].F656_Page1[0].Your_First_Middle_Last_Name[0]',
    ssn: 'topmostSubform[0].F656_Page1[0].YourSocialSecurityNumber[0]',
    street: 'topmostSubform[0].F656_Page1[0].Your_Home_Address[0]',
    bizName: 'topmostSubform[0].F656_Page2[0].Business_Name[0]',
    bizAddr: 'topmostSubform[0].F656_Page2[0].BusinessPhysicalAddress[0]',
    ein: 'topmostSubform[0].F656_Page2[0].BusinessEIN[0]',
    contact: 'topmostSubform[0].F656_Page2[0].Name_Title_Primary_Contact[0]',
    phone: 'topmostSubform[0].F656_Page2[0].BusinessPhone[0]',
    idType: 'ssn',
  },

  // ─── Form 4549 (Exam Changes) ─────────────────────────────────────────────
  '4549': {
    name:   'topmostSubform[0].Page1[0].f1_1[0]',
    ssn:    'topmostSubform[0].Page1[0].f1_2[0]',
    street: 'topmostSubform[0].Page1[0].f1_3[0]',
    cityStateZip: 'topmostSubform[0].Page1[0].f1_4[0]',
    idType: 'ssn',
  },

  // ─── Form 8832 (Entity Classification) ───────────────────────────────────
  '8832': {
    bizName: 'topmostSubform[0].Page1[0].p1-t1[0]',
    ein: 'topmostSubform[0].Page1[0].p1-t2[0]',
    street: 'topmostSubform[0].Page1[0].p1-t4[0]',
    cityStateZip: 'topmostSubform[0].Page1[0].p1-t5[0]',
    idType: 'ein',
  },

  // ─── Form 911 (Taxpayer Advocate) ────────────────────────────────────────
  '911': {
    name: 'topmostSubform[0].page1[0].taxpayerName[0]',
    ssn: 'topmostSubform[0].page1[0].taxpayerTIN[0]',
    street: 'topmostSubform[0].page1[0].taxpayerAddressStreet[0]',
    city: 'topmostSubform[0].page1[0].taxpayerAddressCity[0]',
    state: 'topmostSubform[0].page1[0].taxpayerAddressState[0]',
    zip: 'topmostSubform[0].page1[0].taxpayerAddressZIPCode[0]',
    phone: 'topmostSubform[0].page1[0].taxpayerDaytimePhone[0]',
    idType: 'ssn',
  },

  // ─── Form SS-4 (Apply for EIN) ────────────────────────────────────────────
  'ss4': {
    bizName: 'topmostSubform[0].Page1[0].PgHeader[0].f1_1[0]',
    tradeName: 'topmostSubform[0].Page1[0].f1_2[0]',
    careOf: 'topmostSubform[0].Page1[0].f1_3[0]',
    street: 'topmostSubform[0].Page1[0].Line4ReadOrder[0].f1_5[0]',
    cityStateZip: 'topmostSubform[0].Page1[0].Line4ReadOrder[0].f1_6[0]',
    idType: 'ein',
  },

  // ─── Form 2553 (S-Corp Election) ─────────────────────────────────────────
  '2553': {
    bizName: 'topmostSubform[0].Page1[0].NameAddress[0].f1_01[0]',
    street: 'topmostSubform[0].Page1[0].NameAddress[0].f1_02[0]',
    cityStateZip: 'topmostSubform[0].Page1[0].NameAddress[0].f1_03[0]',
    ein: 'topmostSubform[0].Page1[0].f1_04[0]',
    idType: 'ein',
  },

  // ─── Form 12661 (Disputed Issue Verification) ─────────────────────────────
  '12661': {
    name: 'form1[0].page_1[0].taxpayer_name[0]',
    ssn: 'form1[0].page_1[0].social_security[0]',
    idType: 'ssn',
  },

  // ─── Form 1128 (Adopt/Change Tax Year) ───────────────────────────────────
  '1128': {
    bizName: 'topmostSubform[0].Page1[0].p1-01[0]',
    ein: 'topmostSubform[0].Page1[0].p1-02[0]',
    street: 'topmostSubform[0].Page1[0].p1-03[0]',
    cityStateZip: 'topmostSubform[0].Page1[0].p1-05[0]',
    idType: 'ein',
  },
};

// Form 4549 is an IRS examination report. IRS.gov does not publish a current
// standalone f4549.pdf. Never synthesize or fetch the obsolete dead URL.
export const MANUAL_ONLY_FORM_TYPES = ['4549'];

// Map form type → which blank template filename to fetch
export const TEMPLATE_PATHS = {
  '2848_personal': '2848_Pers_RC.pdf',
  '2848_business': '2848_RC_Biz.pdf',
  '8821_personal': '8821_Pers_RC.pdf',
  '8821_business': '8821_Biz_RC.pdf',
  '433a':  '433A_Blank.pdf',
  '433b':  '433B_Blank.pdf',
  '433d':  '433D_Blank.pdf',
  '433f':  '433F_Blank.pdf',
  '433h':  '433H_Blank.pdf',
  '656l':  '656L_Blank.pdf',
  // Forms fetched direct from IRS.gov at runtime (browser has no restriction)
  '9465':   'https://www.irs.gov/pub/irs-pdf/f9465.pdf',
  '843':    'https://www.irs.gov/pub/irs-pdf/f843.pdf',
  '8822':   'https://www.irs.gov/pub/irs-pdf/f8822.pdf',
  '8822b':  'https://www.irs.gov/pub/irs-pdf/f8822b.pdf',
  '4506t':  'https://www.irs.gov/pub/irs-pdf/f4506t.pdf',
  '12153':  'https://www.irs.gov/pub/irs-pdf/f12153.pdf',
  '656':    'https://www.irs.gov/pub/irs-pdf/f656.pdf',
  '4549':   'https://www.irs.gov/pub/irs-pdf/f4549.pdf',
  '8832':   'https://www.irs.gov/pub/irs-pdf/f8832.pdf',
  '911':    'https://www.irs.gov/pub/irs-pdf/f911.pdf',
  'ss4':    'https://www.irs.gov/pub/irs-pdf/fss4.pdf',
  '12661':  'https://www.irs.gov/pub/irs-pdf/f12661.pdf',
  '2553':   'https://www.irs.gov/pub/irs-pdf/f2553.pdf',
  '1128':   'https://www.irs.gov/pub/irs-pdf/f1128.pdf',
};

// Human-readable labels for each form type
export const FORM_LABELS = {
  '2848_personal': 'Form 2848 — Power of Attorney (Personal)',
  '2848_business': 'Form 2848 — Power of Attorney (Business)',
  '8821_personal': 'Form 8821 — Tax Information Authorization (Personal)',
  '8821_business': 'Form 8821 — Tax Information Authorization (Business)',
  '433a':   'Form 433-A — Collection Information Statement (Individual)',
  '433b':   'Form 433-B — Collection Information Statement (Business)',
  '433d':   'Form 433-D — Installment Agreement',
  '433f':   'Form 433-F — Collection Information Statement (General)',
  '433h':   'Form 433-H — Installment Agreement Request & CIS',
  '656l':   'Form 656-L — Offer in Compromise (Doubt as to Liability)',
  '9465':   'Form 9465 — Installment Agreement Request',
  '843':    'Form 843 — Claim for Refund / Abatement',
  '8822':   'Form 8822 — Change of Address (Individual)',
  '8822b':  'Form 8822-B — Change of Address (Business)',
  '4506t':  'Form 4506-T — Request for Transcript',
  '12153':  'Form 12153 — CDP Hearing Request',
  '656':    'Form 656 — Offer in Compromise',
  '4549':   'Form 4549 — Exam Changes (Audit)',
  '8832':   'Form 8832 — Entity Classification',
  '911':    'Form 911 — Taxpayer Advocate Request',
  'ss4':    'Form SS-4 — Apply for EIN',
  '12661':  'Form 12661 — Disputed Issue Verification',
  '2553':   'Form 2553 — S-Corp Election',
  '1128':   'Form 1128 — Adopt/Change Tax Year',
  'cc_auth': 'Credit Card / Payment Method Authorization',
};

// Which forms go in the "Full Package" based on client type
export const PACKAGE_FORMS_BY_TYPE = {
  'Individual':       ['2848_personal', '8821_personal', 'cc_auth'],
  'Business':         ['2848_business', '8821_business', 'cc_auth'],
  'Individual & Biz': ['2848_personal', '8821_personal', '2848_business', '8821_business', 'cc_auth'],
};

// Whether a form type uses the EIN (vs SSN) as the taxpayer ID
export const FORM_USES_EIN = {
  '2848_personal': false,
  '2848_business': true,
  '8821_personal': false,
  '8821_business': true,
};

// ─── Signature placement ──────────────────────────────────────────────────────
// IRS forms don't expose the taxpayer's actual "Signature" line as a fillable
// AcroForm field (it's a blank line on the printed form). These coordinates
// place the taxpayer's typed/drawn signature + date directly on that line.
// page = 0-indexed page number. Coordinates are in PDF points, origin at
// bottom-left of the page (standard PDF coordinate space).
// Every business POA this firm sends is signed by a managing member, so the
// Title box on line 7 is a constant rather than a per-lead field.
export const BUSINESS_SIGNER_TITLE = 'Managing Member';

// Romy's rule: every POA carries the date it was SIGNED, not the date the
// blank was prepared. The 2848 templates ship with a hardcoded declaration date
// baked into the rep's Part II row, so it gets overwritten at signing time.
export const REP_DATE_FIELDS = {
  '2848_personal': 'Text23',
  '2848_business': 'topmostSubform[0].Page2[0].Table_PartII[0].BodyRow1[0].Date1[0]',
};

export const SIGNATURE_POSITIONS = {
  '2848_personal': { page: 1, sigX: 40,  sigY: 555, dateX: 305, dateY: 555, size: 12 },
  '2848_business': { page: 1, sigX: 40,  sigY: 555, dateX: 305, dateY: 555, size: 12 },
  '8821_personal': { page: 0, sigX: 60,  sigY: 138, dateX: 438, dateY: 138, size: 12 },
  '8821_business': { page: 0, sigX: 60,  sigY: 138, dateX: 438, dateY: 138, size: 12 },
  'cc_auth':       { page: 0, sigX: 60,  sigY: 256, dateX: 366, dateY: 256, size: 12 },
  'addendum':      { page: 'last', sigX: 56, sigY: 698, dateX: 90, dateY: 654, size: 12 },
  // Anchored to the fixed signature block in buildAgreementPdf(), which starts
  // a fresh final page when the body would otherwise run into it.
  'agreement':     { page: 'last', sigX: 62, sigY: 170, dateX: 386, dateY: 170, size: 12 },
  // DR-835 page 2, taxpayer block. Rule measured at y 434.3-440.3, signature
  // column x 36-310, date column x 315-450.
  'state_poa':          { page: 1, sigX: 45, sigY: 438, dateX: 330, dateY: 438, repDateX: 490, repDateY: 117, size: 12 },
  'state_poa_personal': { page: 1, sigX: 45, sigY: 438, dateX: 330, dateY: 438, repDateX: 490, repDateY: 117, size: 12 },
  'state_poa_business': { page: 1, sigX: 45, sigY: 438, dateX: 330, dateY: 438, repDateX: 490, repDateY: 117, size: 12 },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export function formatDate(d) {
  if (!d) return new Date().toLocaleDateString('en-US');
  return new Date(d).toLocaleDateString('en-US');
}

// `party` selects WHICH name heads the block. Business forms (2848_business,
// 8821_business) must show the entity, not the human — on an Individual & Biz
// lead those are two different names and putting the person on the business
// form gets the authorization rejected.
export function buildNameAddress(client, party = 'personal') {
  const name = party === 'business'
    ? (client.business_name || client.name || '')
    : (client.name || client.business_name || '');
  // A business authorization is filed at the entity's own address when one is
  // on record. Falling back to the personal address is correct for a business
  // run from home, which is most of them.
  const useBiz = party === 'business' && client.biz_street;
  const street = useBiz ? client.biz_street : (client.address || client.street);
  const city   = useBiz ? client.biz_city   : client.city;
  const st     = useBiz ? client.biz_state  : client.state;
  const zip    = useBiz ? client.biz_zip    : client.zip;
  const parts = [
    street,
    city && st ? `${city} ${st}${zip ? ' ' + zip : ''}` : city || st || '',
  ].filter(Boolean);
  return name + (parts.length ? '\r' + parts.join('\r') : '');
}

// Blank form templates carry the representative's own details (name, address,
// CAF, PTIN) — data that belongs to the firm, not to the code. A tenant with its
// own set drops it in /templates/<slug>/; everyone else falls through to the
// shared originals, so an absent folder simply means "use the defaults" and no
// existing firm is affected by another firm's templates appearing.
// Same per-tenant lookup for the state POA blanks, which also carry the
// representative block. Returns the first URL that responds, or the shared
// original when the tenant has no folder of its own.
// Per-session memo of which tenant-scoped paths exist. Without it every
// template fetch pays a guaranteed 404 round-trip first for any tenant that
// has no override folder (TCR has none; the demo folder holds five files) —
// which is most fetches, and made package generation visibly slow.
const tenantPathMemo = new Map()

export async function resolveStateFormUrl(base, filename) {
  const slug = FIRM.slug || '';
  if (slug) {
    const tenantUrl = `${base}/state-forms/${slug}/${filename}`;
    const memo = tenantPathMemo.get(tenantUrl);
    if (memo === true) return tenantUrl;
    if (memo !== false) {
      try {
        const head = await fetch(tenantUrl, { method: 'HEAD' });
        tenantPathMemo.set(tenantUrl, head.ok);
        if (head.ok) return tenantUrl;
      } catch (_) { tenantPathMemo.set(tenantUrl, false); }
    }
  }
  return `${base}/state-forms/${filename}`;
}

export async function fetchTemplate(filename) {
  // If filename is a full URL (for IRS forms fetched direct from IRS.gov), try it directly
  if (filename.startsWith('http')) {
    try {
      const res = await fetch(filename);
      if (res.ok) return res.arrayBuffer();
    } catch (_) {}
    throw new Error(`Could not fetch form from: ${filename}`);
  }

  const slug = FIRM.slug || '';
  const paths = [
    ...(slug ? [
      `/templates/${slug}/${filename}`,
      `https://raw.githubusercontent.com/taxresolutioncrm/gh-pages/templates/${slug}/${filename}`,
    ] : []),
    `/templates/${filename}`,
    `https://raw.githubusercontent.com/taxresolutioncrm/gh-pages/templates/${filename}`,
  ];
  for (const url of paths) {
    if (tenantPathMemo.get(url) === false) continue;
    try {
      const res = await fetch(url);
      // Only misses are memoized: a template that WAS found must stay
      // re-fetchable, since its bytes are consumed by the caller each time.
      if (res.ok) return res.arrayBuffer();
      tenantPathMemo.set(url, false);
    } catch (_) { tenantPathMemo.set(url, false); }
  }
  throw new Error(`Template not found: ${filename}`);
}

// Fills the taxpayer fields on a blank IRS form template and returns the
// resulting PDF bytes (Uint8Array). Does NOT touch the signature line.
export async function fillForm(formType, client, useEin = false) {
  const map = FIELD_MAPS[formType];
  if (MANUAL_ONLY_FORM_TYPES.includes(formType)) {
    throw new Error('Form 4549 is an IRS-generated examination report with no current public standalone IRS PDF. Attach the examiner-provided Form 4549 manually.');
  }
  const templateBytes = await fetchTemplate(TEMPLATE_PATHS[formType]);
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();

  const today = formatDate(new Date());
  const isBizForm = formType === '2848_business' || formType === '8821_business';
  const nameAddr = buildNameAddress(client, isBizForm ? 'business' : 'personal');
  const bizName  = client.business_name || client.name || '';
  const taxId = useEin ? (client.ein || '') : (client.ssn || client.tin || '');

  // Helper: safely set a text field (skip if field doesn't exist in this template)
  const setText = (fieldName, value) => {
    try {
      const field = form.getTextField(fieldName);
      field.setText(value || '');
    } catch (_) {
      // field not present in this variant — skip
    }
  };

  if (formType === '2848_personal') {
    setText(map.nameAddress, nameAddr);
    setText(map.ssn, taxId);
    setText(map.phone, client.phone || '');
    setText(map.date, today);
    // Draw taxpayer print name on the Part I "Print name" line (no AcroForm
    // field exists for it). On this template the taxpayer signature block and
    // Part II both live on page index 1; the print-name line sits just below
    // the signature at y≈518. (Previously drawn at y=95 — the bottom of Part II,
    // which put the taxpayer's name under the Declaration of Representative and
    // would get the form rejected.)
    try {
      const pages = pdfDoc.getPages();
      const pg2 = pages[1];
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      pg2.drawText(client.name || '', { x: 42, y: 518, size: 11, font: helvetica, color: rgb(0,0,0) });
    } catch(_) {}
  }

  else if (formType === '2848_business') {
    setText(map.name, bizName);
    const addrParts = [
      client.address || client.street,
      client.city && client.state
        ? `${client.city} ${client.state}${client.zip ? ' ' + client.zip : ''}`
        : '',
    ].filter(Boolean).join('\r');
    setText(map.address, addrParts);
    if (useEin) {
      setText(map.ein, client.ein || '');
    } else {
      setText(map.ssn, client.ssn || client.tin || '');
    }
    setText(map.phone, client.phone || '');
  }

  else if (formType === '8821_personal') {
    setText(map.nameAddress, nameAddr);
    setText(map.ssn, taxId);
    setText(map.phone, client.phone || '');
    setText(map.printName, client.name || '');
    setText(map.date, today);
  }

  else if (formType === '8821_business') {
    setText(map.nameAddress, nameAddr);
    setText(map.ein, client.ein || '');
    setText(map.phone, client.phone || '');
    setText(map.printName, bizName);
    setText(map.date, today);
  }

  // 2848 business line 7: person signs, entity is named separately.
  if (formType === '2848_business') {
    setText(map.printName, client.name || '');
    setText(map.title, BUSINESS_SIGNER_TITLE);
    setText(map.printNameTaxpayer, bizName);

    // The business template shipped with no representative signature in Part II
    // (the personal 2848 has it baked into the page). Draw it in — an unsigned
    // Declaration of Representative gets the POA returned.
    // Part II row 1 Signature cell: x 296.2-517.7, y 144-156.
    try {
      const sigBytes = await fetchTemplate('rep_signature.png');
      const sigPng   = await pdfDoc.embedPng(sigBytes);
      const page2    = pdfDoc.getPages()[1];
      if (page2) page2.drawImage(sigPng, { x: 308, y: 142, width: 34, height: 21 });
    } catch (e) {
      console.warn('Rep signature not applied to 2848 business:', e.message);
    }
  }

  // The IRS templates ship with a "Check Form for Common Errors & Reminders"
  // push-button. It is an interactive artifact, not part of the filing, and it
  // prints as a grey box at the top of the page — drop it from our output.
  try {
    const btn = form.getField('topmostSubform[0].Page1[0].CheckForm[0]');
    if (btn) {
      btn.acroField.getWidgets().forEach(w => {
        pdfDoc.getPages().forEach(pg => {
          const annots = pg.node.Annots();
          if (!annots) return;
          for (let i = annots.size() - 1; i >= 0; i--) {
            if (annots.get(i) === w.ref) annots.remove(i);
          }
        });
      });
      form.removeField(btn);
    }
  } catch (_) { /* button absent in this template — fine */ }

  // ─── 433-A (Individual CIS) ────────────────────────────────────────────────
  // Fills the taxpayer identity block (Lines 1a-1e). Financial data is left
  // blank for the client/staff to complete — it requires income/expense figures
  // the CRM doesn't hold as structured fields.
  if (formType === '433a') {
    const m = FIELD_MAPS['433a'];
    // Line 1a — full name
    setText(m.name, client.name || '');
    // Line 1b — SSN
    setText(m.ssn, client.ssn || client.tin || '');
    // Line 1c — street address + apt
    setText(m.street, client.address || client.street || '');
    // Line 1d — city + state + zip (city/state go in one field, zip in another)
    const cityState = [client.city, client.state].filter(Boolean).join(', ');
    setText(m.cityState, cityState);
    setText(m.zip, client.zip || '');
    // Line 1e — home phone and cell phone
    setText(m.homePhone, client.phone || '');
    setText(m.cellPhone, client.phone2 || '');
    // Taxpayer name block (section 4 employment info — last/first name)
    setText('topmostSubform[0].Page1[0].Taxpayer\\.L4a-h[0].p1_t15_4a[0]',
      (client.name || '').split(' ').slice(-1)[0] || '');
    setText('topmostSubform[0].Page1[0].Taxpayer\\.L4a-h[0].p1_t16_4b[0]',
      (client.name || '').split(' ')[0] || '');
  }

  // ─── 433-B (Business CIS) ─────────────────────────────────────────────────
  // Fills the business identity block (Lines 1a-1f).
  // Phone is split into area code (3 digits) + number (7 digits) per IRS format.
  else if (formType === '433b') {
    const m = FIELD_MAPS['433b'];
    const bizName = client.business_name || client.name || '';
    setText(m.bizName, bizName);
    setText(m.ein, client.ein || '');
    // Address
    const bizStreet = client.biz_street || client.address || client.street || '';
    const bizCity   = client.biz_city   || client.city   || '';
    const bizState  = client.biz_state  || client.state  || '';
    const bizZip    = client.biz_zip    || client.zip    || '';
    setText(m.street, bizStreet);
    setText(m.city,   bizCity);
    setText(m.state,  bizState);
    setText(m.zip,    bizZip);
    // Phone split: strip non-digits, take area code + 7-digit number
    const phoneDigits = (client.phone || '').replace(/\D/g, '');
    const areaCode = phoneDigits.length >= 10 ? phoneDigits.slice(0, 3)  : phoneDigits.slice(0, 3) || '';
    const phoneNum = phoneDigits.length >= 10 ? phoneDigits.slice(3, 10) : phoneDigits.slice(3)    || '';
    setText(m.phone3, areaCode);
    setText(m.phone7, phoneNum);
    setText(m.cellPhone, client.phone2 || '');
    // Entity type — derive from clientType if not explicitly set
    const entityTypeMap = {
      'Business': 'Limited Liability Company (LLC)',
      'Individual & Biz': 'Sole Proprietor',
    };
    setText(m.entityType, entityTypeMap[client.clientType] || '');
  }

  // ─── 433-D (Installment Agreement) ────────────────────────────────────────
  // Fills name+address block and SSN/phone. Payment amount and terms are left
  // for staff to complete — those require negotiation data the CRM doesn't hold.
  else if (formType === '433d') {
    const m = FIELD_MAPS['433d'];
    setText(m.nameAddress, buildNameAddress(client, 'personal'));
    setText(m.ssn,       client.ssn || client.tin || '');
    setText(m.homePhone, client.phone  || '');
    setText(m.workPhone, client.phone2 || '');
  }

  // ─── 433-F (General CIS) ──────────────────────────────────────────────────
  // Uses prefixed field names in the Master and ClientInfo sections.
  else if (formType === '433f') {
    const m = FIELD_MAPS['433f'];
    setText(m.name,      client.name || '');
    setText(m.ssn,       client.ssn || client.tin || '');
    setText(m.homePhone, client.phone  || '');
    setText(m.cellPhone, client.phone2 || '');
    // Business name and EIN if applicable
    if (client.business_name) setText('Name of Business', client.business_name);
    if (client.ein)           setText('Business EIN',     client.ein);
  }

  // ─── 433-H (Installment Agreement Request + CIS) ──────────────────────────
  // Fills name+address, SSN, home/work/cell phones, and county of residence.
  else if (formType === '433h') {
    const m = FIELD_MAPS['433h'];
    setText(m.nameAddress, buildNameAddress(client, 'personal'));
    setText(m.ssn,       client.ssn || client.tin || '');
    setText(m.homePhone, client.phone  || '');
    setText(m.workPhone, client.phone2 || '');
    setText(m.county, client.county || '');
  }

  // ─── 656-L (OIC — Doubt as to Liability) ─────────────────────────────────
  else if (formType === '656l') {
    const m = FIELD_MAPS['656l'];
    setText(m.name, client.name || '');
    // SSN split into 3 parts: XXX-XX-XXXX → [XXX][XX][XXXX]
    const ssnDigits = (client.ssn || client.tin || '').replace(/\D/g,'');
    setText(m.ssn1, ssnDigits.slice(0,3));
    setText(m.ssn2, ssnDigits.slice(3,5));
    setText(m.ssn3, ssnDigits.slice(5,9));
    setText(m.street, [client.address||client.street, client.city, client.state, client.zip].filter(Boolean).join(', '));
    if (client.business_name) {
      setText(m.bizName, client.business_name);
      const einDigits = (client.ein||'').replace(/\D/g,'');
      setText(m.ein1, einDigits.slice(0,2));
      setText(m.ein2, einDigits.slice(2));
      setText(m.contact, client.name || '');
    }
    const phoneDigits = (client.phone||'').replace(/\D/g,'');
    setText(m.phone1, phoneDigits.slice(0,3));
    setText(m.phone2, phoneDigits.slice(3,6));
    setText(m.phone3, phoneDigits.slice(6,10));
  }

  // ─── Form 9465 (Installment Agreement Request) ────────────────────────────
  else if (formType === '9465') {
    const m = FIELD_MAPS['9465'];
    setText(m.name, client.name || '');
    setText(m.ssn,  client.ssn || client.tin || '');
    setText(m.street, client.address || client.street || '');
    const csz = [client.city, client.state].filter(Boolean).join(', ') + (client.zip ? '  ' + client.zip : '');
    setText(m.cityStateZip, csz);
    setText(m.homePhone, client.phone  || '');
    setText(m.workPhone, client.phone2 || '');
  }

  // ─── Form 843 (Abatement/Refund) ──────────────────────────────────────────
  else if (formType === '843') {
    const m = FIELD_MAPS['843'];
    setText(m.name, client.name || '');
    setText(m.street, client.address || client.street || '');
    const csz = [client.city, client.state].filter(Boolean).join(', ') + (client.zip ? '  ' + client.zip : '');
    setText(m.cityStateZip, csz);
    setText(m.ssn, client.ssn || client.tin || '');
    if (client.ein) setText(m.ein, client.ein);
  }

  // ─── Form 8822 (Change of Address — Individual) ───────────────────────────
  else if (formType === '8822') {
    const m = FIELD_MAPS['8822'];
    const nameParts = (client.name || '').split(' ');
    setText(m.firstName, nameParts.slice(0,-1).join(' ') || nameParts[0] || '');
    setText(m.lastName,  nameParts.slice(-1)[0] || '');
    setText(m.ssn, client.ssn || client.tin || '');
    setText(m.newStreet, client.address || client.street || '');
    setText(m.newCityState, [client.city, client.state].filter(Boolean).join(', '));
    setText(m.newZip, client.zip || '');
  }

  // ─── Form 8822-B (Change of Address — Business) ───────────────────────────
  else if (formType === '8822b') {
    const m = FIELD_MAPS['8822b'];
    setText(m.bizName, client.business_name || client.name || '');
    setText(m.ein, client.ein || '');
    const bizStreet = client.biz_street || client.address || client.street || '';
    setText(m.newStreet, bizStreet);
    const bizCSZ = [client.biz_city||client.city, client.biz_state||client.state].filter(Boolean).join(', ');
    setText(m.newCityState, bizCSZ);
    setText(m.newZip, client.biz_zip || client.zip || '');
  }

  // ─── Form 4506-T (Request for Transcript) ────────────────────────────────
  else if (formType === '4506t') {
    const m=FIELD_MAPS['4506t'];
    setText(m.name,client.name||''); setText(m.ssn,client.ssn||client.tin||client.ein||'');
    const address=[client.address||client.street,[client.city,client.state].filter(Boolean).join(', '),client.zip].filter(Boolean).join('  ');
    setText(m.currentAddress,address); setText(m.phone,client.phone||'');
  }

  // ─── Form 12153 (CDP Hearing Request) ────────────────────────────────────
  else if (formType === '12153') {
    const m=FIELD_MAPS['12153'];
    setText(m.name,client.name||client.business_name||''); setText(m.tin,client.ssn||client.tin||client.ein||'');
    setText(m.street,client.address||client.street||''); setText(m.city,client.city||''); setText(m.state,client.state||''); setText(m.zip,client.zip||''); setText(m.phone,client.phone||'');
  }

  // ─── Form 656 (Offer in Compromise) ──────────────────────────────────────
  else if (formType === '656') {
    const m=FIELD_MAPS['656'];
    setText(m.name,client.name||''); setText(m.ssn,client.ssn||client.tin||'');
    setText(m.street,[client.address||client.street,client.city,client.state,client.zip].filter(Boolean).join(', '));
    if(client.business_name||client.ein){ setText(m.bizName,client.business_name||client.name||''); setText(m.bizAddr,[client.biz_street||client.address||client.street,client.biz_city||client.city,client.biz_state||client.state,client.biz_zip||client.zip].filter(Boolean).join(', ')); setText(m.ein,client.ein||''); setText(m.contact,client.name||''); setText(m.phone,client.phone||''); }
  }

  // ─── Form 4549 (Exam Changes) ─────────────────────────────────────────────
  else if (formType === '4549') {
    const m = FIELD_MAPS['4549'];
    setText(m.name, client.name || '');
    setText(m.ssn,  client.ssn || client.tin || '');
    setText(m.street, client.address || client.street || '');
    const csz = [client.city, client.state].filter(Boolean).join(', ') + (client.zip ? '  ' + client.zip : '');
    setText(m.cityStateZip, csz);
  }

  // ─── Form 8832 (Entity Classification) ───────────────────────────────────
  else if (formType === '8832') {
    const m = FIELD_MAPS['8832'];
    setText(m.bizName, client.business_name || client.name || '');
    setText(m.ein, client.ein || '');
    const bizStreet = client.biz_street || client.address || client.street || '';
    setText(m.street, bizStreet);
    const csz = [client.biz_city||client.city, client.biz_state||client.state].filter(Boolean).join(', ') + (client.biz_zip||client.zip ? '  '+(client.biz_zip||client.zip) : '');
    setText(m.cityStateZip, csz);
  }

  // ─── Form 911 (Taxpayer Advocate) ────────────────────────────────────────
  else if (formType === '911') {
    const m=FIELD_MAPS['911'];
    setText(m.name,client.name||''); setText(m.ssn,client.ssn||client.tin||client.ein||''); setText(m.street,client.address||client.street||''); setText(m.city,client.city||''); setText(m.state,client.state||''); setText(m.zip,client.zip||''); setText(m.phone,client.phone||'');
  }

  // ─── Form SS-4 (Apply for EIN) ────────────────────────────────────────────
  else if (formType === 'ss4') {
    const m=FIELD_MAPS['ss4'];
    setText(m.bizName,client.business_name||client.name||''); setText(m.tradeName,client.trade_name||client.dba||''); setText(m.careOf,client.name||''); setText(m.street,client.biz_street||client.address||client.street||'');
    const csz=[client.biz_city||client.city,client.biz_state||client.state].filter(Boolean).join(', ')+(client.biz_zip||client.zip?' '+(client.biz_zip||client.zip):''); setText(m.cityStateZip,csz);
  }

  // ─── Form 2553 (S-Corp Election) ─────────────────────────────────────────
  else if (formType === '2553') {
    const m=FIELD_MAPS['2553'];
    setText(m.bizName,client.business_name||client.name||''); setText(m.street,client.biz_street||client.address||client.street||'');
    const csz=[client.biz_city||client.city,client.biz_state||client.state].filter(Boolean).join(', ')+(client.biz_zip||client.zip?' '+(client.biz_zip||client.zip):''); setText(m.cityStateZip,csz); setText(m.ein,client.ein||'');
  }

  // ─── Form 12661 (Disputed Issue Verification) ─────────────────────────────
  else if (formType === '12661') {
    const m=FIELD_MAPS['12661']; setText(m.name,client.name||''); setText(m.ssn,client.ssn||client.tin||'');
  }

  // ─── Form 1128 (Adopt/Change Tax Year) ───────────────────────────────────
  else if (formType === '1128') {
    const m = FIELD_MAPS['1128'];
    setText(m.bizName, client.business_name || client.name || '');
    setText(m.ein, client.ein || '');
    const bizStreet = client.biz_street || client.address || client.street || '';
    setText(m.street, bizStreet);
    const csz = [client.biz_city||client.city, client.biz_state||client.state].filter(Boolean).join(', ') + (client.biz_zip||client.zip ? '  '+(client.biz_zip||client.zip) : '');
    setText(m.cityStateZip, csz);
  }

  const filledBytes = await pdfDoc.save();
  return filledBytes;
}

// Stamps a taxpayer signature + date onto the blank signature line of an
// already-filled IRS form PDF. Returns new PDF bytes (Uint8Array).
export async function stampSignature(pdfBytes, formType, signatureText, dateText, signatureImage) {
  const pos = SIGNATURE_POSITIONS[formType];
  if (!pos) return pdfBytes; // unknown form type — return unchanged

  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const page = pos.page === 'last' ? pages[pages.length - 1] : (pages[pos.page] || pages[0]);

  const dateFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  if (signatureImage) {
    const pngImage = await pdfDoc.embedPng(signatureImage);
    const h = 26;
    const w = (pngImage.width / pngImage.height) * h;
    page.drawImage(pngImage, { x: pos.sigX, y: pos.sigY - 4, width: w, height: h });
  } else if (signatureText) {
    const sigFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    page.drawText(signatureText, { x: pos.sigX, y: pos.sigY, size: pos.size, font: sigFont });
  }

  // 8821_business has a real AcroForm "Text3" field with an opaque white
  // appearance sitting right on top of the date line — drawing text under
  // it gets covered. Fill the field itself instead, then flatten.
  if (dateText && formType === '8821_business') {
    try {
      const form = pdfDoc.getForm();
      const dateField = form.getTextField('Text3');
      dateField.setText(dateText);
      dateField.setFontSize((pos.size || 12) - 1);
      form.flatten();
    } catch (_) {
      // fallback to drawing if the field isn't where we expect
      page.drawText(dateText, { x: pos.dateX, y: pos.dateY, size: (pos.size || 12) - 2, font: dateFont });
    }
  } else if (dateText) {
    page.drawText(dateText, { x: pos.dateX, y: pos.dateY, size: (pos.size || 12) - 2, font: dateFont });
  }

  // Representative's declaration date — same signing date as the taxpayer's.
  // On the 2848s this is an AcroForm field carrying a stale baked-in value; on
  // the state POA there is no field, so it gets drawn into the Part II cell.
  if (dateText) {
    const repField = REP_DATE_FIELDS[formType];
    if (repField) {
      try {
        const form = pdfDoc.getForm();
        const f = form.getTextField(repField);
        f.setText(dateText);
        f.setFontSize((pos.size || 12) - 2);
      } catch (_) { /* field absent in this template variant */ }
    } else if (pos.repDateX != null) {
      page.drawText(dateText, { x: pos.repDateX, y: pos.repDateY, size: (pos.size || 12) - 3, font: dateFont });
    }
  }

  return pdfDoc.save();
}

// Returns the ordered list of form types that belong in the "Full Package"
// for a given client, based on their client type.
export function getPackageFormTypes(clientType) {
  return PACKAGE_FORMS_BY_TYPE[clientType] || PACKAGE_FORMS_BY_TYPE['Individual'];
}

// ─── Credit Card Authorization — built from scratch for the e-sign package ───
export async function generateCcAuthPdf(client) {
  // Firm branding for the authorization line + footer — falls back to the
  // TCR defaults on any error so a settings hiccup never blocks the doc.
  let firmName = 'Tax Case Review';
  let firmFooterLine1 = 'Tax Case Review · 631 US Highway One Ste 304, North Palm Beach, FL 33408';
  let firmFooterLine2 = 'info@taxcasereview.org · (888) 334-5052 · Fax (561) 420-6999';
  try {
    const { data: s } = await supabase.from('settings').select('name,address,city,state,zip,phone,email,firm_fax_number').maybeSingle();
    if (s?.name) {
      firmName = s.name;
      const addr = [s.address, [s.city, s.state].filter(Boolean).join(', '), s.zip].filter(Boolean).join(', ');
      firmFooterLine1 = addr ? `${firmName} · ${addr}` : firmName;
      const parts = [s.email, s.phone, s.firm_fax_number ? `Fax ${s.firm_fax_number}` : null].filter(Boolean);
      if (parts.length) firmFooterLine2 = parts.join(' · ');
    }
  } catch (_) { /* keep defaults */ }

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 56;
  let y = 730;
  const lineW = 612 - margin * 2;

  const wrap = (text, size, maxWidth, useFont = font) => {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (useFont.widthOfTextAtSize(test, size) > maxWidth && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  };
  const drawWrapped = (text, size, useFont = font, lineGap = 15) => {
    for (const line of wrap(text, size, lineW, useFont)) {
      page.drawText(line, { x: margin, y, size, font: useFont });
      y -= lineGap;
    }
  };
  const drawLine = (label, x, w, yPos) => {
    page.drawLine({ start: { x, y: yPos }, end: { x: x + w, y: yPos }, thickness: 0.5 });
    page.drawText(label, { x, y: yPos - 12, size: 9, font, color: rgb(0.4,0.4,0.4) });
  };

  // Title
  page.drawText('Credit Card / Payment Method Authorization', { x: margin, y, size: 15, font: bold });
  y -= 26;
  page.drawText(`Client: ${client?.name || ''}`, { x: margin, y, size: 11, font });
  y -= 22;

  // Authorization text
  drawWrapped(
    `I/We authorize ${firmName} to charge the payment method below for amounts owed under the Tax Service Agreement and any Addendums, including the investigation fee, resolution fee, and any agreed installment or autopay charges.`,
    10, font, 14
  );
  y -= 6;

  // ── Section 1: Cardholder Info ──
  page.drawText('CARDHOLDER INFORMATION', { x: margin, y, size: 9, font: bold, color: rgb(0.3,0.3,0.3) });
  y -= 16;

  // Name on card
  drawLine('Name on Card', margin, lineW, y); y -= 22;

  // Address
  drawLine('Billing Address', margin, lineW, y); y -= 22;

  // City / State / Zip
  drawLine('City', margin, lineW * 0.5, y);
  drawLine('State', margin + lineW * 0.52, lineW * 0.16, y);
  drawLine('Zip', margin + lineW * 0.71, lineW * 0.29, y);
  y -= 22;

  // ── Section 2: Payment Method ──
  y -= 4;
  page.drawText('PAYMENT METHOD', { x: margin, y, size: 9, font: bold, color: rgb(0.3,0.3,0.3) });
  y -= 16;

  // Card type checkboxes
  page.drawText('Method:', { x: margin, y, size: 10, font });
  const methods = ['Credit Card', 'Debit Card', 'Bank Account (ACH)'];
  let cx = margin + 60;
  for (const m of methods) {
    page.drawRectangle({ x: cx, y: y - 2, width: 10, height: 10, borderWidth: 0.8, borderColor: rgb(0,0,0), color: rgb(1,1,1) });
    page.drawText(m, { x: cx + 14, y, size: 10, font });
    cx += font.widthOfTextAtSize(m, 10) + 30;
  }
  y -= 20;

  // Card network checkboxes
  page.drawText('Card Type:', { x: margin, y, size: 10, font });
  const networks = ['Visa', 'Mastercard', 'Amex', 'Discover'];
  cx = margin + 74;
  for (const n of networks) {
    page.drawRectangle({ x: cx, y: y - 2, width: 10, height: 10, borderWidth: 0.8, borderColor: rgb(0,0,0), color: rgb(1,1,1) });
    page.drawText(n, { x: cx + 14, y, size: 10, font });
    cx += font.widthOfTextAtSize(n, 10) + 26;
  }
  y -= 22;

  // Card number
  drawLine('Card Number', margin, lineW, y); y -= 22;

  // Expiry / CVV / Amount
  drawLine('Expiration Date (MM/YY)', margin, lineW * 0.3, y);
  drawLine('CVV / Security Code', margin + lineW * 0.33, lineW * 0.25, y);
  drawLine('Authorization Amount ($)', margin + lineW * 0.61, lineW * 0.39, y);
  y -= 22;

  // Bank info (ACH)
  y -= 4;
  page.drawText('FOR BANK ACCOUNT (ACH) ONLY:', { x: margin, y, size: 9, font: bold, color: rgb(0.3,0.3,0.3) });
  y -= 16;
  drawLine('Bank Name', margin, lineW * 0.48, y);
  drawLine('Account Type:  [ ] Checking  [ ] Savings', margin + lineW * 0.52, lineW * 0.48, y);
  y -= 22;
  drawLine('Routing Number', margin, lineW * 0.48, y);
  drawLine('Account Number', margin + lineW * 0.52, lineW * 0.48, y);
  y -= 44;

  // Notice — sized to fit its text with padding, clear of the ACH labels above
  const noticeTop = y;
  const noticeH = 60;
  page.drawRectangle({ x: margin, y: noticeTop - noticeH + 10, width: lineW, height: noticeH, color: rgb(0.96,0.96,0.96), borderWidth: 0.5, borderColor: rgb(0.8,0.8,0.8) });
  page.drawText('IMPORTANT:', { x: margin + 10, y: noticeTop - 6, size: 9, font: bold });
  const noticeLines = wrap(`${firmName} does not store your card or bank account number. Payment information is processed and stored securely by Stripe, our PCI-compliant payment processor. This signed form authorizes charges per your Tax Service Agreement.`, 9, lineW - 20, font);
  let ny = noticeTop - 20;
  for (const line of noticeLines) { page.drawText(line, { x: margin + 10, y: ny, size: 9, font }); ny -= 12; }

  // Signature block — fixed line at y=250 so the stamped signature and date
  // (SIGNATURE_POSITIONS.cc_auth, sigY/dateY=256) land exactly on the lines.
  const sigLineY = 250;
  page.drawLine({ start: { x: margin, y: sigLineY }, end: { x: 340, y: sigLineY }, thickness: 0.5 });
  page.drawText('Client Signature', { x: margin, y: sigLineY - 14, size: 9, font });
  page.drawLine({ start: { x: 360, y: sigLineY }, end: { x: 612 - margin, y: sigLineY }, thickness: 0.5 });
  page.drawText('Date', { x: 360, y: sigLineY - 14, size: 9, font });

  // Footer
  page.drawText(firmFooterLine1, { x: margin, y: 40, size: 8, font, color: rgb(0.5,0.5,0.5) });
  page.drawText(firmFooterLine2, { x: margin, y: 28, size: 8, font, color: rgb(0.5,0.5,0.5) });

  return pdfDoc.save();
}

// ─── POA Cover Letter (Form 2848) — fax-ready PDF ────────────────────────────
// The print-only version of this letter lives in docUtils.js (generatePOACoverLetter)
// but only opens a browser print dialog — there's no file to attach to a fax.
// This rebuilds the same content via pdf-lib so it can be uploaded to storage
// and attached directly from the Send Fax forms, same pattern as generateCcAuthPdf.
export async function generatePOACoverLetterPdf(c = null) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // US Letter
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 56;
  let y = 730;
  const wrap = (text, size, maxWidth, useFont = font) => {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (useFont.widthOfTextAtSize(test, size) > maxWidth && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  };
  const drawWrapped = (text, size, useFont = font, lineGap = 15) => {
    for (const line of wrap(text, size, 612 - margin * 2, useFont)) {
      page.drawText(line, { x: margin, y, size, font: useFont });
      y -= lineGap;
    }
  };

  const name  = c?.name || `${c?.first || ''} ${c?.last || ''}`.trim() || '___________________';
  const ssn   = c?.ssn ? `***-**-${c.ssn.replace(/-/g, '').slice(-4)}` : '___-__-____';
  const years = c?.taxYearsCustom || c?.taxYears || '___________________';
  const date  = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  page.drawText(date, { x: margin, y, size: 10, font });
  y -= 30;

  page.drawText('Internal Revenue Service', { x: margin, y, size: 11, font });
  y -= 14;
  page.drawText('[IRS Campus — See Form 2848 Instructions for Applicable Address]', { x: margin, y, size: 11, font });
  y -= 28;

  page.drawText('Re: Power of Attorney — Form 2848', { x: margin, y, size: 11, font: bold });
  y -= 16;
  page.drawText(`Taxpayer: ${name}`, { x: margin, y, size: 11, font });
  y -= 14;
  page.drawText(`SSN/EIN: ${ssn}`, { x: margin, y, size: 11, font });
  y -= 14;
  page.drawText(`Tax Periods: ${years}`, { x: margin, y, size: 11, font });
  y -= 28;

  page.drawText('To Whom It May Concern,', { x: margin, y, size: 11, font });
  y -= 24;

  drawWrapped(
    `Enclosed please find a completed Form 2848 (Power of Attorney and Declaration of Representative) authorizing ${fName()} to represent the above-named taxpayer in connection with the tax matters and periods specified therein.`,
    11
  );
  y -= 8;
  drawWrapped(
    `Please update your records to reflect this authorization and direct all future correspondence regarding the above-referenced matter to our office at the address below. We respectfully request that all notices, letters, and communications be sent to our office rather than directly to the taxpayer.`,
    11
  );
  y -= 8;
  drawWrapped(
    `If you have any questions or require additional information, please do not hesitate to contact our office.`,
    11
  );

  y -= 24;
  page.drawText('Respectfully submitted,', { x: margin, y, size: 11, font });

  y -= 50;
  page.drawLine({ start: { x: margin, y: y + 14 }, end: { x: margin + 260, y: y + 14 }, thickness: 0.5 });
  page.drawText('Authorized Representative', { x: margin, y, size: 11, font: bold });
  y -= 14;
  page.drawText(fName(), { x: margin, y, size: 10.5, font });
  y -= 13;
  page.drawText(fAddr(), { x: margin, y, size: 10, font });
  y -= 13;
  page.drawText(fContactLine(), { x: margin, y, size: 10, font });
  y -= 16;
  page.drawText('Date: _______________________', { x: margin, y, size: 10, font });

  return pdfDoc.save();
}

// ─── 433-F / 433-A Collection Information Statement filling ──────────────────
// These pull from the client record + Financial Profile (profile object as
// stored in financial_profiles table) rather than just the client row.

export const F433_TEMPLATE_PATHS = {
  '433f': '433F_Blank.pdf',
  '433a': '433A_Blank.pdf',
};

export const F433_LABELS = {
  '433f': 'Form 433-F — Collection Information Statement',
  '433a': 'Form 433-A — Collection Information Statement (Wage Earners & Self-Employed)',
};

function n(v) { const x = parseFloat(v); return isNaN(x) ? 0 : x; }
function money(v) { const x = n(v); return x ? x.toFixed(2) : ''; }

// Split a phone string into (area code, number) for forms that have
// separate boxes, e.g. "(407) 555-1234" -> ["407", "555-1234"]
function splitPhone(phone) {
  if (!phone) return ['', ''];
  const digits = (phone.match(/\d/g) || []).join('');
  if (digits.length >= 10) {
    return [digits.slice(0, 3), digits.slice(3)];
  }
  return ['', phone];
}

// Fills Form 433-F (Collection Information Statement) from the client row
// and their Financial Profile. Returns filled PDF bytes (Uint8Array).
export async function fillForm433F(client, profile) {
  const templateBytes = await fetchTemplate(F433_TEMPLATE_PATHS['433f']);
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const p = profile || {};
  const et1 = p.employment_taxpayer_1 || {};
  const es1 = p.employment_spouse_1 || {};
  const b1 = p.business_1 || {};
  const re0 = (p.real_estate || [])[0] || {};
  const re1 = (p.real_estate || [])[1] || {};
  const vehicles = (p.vehicles || []).filter(v => v.make_model);
  const cc = p.credit_cards || [];
  const extra = p.f433_extra || {};
  const exp = p.expenses || {};

  const setText = (fieldName, value) => {
    if (!fieldName) return;
    try {
      const field = form.getTextField(fieldName);
      try { field.acroField.dict.set(PDFName.of('DA'), PDFString.of('/Helv 9 Tf 0 g')); } catch (_) {}
      field.setText(value != null ? String(value) : '');
    } catch (_) { /* field not present — skip */ }
  };
  const setCheck = (fieldName, on) => {
    if (!fieldName) return;
    try {
      const field = form.getCheckBox(fieldName);
      if (on) field.check(); else field.uncheck();
    } catch (_) { /* skip */ }
  };

  // ── Header / Identifying info ──
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_ACCOUNT_NAME_NAME', client?.name || '');
  setText('TOInfo.ACCOUNT_NAME_ADDRESS', client?.street || '');
  setText('TOInfo.ACCOUNT_NAME_CITY_STATE_ZIP_CODE', [client?.city, client?.state, client?.zip].filter(Boolean).join(', '));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_PRIMARY_SSN', client?.ssn || '');
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_SPOUSE_SSN', client?.spouseSsn || '');
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_COUNTY_OF_RESIDENCE', p.county || '');

  // Taxpayer phones
  setText('ClientInfo.ACCOUNT_NAME1_PHONE', client?.phone || '');         // Home
  setText('ClientInfo.ACCOUNT_NAME1_WORK_PHONE', '');                      // Work (no field in CRM)
  setText('ClientInfo.ACCOUNT_NAME1_CELL_PHONE', client?.phone || '');     // Cell
  // Spouse phones
  setText('ClientInfo.ACCOUNT_NAME1_SPOUSE_PHONE', client?.spousePhone || '');
  setText('Work_2', '');
  setText('Cell', '');

  // Household size
  setText('TOInfo.ACCOUNT_NAME_HOUSEHOLD_UNDER_65', p.household_under_65 ?? '');
  setText('TOInfo.ACCOUNT_NAME_HOUSEHOLD_OVER_65', p.household_over_65 ?? '');

  // Business info (self-employed)
  setText('Name of Business', b1.name || '');
  setText('Business EIN', extra.business_ein || b1.ein || '');
  setText('Type of Business', extra.business_type || '');
  setText('Number of Employees not counting owner', extra.num_employees ?? b1.num_employees ?? '');

  // ── Section A: Bank accounts (from Assets & Equity, type=bank_account) ──
  const bankAssets = (p.assets || []).filter(a => a.type === 'bank_account');
  if (bankAssets[0]) {
    setText('TOInfo.ACCOUNT_NAME_BANK_NAME', bankAssets[0].description || '');
    setText('TOInfo.ACCOUNT_NAME_ACCOUNT_BALANCE', money(bankAssets[0].value));
  }
  if (bankAssets[1]) {
    setText('TOInfo.ACCOUNT_NAME_BANK_NAME1', bankAssets[1].description || '');
    setText('TOInfo.ACCOUNT_NAME_ACCOUNT_BALANCE2', money(bankAssets[1].value));
  }

  // ── Section B: Real Estate ──
  if (re0.address) {
    setText('TOInfo.ACCOUNT_NAME_PRIMARY_ADDRESS_ONLY_IF_OWN_HOME', re0.address || '');
    setText('TOInfo.ACCOUNT_NAME_MONTHLY_MORTGAGE_EXPENSE', money(n(re0.mortgage_1) + n(re0.mortgage_2)));
    setText('TOInfo.ACCOUNT_NAME_PURCHASE_YEAR', re0.purchase_year || '');
    setText('TOInfo.ACCOUNT_NAME_PURCHASE_AMOUNT', money(re0.purchase_amount));
    setText('TOInfo.ACCOUNT_NAME_REFINANCE_YEAR', re0.refi_year || '');
    setText('TOInfo.ACCOUNT_NAME_AMOUNT_OF_REFINANCE', money(re0.refi_amount));
    setText('TOInfo.ACCOUNT_NAME_VALUE_OF_HOME_ZILLOW', money(re0.zillow_value));
    setText('TOInfo.ACCOUNT_NAME_BALANCE_OF_MORTGAGE', money(re0.mortgage_balance));
    const equity0 = n(re0.zillow_value) - n(re0.mortgage_balance);
    setText('TOInfo.ACCOUNT_NAME_EQUITY_IN_PROPERTY', equity0 ? money(equity0) : '');
    setCheck('Primary Residence', true);
  }
  if (re1.address) {
    setText('TOInfo.ACCOUNT_NAME_ADDITIONAL_PROPERTY_ADDRESS', re1.address || '');
    setText('TOInfo.ACCOUNT_NAME_MONTHLY_MORTGAGE_EXPENSE1', money(n(re1.mortgage_1) + n(re1.mortgage_2)));
    setText('TOInfo.ACCOUNT_NAME_PURCHASE_YEAR_ADDITIONAL_PROPERTY', re1.purchase_year || '');
    setText('TOInfo.ACCOUNT_NAME_PURCHASE_AMOUNT_ADDITIONAL_PROPERTY', money(re1.purchase_amount));
    setText('TOInfo.ACCOUNT_NAME_REFINANCE_YEAR_ADDITIONAL_PROPERTY', re1.refi_year || '');
    setText('TOInfo.ACCOUNT_NAME_AMOUNT_OF_REFINANCE_ADDITIONAL_PROPERTY', money(re1.refi_amount));
    setText('TOInfo.ACCOUNT_NAME_VALUE_OF_HOME_ADDITIONAL_PROPERTY', money(re1.zillow_value));
    setText('TOInfo.ACCOUNT_NAME_BALANCE_OF_MORTGAGE_ADDITIONAL_PROPERTY', money(re1.mortgage_balance));
    const equity1 = n(re1.zillow_value) - n(re1.mortgage_balance);
    setText('TOInfo.ACCOUNT_NAME_EQUITY_IN_PROPERTY2', equity1 ? money(equity1) : '');
    setCheck('Other_2', true);
  }

  // ── Vehicles ──
  if (vehicles[0]) {
    const v = vehicles[0];
    setText('TOInfo.ACCOUNT_NAME_VEHICLE_1_MAKE_MODEL', `${v.year || ''} ${v.make_model || ''}`.trim());
    setText('TOInfo.ACCOUNT_NAME_VEHICLE_1_MONTHLY_PAYMENT', money(v.monthly_payment));
    setText('TOInfo.ACCOUNT_NAME_VEHICLE_1_PURCHASE_DATE(Date yyyy)', v.purchase_date || '');
    setText('TOInfo.ACCOUNT_NAME_VEHICLE_1_FINAL_PAYMENT_DATE(Date MM/yyyy)', v.final_payment_date || '');
    setText('TOInfo.ACCOUNT_NAME_VEHICLE_1_FMV', money(v.kbb_value));
    setText('TOInfo.ACCOUNT_NAME_VEHICLE_1_PAYOFF_AMOUNT', money(v.remaining_balance));
    const eq = n(v.kbb_value) - n(v.remaining_balance);
    setText('TOInfo.ACCOUNT_NAME_VEHICLE_EQUITY', eq ? money(eq) : '');
  }
  if (vehicles[1]) {
    const v = vehicles[1];
    setText('TOInfo.ACCOUNT_NAME_VEHICLE_2_MAKE_MODEL', `${v.year || ''} ${v.make_model || ''}`.trim());
    setText('TOInfo.ACCOUNT_NAME_VEHICLE_2_MONTHLY_PAYMENT', money(v.monthly_payment));
    setText('TOInfo.ACCOUNT_NAME_VEHICLE_2_PURCHASE_DATE(Date yyyy)', v.purchase_date || '');
    setText('TOInfo.ACCOUNT_NAME_VEHICLE_2_FINAL_PAYMENT_DATE(Date MM/yyyy)', v.final_payment_date || '');
    setText('TOInfo.ACCOUNT_NAME_VEHICLE_2_FMV', money(v.kbb_value));
    setText('TOInfo.ACCOUNT_NAME_VEHICLE_2_PAYOFF_AMOUNT', money(v.remaining_balance));
    const eq2 = n(v.kbb_value) - n(v.remaining_balance);
    setText('TOInfo.ACCOUNT_NAME_VEHICLE_EQUITY2', eq2 ? money(eq2) : '');
  }

  // ── Credit cards / lines of credit ──
  if (cc[0]) {
    setText('TypeRow1', cc[0].name || '');
    setText('Credit LimitRow1', money(cc[0].limit));
    setText('Balance OwedRow1_2', money(cc[0].balance));
    setText('Minimum Monthly PaymentRow1', money(cc[0].min_payment));
  }
  if (cc[1]) {
    setText('TypeRow2', cc[1].name || '');
    setText('Credit LimitRow2', money(cc[1].limit));
    setText('Balance OwedRow2_2', money(cc[1].balance));
    setText('Minimum Monthly PaymentRow2', money(cc[1].min_payment));
  }

  // ── Section E: Employment ──
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_PRIMARY_TAXPAYER_EMPLOYER', et1.employer || '');
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_SPOUSE_EMPLOYER', es1.employer || '');
  setText('TOInfo.ACCOUNT_NAME_PAY_FREQUENCY', et1.pay_frequency || '');
  setText('TOInfo.ACCOUNT_NAME_SPOUSE_PAY_FREQUENCY', es1.pay_frequency || '');
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_GROSS_WAGES_PER_PAY_PERIOD', money(et1.gross_monthly_salary));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_SPOUSE_GROSS_WAGES_PER_PAY_PERIOD', money(es1.gross_monthly_salary));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_TAX_PER_PAY_PERIOD_FED', money(et1.fed_withheld));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_TAX_PER_PAY_PERIOD_STATE', money(et1.state_withheld));
  setText('Local', money(et1.ss_med_withheld));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_TAX_PER_PAY_PERIOD_FEDSPOUSE', money(es1.fed_withheld));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_TAX_PER_PAY_PERIOD_STATESPOUSE', money(es1.state_withheld));
  setText('Local_2', money(es1.ss_med_withheld));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_HOW_LONG_AT_CURRENT_EMPLOYER', et1.length || '');
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_HOW_LONG_AT_CURRENT_EMPLOYERSPOUSE', es1.length || '');

  // Pay frequency checkboxes (taxpayer / spouse)
  const freqMap = { 'Weekly': 'Weekly', 'Bi-weekly': 'Biweekly', 'Biweekly': 'Biweekly', 'Semi-monthly': 'Semimonthly', 'Semimonthly': 'Semimonthly', 'Monthly': 'Monthly' };
  if (freqMap[et1.pay_frequency]) setCheck(freqMap[et1.pay_frequency], true);
  if (freqMap[es1.pay_frequency]) setCheck(freqMap[es1.pay_frequency] + '_2', true);

  // ── Section G: Non-wage household income ──
  setText('TOInfo.ACCOUNT_NAME_MONTHLY_NET_INCOME_FROM_BUSINESS', money(b1.net_income));

  // ── Section H: Monthly Necessary Living Expenses ──
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_FOOD', money(exp.food));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_HOUSEKEEPING_SUPPLIES', money(exp.housekeeping_supplies));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_CLOTHING_AND_CLOTHING_SERVICE', money(exp.clothing));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_PERSONAL_CARE_PRODUCTS_SERVICES', money(exp.personal_care));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_MISC', money(exp.misc));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_FOOD_CLOTHING_AND_MISC_EXPENSES', money(exp.food_clothing));

  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_OPERATING_EXPENSES', money(n(exp.car_misc)));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_PUBLIC_TRANSPORTATION', money(exp.public_transportation));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_TOTAL_TRANSPORTATION_EXPENSE',
    money(n(exp.car_misc) + n(exp.public_transportation) + n(vehicles[0]?.monthly_payment) + n(vehicles[1]?.monthly_payment)));

  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_RENT', money(exp.rent));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_ELECTRIC_OIL_GAS_WATER_TRASH',
    money(n(exp.electricity) + n(exp.heating_gas) + n(exp.heating_propane) + n(exp.water_sewer_trash) + n(exp.waste_sewer) + n(exp.trash)));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_TELEPHONE_CELL_CABLE_INTERNET',
    money(n(exp.cell_phone) + n(exp.internet) + n(exp.cable)));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_REAL_ESTATE_TAXES_AND_INSURANCE',
    money(n(exp.homeowners_insurance) + n(exp.property_taxes) + n(exp.hoa_dues) + n(exp.renters_insurance)));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_MAINTENANCE_AND_REPAIRS', money(n(exp.maintenance) + n(exp.pest_control) + n(exp.lawn)));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_TOTAL_HOUSING_UTILITIES_EXPENSE',
    money(n(re0.mortgage_1) + n(re0.mortgage_2) + n(exp.rent) + n(exp.electricity) + n(exp.heating_gas) + n(exp.heating_propane) +
      n(exp.water_sewer_trash) + n(exp.waste_sewer) + n(exp.trash) + n(exp.cell_phone) + n(exp.internet) + n(exp.cable) +
      n(exp.homeowners_insurance) + n(exp.property_taxes) + n(exp.hoa_dues) + n(exp.renters_insurance) +
      n(exp.maintenance) + n(exp.pest_control) + n(exp.lawn)));

  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_HEALTH_INSURANCE',
    money(n(exp.health_major_medical) + n(exp.health_supplemental) + n(exp.health_dental) + n(exp.health_vision)));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_OUT_OF_POCKET_HEALTH_CARE_EXPENSES', money(exp.health_oop));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_TOTAL_HEALTH_CARE_EXPENSES',
    money(n(exp.health_major_medical) + n(exp.health_supplemental) + n(exp.health_dental) + n(exp.health_vision) + n(exp.health_oop)));

  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_CHILD_DEPENDENT_CARE', money(exp.child_care));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_ESTIMATED_TAX_PAYMENTS', money(exp.estimated_tax_payments));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_RETIREMENT_EMPLOYER_REQUIRED', money(exp.retirement_employer));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_RETIREMENT_VOLUNTARY', money(exp.retirement_voluntary));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_UNION_DUES', money(extra.union_dues));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_DELINQUENT_STATE_LOCAL_TAXES', money(exp.delinquent_state_local));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_STUDENT_LOAN_PAYMENTS', money(p.other_secured_debt?.monthly_payment));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_COURT_ORDERED_CHILD_SUPPORT', money(exp.court_ordered_child_support));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_COURT_ORDERED_ALIMONY', money(extra.court_ordered_alimony));
  setText('Master.INCOME_EXPENSE_EQUITY_WORKSHEET_OTHER_COURT_ORDERED_PAYMENTS', money(exp.other_court_ordered));

  const filledBytes = await pdfDoc.save();
  return filledBytes;
}

// Fills Form 433-A (Section 1: Personal Information) from the client row
// and Financial Profile. Other sections (assets, income/expenses) are left
// blank for manual completion in this first pass.
export async function fillForm433A(client, profile) {
  const templateBytes = await fetchTemplate(F433_TEMPLATE_PATHS['433a']);
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const p = profile || {};

  const setText = (fieldName, value) => {
    if (!fieldName) return;
    try {
      const field = form.getTextField(fieldName);
      try { field.acroField.dict.set(PDFName.of('DA'), PDFString.of('/Helv 9 Tf 0 g')); } catch (_) {}
      field.setText(value != null ? String(value) : '');
    } catch (_) { /* skip */ }
  };
  const setCheck = (fieldName, on) => {
    if (!fieldName) return;
    try {
      const field = form.getCheckBox(fieldName);
      if (on) field.check(); else field.uncheck();
    } catch (_) { /* skip */ }
  };

  const base = 'topmostSubform[0].Page1[0].c1[0]';

  // 1a — Full Name of Taxpayer and Spouse
  const fullName = [client?.name, client?.spouseName].filter(Boolean).join(' & ');
  setText(`${base}.Lines1a-b[0].p1-t4[0]`, fullName);

  // 1b — Address
  const addr = [client?.street, [client?.city, client?.state, client?.zip].filter(Boolean).join(', ')]
    .filter(Boolean).join(', ');
  setText(`${base}.Lines1a-b[0].p1-t5[0]`, addr);

  // 1c — County of Residence
  setText(`${base}.Lines1a-b[1].p1-t4[0]`, p.county || '');

  // 1d — Home Phone (area code / number)
  const [hArea, hNum] = splitPhone(client?.phone);
  setText(`${base}.Line1c[0].p1-t6c[0]`, hArea);
  setText(`${base}.Line1c[0].p1-t7c[0]`, hNum);

  // 1e — Cell Phone
  const [cArea, cNum] = splitPhone(client?.phone);
  setText(`${base}.Line1d[0].p1-t8d[0]`, cArea);
  setText(`${base}.Line1d[0].p1-t9d[0]`, cNum);

  // 1f — Work Phone (no source field in CRM, leave blank)
  setText(`${base}.Line1e[0].p1-t10e[0]`, '');
  setText(`${base}.Line1e[0].p1-t11e[0]`, '');

  // 2a — Marital status: [0]="1"=Married, [1]="2"=Unmarried
  if (p.filing_status) {
    const fs = p.filing_status.toLowerCase();
    if (fs.includes('married')) setCheck(`${base}.C1_01_2a[0]`, true);
    else setCheck(`${base}.C1_01_2a[1]`, true);
  }

  // 2b — SSN/ITIN + DOB (Taxpayer row, Spouse row)
  setText(`${base}.Table_Part4-Line5[0].Row1[0].F02_030_0_[0]`, client?.ssn || '');
  setText(`${base}.Table_Part4-Line5[0].Row1[0].F02_031_0_[0]`, p.dob || '');
  setText(`${base}.Table_Part4-Line5[0].Row2[0].F02_034_0_[0]`, client?.spouseSsn || '');
  setText(`${base}.Table_Part4-Line5[0].Row2[0].F02_035_0_[0]`, '');

  // Section 1 — Dependents (from client.dependents JSON)
  let deps = [];
  try {
    deps = client?.dependents
      ? (typeof client.dependents === 'string' ? JSON.parse(client.dependents || '[]') : client.dependents)
      : [];
  } catch (_) { deps = []; }
  const depBase = 'topmostSubform[0].Page1[0].c2[0].ClaimedAsDependents[0]';
  deps.slice(0, 3).forEach((d, i) => {
    const row = i + 1;
    setText(`${depBase}.Row${row}[0].Name[0]`, d.name || '');
    setText(`${depBase}.Row${row}[0].Age[0]`, d.age || '');
    setText(`${depBase}.Row${row}[0].Relationship[0]`, d.relationship || '');
  });

  const filledBytes = await pdfDoc.save();
  return filledBytes;
}

// ─── 433-D, 433-H, 433-B, 433-A OIC ──────────────────────────────────────────

F433_TEMPLATE_PATHS['433d'] = '433D_Blank.pdf';
F433_TEMPLATE_PATHS['433h'] = '433H_Blank.pdf';
F433_TEMPLATE_PATHS['433b'] = '433B_Blank.pdf';
F433_TEMPLATE_PATHS['433a_oic'] = '433A_OIC_Blank.pdf';

F433_LABELS['433d'] = 'Form 433-D — Installment Agreement';
F433_LABELS['433h'] = 'Form 433-H — Installment Agreement Request & CIS';
F433_LABELS['433b'] = 'Form 433-B — Collection Information Statement for Businesses';
F433_LABELS['433a_oic'] = 'Form 433-A (OIC) — Collection Information Statement (Offer in Compromise)';

// Fills Form 433-D (Installment Agreement). Mostly identifying info — the
// payment terms (lines on Part 1) are left blank for the rep to fill in
// once an agreement amount is negotiated with the IRS.
export async function fillForm433D(client, profile) {
  const templateBytes = await fetchTemplate(F433_TEMPLATE_PATHS['433d']);
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();

  const setText = (fieldName, value) => {
    if (!fieldName) return;
    try {
      const field = form.getTextField(fieldName);
      try { field.acroField.dict.set(PDFName.of('DA'), PDFString.of('/Helv 9 Tf 0 g')); } catch (_) {}
      field.setText(value != null ? String(value) : '');
    } catch (_) {}
  };

  const base = 'form1[0].Page1_Part1[0]';
  const nameAddr = [client?.name, client?.street, [client?.city, client?.state, client?.zip].filter(Boolean).join(', ')]
    .filter(Boolean).join('\r');
  setText(`${base}.NameAddressTaxpayer[0].NameAndAddress[0]`, nameAddr);
  setText(`${base}.SSN_EIN[0].Taxpayer[0]`, client?.ssn || client?.ein || '');
  setText(`${base}.SSN_EIN[0].Spouse[0]`, client?.spouseSsn || '');
  const [hArea, hNum] = splitPhone(client?.phone);
  setText(`${base}.SSN_EIN[0].Home[0]`, client?.phone ? `(${hArea}) ${hNum}` : '');
  setText(`${base}.SSN_EIN[0].WorkCellBusiness[0]`, '');
  setText(`${base}.SSN_EIN[0].OrWrite[0]`, [client?.city, client?.state, client?.zip].filter(Boolean).join(', '));

  const filledBytes = await pdfDoc.save();
  return filledBytes;
}

// Fills Form 433-H (Installment Agreement Request & Collection Information
// Statement). Personal info, income, and expenses come from the client
// record + Financial Profile. Part 1 payment terms left blank.
export async function fillForm433H(client, profile) {
  const templateBytes = await fetchTemplate(F433_TEMPLATE_PATHS['433h']);
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const p = profile || {};
  const et1 = p.employment_taxpayer_1 || {};
  const es1 = p.employment_spouse_1 || {};
  const b1 = p.business_1 || {};
  const exp = p.expenses || {};
  const re0 = (p.real_estate || [])[0] || {};
  const extra = p.f433_extra || {};

  const setText = (fieldName, value) => {
    if (!fieldName) return;
    try {
      const field = form.getTextField(fieldName);
      try { field.acroField.dict.set(PDFName.of('DA'), PDFString.of('/Helv 9 Tf 0 g')); } catch (_) {}
      field.setText(value != null ? String(value) : '');
    } catch (_) {}
  };
  const setCheck = (fieldName, on) => {
    if (!fieldName) return;
    try { const f = form.getCheckBox(fieldName); if (on) f.check(); else f.uncheck(); } catch (_) {}
  };

  // ── Page 1: Header / Identifying info ──
  const p1 = 'form1[0].page_1[0]';
  const nameAddr = [client?.name, client?.street, [client?.city, client?.state, client?.zip].filter(Boolean).join(', ')]
    .filter(Boolean).join('\r');
  setText(`${p1}.address[0].NamesAddress[0]`, nameAddr);
  setText(`${p1}.address[0].CountyResidence[0]`, p.county || '');
  setText(`${p1}.ssn[0].YourSocialSecurityNu[0]`, client?.ssn || '');
  setText(`${p1}.ssn[0].YourSpousesSocialSec[0]`, client?.spouseSsn || '');
  const [hArea, hNum] = splitPhone(client?.phone);
  setText(`${p1}.your_telephone[0].Home11[0]`, client?.phone ? `(${hArea}) ${hNum}` : '');
  setText(`${p1}.Under65[0]`, p.household_under_65 ?? '');
  setText(`${p1}._65Over[0]`, p.household_over_65 ?? '');

  // ── Page 3: Section E (Employment) / F (Non-wage income) / G (Expenses) ──
  const p3 = 'form1[0].page_3[0]';
  // (page-3 "CountyResidence" field is actually the Notes box — leave blank)
  setText(`${p3}.sectionE[0].column_1[0].fieldXmlnshttpwwwxfa[0]`, et1.employer || '');
  setText(`${p3}.sectionE[0].column_2[0].FillText65[0]`, es1.employer || '');
  setText(`${p3}.sectionE[0].column_1[0].GrossPerPayPeriod[0]`, money(et1.gross_monthly_salary));
  setText(`${p3}.sectionE[0].column_2[0].Gross1[0]`, money(es1.gross_monthly_salary));
  setText(`${p3}.sectionE[0].column_1[0].TaxesPerPayPeriodFed[0]`, money(et1.fed_withheld));
  setText(`${p3}.sectionE[0].column_1[0].State[0]`, money(et1.state_withheld));
  setText(`${p3}.sectionE[0].column_1[0].Local[0]`, money(et1.ss_med_withheld));
  setText(`${p3}.sectionE[0].column_2[0].Fed1[0]`, money(es1.fed_withheld));
  setText(`${p3}.sectionE[0].column_2[0].State1[0]`, money(es1.state_withheld));
  setText(`${p3}.sectionE[0].column_2[0].Local1[0]`, money(es1.ss_med_withheld));
  setText(`${p3}.sectionE[0].column_1[0].HowLongAtCurrentEmpl[0]`, et1.length || '');
  setText(`${p3}.sectionE[0].column_2[0].How_long_at_current_employer[0]`, es1.length || '');

  const freqMapH = { 'Weekly': 'weekly', 'Bi-weekly': 'biweekly', 'Biweekly': 'biweekly', 'Semi-monthly': 'semi', 'Semimonthly': 'semi', 'Monthly': 'monthly' };
  if (freqMapH[et1.pay_frequency]) setCheck(`${p3}.sectionE[0].column_1[0].${freqMapH[et1.pay_frequency]}[0]`, true);
  if (freqMapH[es1.pay_frequency]) setCheck(`${p3}.sectionE[0].column_2[0].${freqMapH[es1.pay_frequency]}[0]`, true);

  // Section F — non-wage income
  setText(`${p3}.nsei[0]`, money(b1.net_income));

  // Section G — expenses
  setText(`${p3}.column_1[0].column_1[0].food_personal_care[0].food_personal_care[0].Row1[0].food_monthly[0]`, money(exp.food));
  setText(`${p3}.column_1[0].column_1[0].food_personal_care[0].food_personal_care[0].Row2[0].housekeeping_monthly[0]`, money(exp.housekeeping_supplies));
  setText(`${p3}.column_1[0].column_1[0].food_personal_care[0].food_personal_care[0].Row3[0].clothing_monthly[0]`, money(exp.clothing));
  setText(`${p3}.column_1[0].column_1[0].food_personal_care[0].food_personal_care[0].Row4[0].personal_care_monthly[0]`, money(exp.personal_care));
  setText(`${p3}.column_1[0].column_1[0].food_personal_care[0].food_personal_care[0].Row5[0].miscellaneous_monthly[0]`, money(exp.misc));
  setText(`${p3}.column_1[0].column_1[0].food_personal_care[0].food_personal_care[0].Row6[0].total_monthly[0]`, money(exp.food_clothing));

  setText(`${p3}.column_1[0].column_1[0].transportation[0].Row1[0].gas_monthly[0]`, money(exp.car_misc));
  setText(`${p3}.column_1[0].column_1[0].transportation[0].Row2[0].transportation_monthly[0]`, money(exp.public_transportation));

  setText(`${p3}.column_1[0].column_1[0].housing_utilities[0].Row1[0].rent_monthly[0]`, money(exp.rent));
  setText(`${p3}.column_1[0].column_1[0].housing_utilities[0].Row2[0].electric_monthly[0]`,
    money(n(exp.electricity) + n(exp.heating_gas) + n(exp.heating_propane) + n(exp.water_sewer_trash) + n(exp.waste_sewer) + n(exp.trash)));
  setText(`${p3}.column_1[0].column_1[0].housing_utilities[0].Row3[0].telephone_monthly[0]`,
    money(n(exp.cell_phone) + n(exp.internet) + n(exp.cable)));
  setText(`${p3}.column_1[0].column_1[0].housing_utilities[0].Row4[0].real_estate_monthly[0]`,
    money(n(exp.homeowners_insurance) + n(exp.property_taxes) + n(exp.hoa_dues) + n(exp.renters_insurance)));
  setText(`${p3}.column_1[0].column_1[0].housing_utilities[0].Row5[0].maintenance_monthly[0]`,
    money(n(exp.maintenance) + n(exp.pest_control) + n(exp.lawn)));
  setText(`${p3}.column_1[0].column_1[0].housing_utilities[0].Row6[0].total_monthly[0]`,
    money(n(re0.mortgage_1) + n(re0.mortgage_2) + n(exp.rent) + n(exp.electricity) + n(exp.heating_gas) + n(exp.heating_propane) +
      n(exp.water_sewer_trash) + n(exp.waste_sewer) + n(exp.trash) + n(exp.cell_phone) + n(exp.internet) + n(exp.cable) +
      n(exp.homeowners_insurance) + n(exp.property_taxes) + n(exp.hoa_dues) + n(exp.renters_insurance) +
      n(exp.maintenance) + n(exp.pest_control) + n(exp.lawn)));

  setText(`${p3}.column_2[0].column_2[0].medical[0].Row1[0].health_monthly[0]`,
    money(n(exp.health_major_medical) + n(exp.health_supplemental) + n(exp.health_dental) + n(exp.health_vision)));
  setText(`${p3}.column_2[0].column_2[0].medical[0].Row2[0].out_of_monthly[0]`, money(exp.health_oop));

  setText(`${p3}.column_2[0].column_2[0].other[0].Row1[0].child_monthly[0]`, money(exp.child_care));
  setText(`${p3}.column_2[0].column_2[0].other[0].Row2[0].tax_payments_monthly[0]`, money(exp.estimated_tax_payments));
  setText(`${p3}.column_2[0].column_2[0].other[0].Row4[0].required_retirement_monthly[0]`, money(exp.retirement_employer));
  setText(`${p3}.column_2[0].column_2[0].other[0].Row5[0].voluntary_retirement_monthly[0]`, money(exp.retirement_voluntary));
  setText(`${p3}.column_2[0].column_2[0].other[0].Row6[0].union_monthly[0]`, money(extra.union_dues));
  setText(`${p3}.column_2[0].column_2[0].other[0].Row7[0].delinquent_monthly[0]`, money(exp.delinquent_state_local));
  setText(`${p3}.column_2[0].column_2[0].other[0].Row8[0].student_loans_monthly[0]`, money(p.other_secured_debt?.monthly_payment));
  setText(`${p3}.column_2[0].column_2[0].other[0].Row9[0].support_monthly[0]`, money(exp.court_ordered_child_support));
  setText(`${p3}.column_2[0].column_2[0].other[0].Row10[0].alimony_monthly[0]`, money(extra.court_ordered_alimony));
  setText(`${p3}.column_2[0].column_2[0].other[0].Row11[0].court_ordered_monthly[0]`, money(exp.other_court_ordered));

  const filledBytes = await pdfDoc.save();
  return filledBytes;
}

// Fills Form 433-B (Collection Information Statement for Businesses).
// Section 1 (Business Info) and Section 6 (Officers, from business_1) are
// auto-filled; asset/liability sections (3-5) left blank for manual entry.
export async function fillForm433B(client, profile) {
  const templateBytes = await fetchTemplate(F433_TEMPLATE_PATHS['433b']);
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const p = profile || {};
  const b1 = p.business_1 || {};
  const exp = p.expenses || {};

  const setText = (fieldName, value) => {
    if (!fieldName) return;
    try {
      const field = form.getTextField(fieldName);
      try { field.acroField.dict.set(PDFName.of('DA'), PDFString.of('/Helv 9 Tf 0 g')); } catch (_) {}
      field.setText(value != null ? String(value) : '');
    } catch (_) {}
  };
  const setCheck = (fieldName, value) => {
    if (!fieldName) return;
    try {
      const f = form.getCheckBox(fieldName);
      if (value) f.check(); else f.uncheck();
    } catch (_) {}
  };

  const base = 'topmostSubform[0].Page1[0]';
  const bizName = b1.name || client?.business_name || client?.name || '';
  setText(`${base}.Line1a-f[0].p1_1_1a[0]`, bizName);
  const bizStreet = b1.address ? b1.address.split(',')[0] : (client?.street || '');
  setText(`${base}.Line1a-f[0].p1_3_1b[0]`, bizStreet);
  setText(`${base}.Line1a-f[0].p1_5_1bCity[0]`, client?.city || '');
  setText(`${base}.Line1a-f[0].p1_6_1bstate[0]`, client?.state || '');
  setText(`${base}.Line1a-f[0].p1_7_1bZIP[0]`, client?.zip || '');
  setText(`${base}.Line1a-f[0].p1_8_1c[0]`, p.county || '');
  const [pArea, pNum] = splitPhone(client?.phone);
  setText(`${base}.Line1a-f[0].p1_9_1d_3digits[0]`, pArea);
  setText(`${base}.Line1a-f[0].p1_10_1d_7digits[0]`, pNum);
  setText(`${base}.Line1a-f[0].p1_11_1e[0]`, p.f433_extra?.business_type || '');

  setText(`${base}.p1_13_2a[0]`, b1.ein || client?.ein || '');
  // 2b Entity type checkboxes
  const structure = (b1.structure || '').toLowerCase();
  if (structure.includes('partner')) setCheck(`${base}.c1_0_2b[0]`, true);
  else if (structure.includes('corp') && !structure.includes('llc')) setCheck(`${base}.c1_0_2b[1]`, true);
  else if (structure.includes('llc')) setCheck(`${base}.c1_0_2b[3]`, true);
  else if (structure) setCheck(`${base}.c1_0_2b[2]`, true);

  setText(`${base}.p1_16_2c[0]`, b1.date_opened || '');
  setText(`${base}.p1_17_3a[0]`, b1.num_employees ?? '');
  setText(`${base}.p1_18_3b[0]`, money(exp?.gross_payroll));

  // Section 2 — Officers/Partners (limited to taxpayer as 7a)
  setText(`${base}.Line7a_Col1[0].p1_33_7aFullNm[0]`, client?.name || '');
  setText(`${base}.Line7a_Col1[0].p1_36_7aCity[0]`, client?.city || '');
  setText(`${base}.Line7a_Col1[0].p1_37_7aSt[0]`, client?.state || '');
  setText(`${base}.Line7a_Col1[0].p1_38_7aZIP[0]`, client?.zip || '');
  setText(`${base}.p1_39_SSN_7a[0]`, client?.ssn || '');
  setText(`${base}.p1_42_7aowner[0]`, b1.pct_ownership ? `${b1.pct_ownership}%` : '');

  const filledBytes = await pdfDoc.save();
  return filledBytes;
}

// Fills Form 433-A (OIC) — Section 1 (Personal Info) and Section 2
// (Employment) from the client row + Financial Profile. Sections 3-9
// (asset equity tables, OIC offer calculation) left blank for manual entry.
export async function fillForm433AOIC(client, profile) {
  const templateBytes = await fetchTemplate(F433_TEMPLATE_PATHS['433a_oic']);
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const p = profile || {};
  const et1 = p.employment_taxpayer_1 || {};
  const es1 = p.employment_spouse_1 || {};
  const b1 = p.business_1 || {};

  const setText = (fieldName, value) => {
    if (!fieldName) return;
    try {
      const field = form.getTextField(fieldName);
      try { field.acroField.dict.set(PDFName.of('DA'), PDFString.of('/Helv 9 Tf 0 g')); } catch (_) {}
      field.setText(value != null ? String(value) : '');
    } catch (_) {}
  };
  const setCheck = (fieldName, on) => {
    if (!fieldName) return;
    try { const f = form.getCheckBox(fieldName); if (on) f.check(); else f.uncheck(); } catch (_) {}
  };

  const s1 = 'topmostSubform[0].F433-A-OIC_Page1[0].Section1[0]';
  // Split full name -> first/last (best-effort)
  const nameParts = (client?.name || '').trim().split(/\s+/);
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : (client?.name || '');
  const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '';
  setText(`${s1}.Last_Name[0]`, lastName);
  setText(`${s1}.First_Name[0]`, firstName);
  setText(`${s1}.Date_Birth[0]`, p.dob || '');
  // SSN split into 3-2-4
  const ssnDigits = (client?.ssn || '').replace(/\D/g, '');
  if (ssnDigits.length === 9) {
    setText(`${s1}.SSN_3[0]`, ssnDigits.slice(0, 3));
    setText(`${s1}.SSN_2[0]`, ssnDigits.slice(3, 5));
    setText(`${s1}.SSN_4[0]`, ssnDigits.slice(5));
  }

  // Marital status: CB_01[0]=Unmarried, CB_02[0]=Married
  if (p.filing_status) {
    const fs = p.filing_status.toLowerCase();
    if (fs.includes('married')) setCheck(`${s1}.MaritalStatus[0].CB_02[0]`, true);
    else setCheck(`${s1}.MaritalStatus[0].CB_01[0]`, true);
  }

  setText(`${s1}.Home_Address[0]`, [client?.street, [client?.city, client?.state, client?.zip].filter(Boolean).join(', ')].filter(Boolean).join(', '));
  setText(`${s1}.Col1[0].County_Residence[0]`, p.county || '');

  const [pArea, pNum1] = splitPhone(client?.phone);
  setText(`${s1}.Col1[0].primary[0].Primary_Area_Code[0]`, pArea);
  if (pNum1.includes('-')) {
    const [a, b] = pNum1.split('-');
    setText(`${s1}.Col1[0].primary[0].Primary_Phone1[0]`, a);
    setText(`${s1}.Col1[0].primary[0].Primary_Phone2[0]`, b);
  } else {
    setText(`${s1}.Col1[0].primary[0].Primary_Phone1[0]`, pNum1.slice(0, 3));
    setText(`${s1}.Col1[0].primary[0].Primary_Phone2[0]`, pNum1.slice(3));
  }

  // Spouse
  if (client?.spouseName) {
    const spParts = client.spouseName.trim().split(/\s+/);
    const spLast = spParts.length > 1 ? spParts[spParts.length - 1] : client.spouseName;
    const spFirst = spParts.length > 1 ? spParts.slice(0, -1).join(' ') : '';
    setText(`${s1}.Spouse_Last_Name[0]`, spLast);
    setText(`${s1}.Spouse_First_Name[0]`, spFirst);
  }
  // Spouse SSN (3-2-4 split, second widget set [1])
  const spouseSsnDigits = (client?.spouseSsn || '').replace(/\D/g, '');
  if (spouseSsnDigits.length === 9) {
    setText(`${s1}.SSN_3[1]`, spouseSsnDigits.slice(0, 3));
    setText(`${s1}.SSN_2[1]`, spouseSsnDigits.slice(3, 5));
    setText(`${s1}.SSN_4[1]`, spouseSsnDigits.slice(5));
  }

  // Dependents
  let deps = [];
  try {
    deps = client?.dependents
      ? (typeof client.dependents === 'string' ? JSON.parse(client.dependents || '[]') : client.dependents)
      : [];
  } catch (_) { deps = []; }
  deps.slice(0, 4).forEach((d, i) => {
    const row = i + 1;
    setText(`${s1}.Table1[0].Row${row}[0].Name_0${row}[0]`, d.name || '');
    setText(`${s1}.Table1[0].Row${row}[0].Age_0${row}[0]`, d.age || '');
    setText(`${s1}.Table1[0].Row${row}[0].Relationship_0${row}[0]`, d.relationship || '');
  });

  // Section 2 — Employment Information
  const s2 = 'topmostSubform[0].F433-A-OIC_Page1[0].Section2[0]';
  const freqMapOIC = { 'Weekly': 'weekly', 'Bi-weekly': 'biweekly', 'Biweekly': 'biweekly', 'Monthly': 'monthly' };
  if (et1.employer) {
    if (freqMapOIC[et1.pay_frequency]) setCheck(`${s2}.You[0].pay_period[0].${freqMapOIC[et1.pay_frequency]}[0]`, true);
    if (b1.name) setCheck(`${s2}.You[0].BusinessInterest[0].CB_22[0]`, true);
  }
  if (es1.employer) {
    if (freqMapOIC[es1.pay_frequency]) setCheck(`${s2}.Spouse[0].pay_period[0].${freqMapOIC[es1.pay_frequency]}[0]`, true);
  }

  const filledBytes = await pdfDoc.save();
  return filledBytes;
}

// ─── Service Addendum — resolution-services checklist ────────────────────────
// Pulled from the firm's existing paper addendum (the version with checkbox
// items per service) so the rep can select exactly which services apply to
// THIS client's case, based on what came back from the tax investigation,
// rather than a one-size-fits-all bullet list. Shown on both the rep-facing
// checkbox UI in the Addendum modal and the generated document itself
// (every item prints, checked or not — matching the original paper form's
// "selected with an x or check mark" style, which also documents what was
// NOT authorized).
export const RESOLUTION_SERVICES = [
  { key: 'oic', label: 'Offer in Compromise (OIC)',
    legal: `Company will prepare and analyze an Offer in Compromise ("OIC"). Upon completion of the OIC analysis, Company will submit and negotiate the OIC with the Internal Revenue Service ("IRS"). In the event Client's OIC is rejected, Company will review Client's options and assist, at Client's direction, with preparing and submitting an appeal on Client's behalf. No Offer in Compromise shall be submitted unless Company determines its feasibility in advance.` },
  { key: 'ia', label: 'Installment Agreement (IA)',
    legal: `Company will prepare, submit, and negotiate an Installment Agreement ("IA") with the IRS. Company will notify Client of the proposed installment payment prior to Client being committed to such amount. The IRS requires a $105.00 set-up fee for any IA, payable as set forth in the annexed payment schedule. Client understands that establishment of an IA does not stop the accrual of penalties and interest.` },
  { key: 'masterfile', label: 'IRS Master File Request & Analysis',
    legal: `Company will request a copy of Client's IRS master file and conduct an analysis to determine the status of Client's IRS account.` },
  { key: 'lien_sub', label: 'Lien Subordination Request',
    legal: `Company will prepare, submit, and negotiate Client's Lien Subordination Request application for a Certificate of Subordination of Federal Tax Lien.` },
  { key: 'lien_release', label: 'Lien Release Request',
    legal: `Company will prepare, submit, and negotiate Client's Lien Release Request application for a Certificate of Release of Federal Tax Lien.` },
  { key: 'cnc', label: 'Currently Non-Collectible (Status 53)',
    legal: `Company will prepare, submit, and negotiate a Status 53 request to place Client's IRS tax account in Currently Non-Collectible status.` },
  { key: 'levy_release', label: 'Levy Release (IRS or State)',
    legal: `Company will prepare, submit, and negotiate a levy release of an IRS or State tax levy.` },
  { key: 'abatement', label: 'Penalty Abatement Request',
    legal: `Company will prepare, submit, and negotiate an abatement of penalty request.` },
  { key: 'eic', label: 'Earned Income Credit Reinstatement',
    legal: `Company will prepare, submit, and negotiate an earned income credit reinstatement request for reinstatement of a disallowed earned income credit.` },
  { key: 'innocent_spouse', label: 'Innocent Spouse Relief',
    legal: `Company will prepare and negotiate an innocent spouse relief request application for innocent spouse relief.` },
  { key: 'injured_spouse', label: 'Injured Spouse Relief',
    legal: `Company will prepare and negotiate an injured spouse relief request application for injured spouse relief.` },
  { key: 'earnings', label: 'Earnings & Withholding Information Request',
    legal: `Company will request a copy of Client's earnings and withholding information that has been reported to the IRS.` },
];

// ─── Service Addendum — fax-ready / e-sign-ready PDF ─────────────────────────
// Built from scratch via pdf-lib (same approach as generateCcAuthPdf) rather
// than the printBase()/window.print() HTML version in docUtils.js, because
// this one needs to be uploaded and attached to an esigns row for the client
// to actually e-sign — a print window has no file to attach. Multi-page:
// the checklist alone usually pushes this past one page, so everything
// flows through ensureSpace()/newPage() rather than fixed Y coordinates.
const ADDENDUM_MARGIN = 56;
const ADDENDUM_PAGE = [612, 792]; // US Letter

export async function generateAddendumPdf(c = null, opts = {}) {
  const {
    resolutionFee = '', paymentPlan = '', startDate = '', notes = '',
    services = [],
  } = opts;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const margin = ADDENDUM_MARGIN;
  const [pageW, pageH] = ADDENDUM_PAGE;

  let page = pdfDoc.addPage(ADDENDUM_PAGE);
  let y = pageH - 62;

  function newPage() {
    page = pdfDoc.addPage(ADDENDUM_PAGE);
    y = pageH - 62;
  }
  function ensureSpace(needed) {
    if (y - needed < margin + 24) newPage();
  }
  function wrap(text, size, maxWidth, useFont = font) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (useFont.widthOfTextAtSize(test, size) > maxWidth && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  function drawWrapped(text, size, useFont = font, lineGap = 14, indent = 0) {
    const lines = wrap(text, size, pageW - margin * 2 - indent, useFont);
    for (const line of lines) {
      ensureSpace(lineGap);
      page.drawText(line, { x: margin + indent, y, size, font: useFont });
      y -= lineGap;
    }
  }
  function heading(text) {
    ensureSpace(28);
    y -= 4;
    page.drawText(text, { x: margin, y, size: 12.5, font: bold });
    y -= 16;
  }
  function checklistItem(label, legal, checked) {
    const boxSize = 9;
    const lines = wrap(legal, 9.5, pageW - margin * 2 - 22);
    ensureSpace(13 + lines.length * 12 + 6);
    page.drawRectangle({ x: margin, y: y - boxSize + 1, width: boxSize, height: boxSize, borderWidth: 1, borderColor: rgb(0.2, 0.2, 0.2) });
    if (checked) page.drawText('X', { x: margin + 1.2, y: y - boxSize + 1.5, size: 9, font: bold });
    page.drawText(label, { x: margin + 18, y, size: 10.5, font: bold });
    y -= 13;
    for (const line of lines) {
      page.drawText(line, { x: margin + 18, y, size: 9.5, font, color: rgb(0.25, 0.25, 0.25) });
      y -= 12;
    }
    y -= 6;
  }

  // ── Header ──
  page.drawText(fName(), { x: margin, y, size: 16, font: bold });
  y -= 16;
  page.drawText(fFooterLine(), { x: margin, y, size: 8.5, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 22;
  page.drawText('SERVICE ADDENDUM — ADDITIONAL SERVICES AGREEMENT', { x: margin, y, size: 12.5, font: bold });
  y -= 20;

  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  page.drawText(`Date: ${date}`, { x: margin, y, size: 9.5, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 20;

  // ── Client block ──
  const name = c?.name || `${c?.first || ''} ${c?.last || ''}`.trim() || '___________________';
  const phone = c?.phone || '___________________';
  const email = c?.email || '___________________';
  const address = [c?.street, c?.city, c?.state, c?.zip].filter(Boolean).join(', ') || '___________________';
  page.drawText(name, { x: margin, y, size: 12, font: bold });
  y -= 14;
  page.drawText(`${phone}   ·   ${email}`, { x: margin, y, size: 9.5, font });
  y -= 13;
  page.drawText(address, { x: margin, y, size: 9.5, font });
  y -= 20;

  drawWrapped(`This Addendum ("Addendum") supplements the Tax Investigation Service Agreement previously executed between ${fName()} ("Company") and the undersigned client ("Client") and is incorporated therein by reference. The Additional Services below are described in the paragraphs that have been selected with an "X."`, 10.5);
  y -= 6;

  // ── Checklist ──
  heading('1. Additional Services Authorized');
  for (const svc of RESOLUTION_SERVICES) {
    checklistItem(svc.label, svc.legal, services.includes(svc.key));
  }
  if (notes) {
    ensureSpace(28);
    page.drawText('Additional Scope / Work Notes:', { x: margin, y, size: 10, font: bold });
    y -= 13;
    drawWrapped(notes, 10);
    y -= 4;
  }
  drawWrapped(`Additional Services shall not in any event include audit reconsideration representation, collection appeal representation, fraud assertions or defense, future tax return preparation, or any other service not explicitly provided for in one of the checked paragraphs above.`, 9.5, font, 12);
  y -= 8;

  // ── Fee box ──
  heading('2. Resolution Service Fee');
  const feeDisplay = resolutionFee ? `$${Number(resolutionFee).toLocaleString()}` : '$___________';
  const planDisplay = paymentPlan ? `$${Number(paymentPlan).toLocaleString()} /month` : '$___________ /month';
  const startDisp = startDate || '___________';
  ensureSpace(70);
  const boxTop = y;
  const boxH = 62;
  page.drawRectangle({ x: margin, y: boxTop - boxH, width: pageW - margin * 2, height: boxH, borderWidth: 1.4, borderColor: rgb(0.10, 0.50, 0.83) });
  page.drawText(`Resolution Service Fee: ${feeDisplay}`, { x: margin + 12, y: boxTop - 18, size: 13, font: bold, color: rgb(0.10, 0.50, 0.83) });
  page.drawText(`Payment Plan: ${planDisplay} · Starting: ${startDisp}`, { x: margin + 12, y: boxTop - 34, size: 9.5, font, color: rgb(0.3, 0.3, 0.3) });
  page.drawText('Fees for resolution services are separate from and in addition to the investigation fee.', { x: margin + 12, y: boxTop - 47, size: 8.5, font, color: rgb(0.3, 0.3, 0.3) });
  page.drawText('Payments are due on the agreed start date and monthly thereafter until paid in full.', { x: margin + 12, y: boxTop - 58, size: 8.5, font, color: rgb(0.3, 0.3, 0.3) });
  y = boxTop - boxH - 16;

  // ── Conditions / autopay / incorporation ──
  heading('3. Conditions');
  drawWrapped(`Services under this Addendum are contingent upon: (a) Client remaining current on any required tax filings; (b) Client maintaining compliance with any IRS or state payment agreements during representation; (c) timely payment of fees as agreed upon above. Client authorizes automatic withdrawals via the payment method on file in the amounts and at the times set forth above; unless otherwise agreed, Company bills based on time spent and difficulty of services performed.`, 10.5);
  y -= 4;

  heading('4. Incorporation & Entire Agreement');
  drawWrapped(`All terms of the original Tax Investigation Service Agreement remain in full force and effect and are incorporated herein. In the event of conflict between this Addendum and the original Agreement, this Addendum controls.`, 10.5);
  y -= 4;

  heading('5. Right to Cancel');
  drawWrapped(`Client may cancel the transactions set forth in this Addendum at any time prior to midnight of the third (3rd) business day after the date of execution of this Addendum. Any payments made will be returned within three (3) days of Company's receipt of a cancellation notice, prorated at $250/hour for work already performed. To cancel, mail a signed cancellation notice to ${fName()}, ${fAddr()}, before midnight of the third business day after signing.`, 10.5);
  y -= 4;

  heading('6. Client Acknowledgment');
  drawWrapped(`By signing below, Client confirms they have read, understand, and agree to the terms of this Addendum and authorize ${fName()} to proceed with the resolution services checked above. Except as modified by this Addendum, the existing Tax Service Agreement remains unmodified and in full force and effect and is reaffirmed by Client.`, 10.5);

  // ── Signatures — always on their own page so the e-sign stamp position is
  // predictable, with real blank space ABOVE each line (not just a caption)
  // since that's where the typed/drawn signature actually gets stamped later.
  newPage();
  y -= 10;
  const clientLineY = y - 28;
  page.drawLine({ start: { x: margin, y: clientLineY }, end: { x: margin + 260, y: clientLineY }, thickness: 0.8 });
  page.drawText('Client Signature', { x: margin, y: clientLineY - 12, size: 10, font: bold });
  page.drawText('Print Name: ___________________________________', { x: margin, y: clientLineY - 26, size: 9.5, font });
  page.drawText('Date: _______________________', { x: margin, y: clientLineY - 40, size: 9.5, font });

  const coClientLineY = clientLineY - 70;
  page.drawLine({ start: { x: margin, y: coClientLineY }, end: { x: margin + 260, y: coClientLineY }, thickness: 0.8 });
  page.drawText('Co-Client Signature (if applicable)', { x: margin, y: coClientLineY - 12, size: 10, font: bold });
  page.drawText('Print Name: ___________________________________', { x: margin, y: coClientLineY - 26, size: 9.5, font });
  page.drawText('Date: _______________________', { x: margin, y: coClientLineY - 40, size: 9.5, font });

  const repLineY = coClientLineY - 70;
  page.drawLine({ start: { x: margin, y: repLineY }, end: { x: margin + 260, y: repLineY }, thickness: 0.8 });
  page.drawText(`Authorized Representative — ${fName()}`, { x: margin, y: repLineY - 12, size: 10, font: bold });
  page.drawText('Name: ___________________________________', { x: margin, y: repLineY - 26, size: 9.5, font });
  page.drawText('Date: _______________________', { x: margin, y: repLineY - 40, size: 9.5, font });

  // The client's e-sign stamp lands just above the Client Signature line —
  // SIGNATURE_POSITIONS['addendum'] uses page:'last' since this document's
  // total page count varies with how much content the checklist generates.
  return pdfDoc.save();
}

// ─── Financial Intake — submitted-answers summary PDF ────────────────────────
// Snapshots a submitted financial_intake_responses row into a readable PDF,
// generated automatically at lead-to-client conversion and saved into the
// new client's Documents > Financial Statements folder. Same flowing
// multi-page approach as generateAddendumPdf — this can run long since the
// intake covers income, assets, debts, and expenses in full.
function fmtIntakeVal(v) {
  if (v === undefined || v === null || v === '') return null;
  return String(v);
}

export async function generateFinancialIntakePdf(clientName, answers = {}, submittedAt = null) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const margin = 56;
  const [pageW, pageH] = [612, 792];

  let page = pdfDoc.addPage([pageW, pageH]);
  let y = pageH - 62;

  function newPage() {
    page = pdfDoc.addPage([pageW, pageH]);
    y = pageH - 62;
  }
  function ensureSpace(needed) {
    if (y - needed < margin + 24) newPage();
  }
  function wrap(text, size, maxWidth, useFont = font) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (useFont.widthOfTextAtSize(test, size) > maxWidth && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  function row(label, value) {
    const labelLines = wrap(label, 9.5, 280);
    const valueLines = wrap(value, 9.5, pageW - margin * 2 - 300, bold);
    const lineCount = Math.max(labelLines.length, valueLines.length);
    ensureSpace(lineCount * 13 + 4);
    labelLines.forEach((l, i) => page.drawText(l, { x: margin, y: y - i * 13, size: 9.5, font, color: rgb(0.35, 0.35, 0.35) }));
    valueLines.forEach((l, i) => page.drawText(l, { x: margin + 300, y: y - i * 13, size: 9.5, font: bold }));
    y -= lineCount * 13 + 4;
  }
  function sectionTitle(text) {
    ensureSpace(26);
    y -= 6;
    page.drawText(text.toUpperCase(), { x: margin, y, size: 10.5, font: bold, color: rgb(0.06, 0.4, 0.66) });
    y -= 4;
    page.drawLine({ start: { x: margin, y: y - 2 }, end: { x: pageW - margin, y: y - 2 }, thickness: 0.6, color: rgb(0.85, 0.85, 0.85) });
    y -= 14;
  }

  page.drawText(fName(), { x: margin, y, size: 16, font: bold });
  y -= 16;
  page.drawText(fFooterLine(), { x: margin, y, size: 8.5, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 22;
  page.drawText('FINANCIAL INTAKE — SUBMITTED SUMMARY', { x: margin, y, size: 12.5, font: bold });
  y -= 18;
  page.drawText(clientName || 'Client', { x: margin, y, size: 12, font: bold });
  y -= 14;
  const subDate = submittedAt ? new Date(submittedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—';
  page.drawText(`Submitted: ${subDate}`, { x: margin, y, size: 9.5, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 22;

  for (const step of FINANCIAL_INTAKE_STEPS) {
    if (step.id === 'intro' || step.id === 'done') continue;
    const visibleQuestions = step.questions.filter(q => q.type !== 'info' && intakeShouldShow(q, answers));
    const hasAnyAnswer = visibleQuestions.some(q => {
      if (q.type === 'entries') return (answers[q.id] || []).length > 0;
      return fmtIntakeVal(answers[q.id]) !== null;
    });
    if (!hasAnyAnswer) continue;

    sectionTitle(step.title);
    for (const q of visibleQuestions) {
      if (q.type === 'entries') {
        const entries = answers[q.id] || [];
        if (!entries.length) continue;
        ensureSpace(16);
        page.drawText(q.label, { x: margin, y, size: 9.5, font, color: rgb(0.35, 0.35, 0.35) });
        y -= 13;
        entries.forEach((entry, i) => {
          ensureSpace(14);
          page.drawText(`#${i + 1}`, { x: margin, y, size: 9, font: bold, color: rgb(0.5, 0.5, 0.5) });
          y -= 12;
          for (const f of q.entryFields) {
            const v = fmtIntakeVal(entry[f.id]);
            if (v === null) continue;
            row('   ' + f.label, v);
          }
          y -= 4;
        });
        continue;
      }
      const v = fmtIntakeVal(answers[q.id]);
      if (v === null) continue;
      row(q.label, v);
    }
    y -= 6;
  }

  return pdfDoc.save();
}

// ─── STATE POA — FL DR-835 DIRECT FILL ────────────────────────────────────────
// Overlays client + firm data directly onto the FL DR-835 PDF at precise
// coordinate positions. No cover page — data goes right on the form fields.
// Page dimensions: 612 x 792 (US Letter). pdf-lib y=0 is bottom of page.

export async function generateStatePOACover(client) {
  // Legacy shim — returns empty bytes; generateStatePOAWithCover handles everything now
  const { PDFDocument } = await import('pdf-lib')
  return await (await PDFDocument.create()).save()
}

// `party` — 'personal' fills the human taxpayer, 'business' fills the entity.
// An Individual & Biz lead needs BOTH, filed as two separate state POAs; the
// state authorizes one taxpayer per form and the SSN/FEIN line differs.
export async function generateStatePOAWithCover(client, poaPdfBytes, party = 'personal') {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')

  const doc  = await PDFDocument.load(poaPdfBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)

  // ── Client data ──
  const isBiz        = party === 'business'
  const name         = isBiz ? (client?.business_name || client?.name || '') : (client?.name || '')
  const street       = client?.street  || client?.address || ''
  const city         = client?.city    || ''
  const state        = client?.state   || ''
  const zip          = client?.zip     || ''
  const phone        = client?.phone   || ''
  // Business POA is keyed to the FEIN, personal to the SSN — and states reject
  // the filing if the identifier is masked, so this prints in full (unlike the
  // federal forms, where only the last four are shown).
  const fmtSsn = v => {
    const d = String(v || '').replace(/\D/g,'')
    return d.length === 9 ? `${d.slice(0,3)}-${d.slice(3,5)}-${d.slice(5)}` : String(v || '')
  }
  const ssn          = isBiz
    ? (client?.ein || '')
    : (client?.ssn ? fmtSsn(client.ssn) : (client?.ein || ''))
  const cityStateZip = [city, state ? `${state} ${zip}` : zip].filter(Boolean).join(', ')
  const black        = rgb(0, 0, 0)
  const sz           = 9
  // Contact person on a business POA is the human signing for the entity.
  const contact      = isBiz ? (client?.name || name) : name

  // ── PAGE 1 — Section 1: Taxpayer Information ──
  // Coordinates derived from exact fitz text search on FL DR-835 (612×792 US Letter)
  const p1 = doc.getPage(0)
  p1.drawText(name,         { x: 40,  y: 642, size: sz, font, color: black })
  p1.drawText(street,       { x: 40,  y: 631, size: sz, font, color: black })
  p1.drawText(cityStateZip, { x: 40,  y: 620, size: sz, font, color: black })
  p1.drawText(ssn,          { x: 291, y: 642, size: sz, font, color: black })
  // Contact person cell runs x 288-420. Long names used to start at x=340 and
  // spill under the Telephone box, so start at the cell edge and step the size
  // down until it fits.
  let contactSz = sz
  while (contactSz > 6 && font.widthOfTextAtSize(contact, contactSz) > 126) contactSz -= 0.5
  p1.drawText(contact,      { x: 292, y: 611, size: contactSz, font, color: black }) // Contact person
  p1.drawText(phone,        { x: 478, y: 604, size: sz, font, color: black }) // Telephone (Section 1 right col)

  // Section 2 is pre-printed on this FL DR-835 PDF template with firm info — skip

  // ── PAGE 2 — Taxpayer Name & ID row + Section 8 Signature ──
  const p2 = doc.getPage(1)
  p2.drawText(name,  { x: 103, y: 699, size: sz, font, color: black }) // Taxpayer Name(s):
  p2.drawText(ssn,   { x: 382, y: 699, size: sz, font, color: black }) // Federal Identification Number:
  // Measured off the DR-835 itself: the signature/date rule sits at y=434.3-440.3
  // and the Print name rule at y=407.9-413.9 (pdf-lib origin = bottom-left).
  // Both values used to sit BELOW their rule, so the text collided with the
  // "Date" / "Print name" captions instead of resting on the line.
  // Taxpayer date is intentionally NOT drawn here — stampSignature writes it at
  // signing time, so an unsigned copy is never pre-dated.
  // Declaration of Representative date is written at SIGNING time by
  // stampSignature, so an unsigned copy carries no date at all.
  p2.drawText(name,  { x: 40,  y: 411, size: sz, font, color: black }) // Print name (first signature block)

  return await doc.save()
}


// ── Certificate of Completion page ────────────────────────────────────────────
// Generates a standalone PDF page that can be appended to any signed document.
// Used internally (appended to firm's copy) and as the last page of the
// client's copy with a teardrop timestamp stamp.
export async function buildCertificatePage({ docType, clientName, signedBy, ip, signedAt, logoUrl }) {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')
  const doc  = await PDFDocument.create()
  const page = doc.addPage([612, 792]) // US Letter
  const { width, height } = page.getSize()
  const font     = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const fontMono = await doc.embedFont(StandardFonts.Courier)

  const green  = rgb(0.13, 0.74, 0.38)
  const dark   = rgb(0.04, 0.09, 0.19)
  const gray   = rgb(0.38, 0.45, 0.55)
  const white  = rgb(1, 1, 1)
  const border = rgb(0.13, 0.74, 0.38)

  // Background
  page.drawRectangle({ x:0, y:0, width, height, color: rgb(0.05, 0.09, 0.15) })

  // Header bar
  page.drawRectangle({ x:0, y:height-80, width, height:80, color: rgb(0.07, 0.17, 0.35) })

  // Header text
  page.drawText('TAX CASE REVIEW', {
    x: 40, y: height-36, size: 10, font: fontBold, color: rgb(0.58, 0.76, 0.98),
    characterSpacing: 2,
  })
  page.drawText('CERTIFICATE OF COMPLETION', {
    x: 40, y: height-58, size: 18, font: fontBold, color: white,
  })

  // Green checkmark circle
  const cx = width - 60, cy = height - 42
  page.drawCircle({ x: cx, y: cy, size: 24, color: green })
  page.drawText('✓', { x: cx - 7, y: cy - 7, size: 16, font: fontBold, color: white })

  // Document info box
  const boxY = height - 200
  page.drawRectangle({ x:40, y:boxY, width:width-80, height:120, color: rgb(0.07, 0.13, 0.25), borderColor: border, borderWidth: 1 })

  const infoLines = [
    ['DOCUMENT', docType || 'Agreement'],
    ['CLIENT', clientName || '—'],
    ['SIGNED BY', signedBy || '—'],
    ['IP ADDRESS', ip || 'Recorded'],
    ['TIMESTAMP', signedAt ? new Date(signedAt).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true }) + ' ET' : '—'],
  ]
  infoLines.forEach(([label, value], i) => {
    const y = boxY + 95 - i * 20
    page.drawText(label + ':', { x:54, y, size: 8, font: fontBold, color: rgb(0.58, 0.76, 0.98), characterSpacing: 1 })
    page.drawText(value, { x:160, y, size: 9, font: fontMono, color: white })
  })

  // Legal text
  const legalText = 'This certificate confirms that the above-named individual electronically signed the referenced document. ' +
    `The electronic signature was captured via ${fName()}'s secure signing portal and has the same legal effect ` +
    'as a handwritten signature under the Electronic Signatures in Global and National Commerce Act (ESIGN) and ' +
    'the Uniform Electronic Transactions Act (UETA).'

  const words = legalText.split(' ')
  let line = '', lineY = boxY - 40, maxW = width - 80
  for (const word of words) {
    const test = line ? line + ' ' + word : word
    const tw = font.widthOfTextAtSize(test, 9)
    if (tw > maxW) {
      page.drawText(line, { x:40, y:lineY, size:9, font, color:gray })
      line = word; lineY -= 14
    } else { line = test }
  }
  if (line) page.drawText(line, { x:40, y:lineY, size:9, font, color:gray })

  // Footer
  page.drawRectangle({ x:0, y:0, width, height:40, color: rgb(0.07, 0.17, 0.35) })
  page.drawText(`${fName()} · ${fFooterLine()}`, {
    x:40, y:14, size:7.5, font, color:gray,
  })

  return await doc.save()
}

// ── Teardrop timestamp stamp ──────────────────────────────────────────────────
// Adds a small teardrop/badge stamp in the bottom-right corner of the LAST page
// of a PDF. Shows on the client's signed copy only.
export async function addTearDropStamp(pdfBytes, { signedBy, signedAt, ip, envelopeId }) {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib')
  const doc   = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
  const pages = doc.getPages()
  const page  = pages[pages.length - 1] // stamp on LAST page only
  const font  = await doc.embedFont(StandardFonts.Helvetica)
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold)
  const { width } = page.getSize()

  const x = width - 190, y = 14
  const bw = 177, bh = 64

  // Badge background
  page.drawRectangle({ x, y, width:bw, height:bh, color:rgb(0.04,0.09,0.19), borderColor:rgb(0.13,0.74,0.38), borderWidth:1.5, opacity:0.93 })

  // Teardrop shape (triangle pointing down-left)
  page.drawRectangle({ x:x-8, y:y+18, width:12, height:12, color:rgb(0.13,0.74,0.38) })

  // Badge text
  const ts = signedAt ? new Date(signedAt).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}) : ''
  page.drawText('✓ E-SIGNATURE COMPLETION', { x:x+6, y:y+51, size:6.5, font:fontB, color:rgb(0.58,0.76,0.98), characterSpacing:0.45 })
  page.drawText('By: ' + (signedBy||'').slice(0,30), { x:x+6, y:y+39, size:7.3, font:fontB, color:rgb(1,1,1) })
  page.drawText(ts, { x:x+6, y:y+28, size:6.8, font, color:rgb(0.7,0.85,1) })
  page.drawText('IP: ' + (ip||'').slice(0,25), { x:x+6, y:y+17, size:6.2, font, color:rgb(0.4,0.55,0.7) })
  if (envelopeId) page.drawText('Envelope: ' + String(envelopeId).slice(0,36), { x:x+6, y:y+6, size:5.8, font, color:rgb(0.4,0.55,0.7), maxWidth:bw-12 })

  return await doc.save()
}

// ── Append pages from one PDF to another ─────────────────────────────────────
export async function appendPdfPages(baseBytes, appendBytes) {
  const { PDFDocument } = await import('pdf-lib')
  const base   = await PDFDocument.load(baseBytes, { ignoreEncryption: true })
  const extra  = await PDFDocument.load(appendBytes, { ignoreEncryption: true })
  const copied = await base.copyPages(extra, extra.getPageIndices())
  copied.forEach(p => base.addPage(p))
  return await base.save()
}

// ─── Form 656-L (Offer in Compromise — Doubt as to Liability) ────────────────

F433_TEMPLATE_PATHS['656l'] = '656L_Blank.pdf';
F433_LABELS['656l'] = 'Form 656-L — Offer in Compromise (Doubt as to Liability)';

export async function fillForm656L(client) {
  const templateBytes = await fetchTemplate(F433_TEMPLATE_PATHS['656l']);
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();

  const setText = (fieldName, value) => {
    try {
      const field = form.getTextField(fieldName);
      try { field.acroField.dict.set(PDFName.of('DA'), PDFString.of('/Helv 9 Tf 0 g')); } catch (_) {}
      field.setText(value != null ? String(value) : '');
    } catch (_) {}
  };

  // Split SSN: 123-45-6789 → ['123','45','6789']
  const ssnParts = (client?.ssn || '').replace(/\D/g, '');
  const ssn1 = ssnParts.slice(0, 3);
  const ssn2 = ssnParts.slice(3, 5);
  const ssn3 = ssnParts.slice(5);

  // Split phone: (561) 420-1234 → area=561, p1=420, p2=1234
  const phoneDigits = (client?.phone || '').replace(/\D/g, '');
  const pArea = phoneDigits.slice(0, 3);
  const p1    = phoneDigits.slice(3, 6);
  const p2    = phoneDigits.slice(6);

  const address = [client?.street, [client?.city, client?.state, client?.zip].filter(Boolean).join(', ')].filter(Boolean).join('\n');

  const p6 = 'topmostSubform[0].Page_6[0]';

  // Section 1 — Individual
  setText(`${p6}.Your_First_Middle_Last_Name[0]`, client?.name || '');
  setText(`${p6}.YourSSN[0].Your_SSN_1[0]`, ssn1);
  setText(`${p6}.YourSSN[0].Your_SSN_2[0]`, ssn2);
  setText(`${p6}.YourSSN[0].Your_SSN_3[0]`, ssn3);
  setText(`${p6}.Spouse_First_Middle_Last_Name[0]`, client?.spouseName || '');
  const spouseSsnParts = (client?.spouseSsn || '').replace(/\D/g, '');
  setText(`${p6}.SpouseSSN[0].Spouse_SSN_1[0]`, spouseSsnParts.slice(0, 3));
  setText(`${p6}.SpouseSSN[0].Spouse_SSN_2[0]`, spouseSsnParts.slice(3, 5));
  setText(`${p6}.SpouseSSN[0].Spouse_SSN_3[0]`, spouseSsnParts.slice(5));
  setText(`${p6}.Your_Home_Address[0]`, address);
  setText(`${p6}.Phone[0].Area_Code[0]`, pArea);
  setText(`${p6}.Phone[0].Phone1[0]`, p1);
  setText(`${p6}.Phone[0].Phone2[0]`, p2);

  // Section 7 — Preparer. Resolves per signed-in tenant.
  const p8 = 'topmostSubform[0].page_8[0]';
  setText(`${p8}.Address[0]`, `${fName()} · ${fAddr()}`);
  const firmDigits = String(fPhone()).replace(/\D/g, '');
  if (firmDigits.length >= 10) {
    setText(`${p8}.Phone[1].Area_Code[0]`, firmDigits.slice(0, 3));
    setText(`${p8}.Phone[1].Phone1[0]`, firmDigits.slice(3, 6));
    setText(`${p8}.Phone[1].Phone2[0]`, firmDigits.slice(6, 10));
  }

  return await pdfDoc.save();
}
