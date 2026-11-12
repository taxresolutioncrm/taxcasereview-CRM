import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const email=readFileSync('src/pages/Email.jsx','utf8')
const bulk=readFileSync('src/components/ReceivedEmailAttachments.jsx','utf8')
const release=readFileSync('src/releaseInfo.js','utf8')
const pkg=JSON.parse(readFileSync('package.json','utf8'))
const contracts=[
 ['received reader',email.includes('<ReceivedEmailAttachments key={selected.id}')],
 ['original Download',email.includes('downloadGmailAttachment(supabase')],
 ['individual Attach to File',email.includes('attachEmailAttachmentToFile(selected, att,')],
 ['Compose attachment',email.includes('addComposeAttachments(event)')],
 ['existing CC/BCC',email.includes("fld('cc', e.target.value)")&&email.includes("fld('bcc', e.target.value)")],
 ['authorized Gmail',bulk.includes('fetchGmailAttachmentBlob')&&bulk.includes('employeeEmail: email.mailbox_owner')],
 ['mailbox guard',bulk.includes('authorizedMailbox')&&bulk.includes('gmailReady')],
 ['tenant and permission',bulk.includes("supabase.rpc('current_tenant_id')")&&bulk.includes("p_column:'perm_documents'")],
 ['client identity',/\.eq\('tenant_id',\s*tenantId\)\.eq\('id',\s*selected\.id\)/.test(bulk)],
 ['folder',bulk.includes('client_document_folder_id:folderId')&&bulk.includes("eq('tenant_id', tenantId).eq('client_id', clientId)")],
 ['nonempty batch',bulk.includes('attachments.length > 0')],
 ['duplicate check',bulk.includes("eq('storage_path',path)")],
 ['no overwrite',bulk.includes('upsert:false')],
 ['source IDs',bulk.includes('email.gmail_message_id')&&bulk.includes('att.attachmentId')],
 ['partial results',bulk.includes("outcome.push({name,status:'error'")],
 ['private bucket',bulk.includes("supabase.storage.from('documents')")],
 ['sandbox PDF',bulk.includes('sandbox=""')],
 ['no script HTML',!bulk.includes('dangerouslySetInnerHTML')],
 ['text safe',bulk.includes("preview.kind==='text'")],
 ['image MIME allowlist',bulk.includes("const imageMime={jpg:'image/jpeg'")],
 ['URL cleanup',bulk.includes('URL.revokeObjectURL(preview.url)')],
 ['version',Boolean(/^3\\.2\\.\\d+$/.test(pkg.version)) && release.includes(`version: '${pkg.version}'`)],
 ['office parity',(release.match(/version: DEFAULT_RELEASE.version/g)||[]).length===2],
]
for(const [name,passed]of contracts)assert(passed,'Inbound email contract: '+name)
console.log('PASS '+contracts.length+' shared received-attachment and source parity contracts')
