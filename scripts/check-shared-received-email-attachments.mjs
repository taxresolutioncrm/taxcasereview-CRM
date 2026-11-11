import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const email=readFileSync('src/pages/Email.jsx','utf8')
const bulk=readFileSync('src/components/ReceivedEmailAttachments.jsx','utf8')
for(const [ok,message] of [
 [email.includes('<ReceivedEmailAttachments key={selected.id}'),'received email reader integration'],
 [email.includes('downloadGmailAttachment(supabase'),'individual received attachment Download unchanged'],
 [email.includes('attachEmailAttachmentToFile(selected, att,'),'individual Attach to File unchanged'],
 [email.includes('addComposeAttachments(event)'),'Compose attachment workflow unchanged'],
 [bulk.includes('fetchGmailAttachmentBlob'),'reuse employee Gmail connection'],
 [bulk.includes("employeeEmail: email.mailbox_owner"),'owning mailbox retrieval'],
 [bulk.includes('authorizedMailbox') && bulk.includes('mailboxOwner'),'mailbox-owner isolation'],
 [bulk.includes("supabase.rpc('current_tenant_id')"),'authoritative office resolution'],
 [bulk.includes("p_column:'perm_documents'"),'document permission guard'],
 [/\.eq\('tenant_id',\s*tenantId\)\.eq\('id',\s*selected\.id\)/.test(bulk),'exact client and office query'],
 [bulk.includes('client_document_folder_id:folderId'),'client document folder ID'],
 [bulk.includes("upsert:false"),'storage never overwrites'],
 [bulk.includes("eq('storage_path',path)"),'repeat-filing duplicate avoidance'],
 [bulk.includes('email.gmail_message_id') && bulk.includes('att.attachmentId'),'source mail and attachment identifiers'],
 [bulk.includes("outcome.push({name,status:'error'"),'per-file failure reporting'],
 [bulk.includes("URL.revokeObjectURL(preview.url)"),'preview URL cleanup'],
 [bulk.includes("sandbox=\"\""),'PDF preview iframe sandbox'],
 [bulk.includes("preview.kind==='text'"),'plain text rendered as text'],
 [!bulk.includes('dangerouslySetInnerHTML'),'no unsafe HTML injection'],
 [!bulk.includes('m365-mail-gateway'),'no accidental Nashville-specific provider assumptions'],
]) assert(ok, 'Received email attachments: '+message)
console.log('PASS shared received email attachment regression')
