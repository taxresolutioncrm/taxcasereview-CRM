# IRS TDS API Technical Integration

*Research compiled September 23, 2026*

---

## Sourcing Note

The primary public technical document for this integration is the **IRS e-Services API Authorization User Guide** (November 2022), publicly available via GovDelivery:
`https://content.govdelivery.com/attachments/USIRS/2022/11/21/file_attachments/2335011/IRS%20eServices%20API%20Authorization%20User%20Guide.pdf`

Additional sources include IRS procedural updates (FOIA-released), the IRS e-Services PIA, and IRS.gov developer pages. The product-specific TDS and SOR API guides (request/response schemas, payload structure, SOR retrieval endpoints) are **not publicly available** — they require enrollment in IRS e-Services and receipt of a Client ID before the IRS provides detailed product documentation. The answers below distinguish confirmed facts from reasonable inference.

---

## DELIVERY / SOR

### Does TDS return the transcript inline or deposit to SOR?

**SOR Deposit (confirmed).** The IRS has explicitly moved away from on-screen transcript delivery for API/software integrators. The confirmed delivery pathway is:

- TDS processes the request and **deposits the transcript into the practitioner's SOR mailbox** (Secure Object Repository).
- The 2024 IRS e-Services overview confirms: "TDS allows authorized users to electronically request transcripts to be delivered in an on-screen format or to the user's secure mailbox." For API-based access, SOR mailbox delivery is the designated method.
- The IRM 3.42.8 procedural work instructions (FOIA-released) consistently describe the flow as: TDS request → IRS processes → transcript placed in the practitioner's SOR mailbox → practitioner or software retrieves it.

**Inference/caveat:** Whether the API-based TDS call returns a polling status (with a job/transaction ID you later use to retrieve from SOR) vs. delivering a direct content URL is not documented in any publicly available spec. The FBP A2A User Guide (for 4506-C forms) does show a content retrieval pattern at `https://api.www4.irs.gov/fbp/1.0/a2a/products/{productId}/content` returning `text/html`, suggesting inline content is technically possible for some products. Whether TDS uses this same pattern or routes to a separate SOR retrieval step is not confirmed in public documentation.

### Is SOR a separate API contract with its own endpoint?

**Yes, SOR is a distinct system, but publicly confirmed as using the same OAuth access token.** The IRS e-Services PIA and API guide identify SOR, TDS, and TIN Matching as three separate API products under the e-Services umbrella, all authenticated via the same OAuth infrastructure (`api.www4.irs.gov`). The specific SOR retrieval endpoint path is **not disclosed in any publicly available document**. SOR does not appear to require a separate OAuth registration — your Client ID credential covers whichever e-Services products you're enrolled for, but the actual endpoint to retrieve an object from SOR is only provided to enrolled API participants.

**SOR retention rule (confirmed):** IRM 3.42.8 specifies:
- TDS-deposited transcripts: **3 business days** if read / **30 business days** if unread
- TIN Matching results: same schedule

### How does the TDS transaction ID correlate to the SOR object?

**Not publicly documented** at the API level. At the browser/manual level, the TDS records all requests in "TDS Transaction History" (14 months of records). For the software API, the FBP A2A guide uses a `transactionId` in the format `form4506c_05_2022-20220629-00d5cd6fad214861b75a9e6c348f6c94`, and products reference this `transactionId`. Whether TDS API responses return an equivalent `transactionId` that maps to a SOR message/object ID is **not publicly specified**. IRS FOIA documents reference a "SOR ID" (e.g., `SORID xxxxxxxx`) as a separate identifier from the TDS transaction ID, suggesting they are distinct but correlated — the exact mapping mechanism is in the product guide available only post-enrollment.

### How is the final PDF/data retrieved?

**Via SOR retrieval** (confirmed conceptually; endpoint not public). The 2024 IRS overview states: "Retrieve transcripts and TIN matching results from the secure mailbox." The SOR object is accessed programmatically through the SOR API (same auth, separate endpoint path). There is no confirmed "download URL" embedded in a TDS status response available in public documents. The most likely flow (inferred from the FBP A2A pattern and IRS architecture documents): poll TDS for status → on completion, a SOR object ID or message ID is returned → call SOR retrieval endpoint with that ID to get the transcript content. Whether the content is returned inline (as in the FBP content endpoint) or as a pre-signed download URL is unknown from public sources.

### Is acknowledgment/deletion/retention behavior required?

**Retention rules are confirmed; explicit API-level acknowledgment is not publicly documented.** Confirmed:
- SOR auto-deletes transcripts **3 business days after first read**, or **30 business days unread**.
- TDS Transaction History retains records for **14 months**.
- No explicit API-level "acknowledge and delete" call is described in any public document. The FBP A2A guide does not mention acknowledgment. It is plausible that retrieval constitutes acknowledgment (triggering the 3-day read timer), but this is inference.

---

## TOKEN LIFECYCLE

All token lifecycle details below are **confirmed** from the IRS e-Services API Authorization User Guide.

### Access token lifetime

**15 minutes (900 seconds).** Exact quote: "the value '900' denotes that the access token will expire in 15 minutes."

### Does the authorization-code response include a refresh_token?

**Yes.** The token response includes a `refresh_token` field alongside the `access_token`.

### Is refresh_token grant permitted?

**Yes.** The guide explicitly documents `grant_type=refresh_token` as a supported grant type with example request syntax.

### Is refreshing only permitted within a one-hour ISP authorization window?

**Yes — the refresh_token itself expires after one hour.** Exact quote: "access token will expire after 15 minutes and refresh token gets revoked after one hour." The refresh token is not renewable; once the one-hour window closes, no further token refresh is possible under that authorization grant.

### Must the practitioner reauthenticate after ~1 hour?

**Yes, confirmed.** Exact quote from the guide: "When revokes occur, the ISP needs to get new access token and refresh token by taking the user back to step 2" — step 2 being the redirect to the IRS authorization endpoint, which requires the practitioner to re-authenticate (IRS login + 2FA).

**Implication:** Within any given session window, an ISP application can use the initial 15-minute access token and refresh it (getting new 15-minute access tokens) for up to 1 hour total. After 1 hour, the practitioner must go back through the full browser-based login flow.

---

## ISP ENDPOINTS

All values below are **confirmed** from the API Authorization User Guide.

### Authorization endpoint URL

```
https://api.www4.irs.gov/auth/oauth/v2/authorize
```
Test environment: `https://api.alt.www4.irs.gov/auth/oauth/v2/authorize`

### Token endpoint URL

```
https://api.www4.irs.gov/auth/oauth/v2/token
```
Test environment: `https://api.alt.www4.irs.gov/auth/oauth/v2/token`

### Required scope(s)

**Not specified in the API Authorization User Guide.** No scope parameter strings are documented in any publicly available IRS document. Scope values are likely provided in the product-specific developer guides distributed post-enrollment. The authorization URL example in the guide shows only `client_id` and `response_type=code` — no `scope` parameter is shown in the ISP flow example.

### Required authorization query parameters (ISP flow)

Confirmed required parameters:
- `client_id` = your registered Client ID
- `response_type` = `code`
- `state` = optional but supported (passed back to redirect URI)

**Not confirmed:** whether `redirect_uri`, `scope`, or `nonce` are also required query parameters. The guide's example shows the minimal `client_id` + `response_type=code` form only.

### ISP "Grant Access" / consent screen — what triggers it?

**The IRS Consent App is triggered at Step 4 of the authorization flow**, when the user reaches the authorization endpoint and the auth server evaluates whether consent exists. Confirmed:

- The authentication server redirects to the **IRS Consent App** at `https://la.www4.irs.gov/esrv/consent/` as part of the authorization endpoint response.
- If consent does not yet exist for the requesting application, the user is prompted to grant it.
- For A2A flow: "If consent does not exist, A2A login endpoint returns 401 Unauthorized response with reason for denial." Pre-authorization via the Consent App is required before A2A transactions succeed.
- For ISP flow: "User will be prompted to authorize the application through the Consent App" during the authorization redirect.

**It is IRS-specific**, not a generic OAuth consent screen. The Consent App is a separate IRS web application the user must interact with during the OAuth redirect. One third-party guide (TaxHelpSoftware A2A Instructions) confirms the sequence: user logs into the Consent App, selects their organization, navigates to "A2A setup," selects the environment (PROD/TEST), and clicks "Grant Access." The guide also warns: "DO NOT SELECT INDIVIDUAL — It never has access to TDS." The user must select their **organization** to get TDS access.

### JWT client assertion: required claims, expected `aud` value, JWK requirements

**Required JWT claims (confirmed):**

| Claim | Value |
|-------|-------|
| `iss` | Client ID (from registration) |
| `sub` | Client ID (for client JWT); User ID (for user JWT in A2A) |
| `aud` | The token endpoint URL (`https://api.www4.irs.gov/auth/oauth/v2/token`) |
| `exp` | Current time + 15 minutes (numeric Unix timestamp) |
| `jti` | Unique identifier per request (replay prevention) |

**Header claims required:**
- `alg` — algorithm (RSA-based)
- `kid` — Key ID matching the registered JWK

**Exact `aud` value:** The guide states `aud` = "the IRS authorization server. The token endpoint of the auth server." The literal expected string is `https://api.www4.irs.gov/auth/oauth/v2/token` (inferred from the token endpoint URL; the guide does not print the exact string but defines it as "the token endpoint").

**JWK requirements (confirmed):**
```json
{
  "kty": "RSA",
  "kid": "<your key ID>",
  "use": "sig",
  "n": "<modulus>",
  "e": "AQAB",
  "x5c": ["<X.509 certificate chain>"],
  "x5t": "<SHA-1 thumbprint>"
}
```
Both `x5t` and `x5c` are required. The guide notes: "It is your responsibility to keep track of the JWK expiration date and provide a new one once the current JWK expires."

### Redirect URI rules

- Redirect URI must be registered with the IRS at application registration time.
- The auth server validates the redirect URI on each request; mismatches return `invalid_redirect_uri`.
- The guide does not specify additional constraints (localhost restrictions, HTTPS requirement, wildcard rules) — these are likely in the enrollment materials.

---

## GRANT ACCESS FLOW

### Expected live flow

Based on confirmed documentation:

1. **CRM/software** initiates authorization: redirects practitioner browser to `https://api.www4.irs.gov/auth/oauth/v2/authorize?client_id=X&response_type=code`
2. **IRS auth server** evaluates: if consent not pre-established, redirects to IRS Consent App at `https://la.www4.irs.gov/esrv/consent/`
3. **Practitioner** authenticates to IRS e-Services via ID.me or IRS.gov credentials (including MFA/2FA)
4. **Consent App** displays — practitioner sees available organizations; must select their **firm/organization** (not "Individual")
5. **Grant Access** — practitioner navigates to A2A/API setup section and clicks "Grant Access" button
6. **System generates** authorization code, redirects back to the registered redirect URI: `https://your-redirect-uri.example.com/callback?code=XXXXXX&state=YYYY`
7. **CRM backend** receives the authorization code (valid for 10 minutes)
8. **CRM** calls token endpoint with `grant_type=authorization_code`, `code=XXXXXX`, plus signed `client_assertion` JWT
9. **IRS** returns `access_token` (15-min TTL) + `refresh_token` (1-hr TTL)
10. **CRM session is active** — API calls proceed with Bearer token in Authorization header

### Where is Grant Access triggered?

At step 4/5 above — within the **IRS Consent App**, which is invoked as part of the authorization endpoint redirect. Grant Access is not a parameter in the authorization URL; it is a user action inside the Consent App after authentication.

### Standard OAuth consent or IRS-specific?

**IRS-specific.** The Consent App is a custom IRS application at `https://la.www4.irs.gov/esrv/consent/` with IRS-specific navigation (organization selection, A2A setup section, PROD/TEST environment choice). It does not behave like a generic OAuth consent screen (e.g., Google's "Allow this app to access..."). The practitioner must actively navigate to the API/A2A configuration section and click "Grant Access" — it is not a simple "Accept" button on a permission list.

---

## WHAT REQUIRES ENROLLMENT TO ACCESS

The following are **not publicly documented** and require IRS e-Services enrollment + Client ID receipt before the IRS provides the documentation:

- Specific SOR API endpoint URL(s) for retrieving deposited transcripts
- TDS API endpoint URL(s) for submitting transcript requests and polling status
- OAuth scope string values required for TDS/SOR access
- Request/response JSON or XML schemas for TDS and SOR
- The exact mechanism by which a TDS transaction ID maps to a SOR object/message ID
- Whether retrieval from SOR requires an explicit "delete after read" acknowledgment call
- Whether transcripts are returned inline in the SOR retrieval response or via a pre-signed URL
- Specific redirect URI validation rules (HTTPS required, localhost allowed, etc.)

The IRS e-Help Desk for e-Services (866-255-0654) and the enrollment portal at `https://la.www4.irs.gov/esrv/esam/pages/landingPage.xhtml` are the paths to obtaining this restricted documentation.

---

## Sources

- [IRS e-Services API Authorization User Guide (Nov 2022)](https://content.govdelivery.com/attachments/USIRS/2022/11/21/file_attachments/2335011/IRS%20eServices%20API%20Authorization%20User%20Guide.pdf) — primary technical source
- [TDS SOR Mailbox Work Instruction WI-21-0424-0475 (FOIA)](https://www.irs.gov/pub/foia/ig/sbse/wi-21-0424-0475%20redacted.pdf) — SOR delivery confirmation
- [IRS Get an API Client ID page](https://www.irs.gov/tax-professionals/get-an-api-client-id) — product overview
- [IRS e-Services Privacy Impact Assessment (Dec 2024)](https://www.irs.gov/pub/irs-pia/eserv-pia.pdf) — system architecture
- [IRM 3.42.8 E-Services Procedures](https://www.irs.gov/irm/part3/irm_03-042-008) — SOR retention rules (3/30 day policy)
- [TaxHelpSoftware A2A Instructions (third party)](https://taxhelpsoftware.com/Downloads/A2A_Instructions.pdf) — Grant Access flow detail
- [SOR Privacy Impact Assessment](https://www.irs.gov/pub/irs-pia/sor-pia.pdf) — SOR system overview
- [FBP A2A User Guide (Nov 2022)](https://content.govdelivery.com/attachments/USIRS/2022/11/21/file_attachments/2335060/fbpA2AUserGuide_v2.pdf) — product retrieval pattern reference
- [IRS Transcript Delivery System page](https://www.irs.gov/tax-professionals/transcript-delivery-system-tds)
- [IRS E-Services and You (2024 NTF)](https://www.irs.gov/pub/irs-npl/2024ntf-e-services-and-you.pdf)
