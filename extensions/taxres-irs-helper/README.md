# TaxRes IRS Helper (free Chrome helper)

Sends the IRS transcript PDFs a rep chooses back to the TaxRes CRM, where they are matched to the
client (last 4 of SSN/EIN, tax year, transcript type), filed and analyzed. Anything it can't match
shows up under **Needs a client** on the CRM's IRS Transcripts page.

## What it does
- **Secure Mailbox button (main way):** on the IRS Secure Mailbox page a small panel shows
  "Send N transcripts to CRM". Nothing happens until the rep clicks it. Files are opened one at a
  time, about 1.5 seconds apart.
- **Downloads (backup):** if the rep downloads a transcript PDF from an IRS page, the helper asks
  that IRS page to open the same file again and sends it to the CRM. If it can't, the CRM tells the
  rep to drag the PDF in (or scans the watched download folder).

## What it never does
- Never reads, stores or sends IRS / ID.me passwords, cookies, tokens or session IDs.
- Never signs in, never touches the sign-in pages, never runs in the background on its own.
- Has no `cookies`, `webRequest`, `debugger` or `tabs` permission.
- The IRS session stays in the rep's own browser. Each rep uses their own IRS login.

## Install (each rep, once)
1. Download `taxres-irs-helper.zip` from the CRM (IRS Transcripts page → "Download helper") and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped `taxres-irs-helper` folder.
4. Reload the CRM's IRS Transcripts page. It should say **Helper connected**.

## Files
- `manifest.json` – permissions: `downloads`, `storage`; runs on `*.irs.gov` mailbox/TDS pages and `taxrescrm.app` pages only.
- `mailbox.js` – the Secure Mailbox panel, and re-opening a downloaded file for the backup path.
- `crm-bridge.js` – hands PDF files to the CRM page and passes back the CRM's answer.
- `background.js` – keeps track of which tabs are CRM / IRS tabs and routes files between them.
