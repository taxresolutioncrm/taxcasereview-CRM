# Karbon → TaxRes migration: controlled preflight (v1)

**Status: read-only tool, not a production importer or migration certification.**

## Why this exists
An existing Karbon customer should never be asked to risk client records, mail history, staff assignments or employee access merely to try TaxRes. Karbon supports API access to contacts and work items, notes, and document upload workflows; actual export scope, authorization and historical conversation fidelity must be confirmed per customer. See [Karbon Developer Center](https://developers.karbonhq.com/) and [Karbon API reference](https://github.com/karbonhq/karbon-api-reference/blob/master/KARBON_API.md).

## Contract: preflight only
The `preflight.mjs` command:
- Uses local, **operator-authorized** exports; no Karbon keys or Supabase credentials.
- Does not connect to any database, call network endpoints, create employees, send messages, mutate source records or perform an import.
- Accepts JSON arrays/OData `value` or `items` arrays, or CSV files for `contacts`, `work-items`, `notes`, `documents`, `communications`.
- Requires a target-tenant UUID and an explicit approved source-assignee-email → **existing TaxRes employee profile ID** mapping. It does not infer assignments from names or create new users.
- Reports duplicate source keys, missing client/work references, unknown assignees, document file/path/checksum failures.
- Generates an aggregate, private `0600` JSON report with **no source names, emails or document contents**.
- Can report `READY_FOR_SANDBOX_REVIEW` only; **never production-cutover authorization**.

### Input directory structure
```text
/secured-karbon-export/
  contacts.json                   # ContactKey or OrganizationKey
  work-items.json                 # WorkItemKey, ClientKey, AssigneeEmailAddress
  notes.json                      # NoteKey, WorkItemKey/ContactKey
  documents.json                  # DocumentKey, ContactKey, relative_path, sha256
  communications.json             # CommunicationKey, ContactKey or WorkItemKey
  sample.pdf                      # example only — file contents never in report
```
Each `.json` file may instead be an authorized `.csv` file with equivalent columns. Document files must be inside the export directory (no absolute or traversal paths).

### Approved existing-employee mapping
```json
{
  "tenant_id": "11111111-1111-4111-8111-111111111111",
  "employees": {
    "source.assignee@example.test": "22222222-2222-4222-8222-222222222222"
  }
}
```
This is **not** an Auth identity replacement. Before permitting staging writes, independently compare each mapped ID with active **TaxRes employee rows, Auth IDs, tenant, roles, and permissions**. No role promotion, profile replacement or password reset is authorized.

### Run
```bash
node tools/karbon-migration/preflight.mjs \
  --input /path/to/secure-export \
  --employee-map /path/to/approved-existing-employees.json \
  --tenant 11111111-1111-4111-8111-111111111111 \
  --out /path/outside/export-directory/preflight-report.json
```
Exit 0 = structurally ready for further **sandbox** review; exit 2 = blocking links/mappings/integrity problems; exit 1 = invalid input/operation. Do **not** place exported PII or reports into GitHub or paste them into issue comments.

### Produce a local-only staging packet (no database writes)

After a passing preflight, the companion staging tool creates a deterministic, **private** local JSON packet containing the authorized source records, source keys, target-tenant ID, approved existing employee profile mappings, and file hashes. This is an input artifact for future **isolated** importer development; it does not import anything or turn on email/SMS, payroll, or billing.

```bash
node tools/karbon-migration/stage.mjs \
  --input /path/to/secure-export \
  --employee-map /path/to/approved-existing-employees.json \
  --tenant 11111111-1111-4111-8111-111111111111 \
  --out /path/outside/export-directory/staging-packet.json
```

The staging command requires complete JSON exports for all five dataset groups, verifies document paths and SHA-256 checksums, and **refuses** a packet if preflight finds missing client relationships, duplicate keys, or unapproved assignees. It refuses CSV at this step; convert a validated authorized CSV export to a complete JSON array before staging. The staging packet includes original exported PII, so **store it securely with limited access and delete it according to the firm's approved retention policy. Never commit it, email it or upload it to an issue.**

Neither a preflight report nor a local staging packet is evidence of a completed migration. They have not established historical Karbon API export completeness or tested database insertion, role preservation, user sign-in, communication history, or restore.

### Required next development gates
1. **Read-only authorized extraction:** confirm the firm's Karbon subscription/API access; traverse pagination; inventory metadata and totals for contacts, work, notes, documents, time entries, email history and custom fields, recording any unavailable entities. Prefer provider-supported exports; do not scrape logged-in user sessions or store customer API keys in git.
2. **Tenant-safe staging importer:** build idempotent source-key mappings to a dedicated isolated tenant. Preserve timestamps, user associations and original source keys in a mapping journal. Explicitly suppress emails/SMS, external integrations, invoice creation, recurring jobs and notifications in staging.
3. **Reconciliation:** check record counts, references, duplicate sets, attachment hashes, missing threads, assignment matches, and sample real-world UI workflows; any missing conversation history must remain visible as a blocker.
4. **Pilot:** test with synthetic or customer-authorized data; users review the actual workflow in both systems with current Karbon work unaffected.
5. **Cutover authorization:** signed scope, production backup with tested restore, read-only freeze/delta handling, dual-run controls, rollback checklist, named owner approval and post-deploy login tests. **Never assume full export coverage.**

### Non-negotiable
A blocked preflight does not modify either platform. A passing preflight does not promise that communications, attachments or metadata are fully transferable; the availability and fidelity of those records require independent confirmation. For Centurion, keep Karbon as the system of record until its owner explicitly authorizes a tested migration. Nashville is a separate Supabase project and is outside this scope.
