import assert from 'node:assert/strict'
import{readFileSync}from'node:fs'
import{validateEmailRecipients}from'../src/lib/emailRecipients.js'
let v=validateEmailRecipients({to:'first@example.com; second@example.com',cc:'third@example.com',bcc:'hidden@example.com'})
assert.deepEqual(v.to,['first@example.com','second@example.com'])
assert.deepEqual(v.bcc,['hidden@example.com'])
assert.throws(()=>validateEmailRecipients({to:'bad; first@example.com'}))
assert.throws(()=>validateEmailRecipients({to:'first@example.com',cc:'first@example.com'}))
for(const [path,strings]of Object.entries({
 'src/pages/Email.jsx':['validateEmailRecipients','recipients.cc','recipients.bcc','CC (visible copies)','BCC (private copies)'],
 'src/components/QuickEmail.jsx':['validateEmailRecipients','cc:recipients.cc','bcc:recipients.bcc'],
 'src/lib/gmailUtils.js':["'Cc: '","'Bcc: '",'...addressHeaders'],
 'supabase/functions/smtp-send/index.ts':['ccList=recipients(cc','bccList=recipients(bcc','to: allRecipients','bcc:opts.bcc.map','...(opts.cc?.length ?'],
 'supabase/functions/demo-send-email/index.ts':["list(body.cc,'CC')","list(body.bcc,'BCC')",'        bcc,'],
})) {
 const content=readFileSync(path,'utf8')
 strings.forEach(str=>assert(content.includes(str),path+' missing '+str))
}
console.log('PASS shared CC/BCC parsing and provider contract tests')
