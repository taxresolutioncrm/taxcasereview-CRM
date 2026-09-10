# RomyLabs Phone Cutover — staged, not deployed

Temporary RomyLabs main DID: +1 561-420-6999
Current TaxRes local voice DID: +1 561-420-6665
Current TaxRes toll-free DID: +1 888-334-5052

## Production cutover order
1. Apply `supabase/migrations/20260909133000_romylabs_voicemail_transcription.sql`.
   - Adds nullable voicemail transcript/status fields.
   - Adds tenant+CallSid idempotency indexes for voicemails, call recordings, and AI summaries.
2. Deploy the new/updated phone edge functions with the JWT settings in `supabase/config.toml`.
3. Confirm the RomyLabs control-plane settings row has `sw_inbound_did=+15614206999`.
4. Confirm the existing SignalWire signing secret and Groq/Gmail configuration remain available to the deployed functions.
5. Point SignalWire DID +15614206999 voice webhook to:
   `https://mpxgxfqdbquzkrvvejkh.supabase.co/functions/v1/romylabs-receive-call`
   Method: POST
6. Verify before merging the Admin Portal UI:
   - inbound greeting says RomyLabs
   - 1 Sales rings Admin Portal
   - 2 Support rings Admin Portal
   - 3 Billing rings Admin Portal
   - 4 Representative rings Admin Portal
   - 5 records RomyLabs voicemail
   - no selection routes to voicemail
   - after-hours routes directly to voicemail
   - unanswered daytime call reaches voicemail with Admin Portal open
   - unanswered daytime call reaches voicemail with Admin Portal closed
   - voicemail appears in Admin Portal with private audio playback
   - voicemail transcription completes or fails gracefully without losing audio
   - voicemail notification reaches info@romylabs.com
   - missed/inbound call appears in Recent Calls and Call Back works
   - outbound Admin Portal call presents +15614206999
   - outbound call recording appears under Recordings & AI Summaries
   - RomyLabs AI summary uses business/software context, not tax-resolution context
   - hold, resume, add caller, external transfer, hangup and refresh recovery work
   - TaxRes +15614206665 remains unaffected
   - TaxRes toll-free +18883345052 remains unaffected
7. Only after all phone tests pass, merge the Admin Portal UI branch.

## Rollback
Restore +15614206999 to the previous fax webhook/configuration.
No TaxRes voice DID should be changed during this cutover.
