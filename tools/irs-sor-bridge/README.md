# TaxRes IRS SOR Bridge

This browser extension bridges an already-authenticated IRS Secure Object Repository (SOR) browser session back into the TaxRes CRM.

It does **not** store IRS passwords, ID.me credentials, MFA codes, or IRS cookies.

## Install for sandbox acceptance testing

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `TaxRes-IRS-SOR-Bridge-1.1.0` folder.
5. Confirm the extension shows **TaxRes IRS SOR Bridge 1.1.0**.
6. Open the TaxRes IRS Portal. The status must change from **SOR bridge not detected** to **SOR bridge connected**.

## Acceptance test

1. In TaxRes IRS Portal, select the intended client and confirm an On File POA covers the requested tax year.
2. Click **Sign in to IRS TDS** and authenticate through IRS / ID.me.
3. Request or retrieve a transcript through IRS TDS/SOR.
4. Open the SOR message containing the TDS transcript attachment.
5. Return to the TaxRes IRS Portal.
6. Verify the transcript is received, matched to the intended client, filed under Documents → Transcripts, and visible in Transcript Analysis.
7. Verify the request status/coverage updates for the returned year/type.
8. Verify the browser bridge queue clears only after the CRM acknowledges the filed transcript.
