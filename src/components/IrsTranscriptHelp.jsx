import { useState } from 'react'
import './IrsTranscriptHelp.css'

export default function IrsTranscriptHelp({ section = 'pull', onOpenInbox }) {
  const [open, setOpen] = useState(false)

  const steps = section === 'inbox' ? [
    ['Review the unmatched transcript', 'Open Unassigned Transcripts and inspect the PDF, taxpayer identity, tax year, transcript type, AI findings, and any mismatch warning.'],
    ['Verify taxpayer identity', 'Do not guess. Confirm the taxpayer information before selecting a client.'],
    ['Search existing clients', 'Search the CRM before creating a duplicate client record.'],
    ['Create a client when needed', 'If no correct client exists, create one first and then return to the inbox.'],
    ['Assign explicitly', 'Select the correct client and confirm the assignment. The CRM must never auto-assign an uncertain taxpayer match.'],
    ['Confirm filing', 'Open the client and verify the PDF is filed under Documents → Transcripts.'],
    ['Review analysis and duplicate warnings', 'Review AI analysis when available and treat SHA-256 duplicate warnings as a reason to verify before taking another action.'],
    ['Recover safely', 'If an upload or filing step fails, keep the original PDF and retry. Use Discard only intentionally and with a reason.'],
  ] : section === 'sor' ? [
    ['Open the SOR Mailbox', 'Use this receive-only workflow for IRS Secure Object Repository deliveries.'],
    ['Sign in as an authorized practitioner', 'Complete IRS identity verification in the IRS site. The CRM does not bypass IRS authentication.'],
    ['Retrieve the delivered document', 'Open the authorized SOR message/object and save the delivered PDF or HTML document.'],
    ['Use secure CRM intake', 'Where folder monitoring is available, connect the dedicated folder and use Scan Now or the automatic scan.'],
    ['Review unmatched items', 'Documents without a confident client match must go to Unassigned Transcripts for employee review.'],
    ['Verify filing', 'Confirm the final document appears under the correct client in Documents → Transcripts.'],
  ] : [
    ['Select the client', 'Choose the correct existing client before starting the transcript request.'],
    ['Verify POA authorization', 'Confirm the appropriate POA/CAF authorization is on file for the practitioner and taxpayer.'],
    ['Choose years and transcript types', 'Select only the tax years and transcript types needed for the request.'],
    ['Authenticate with IRS TDS', 'An authorized practitioner signs in to IRS TDS and completes required IRS identity verification.'],
    ['Retrieve authorized documents', 'Download only documents the practitioner is authorized to access.'],
    ['Connect the download folder when supported', 'In compatible Chrome/Edge browsers, connect a dedicated IRS transcript folder, save IRS PDFs there, and use Scan Now or the automatic scan.'],
    ['Verify filing', 'Confirm the PDF is under the correct client in Documents → Transcripts and review available AI analysis.'],
  ]

  return (
    <section className="irs-help-guide" aria-label="IRS transcript workflow instructions">
      <button type="button" className="irs-help-guide-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span>📖 How to Use This Feature</span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="irs-help-guide-content">
        <p className="irs-help-guide-note">
          Use only transcripts obtained by an authorized practitioner. This CRM does not bypass IRS identity verification and does not claim an IRS Direct API connection unless that office has separately verified authorization and a working contract.
        </p>
        <ol className="irs-help-guide-steps">
          {steps.map(([heading, description], i) => (
            <li key={heading}><strong>{i + 1}. {heading}</strong><span>{description}</span></li>
          ))}
        </ol>
        {section !== 'inbox' && (
          <p className="irs-help-guide-note">
            No confident client match? Open <button type="button" onClick={onOpenInbox}>Unassigned Transcripts</button>. Never assign the document to a different taxpayer just to clear the queue.
          </p>
        )}
        {section === 'inbox' && (
          <p className="irs-help-guide-note">
            Unassigned items are stored in private document storage and remain pending across refresh, browser closure, and logout. If a save error appears, keep the source file and retry.
          </p>
        )}
      </div>}
    </section>
  )
}
