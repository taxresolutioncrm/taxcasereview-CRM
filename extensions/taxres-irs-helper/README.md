# TaxRes IRS Helper (free Chrome helper)

Sends the IRS transcript PDFs a rep chooses back to the TaxRes CRM, where they are matched to the
client (last 4 of SSN/EIN, tax year, transcript type), filed and analyzed. Anything it can't match
exactly shows up under **Needs a client** on the CRM's IRS Transcripts page.

## Which office gets the files
- Every IRS window is tied to the CRM tab that opened it ("Sign in to IRS", "Secure Mailbox" or
  "Request Transcripts"). The CRM adds a one-time pairing code after `#` in the IRS address; browsers
  never send that part to the IRS. The helper panel always shows **Sends to: <office>**.
- Files from that window go only to that CRM tab, and only while it is still signed in to the same office
  the window was opened for. There is no fallback: if that tab is closed or now signed in to another office,
  nothing is sent and the rep is told to open Secure Mailbox again from the right CRM tab.
- An IRS window that was not opened from the CRM sends nothing.
- The CRM page also refuses any file addressed to a different office.

## What it does
- **Secure Mailbox button (main way):** on an IRS mailbox/message page (never on the TDS request pages) a small panel shows
  "Send N transcripts to CRM". Nothing happens until the rep clicks it. Files are opened one at a
  time, about 1.5 seconds apart. It finds attachments in plain links, links and buttons that open the
  file from page code, `view_file.jsp`-style addresses, GET and POST attachment forms, pages that wrap
  the PDF in a frame, frames inside the message, and message links (it opens the message and sends
  the files inside). An attachment that only the page's own code can open is clicked for the rep and
  caught when it opens: a download, a new tab that identifies the exact window that opened it, or this
  window itself. If it still won't open, the panel says "click it yourself" and catches it (the same way)
  when the rep clicks it within 2 minutes. Only simple attachment forms (hidden fields + a button) are
  replayed; forms with drop-downs, typed fields or sign-in boxes never are.
- **Downloads (backup):** if the rep downloads a transcript PDF in an IRS window opened from the CRM,
  the helper asks that IRS page to open the same file again and sends it to that window's office. It only
  does this when it is certain which window the download came from (the exact link clicked there, or the
  only IRS window in use at that moment); otherwise it sends nothing. If the file can't be re-opened, the CRM
  tells the rep to drag it in.
- **Duplicates:** the CRM checks the PDF's bytes (SHA-256) against everything already filed in the
  office; that check is final. The helper's own "already sent" memory is only there so the button
  doesn't offer the same files twice, and only counts files the CRM filed or already had ("Needs a
  client" files are offered again). **Send all again** resends everything and lets the CRM decide.

- **Page outline (for support):** a link at the bottom of the panel shows how the IRS page is built —
  tags, address shapes and function names — with every name, number, text and field value blanked out.
  The rep copies it by hand only if support asks (for example if the helper finds no attachments on the
  real mailbox). The helper never sends it anywhere.

## What it never does
- Never reads, stores or sends IRS / ID.me passwords, cookies, tokens or session IDs.
- Never runs on sign-in pages, never touches a form with a password box, never signs in.
- Never clicks or opens delete, archive, move, reply, log-out or settings links.
- Has no `cookies`, `webRequest`, `webNavigation`, `debugger` or `tabs` permission.
- Stores only tab numbers, office IDs, request IDs and SHA-256 fingerprints (never addresses or files).
- The IRS session stays in the rep's own browser. Each rep uses their own IRS login.

## Install (each rep, once)
1. Download `taxres-irs-helper.zip` from the CRM (IRS Transcripts page → "Download helper") and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped `taxres-irs-helper` folder.
4. Reload the CRM's IRS Transcripts page. It should say **Helper connected**.

## Files
- `manifest.json` – permissions: `downloads`, `storage`; runs on `*.irs.gov` pages (not sign-in pages) and `taxrescrm.app` pages only.
- `mailbox.js` – the Secure Mailbox panel, finding attachments, and re-opening a file for the backup path.
- `crm-bridge.js` – tells the helper which office the CRM tab is in, hands PDFs to the CRM page, passes back the answer.
- `background.js` – ties each IRS window to its CRM tab/office and routes files only there.
