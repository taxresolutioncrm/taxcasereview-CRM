// ─── Shared document utilities — Tax Case Review CRM ─────────────────────────
import { getPackageFormTypes, FORM_LABELS, FORM_USES_EIN, fillForm, generateCcAuthPdf, RESOLUTION_SERVICES, generateAddendumPdf, generateStatePOAWithCover, resolveStateFormUrl } from './irsFormUtils'
import { FIRM } from './firmBranding'

const LOGO_URL = ''  // replaced by FIRM.logoUrl

const TCR_TENANT = '61a89aef-0e7e-4ea2-b222-44ab2024655a'
const firmFax = () => FIRM.fax || ((!FIRM.tenantId || FIRM.tenantId === TCR_TENANT) ? '(561) 420-6999' : '')

// Legal/body text renders the SIGNED-IN tenant's own firm, so a demo or
// prospect tenant never sees Tax Case Review inside an agreement.
// The contact email comes from the tenant's own settings row, which is the
// address that actually receives mail — contracts use it for cancellation
// notices and withdrawal of e-communication consent, so a derived-but-wrong
// address would send legally operative notices into a void. Falls back to a
// name-derived .com only when a tenant hasn't set one.
const firmName  = () => FIRM.name || 'Tax Case Review'
const firmEmail = () =>
  (FIRM.email || '').trim() ||
  'info@' + firmName().toLowerCase().replace(/[^a-z0-9]+/g, '') + '.com'

function printHeader(title, phone = FIRM.phone) {
  return `
    <div style="text-align:center;margin-bottom:28px;padding-bottom:18px;border-bottom:3px solid #1A7FD4">
      <img src="${FIRM.logoUrl}" style="height:52px;margin-bottom:10px;display:block;margin-left:auto;margin-right:auto" onerror="this.style.display='none'"/>
      <div style="font-size:22px;font-weight:800;color:#1A7FD4;letter-spacing:-.3px">${FIRM.name}</div>
      <div style="font-size:11px;color:#666;margin-top:3px">${FIRM.address} &nbsp;·&nbsp; ${FIRM.email} &nbsp;·&nbsp; ${phone} &nbsp;·&nbsp; Fax ${firmFax()}</div>
      <div style="font-size:15px;font-weight:700;margin-top:14px;color:#111;text-transform:uppercase;letter-spacing:.5px">${title}</div>
    </div>`
}

function footer(phone = FIRM.phone) {
  return `
    <div style="margin-top:48px;padding-top:16px;border-top:1px solid #ddd;text-align:center;font-size:10px;color:#999;line-height:1.8">
      ${FIRM.name} &nbsp;·&nbsp; ${FIRM.address} &nbsp;·&nbsp; ${FIRM.email} &nbsp;·&nbsp; ${phone} &nbsp;·&nbsp; Fax ${firmFax()}<br/>
      <em>${FIRM.name} is a tax resolution consulting firm and is not a law firm. No attorney-client relationship is created by this agreement.</em>
    </div>`
}

function sigBlock(label1 = 'Client Signature', label2 = 'Authorized Representative') {
  return `
    <div style="margin-top:48px;padding-top:0">
      <div style="display:flex;gap:48px;">
        <div style="flex:1">
          <div style="border-top:1.5px solid #333;padding-top:8px;margin-top:0">
            <div style="font-size:12px;font-weight:700;color:#222;margin-bottom:4px">${label1}</div>
            <div style="font-size:11px;color:#555">Print Name: ___________________________________</div>
            <div style="font-size:11px;color:#555;margin-top:6px">Date: _______________________</div>
          </div>
        </div>
        <div style="flex:1">
          <div style="border-top:1.5px solid #333;padding-top:8px;margin-top:0">
            <div style="font-size:12px;font-weight:700;color:#222;margin-bottom:4px">${label2} — ${FIRM.name}</div>
            <div style="font-size:11px;color:#555">Name: ___________________________________</div>
            <div style="font-size:11px;color:#555;margin-top:6px">Date: _______________________</div>
          </div>
        </div>
      </div>
    </div>`
}

export function printBase(title, body, opts = {}) {
  const { phone = FIRM.phone } = opts
  const w = window.open('', '_blank', 'width=880,height=1100')
  w.document.write(`<!DOCTYPE html><html><head>
    <title>${title} — ${FIRM.name}</title>
    <style>
      *{box-sizing:border-box}
      body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:12.5px;color:#111;padding:48px 56px;max-width:820px;margin:0 auto;line-height:1.6}
      h3{color:#1A7FD4;margin:22px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid #e0eef9;padding-bottom:4px}
      p{margin:8px 0;line-height:1.7}
      ul{margin:8px 0 14px;padding-left:22px;line-height:1.9}
      li{margin-bottom:2px}
      .fee-box{border:2px solid #1A7FD4;border-radius:8px;padding:16px 20px;margin:16px 0;background:#f0f7ff}
      .fee-box .fee-main{font-size:16px;font-weight:800;color:#1A7FD4;margin-bottom:6px}
      .fee-box .fee-sub{font-size:11px;color:#555;line-height:1.7}
      .client-box{border:1px solid #c8daea;border-radius:8px;padding:14px 18px;margin:0 0 24px;background:#f5f9fd}
      .client-box .cb-name{font-size:14px;font-weight:800;color:#111;margin-bottom:6px}
      .client-box .cb-row{font-size:11.5px;color:#444;margin-top:3px}
      .notice{background:#fffbea;border:1px solid #f0c040;border-radius:6px;padding:10px 14px;font-size:11px;color:#7a5c00;margin:14px 0}
      .page-break{page-break-before:always;break-before:page}
      @media print{
        body{padding:24px 32px}
        button{display:none}
      }
    </style>
  </head><body>
    ${printHeader(title, phone)}
    ${body}
    ${footer(phone)}
  </body></html>`)
  w.document.close()
  setTimeout(() => w.print(), 500)
}

// ─── Client info block ────────────────────────────────────────────────────────
function clientBlock(c) {
  if (!c) return ''
  const name    = c.name || `${c.first||''} ${c.last||''}`.trim() || '___________________'
  const phone   = c.phone || '___________________'
  const email   = c.email || '___________________'
  const address = [c.street, c.city, c.state, c.zip].filter(Boolean).join(', ') || '___________________'
  const balance = c.irsBalance ? (isNaN(Number(c.irsBalance)) ? c.irsBalance : '$'+Number(c.irsBalance).toLocaleString()) : '___________________'
  const fee     = c.taxFee ? `$${Number(c.taxFee).toLocaleString()}` : (c.investigationFee ? `$${c.investigationFee}` : '$___________')
  const years   = (() => { try { const p = JSON.parse(c.taxYears); return Array.isArray(p) ? p.join(', ') : (c.taxYears || '___________________') } catch { return c.taxYears || '___________________' } })()
  const issue   = c.issueType || '___________________'
  return `
    <div class="client-box">
      <div class="cb-name">${name}</div>
      <div class="cb-row">📞 ${phone} &nbsp;&nbsp; ✉️ ${email}</div>
      <div class="cb-row">📍 ${address}</div>
      <div class="cb-row" style="margin-top:8px;padding-top:8px;border-top:1px solid #d0dde8">
        <b>Est. IRS Balance:</b> ${balance} &nbsp;&nbsp;
        <b>Issue:</b> ${issue} &nbsp;&nbsp;
        <b>Tax Years:</b> ${years} &nbsp;&nbsp;
        <b>Investigation Fee:</b> ${fee}
      </div>
    </div>`
}

// ─── Service Agreement ────────────────────────────────────────────────────────
export function generateServiceAgreement(c = null) {
  const fee  = c?.taxFee ? `$${Number(c.taxFee).toLocaleString()}` : (c?.investigationFee ? `$${c.investigationFee}` : '$___________')
  const date = new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})
  printBase('Tax Service Agreement', `
    <p style="text-align:right;font-size:11px;color:#666;margin-bottom:4px">Date: ${date}</p>
    ${clientBlock(c)}

    <p>This Tax Service Agreement (as the same may be amended from time to time by any Addendum, the <b>"Agreement"</b>), dated as of ${date}, by and between <b>${firmName()}</b>, with its principal offices located at ${FIRM.address} (together with any successors or assigns, <b>"Company"</b>) and the undersigned Client.</p>

    <h3>1. Company Obligations</h3>
    <ul>
      <li>Company will contact the Internal Revenue Service ("IRS") on behalf of Client, to determine the total amount of Client's current tax liability accrued, if any</li>
      <li>Company will obtain a copy of Client's master file from the IRS if necessary</li>
      <li>Company will identify any unfiled tax returns by Client</li>
      <li>Company will identify any outstanding tax liens filed against Client</li>
      <li>Company will identify the collection statute expiration date</li>
      <li>Company will conduct a consultation with Client to determine Client's financial status and ability to pay unpaid taxes</li>
      <li>Company will analyze the information obtained from the IRS in comparison to Client's financial status and ability to pay unpaid taxes, and present Client with a proposed strategy for resolution. Once the analysis is complete, should Client enter into a separate engagement with Company as Client's tax representative, Company will immediately notify the IRS of Client's intentions in order to help prevent any and all collection action(s)</li>
      <li>Company will perform those additional services for additional fees described in any Addendum signed, or electronically transmitted to Company, by Client and which is in form and substance acceptable to Company</li>
    </ul>

    <h3>2. Client Obligations and Authority</h3>
    <ul>
      <li>Client authorizes Company to obtain necessary tax information concerning Client from the IRS and/or state taxing authority</li>
      <li>Client agrees to provide all necessary information and any requested financial statements to Company promptly</li>
      <li>Client agrees to respond promptly to all Company requests for information or documentation</li>
      <li>Client will promptly notify Company of any changes in Client's financial circumstances, marital status, contact information, or any other material information</li>
      <li>Client agrees to make timely payments for services rendered by Company and to reimburse Company for costs as agreed upon in this Agreement</li>
      <li>Client agrees to indemnify and hold harmless Company from any and all liability, claims, actions, demands, proceedings, or damages incurred as a result of any fraudulence, negligence, or acts or omission of Client or breach of Client's obligations under this Agreement</li>
    </ul>

    <h3>3. Not Included in Agreement</h3>
    <p>Client expressly acknowledges that Company is not a law firm and does not provide legal, tax law, or investment advice. Unless otherwise agreed upon by Client in an Addendum, Client has not retained Company for any services other than those identified above or in an Addendum. Company's services do not include representation in connection with any litigation in tax, federal, or state court.</p>

    <h3>4. Client Acknowledgments</h3>
    <ul>
      <li>Unless otherwise agreed upon in an Addendum, Company will not prepare, submit, and negotiate with the IRS a Federal Offer in Compromise, an Installment Agreement, or any other negotiation services</li>
      <li>Company will not prevent any collection action by the IRS</li>
      <li>Company does not provide legal advice; legal advice or representation must be provided by an attorney licensed by Client's state of residence</li>
      <li>At all times, Client's IRS obligations remain those of Client. Company will not assume or pay any IRS obligation of Client</li>
      <li>Company makes no warranties or representations as to the time to perform or complete services, or to the outcome of any claim or controversy</li>
      <li>All fees paid to Company are for the limited services identified herein and do not include any amount required to settle any claim by the IRS or state taxing authority</li>
    </ul>

    <h3>5. Payment of Fees</h3>
    <div class="fee-box">
      <div class="fee-main">Tax Investigation Fee: ${fee}</div>
      <div class="fee-sub">
        Client agrees to pay the fee above for the limited services rendered by Company as described in this Agreement. Additional fees described in any Addendum shall be payable as set forth in such Addendum.<br/>
        A returned check fee of $25.00 will be charged for each bounced check or draft returned for insufficient funds.
      </div>
    </div>

    <h3>6. Additional Obligations of Company</h3>
    <p>Company will deal with Client's personal information only as contemplated in the Privacy Policy below. Company will keep Client reasonably informed of progress in the rendition of services hereunder, and will respond promptly to Client's reasonable inquiries and communications.</p>

    <h3>7. Termination</h3>
    <p>Either party may terminate this Agreement at any time by written notice, effective upon actual receipt or five days after transmittal. Upon termination, all service fees shall be apportioned or prorated on a reasonable basis determined by Company.</p>

    <h3>8. Arbitration of Disputes — No Class Actions</h3>
    <p>Any controversy, claim, or dispute arising out of or relating to this Agreement shall be determined by binding arbitration in Palm Beach County, Florida, or in the county in which Client resides, administered by a nationally recognized arbitration service mutually agreed upon by the parties. The arbitrator's award shall be final. Both parties waive the right to bring claims as a plaintiff or class member in any class or representative proceeding. The parties shall share arbitration costs, including attorney's fees, equally; if Client's share exceeds $1,000, Company will pay Client's reasonable share of costs in excess of that amount.</p>

    <h3>9. No Trial By Jury</h3>
    <p>Company and Client each waive any right to trial by jury in any lawsuit or other similar proceeding arising from this Agreement.</p>

    <h3>10. Limitation of Obligations</h3>
    <p>Company's obligations hereunder in the event of any breach shall in no event exceed 200% of the fees actually collected by Company. In no event shall Company be liable for penalties, interest charges, or consequential damages of any amount whatsoever.</p>

    <h3>11. Governing Law &amp; Entire Agreement</h3>
    <p>This Agreement is made and services are performed in the State of Florida and is governed by Florida law. This Agreement and any Addendums constitute the full and complete agreement and supersede any prior agreements, whether written or oral. No amendment, change, or modification other than an Addendum shall be valid unless in writing and signed by all parties.</p>

    <h3>12. Electronic Communication Disclosures</h3>
    <p>Client consents to receive, in electronic format, all information, copies of agreements, and correspondence from Company, with the same legal effect as written and signed paper communications. Consent may be withdrawn at any time by emailing ${firmEmail()} or writing to ${firmName()}, ${FIRM.address}.</p>

    <div class="page-break"></div>
    <h3>13. Right of Cancellation</h3>
    <p>Client may cancel this Agreement at any time prior to midnight of the third (3rd) business day after the date of execution, without penalty or obligation. If Client cancels, any payments made will be returned within three (3) days following receipt of Client's cancellation notice, prorated at a $250 hourly rate for any work product services already performed. To cancel, Client must mail or deliver a signed and dated cancellation notice to ${firmName()}, ${FIRM.address}, not later than midnight of the third business day after execution of this Agreement. See the attached Notice of Right of Cancellation for further detail.</p>

    <div class="notice">
      <b>Privacy Policy:</b> ${firmName()} uses and shares your information only to perform our obligations under this Agreement and related purposes, or as permitted or required by law. Calls may be recorded or monitored for quality purposes. Contact ${firmEmail()} with any privacy concerns.
    </div>

    ${sigBlock('Client Signature', 'Authorized Representative')}
  `)
}

// ─── Notice of Right of Cancellation — blank, standalone printable form ───────
export function generateCancellationNotice(c = null) {
  printBase('Notice of Right of Cancellation', `
    ${clientBlock(c)}
    <p>You may cancel the Tax Service Agreement, without any penalty or obligation, within three (3) business days after the date you sign it.</p>
    <p>If you cancel, any payments made by you will be returned within three (3) days following receipt of your cancellation notice. In the event of a cancellation, payments made will be prorated at a $250 hourly rate for all work product services already performed by ${firmName()}.</p>
    <p>You may also terminate the Tax Service Agreement at any later time as provided therein, but we are not required to refund fees you have paid us except as set forth in the Agreement.</p>
    <p>To cancel, mail or deliver a signed and dated copy of this notice to <b>${firmName()}, ${FIRM.address}</b>, not later than midnight of the third business day after the execution of the Tax Service Agreement.</p>

    <h3 style="margin-top:32px">I Hereby Cancel the Tax Service Agreement</h3>
    <div style="margin-top:24px">
      <div style="border-bottom:1.5px solid #333;height:28px;margin-bottom:6px"></div>
      <div style="font-size:11px;color:#555">Full Client Name</div>
    </div>
    <div style="display:flex;gap:48px;margin-top:28px">
      <div style="flex:1">
        <div style="border-bottom:1.5px solid #333;height:28px;margin-bottom:6px"></div>
        <div style="font-size:11px;color:#555">Signature</div>
      </div>
      <div style="flex:1">
        <div style="border-bottom:1.5px solid #333;height:28px;margin-bottom:6px"></div>
        <div style="font-size:11px;color:#555">Date</div>
      </div>
    </div>
    <p style="margin-top:24px;font-size:11px;color:#888"><em>This notice is provided for your protection and should be left blank unless you decide to cancel.</em></p>
  `)
}

// ─── Credit Card Authorization Form — blank, standalone printable form ───────
// Mirrors the original Freedom Tax Calling form, rebranded. Intentionally a
// blank PRINTABLE form (client fills it by hand and returns it) rather than
// a digital card-capture field — collecting raw card numbers through a web
// form/e-sign page and storing them in Supabase would be a PCI-DSS problem.
// Actual digital payment collection should go through Stripe/Square, not this.
export function generateCreditCardAuthForm(c = null) {
  const fee = c?.taxFee ? `$${Number(c.taxFee).toLocaleString()}` : (c?.investigationFee ? `$${c.investigationFee}` : '$___________')
  printBase('Credit Card Authorization Form', `
    ${clientBlock(c)}
    <p>Complete the following form to authorize <b>${firmName()}</b> to charge fees to the credit or debit card listed below. If you need assistance completing this form, please contact a ${firmName()} representative at ${FIRM.phone}.</p>

    <h3>Cardholder Information</h3>
    <p>Client Name(s): <span style="display:inline-block;min-width:340px;border-bottom:1px solid #333">&nbsp;${c?.name ? `<b>${c.name}</b>` : ''}</span></p>
    <p>Client Address: <span style="display:inline-block;min-width:320px;border-bottom:1px solid #333">&nbsp;</span></p>
    <p>City: <span style="display:inline-block;min-width:160px;border-bottom:1px solid #333">&nbsp;</span>&nbsp;&nbsp; State: <span style="display:inline-block;min-width:60px;border-bottom:1px solid #333">&nbsp;</span>&nbsp;&nbsp; Zip: <span style="display:inline-block;min-width:90px;border-bottom:1px solid #333">&nbsp;</span></p>
    <p>Name on Account: <span style="display:inline-block;min-width:300px;border-bottom:1px solid #333">&nbsp;</span></p>

    <h3>Payment Details</h3>
    <div class="fee-box">
      <div class="fee-main">Payment Amount: ${fee}</div>
      <div class="fee-sub">Date: ___________________</div>
    </div>
    <p>Method of Payment: &nbsp;&#9633; Debit &nbsp;&nbsp; &#9633; Credit</p>
    <p>Card Type: &nbsp;&#9633; Visa &nbsp;&nbsp; &#9633; Mastercard &nbsp;&nbsp; &#9633; Amex &nbsp;&nbsp; &#9633; Discover</p>
    <p>Credit/Debit Card #: <span style="display:inline-block;min-width:280px;border-bottom:1px solid #333">&nbsp;</span></p>
    <p>Expiration Date: <span style="display:inline-block;min-width:90px;border-bottom:1px solid #333">&nbsp;</span> &nbsp;&nbsp; Security Code: <span style="display:inline-block;min-width:90px;border-bottom:1px solid #333">&nbsp;</span></p>

    <div class="notice">
      <b>Electronic Payment Authorization:</b> Client authorizes ${firmName()} to charge amounts owed under the Tax Service Agreement, and any Addendums, to the credit or debit card identified above. Fees charged by ${firmName()} are non-refundable except as set forth in the Tax Service Agreement.
    </div>

    ${sigBlock('Client Signature', 'Authorized Representative')}
  `)
}

// ─── Addendum — called with pre-filled fee/scope from modal ──────────────────
export function generateAddendum(c = null, opts = {}) {
  const {
    resolutionFee   = '',
    paymentPlan     = '',
    startDate       = '',
    services        = [],
    notes           = '',
  } = opts

  const feeDisplay  = resolutionFee ? `$${Number(resolutionFee).toLocaleString()}` : '$___________'
  const planDisplay = paymentPlan   ? `$${Number(paymentPlan).toLocaleString()} /month` : '$___________ /month'
  const startDisp   = startDate     || '___________'

  const date = new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})

  printBase('Service Addendum — Additional Services Agreement', `
    <p style="text-align:right;font-size:11px;color:#666;margin-bottom:4px">Date: ${date}</p>
    ${clientBlock(c)}

    <p>This Addendum (<b>"Addendum"</b>) supplements the Tax Investigation Service Agreement previously executed between <b>${firmName()}</b> ("Company") and the undersigned client ("Client") and is incorporated therein by reference. The Additional Services below are described in the paragraphs that have been selected with an "X."</p>

    <h3>1. Additional Services Authorized</h3>
    <div style="margin:10px 0">
      ${RESOLUTION_SERVICES.map(s => `
        <div style="display:flex;gap:10px;margin-bottom:10px;align-items:flex-start">
          <div style="width:14px;height:14px;border:1.3px solid #333;flex-shrink:0;margin-top:2px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;line-height:1">${services.includes(s.key) ? 'X' : ''}</div>
          <div>
            <div style="font-weight:700;font-size:12px;margin-bottom:2px">${s.label}</div>
            <div style="font-size:11px;color:#444;line-height:1.6">${s.legal}</div>
          </div>
        </div>`).join('\n')}
    </div>
    ${notes ? `<p><b>Additional Scope / Work Notes:</b> ${notes}</p>` : ''}
    <p style="font-size:11px;color:#555">Additional Services shall not in any event include audit reconsideration representation, collection appeal representation, fraud assertions or defense, future tax return preparation, or any other service not explicitly provided for in one of the checked paragraphs above.</p>

    <h3>2. Resolution Service Fee</h3>
    <div class="fee-box">
      <div class="fee-main">Resolution Service Fee: ${feeDisplay}</div>
      <div class="fee-sub">
        Payment Plan: ${planDisplay} · Starting: ${startDisp}<br/>
        Fees for resolution services are separate from and in addition to the investigation fee.<br/>
        Payments are due on the agreed start date and monthly thereafter until paid in full.
      </div>
    </div>

    <h3>3. Conditions</h3>
    <p>Services under this Addendum are contingent upon: (a) Client remaining current on any required tax filings; (b) Client maintaining compliance with any IRS or state payment agreements during representation; (c) Timely payment of fees as agreed upon above. Client authorizes automatic withdrawals via the payment method on file in the amounts and at the times set forth above; unless otherwise agreed, Company bills based on time spent and difficulty of services performed.</p>

    <h3>4. Incorporation &amp; Entire Agreement</h3>
    <p>All terms of the original Tax Investigation Service Agreement remain in full force and effect and are incorporated herein. In the event of conflict between this Addendum and the original Agreement, this Addendum controls.</p>

    <h3>5. Right to Cancel</h3>
    <p>Client may cancel the transactions set forth in this Addendum at any time prior to midnight of the third (3rd) business day after the date of execution of this Addendum. Any payments made will be returned within three (3) days of Company's receipt of a cancellation notice, prorated at $250/hour for work already performed. To cancel, mail a signed cancellation notice to ${firmName()}, ${FIRM.address}, before midnight of the third business day after signing.</p>

    <h3>6. Client Acknowledgment</h3>
    <p>By signing below, Client confirms they have read, understand, and agree to the terms of this Addendum and authorize ${firmName()} to proceed with the resolution services checked above. Except as modified by this Addendum, the existing Tax Service Agreement remains unmodified and in full force and effect and is reaffirmed by Client.</p>

    ${sigBlock('Client Signature', 'Authorized Representative')}
    <div style="margin-top:24px;padding-top:0">
      <div style="border-top:1.5px solid #333;padding-top:8px;max-width:48%">
        <div style="font-size:12px;font-weight:700;color:#222;margin-bottom:4px">Co-Client Signature (if applicable)</div>
        <div style="font-size:11px;color:#555">Print Name: ___________________________________</div>
        <div style="font-size:11px;color:#555;margin-top:6px">Date: _______________________</div>
      </div>
    </div>
  `)
}

// ─── Engagement Letter ────────────────────────────────────────────────────────
export function generateEngagementLetter(c = null) {
  const name    = c ? (c.name || `${c.first||''} ${c.last||''}`.trim()) : 'Valued Client'
  const fee     = c?.taxFee ? `$${Number(c.taxFee).toLocaleString()}` : (c?.investigationFee ? `$${c.investigationFee}` : '$___________')
  const issue   = c?.issueType || 'tax resolution matter'
  const years   = c?.taxYears  || '___________________'
  const rep     = c?.assignedTo || '___________________'
  const date    = new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})

  printBase('Engagement Letter', `
    <p style="text-align:right;font-size:11px;color:#666;margin-bottom:16px">${date}</p>
    ${clientBlock(c)}

    <p>Dear <b>${name}</b>,</p>
    <p>Thank you for choosing <b>${firmName()}</b>. We are pleased to confirm our engagement to assist you with your ${issue} matter${years !== '___________________' ? ` for tax year(s) ${years}` : ''}. Your dedicated case representative is <b>${rep}</b>.</p>

    <h3>Services to Be Performed</h3>
    <ul>
      <li>Review your tax transcripts and compliance history with the IRS and/or applicable state taxing authority</li>
      <li>Identify all outstanding liabilities and unfiled returns</li>
      <li>Evaluate eligibility for IRS resolution programs including Installment Agreement, Currently Not Collectible (CNC), Offer in Compromise, Penalty Abatement, and/or Innocent Spouse relief</li>
      <li>Represent you before the IRS and/or state tax authority through resolution</li>
    </ul>

    <h3>Investigation Fee</h3>
    <div class="fee-box">
      <div class="fee-main">Investigation Fee: ${fee}</div>
      <div class="fee-sub">
        This fee covers the initial tax investigation, transcript retrieval, and delivery of a written resolution strategy.<br/>
        This fee is non-refundable once transcript review has commenced.
      </div>
    </div>

    <h3>Your Responsibilities</h3>
    <ul>
      <li>Provide complete and accurate financial and tax information</li>
      <li>Execute all necessary authorization forms (Form 2848 / 8821) promptly</li>
      <li>Notify us immediately of any IRS or state contacts, notices, or levies received</li>
      <li>Respond to requests for information within 5 business days</li>
    </ul>

    <h3>Our Commitment to You</h3>
    <p>We are committed to providing professional, ethical, and effective representation. Your assigned representative will keep you informed of all significant developments in your case. We are available Monday through Friday to answer your questions.</p>

    <div class="notice">
      <b>Important:</b> ${firmName()} is a tax resolution consulting firm and is not a law firm. No attorney-client relationship is created by this engagement. All representation is performed by Enrolled Agents and/or licensed tax professionals.
    </div>

    ${sigBlock('Client Acknowledgment', 'Authorized Representative')}
  `)
}

// ─── POA Cover Letter ─────────────────────────────────────────────────────────
export function generatePOACoverLetter(c = null) {
  const name  = c ? (c.name || `${c.first||''} ${c.last||''}`.trim()) : '___________________'
  const ssn   = c?.ssn ? `***-**-${c.ssn.replace(/-/g,'').slice(-4)}` : '___-__-____'
  const years = c?.taxYears || '___________________'
  const date  = new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})

  printBase('Power of Attorney Cover Letter — Form 2848', `
    <p style="margin-bottom:24px;font-size:11px;color:#666">${date}</p>

    <p>Internal Revenue Service<br/>
    [IRS Campus — See Form 2848 Instructions for Applicable Address]</p>

    <p style="margin-top:20px"><b>Re: Power of Attorney — Form 2848</b><br/>
    <b>Taxpayer:</b> ${name}<br/>
    <b>SSN/EIN:</b> ${ssn}<br/>
    <b>Tax Periods:</b> ${years}</p>

    <p style="margin-top:20px">To Whom It May Concern,</p>

    <p>Enclosed please find a completed Form 2848 (Power of Attorney and Declaration of Representative) authorizing <b>${firmName()}</b> to represent the above-named taxpayer in connection with the tax matters and periods specified therein.</p>

    <p>Please update your records to reflect this authorization and direct all future correspondence regarding the above-referenced matter to our office at the address below. We respectfully request that all notices, letters, and communications be sent to our office rather than directly to the taxpayer.</p>

    <p>If you have any questions or require additional information, please do not hesitate to contact our office.</p>

    <p style="margin-top:28px">Respectfully submitted,</p>

    <div style="margin-top:32px;padding-top:8px;border-top:1.5px solid #333;display:inline-block;min-width:260px">
      <div style="font-size:12px;font-weight:700">Authorized Representative</div>
      <div style="font-size:11.5px;margin-top:4px">${FIRM.name}</div>
      <div style="font-size:11px;color:#555;margin-top:2px">${FIRM.address}</div>
      <div style="font-size:11px;color:#555">${FIRM.email} &nbsp;·&nbsp; ${FIRM.phone}${FIRM.fax ? ' &nbsp;·&nbsp; Fax ' + FIRM.fax : ''}</div>
      <div style="font-size:11px;color:#888;margin-top:6px">Date: _______________________</div>
    </div>
  `)
}


// ─── REPRESENTATIVE CONSTANTS ─────────────────────────────────────────────────
const REP1 = {
  name: 'Rommel Cruz Rivera',
  address: '631 US Highway One, North Palm Beach FL 33408',
  caf: '0312-27862R',
  ptin: 'P01982875',
  phone: '561-206-2551',
  fax: '561-328-0029',
}
const REP2 = {
  name: 'Anthony Michael Tropeano',
  address: '2006 Tigris Dr, West Palm Beach FL 33411',
  caf: '0309-50688R',
  ptin: 'P01065275',
  phone: '561-596-2724',
  fax: '561-328-0029',
}

function irsFormBase(title, body) {
  const w = window.open('','_blank','width=900,height=1100')
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
  <title>${title}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:11px;color:#000;background:#fff;padding:24px;max-width:780px;margin:auto}
    h1{font-size:13px;font-weight:bold;text-align:center;margin-bottom:2px}
    h2{font-size:11px;font-weight:bold;text-align:center;margin-bottom:12px;color:#333}
    table{width:100%;border-collapse:collapse;margin-bottom:8px}
    td,th{border:1px solid #000;padding:4px 6px;vertical-align:top;font-size:10px}
    .no-border td{border:none;padding:2px 0}
    .header-box{border:1px solid #000;padding:6px;margin-bottom:8px}
    .section-label{font-weight:bold;font-size:10px;margin:8px 0 4px}
    .irs-box{border:1px solid #000;padding:6px;font-size:10px;float:right;width:160px;margin-left:12px;margin-bottom:8px}
    .field-label{font-size:8px;color:#555;margin-bottom:2px}
    .field-value{font-size:11px;font-weight:bold;border-bottom:1px solid #000;min-height:16px;padding-bottom:1px}
    .sig-line{border-bottom:1px solid #000;min-height:32px;margin-top:8px}
    .clearfix::after{content:'';display:table;clear:both}
    .warn{font-style:italic;font-size:9px;color:#444}
    @media print{body{padding:12px}}
  </style>
  </head><body onload="window.print()">${body}</body></html>`)
  w.document.close()
}

// ─── Form 8821 Personal ───────────────────────────────────────────────────────
export function generateForm8821Personal(c = null) {
  const name    = c?.name || '___________________________________'
  const address = [c?.street, c?.city, c?.state, c?.zip].filter(Boolean).join(', ') || '___________________________________'
  const ssn     = c?.ssn  || '___-__-____'
  const phone   = c?.phone || '_________________'
  const years   = (() => { try { return JSON.parse(c?.taxYears||'[]').join(', ') } catch { return c?.taxYears || '____' } })()
  const date    = new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'})

  irsFormBase('Form 8821 — Personal', `
    <div class="clearfix">
      <div class="irs-box">
        <b>For IRS Use Only</b><br/>
        Received by: ___________<br/>
        Name: ___________<br/>
        Telephone: ___________<br/>
        Function: ___________<br/>
        Date: ___________
      </div>
      <div style="margin-right:170px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
          <div style="font-size:36px;font-weight:900;border:3px solid #000;padding:2px 8px">8821</div>
          <div>
            <div style="font-size:13px;font-weight:bold">Tax Information Authorization</div>
            <div style="font-size:9px">Department of the Treasury — Internal Revenue Service</div>
            <div style="font-size:9px">OMB No. 1545-1165</div>
          </div>
        </div>
        <div class="warn">▶ Don't sign this form unless all applicable lines have been completed.<br/>
        ▶ Don't use Form 8821 to request copies of your tax returns or to authorize someone to represent you.</div>
      </div>
    </div>

    <div class="section-label">1 Taxpayer information. Taxpayer must sign and date this form on line 6.</div>
    <table>
      <tr>
        <td style="width:60%">
          <div class="field-label">Taxpayer name and address</div>
          <div class="field-value">${name}</div>
          <div class="field-value" style="margin-top:4px">${address}</div>
        </td>
        <td>
          <div class="field-label">Taxpayer identification number(s)</div>
          <div class="field-value">${ssn}</div>
          <div class="field-label" style="margin-top:6px">Daytime telephone number</div>
          <div class="field-value">${phone}</div>
        </td>
      </tr>
    </table>

    <div class="section-label">2 Designee(s).</div>
    <table>
      <tr>
        <td style="width:55%">
          <div class="field-label">Name and address</div>
          <div class="field-value">${REP1.name}</div>
          <div class="field-value" style="margin-top:2px">${REP1.address}</div>
          <div style="margin-top:4px"><input type="checkbox" checked/> Check if to be sent copies of notices and communications</div>
        </td>
        <td>
          <div class="field-label">CAF No.</div><div class="field-value">${REP1.caf}</div>
          <div class="field-label">PTIN</div><div class="field-value">${REP1.ptin}</div>
          <div class="field-label">Telephone No.</div><div class="field-value">${REP1.phone}</div>
          <div class="field-label">Fax No.</div><div class="field-value">${REP1.fax}</div>
        </td>
      </tr>
    </table>

    <div class="section-label">3 Tax information.</div>
    <table>
      <tr style="background:#eee"><th>(a) Type of Tax Information</th><th>(b) Tax Form Number</th><th>(c) Year(s) or Period(s)</th><th>(d) Specific Tax Matters</th></tr>
      <tr><td>Income</td><td>1040</td><td>${years}</td><td>N/A</td></tr>
      <tr><td>Penalty</td><td>500</td><td>${years}</td><td>N/A</td></tr>
    </table>

    <div class="section-label">6 Taxpayer signature.</div>
    <div class="warn">▶ IF NOT COMPLETED, SIGNED, AND DATED, THIS TAX INFORMATION AUTHORIZATION WILL BE RETURNED.<br/>
    ▶ DON'T SIGN THIS FORM IF IT IS BLANK OR INCOMPLETE.</div>
    <table style="margin-top:8px">
      <tr>
        <td style="width:55%">
          <div class="field-label">Signature</div>
          <div class="sig-line"></div>
          <div class="field-label" style="margin-top:4px">Print Name: <span style="font-weight:bold">${name}</span></div>
        </td>
        <td>
          <div class="field-label">Date</div>
          <div class="field-value">${date}</div>
          <div class="field-label" style="margin-top:4px">Title (if applicable)</div>
          <div class="field-value"></div>
        </td>
      </tr>
    </table>
    <div style="font-size:9px;margin-top:8px;border-top:1px solid #000;padding-top:4px">
      For Privacy Act and Paperwork Reduction Act Notice, see the instructions. &nbsp;&nbsp; Cat. No. 11596P &nbsp;&nbsp; Form <b>8821</b> (Rev. 01-2021)
    </div>
  `)
}

// ─── Form 8821 Business ───────────────────────────────────────────────────────
export function generateForm8821Business(c = null) {
  const name    = c?.entityName || c?.name || '___________________________________'
  const address = [c?.street, c?.city, c?.state, c?.zip].filter(Boolean).join(', ') || '___________________________________'
  const ein     = c?.ein || c?.ssn || '__-_______'
  const phone   = c?.phone || '_________________'
  const years   = (() => { try { return JSON.parse(c?.taxYears||'[]').join(', ') } catch { return c?.taxYears || '____' } })()
  const date    = new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'})

  irsFormBase('Form 8821 — Business', `
    <div class="clearfix">
      <div class="irs-box">
        <b>For IRS Use Only</b><br/>
        Received by: ___________<br/>
        Name: ___________<br/>
        Telephone: ___________<br/>
        Function: ___________<br/>
        Date: ___________
      </div>
      <div style="margin-right:170px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
          <div style="font-size:36px;font-weight:900;border:3px solid #000;padding:2px 8px">8821</div>
          <div>
            <div style="font-size:13px;font-weight:bold">Tax Information Authorization — Business</div>
            <div style="font-size:9px">Department of the Treasury — Internal Revenue Service</div>
            <div style="font-size:9px">OMB No. 1545-1165</div>
          </div>
        </div>
      </div>
    </div>

    <div class="section-label">1 Taxpayer information.</div>
    <table>
      <tr>
        <td style="width:60%">
          <div class="field-label">Business name and address</div>
          <div class="field-value">${name}</div>
          <div class="field-value" style="margin-top:4px">${address}</div>
        </td>
        <td>
          <div class="field-label">EIN</div>
          <div class="field-value">${ein}</div>
          <div class="field-label" style="margin-top:6px">Daytime telephone number</div>
          <div class="field-value">${phone}</div>
        </td>
      </tr>
    </table>

    <div class="section-label">2 Designee(s).</div>
    <table>
      <tr>
        <td style="width:55%">
          <div class="field-label">Name and address</div>
          <div class="field-value">${REP1.name}</div>
          <div class="field-value" style="margin-top:2px">${REP1.address}</div>
          <div style="margin-top:4px"><input type="checkbox" checked/> Check if to be sent copies of notices and communications</div>
        </td>
        <td>
          <div class="field-label">CAF No.</div><div class="field-value">${REP1.caf}</div>
          <div class="field-label">PTIN</div><div class="field-value">${REP1.ptin}</div>
          <div class="field-label">Telephone No.</div><div class="field-value">${REP1.phone}</div>
          <div class="field-label">Fax No.</div><div class="field-value">${REP1.fax}</div>
        </td>
      </tr>
    </table>

    <div style="margin-top:4px"><input type="checkbox" checked/> By checking here, I authorize access to my IRS records via an Intermediate Service Provider.</div>

    <div class="section-label">3 Tax information.</div>
    <table>
      <tr style="background:#eee"><th>(a) Type of Tax Information</th><th>(b) Tax Form Number</th><th>(c) Year(s) or Period(s)</th><th>(d) Specific Tax Matters</th></tr>
      <tr><td>Corporate/Partnership</td><td>1120/1120s/1065</td><td>${years}</td><td>N/A</td></tr>
      <tr><td>Employment/Payroll</td><td>940/941 All Quarters</td><td>${years}</td><td>N/A</td></tr>
      <tr><td>Civil Penalty</td><td>500</td><td>${years}</td><td>N/A</td></tr>
    </table>

    <div class="section-label">6 Taxpayer signature.</div>
    <div class="warn">▶ IF NOT COMPLETED, SIGNED, AND DATED, THIS TAX INFORMATION AUTHORIZATION WILL BE RETURNED.</div>
    <table style="margin-top:8px">
      <tr>
        <td style="width:55%">
          <div class="field-label">Signature</div>
          <div class="sig-line"></div>
          <div class="field-label" style="margin-top:4px">Print Name: <span style="font-weight:bold">${name}</span></div>
        </td>
        <td>
          <div class="field-label">Date</div>
          <div class="field-value">${date}</div>
          <div class="field-label" style="margin-top:4px">Title (if applicable)</div>
          <div class="field-value"></div>
        </td>
      </tr>
    </table>
    <div style="font-size:9px;margin-top:8px;border-top:1px solid #000;padding-top:4px">
      For Privacy Act and Paperwork Reduction Act Notice, see the instructions. &nbsp;&nbsp; Cat. No. 11596P &nbsp;&nbsp; Form <b>8821</b> (Rev. 01-2021)
    </div>
  `)
}

// ─── Form 2848 Personal ───────────────────────────────────────────────────────
export function generateForm2848Personal(c = null) {
  const name    = c?.name || '___________________________________'
  const address = [c?.street, c?.city, c?.state, c?.zip].filter(Boolean).join(', ') || '___________________________________'
  const ssn     = c?.ssn  || '___-__-____'
  const phone   = c?.phone || '_________________'
  const years   = (() => { try { return JSON.parse(c?.taxYears||'[]').join(', ') } catch { return c?.taxYears || '____' } })()
  const date    = new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'})

  irsFormBase('Form 2848 — Personal POA', `
    <div class="clearfix">
      <div class="irs-box">
        <b>For IRS Use Only</b><br/>
        Received by: ___________<br/>
        Name: ___________<br/>
        Telephone: ___________<br/>
        Function: ___________<br/>
        Date: ___________
      </div>
      <div style="margin-right:170px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
          <div style="font-size:36px;font-weight:900;border:3px solid #000;padding:2px 8px">2848</div>
          <div>
            <div style="font-size:13px;font-weight:bold">Power of Attorney and Declaration of Representative</div>
            <div style="font-size:9px">Department of the Treasury — Internal Revenue Service</div>
            <div style="font-size:9px">OMB No. 1545-0150</div>
          </div>
        </div>
      </div>
    </div>

    <div style="font-weight:bold;font-size:11px;margin-bottom:6px;border-top:2px solid #000;padding-top:4px">Part I &nbsp;&nbsp; Power of Attorney</div>
    <div class="warn" style="margin-bottom:6px">Caution: A separate Form 2848 must be completed for each taxpayer.</div>

    <div class="section-label">1 Taxpayer information. Taxpayer must sign and date this form on page 2, line 7.</div>
    <table>
      <tr>
        <td style="width:60%">
          <div class="field-label">Taxpayer name and address</div>
          <div class="field-value">${name}</div>
          <div class="field-value" style="margin-top:4px">${address}</div>
        </td>
        <td>
          <div class="field-label">Taxpayer identification number(s)</div>
          <div class="field-value">${ssn}</div>
          <div class="field-label" style="margin-top:6px">Daytime telephone number</div>
          <div class="field-value">${phone}</div>
        </td>
      </tr>
    </table>
    <div style="font-size:10px;margin:4px 0">hereby appoints the following representative(s) as attorney(s)-in-fact:</div>

    <div class="section-label">2 Representative(s) must sign and date this form on page 2, Part II.</div>
    <table>
      <tr>
        <td style="width:55%">
          <div class="field-label">Name and address</div>
          <div class="field-value">${REP2.name}</div>
          <div class="field-value" style="margin-top:2px">${REP2.address}</div>
        </td>
        <td>
          <div class="field-label">CAF No.</div><div class="field-value">${REP2.caf}</div>
          <div class="field-label">PTIN</div><div class="field-value">${REP2.ptin}</div>
          <div class="field-label">Telephone No.</div><div class="field-value">${REP2.phone}</div>
          <div class="field-label">Fax No.</div><div class="field-value">${REP2.fax}</div>
        </td>
      </tr>
      <tr>
        <td style="width:55%">
          <div class="field-label">Name and address</div>
          <div class="field-value">${REP1.name}</div>
          <div class="field-value" style="margin-top:2px">${REP1.address}</div>
          <div style="margin-top:4px"><input type="checkbox" checked/> Check if to be sent copies of notices and communications</div>
        </td>
        <td>
          <div class="field-label">CAF No.</div><div class="field-value">${REP1.caf}</div>
          <div class="field-label">PTIN</div><div class="field-value">${REP1.ptin}</div>
          <div class="field-label">Telephone No.</div><div class="field-value">${REP1.phone}</div>
          <div class="field-label">Fax No.</div><div class="field-value">${REP1.fax}</div>
        </td>
      </tr>
    </table>

    <div class="section-label">3 Acts authorized.</div>
    <table>
      <tr style="background:#eee"><th>Description of Matter</th><th>Tax Form Number</th><th>Year(s) or Period(s)</th></tr>
      <tr><td>Income</td><td>1040</td><td>${years}</td></tr>
      <tr><td>Health Insurance</td><td>6672/6702</td><td>${years}</td></tr>
      <tr><td>Civil Penalty</td><td>500</td><td>${years}</td></tr>
    </table>

    <div class="section-label" style="page-break-before:always;margin-top:16px">7 Taxpayer declaration and signature. (Page 2)</div>
    <div class="warn">▶ IF NOT COMPLETED, SIGNED, AND DATED, THE IRS WILL RETURN THIS POWER OF ATTORNEY TO THE TAXPAYER.</div>
    <table style="margin-top:8px">
      <tr>
        <td style="width:50%">
          <div class="field-label">Signature</div>
          <div class="sig-line"></div>
          <div class="field-label" style="margin-top:6px">Print name: <span style="font-weight:bold">${name}</span></div>
        </td>
        <td style="width:25%">
          <div class="field-label">Date</div>
          <div class="field-value">${date}</div>
        </td>
        <td>
          <div class="field-label">Title (if applicable)</div>
          <div class="field-value"></div>
        </td>
      </tr>
    </table>

    <div style="font-weight:bold;font-size:11px;margin:12px 0 6px;border-top:2px solid #000;padding-top:4px">Part II &nbsp;&nbsp; Declaration of Representative</div>
    <div style="font-size:9px;margin-bottom:6px;line-height:1.5">Under penalties of perjury, by my signature below I declare that I am not currently suspended or disbarred from practice before the IRS; I am subject to regulations in Circular 230; I am authorized to represent the taxpayer identified in Part I.</div>
    <table>
      <tr style="background:#eee">
        <th>Designation (a–r)</th>
        <th>Licensing jurisdiction</th>
        <th>Bar/license/enrollment number</th>
        <th>Signature</th>
        <th>Date</th>
      </tr>
      <tr>
        <td style="text-align:center">D</td>
        <td>RS</td>
        <td>${REP1.caf}</td>
        <td></td>
        <td></td>
      </tr>
      <tr><td></td><td></td><td></td><td></td><td></td></tr>
    </table>
    <div style="font-size:9px;margin-top:8px;border-top:1px solid #000;padding-top:4px">
      Cat. No. 11980J &nbsp;&nbsp; Form <b>2848</b> (Rev. 1-2021)
    </div>
  `)
}

// ─── Form 2848 Business ───────────────────────────────────────────────────────
export function generateForm2848Business(c = null) {
  const name    = c?.entityName || c?.name || '___________________________________'
  const address = [c?.street, c?.city, c?.state, c?.zip].filter(Boolean).join(', ') || '___________________________________'
  const ein     = c?.ein || c?.ssn || '__-_______'
  const phone   = c?.phone || '_________________'
  const years   = (() => { try { return JSON.parse(c?.taxYears||'[]').join(', ') } catch { return c?.taxYears || '____' } })()
  const date    = new Date().toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'})

  irsFormBase('Form 2848 — Business POA', `
    <div class="clearfix">
      <div class="irs-box">
        <b>For IRS Use Only</b><br/>
        Received by: ___________<br/>
        Name: ___________<br/>
        Telephone: ___________<br/>
        Function: ___________<br/>
        Date: ___________
      </div>
      <div style="margin-right:170px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
          <div style="font-size:36px;font-weight:900;border:3px solid #000;padding:2px 8px">2848</div>
          <div>
            <div style="font-size:13px;font-weight:bold">Power of Attorney — Business Entity</div>
            <div style="font-size:9px">Department of the Treasury — Internal Revenue Service</div>
            <div style="font-size:9px">OMB No. 1545-0150</div>
          </div>
        </div>
      </div>
    </div>

    <div style="font-weight:bold;font-size:11px;margin-bottom:6px;border-top:2px solid #000;padding-top:4px">Part I &nbsp;&nbsp; Power of Attorney</div>

    <div class="section-label">1 Taxpayer information.</div>
    <table>
      <tr>
        <td style="width:60%">
          <div class="field-label">Business name and address</div>
          <div class="field-value">${name}</div>
          <div class="field-value" style="margin-top:4px">${address}</div>
        </td>
        <td>
          <div class="field-label">EIN</div>
          <div class="field-value">${ein}</div>
          <div class="field-label" style="margin-top:6px">Daytime telephone number</div>
          <div class="field-value">${phone}</div>
        </td>
      </tr>
    </table>

    <div class="section-label">2 Representative(s).</div>
    <table>
      <tr>
        <td style="width:55%">
          <div class="field-label">Name and address</div>
          <div class="field-value">${REP1.name}</div>
          <div class="field-value" style="margin-top:2px">${REP1.address}</div>
          <div style="margin-top:4px"><input type="checkbox" checked/> Check if to be sent copies of notices and communications</div>
        </td>
        <td>
          <div class="field-label">CAF No.</div><div class="field-value">${REP1.caf}</div>
          <div class="field-label">PTIN</div><div class="field-value">${REP1.ptin}</div>
          <div class="field-label">Telephone No.</div><div class="field-value">${REP1.phone}</div>
          <div class="field-label">Fax No.</div><div class="field-value">${REP1.fax}</div>
        </td>
      </tr>
    </table>

    <div class="section-label">3 Acts authorized.</div>
    <table>
      <tr style="background:#eee"><th>Description of Matter</th><th>Tax Form Number</th><th>Year(s) or Period(s)</th></tr>
      <tr><td>Income/Corporate</td><td>1120/1120s/1065</td><td>${years}</td></tr>
      <tr><td>Employment/Payroll</td><td>940/941</td><td>${years}</td></tr>
      <tr><td>Civil Penalty</td><td>500</td><td>${years}</td></tr>
    </table>

    <div class="section-label" style="margin-top:16px">7 Authorized Officer/Partner Signature (Page 2)</div>
    <div class="warn">▶ IF NOT COMPLETED, SIGNED, AND DATED, THE IRS WILL RETURN THIS POWER OF ATTORNEY TO THE TAXPAYER.</div>
    <table style="margin-top:8px">
      <tr>
        <td style="width:50%">
          <div class="field-label">Signature of authorized officer/partner</div>
          <div class="sig-line"></div>
          <div class="field-label" style="margin-top:6px">Print name: <span style="font-weight:bold">${name}</span></div>
        </td>
        <td style="width:25%">
          <div class="field-label">Date</div>
          <div class="field-value">${date}</div>
        </td>
        <td>
          <div class="field-label">Title</div>
          <div class="field-value"></div>
        </td>
      </tr>
    </table>

    <div style="font-weight:bold;font-size:11px;margin:12px 0 6px;border-top:2px solid #000;padding-top:4px">Part II &nbsp;&nbsp; Declaration of Representative</div>
    <table>
      <tr style="background:#eee">
        <th>Designation</th><th>Licensing jurisdiction</th><th>Enrollment number</th><th>Signature</th><th>Date</th>
      </tr>
      <tr>
        <td style="text-align:center">D</td>
        <td>RS</td>
        <td>${REP1.caf}</td>
        <td></td>
        <td></td>
      </tr>
    </table>
    <div style="font-size:9px;margin-top:8px;border-top:1px solid #000;padding-top:4px">
      Cat. No. 11980J &nbsp;&nbsp; Form <b>2848</b> (Rev. 1-2021)
    </div>
  `)
}

// ─── Combined Client Package (Tax Engagement Service Agreement) ───────────────
export function generateClientPackage(c = null) {
  const fee  = c?.taxFee ? `$${Number(c.taxFee).toLocaleString()}` : (c?.investigationFee ? `$${c.investigationFee}` : '$___________')
  const name = c ? (c.name || '') : 'Valued Client'
  const date = new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})
  const rep  = c?.assignedTo || '___________________'
  const years= (() => { try { return JSON.parse(c?.taxYears||'[]').join(', ') } catch { return c?.taxYears || '___________________' } })()
  const issue= c?.issueType || 'tax resolution matter'

  printBase('Tax Engagement Service Agreement', `
    ${clientBlock(c)}
    <p style="text-align:right;font-size:11px;color:#666">Date: ${date}</p>
    <p>Dear <b>${name}</b>,</p>
    <p>Thank you for choosing <b>${firmName()}</b>. This document serves as your <b>Tax Investigation Service Agreement</b> and <b>Engagement Letter</b> confirming our engagement to assist you with your ${issue} matter${years !== '___________________' ? ` for tax year(s) ${years}` : ''}.</p>
    <h3>1. Scope of Services</h3>
    <ul>
      <li>Review of IRS and/or state tax transcripts</li>
      <li>Identification of outstanding tax liabilities and unfiled returns</li>
      <li>Evaluation of eligibility for IRS resolution programs (OIC, CNC, IA, Penalty Abatement)</li>
      <li>Preparation of a written resolution strategy within 21 business days</li>
      <li>Full IRS/state representation — Case Rep: <b>${rep}</b></li>
    </ul>
    <h3>2. Authorization</h3>
    <p>Client authorizes ${firmName()} to obtain IRS transcripts via Form 2848/8821 and represent the Client before the IRS and/or applicable state tax authority.</p>
    <h3>3. Investigation Fee</h3>
    <div class="fee-box">
      <div class="fee-main">Investigation Fee: ${fee}</div>
      <div class="fee-sub">Non-refundable once transcript review has commenced. Full payment due prior to commencement.</div>
    </div>
    <h3>4. Client Responsibilities</h3>
    <ul>
      <li>Provide accurate and complete financial and tax information</li>
      <li>Execute IRS authorization forms (Form 2848 / 8821) promptly</li>
      <li>Respond to document requests within 5 business days</li>
      <li>Notify us immediately of any IRS notices, levies, or contacts</li>
    </ul>
    <h3>5. No Guarantee of Outcome</h3>
    <p>${firmName()} makes no guarantee as to any specific outcome. Acceptance into any IRS program is solely at the discretion of the IRS.</p>
    <h3>6. Not a Law Firm</h3>
    <p>${firmName()} is a tax resolution consulting firm and is <b>not a law firm</b>. All representation is performed by Enrolled Agents and/or licensed tax professionals.</p>
    <h3>7. Termination</h3>
    <p>Either party may terminate this Agreement at any time by written notice, effective upon actual receipt or five days after transmittal. Upon termination, all service fees shall be apportioned or prorated on a reasonable basis determined by Company.</p>
    <h3>8. Arbitration of Disputes — No Class Actions</h3>
    <p>Any controversy, claim, or dispute arising out of or relating to this Agreement shall be determined by binding arbitration in Palm Beach County, Florida, or in the county in which Client resides, administered by a nationally recognized arbitration service mutually agreed upon by the parties. The arbitrator's award shall be final. Both parties waive the right to bring claims as a plaintiff or class member in any class or representative proceeding. The parties shall share arbitration costs, including attorney's fees, equally; if Client's share exceeds $1,000, Company will pay Client's reasonable share of costs in excess of that amount.</p>
    <h3>9. No Trial By Jury</h3>
    <p>Company and Client each waive any right to trial by jury in any lawsuit or other similar proceeding arising from this Agreement.</p>
    <h3>10. Limitation of Obligations</h3>
    <p>Company's obligations hereunder in the event of any breach shall in no event exceed 200% of the fees actually collected by Company. In no event shall Company be liable for penalties, interest charges, or consequential damages of any amount whatsoever.</p>
    <h3>11. Governing Law &amp; Entire Agreement</h3>
    <p>This Agreement is made and services are performed in the State of Florida and is governed by Florida law. This Agreement and any Addendums constitute the full and complete agreement and supersede any prior agreements, whether written or oral. No amendment, change, or modification other than an Addendum shall be valid unless in writing and signed by all parties.</p>
    <h3>12. Electronic Communication Disclosures</h3>
    <p>Client consents to receive, in electronic format, all information, copies of agreements, and correspondence from Company, with the same legal effect as written and signed paper communications. Consent may be withdrawn at any time by emailing ${firmEmail()} or writing to ${firmName()}, ${FIRM.address}.</p>
    <div class="page-break"></div>
    <h3>13. Right of Cancellation</h3>
    <p>Client may cancel this Agreement at any time prior to midnight of the third (3rd) business day after the date of execution, without penalty or obligation. If Client cancels, any payments made will be returned within three (3) days following receipt of Client's cancellation notice, prorated at a $250 hourly rate for any work product services already performed. To cancel, Client must mail or deliver a signed and dated cancellation notice to ${firmName()}, ${FIRM.address}, not later than midnight of the third business day after execution of this Agreement. See the attached Notice of Right of Cancellation for further detail.</p>
    <div class="notice">
      <b>Privacy Policy:</b> ${firmName()} uses and shares your information only to perform our obligations under this Agreement and related purposes, or as permitted or required by law. Calls may be recorded or monitored for quality purposes. Contact ${firmEmail()} with any privacy concerns.
    </div>
    ${sigBlock('Client Signature', 'Authorized Representative')}
  `)
}

// ─── Full Package — Investigation Agreement + IRS Authorization Forms ────────
// Builds a plain-text version of the engagement agreement (for the e-sign
// "message" field), pre-fills the appropriate 2848/8821 PDFs based on the
// client's clientType, uploads them to storage, and creates a single e-sign
// package record the client can review and sign in one place.

export function getAgreementMessageText(c = null) {
  const fee  = c?.taxFee ? `$${Number(c.taxFee).toLocaleString()}` : (c?.investigationFee ? `$${c.investigationFee}` : '$___________')
  const name = c ? (c.name || '') : 'Valued Client'
  const date = new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})

  return `TAX SERVICE AGREEMENT

This Tax Service Agreement (as the same may be amended from time to time by any Addendum, the "Agreement"), dated as of ${date}, by and between ${firmName()}, with its principal offices located at ${FIRM.address} ("Company") and ${name} ("Client").

1. COMPANY OBLIGATIONS
- Company will contact the IRS on behalf of Client to determine the total amount of Client's current tax liability accrued, if any
- Company will obtain a copy of Client's master file from the IRS if necessary
- Company will identify any unfiled tax returns, outstanding tax liens, and the collection statute expiration date
- Company will conduct a consultation with Client to determine Client's financial status and ability to pay unpaid taxes
- Company will analyze the information obtained from the IRS and present Client with a proposed strategy for resolution
- Company will perform additional services for additional fees described in any signed Addendum

2. CLIENT OBLIGATIONS AND AUTHORITY
- Client authorizes Company to obtain necessary tax information from the IRS and/or state taxing authority
- Client agrees to provide all necessary information and financial statements promptly, and to respond to Company requests within a reasonable time
- Client will promptly notify Company of any changes in financial circumstances, marital status, or contact information
- Client agrees to make timely payments and to indemnify and hold Company harmless from claims arising from Client's negligence or breach

3. NOT INCLUDED IN AGREEMENT
Client acknowledges that Company is not a law firm and does not provide legal, tax law, or investment advice. Company's services do not include representation in litigation in tax, federal, or state court, unless agreed in an Addendum.

4. CLIENT ACKNOWLEDGMENTS
Client understands that, unless otherwise agreed in an Addendum, Company will not prepare, submit, or negotiate a Federal Offer in Compromise, Installment Agreement, or other negotiation; Company will not prevent IRS collection action; legal advice must come from a licensed attorney; Client's IRS obligations remain Client's own; and fees paid do not include any amount required to settle a claim with the IRS or state.

5. PAYMENT OF FEES
Tax Investigation Fee: ${fee}
A returned check fee of $25.00 applies to any bounced check or draft returned for insufficient funds.

6. TERMINATION
Either party may terminate this Agreement at any time by written notice. Fees shall be apportioned or prorated on a reasonable basis determined by Company.

7. ARBITRATION OF DISPUTES — NO CLASS ACTIONS
Disputes shall be resolved by binding arbitration in Palm Beach County, Florida (or Client's county of residence), administered by a nationally recognized arbitration service. No class or representative proceedings are permitted. Arbitration costs are shared equally, except Company will cover Client's share above $1,000.

8. NO TRIAL BY JURY
Company and Client each waive the right to trial by jury for any dispute arising from this Agreement.

9. LIMITATION OF OBLIGATIONS
Company's liability for any breach shall not exceed 200% of fees actually collected. Company is not liable for penalties, interest, or consequential damages.

10. GOVERNING LAW & ENTIRE AGREEMENT
This Agreement is governed by Florida law and constitutes the entire agreement between the parties, superseding prior agreements.

11. ELECTRONIC COMMUNICATION DISCLOSURES
Client consents to receive all agreements, notices, and disclosures electronically, with the same legal effect as paper communications. Consent may be withdrawn by emailing ${firmEmail()}.

12. RIGHT OF CANCELLATION
Client may cancel this Agreement without penalty within three (3) business days after signing. Payments will be returned within three (3) days of Company's receipt of a cancellation notice, prorated at $250/hour for work already performed. To cancel, mail a signed cancellation notice to ${firmName()}, ${FIRM.address}, before midnight of the third business day after signing.

By typing/drawing your signature below, you electronically sign this Tax Service Agreement AND each IRS authorization form included in this package.`
}

// Builds the pre-filled 2848/8821 PDFs for a client (based on clientType),
// uploads them to Supabase storage, and creates a single "Full Package"
// e-sign record. Returns { id, url, error }.
// State POA form file mappings — same list as the inline modal
const STATE_POA_FILES = {
  FL:'FL_POA.pdf', NC:'NC_POA.pdf', TX:'TX_POA.pdf', OH:'OH_POA.pdf',
  NY:'NY_POA.pdf', PA:'PA_POA.pdf', CA:'CA_POA.pdf', GA:'GA_POA.pdf',
  IL:'IL_POA.pdf', MA:'MA_POA.pdf', MO:'MO_POA.pdf', OR:'OR_POA.pdf',
  TN:'TN_POA.pdf', WA:'Washington_POA.pdf', WY:'Wyoming.pdf',
  AZ:'AZ_POA.pdf', ID:'ID_POA.pdf',
}

export async function sendFullPackage(client, supabase) {
  const clientType  = client?.clientType || 'Individual'
  const irsOrState  = client?.irsOrState || 'IRS Federal'
  const clientState = client?.state || ''
  const safeName    = (client?.name || 'client').replace(/[^a-zA-Z0-9]+/g, '-')
  const base        = typeof import.meta !== 'undefined' ? import.meta.env?.BASE_URL?.replace(/\/$/, '') : '/'

  // Determine which IRS forms to include based on irsOrState
  const includeIRS   = irsOrState !== 'State'       // IRS Federal or Both
  const includeState = irsOrState !== 'IRS Federal'  // State or Both

  const formTypes = includeIRS ? getPackageFormTypes(clientType) : []

  const pdfAttachments = []

  // Tax Service Agreement — first in the package, so the client signs the
  // engagement itself rather than only the IRS authorizations. Previously the
  // agreement existed solely as printable HTML, so no copy of it ever reached
  // the client or their document folder.
  try {
    const { buildAgreementPdf } = await import('./agreementPdf')
    let repSig = null
    try { repSig = await fetch(`${base}/templates/rep_signature.png`).then(r => r.ok ? r.arrayBuffer() : null) } catch (_) {}
    const agreementBytes = await buildAgreementPdf({
      bodyText: getAgreementMessageText(client),
      firmName: firmName(),
      firmAddress: FIRM.address,
      clientName: client?.name || '',
      repSignature: repSig,
    })
    const agreementPath = `docs/${safeName}/package/agreement.pdf`
    const { error: agErr } = await supabase.storage.from('documents')
      .upload(agreementPath, new Blob([agreementBytes], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf' })
    if (agErr) throw agErr
    const { data: agUrl } = await supabase.storage.from('documents').createSignedUrl(agreementPath, 94608000)
    pdfAttachments.push({ formType: 'agreement', label: 'Tax Service Agreement', url: agUrl?.signedUrl || '' })
  } catch (e) {
    console.warn('Agreement PDF could not be generated:', e.message)
  }

  // IRS forms (2848, 8821, cc_auth)
  for (const formType of formTypes) {
    try {
      const bytes = formType === 'cc_auth'
        ? await generateCcAuthPdf(client)
        : await fillForm(formType, client, FORM_USES_EIN[formType])
      const path = `docs/${safeName}/package/${formType}.pdf`
      const { error: upErr } = await supabase.storage.from('documents')
        .upload(path, new Blob([bytes], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf' })
      if (upErr) throw upErr
      const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(path, 94608000)
      pdfAttachments.push({ formType, label: FORM_LABELS[formType], url: urlData?.signedUrl || '' })
    } catch (e) {
      return { error: `Failed to build ${FORM_LABELS[formType] || formType}: ${e.message}` }
    }
  }

  // State POA — auto-include when irsOrState is State or Both IRS + State
  // Generates a pre-filled cover page with client info merged with the blank state form
  if (includeState && clientState && STATE_POA_FILES[clientState]) {
    // One state POA per taxpayer, mirroring the 2848/8821 split: a state
    // authorizes a single taxpayer per form, so an Individual & Biz lead needs
    // two — the person (SSN) and the entity (FEIN).
    const stateParties =
      clientType === 'Individual & Biz' ? ['personal', 'business']
      : clientType === 'Business'       ? ['business']
      : ['personal']

    for (const party of stateParties) {
      try {
        const poaFile = STATE_POA_FILES[clientState]
        const poaUrl  = await resolveStateFormUrl(base, poaFile)
        const poaRes  = await fetch(poaUrl)
        if (!poaRes.ok) throw new Error(`Could not load ${clientState} POA PDF`)
        const rawBytes  = new Uint8Array(await poaRes.arrayBuffer())
        const mergedBytes = await generateStatePOAWithCover(client, rawBytes, party)
        const suffix = stateParties.length > 1 ? `_${party}` : ''
        const path = `docs/${safeName}/package/state_poa_${clientState}${suffix}.pdf`
        const { error: upErr } = await supabase.storage.from('documents')
          .upload(path, new Blob([mergedBytes], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf' })
        if (upErr) throw upErr
        const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(path, 94608000)
        const partyLabel = stateParties.length > 1
          ? ` (${party === 'business' ? 'Business' : 'Personal'})`
          : ''
        pdfAttachments.push({
          formType: `state_poa${suffix}`,
          label: `${clientState} State Power of Attorney${partyLabel}`,
          url: urlData?.signedUrl || '',
        })
      } catch (e) {
        console.warn(`State POA auto-include failed (${party}):`, e.message)
        // Non-fatal — package continues without this state POA
      }
    }
  }

  const { data, error } = await supabase.from('esigns').insert([{
    doc_type: 'Full Investigation Package',
    client_name: client?.name || '',
    client_email: client?.email || '',
    message: getAgreementMessageText(client),
    pdf_attachments: pdfAttachments,
    priority: 'Normal',
    status: 'Awaiting',
    sent_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }]).select().single()

  if (error) return { error: error.message }

  const url = `${window.location.origin}/sign/${data.id}`
  return { id: data.id, url, pdfAttachments }
}

// ─── Service Addendum — send for e-signature ─────────────────────────────────
// Same shape as sendFullPackage: build the PDF, upload it, create an esigns
// row with it attached, hand back the signing link. The caller (Leads.jsx /
// Clients.jsx) sends the link via email/SMS and logs a note — this function
// doesn't touch notifications itself, matching how sendFullPackage is split.
// Timestamped storage path (not a fixed one like the package forms) since an
// addendum can legitimately be re-sent later with different fee terms.
export async function sendAddendumForSignature(record, opts, supabase, sentBy) {
  const safeName = (record?.name || 'client').replace(/[^a-zA-Z0-9]+/g, '-')
  let bytes
  try {
    bytes = await generateAddendumPdf(record, opts)
  } catch (e) {
    return { error: `Failed to build addendum PDF: ${e.message}` }
  }

  const path = `docs/${safeName}/addendum/addendum_${Date.now()}.pdf`
  const { error: upErr } = await supabase.storage.from('documents')
    .upload(path, new Blob([bytes], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf' })
  if (upErr) return { error: upErr.message }
  const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(path, 94608000)
  const pdfAttachments = [{ formType: 'addendum', label: 'Service Addendum', url: urlData?.signedUrl || '' }]

  const { data, error } = await supabase.from('esigns').insert([{
    doc_type: 'Service Addendum',
    client_name: record?.name || '',
    client_email: record?.email || '',
    client_phone: record?.phone || '',
    message: `Please review the attached Service Addendum, which authorizes ${firmName()} to proceed with the resolution services listed and the associated fee. Sign below to confirm.`,
    pdf_attachments: pdfAttachments,
    priority: 'Normal',
    status: 'Awaiting',
    sent_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    sent_by: sentBy || null,
    tenant_id: FIRM.tenantId || undefined,
  }]).select().single()

  if (error) return { error: error.message }

  const url = `${window.location.origin}/sign/${data.id}`
  return { id: data.id, url, pdfAttachments }
}

