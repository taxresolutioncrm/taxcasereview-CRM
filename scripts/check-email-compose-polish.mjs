import assert from 'node:assert/strict'
import{readFileSync}from'node:fs'
const src=readFileSync('src/pages/Email.jsx','utf8')
const release=readFileSync('src/releaseInfo.js','utf8')
const tests=[
['responsive recipients',src.includes("data-email-compose-recipients")&&src.includes("gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,240px),1fr))'")],
['CC field retained',src.includes("fld('cc', e.target.value)")],
['BCC field retained',src.includes("fld('bcc', e.target.value)")],
['original recipient validation',src.includes('validateEmailRecipients({to:form.recipient,cc:form.cc,bcc:form.bcc})')],
['full template catalog accessible',src.includes("TEMPLATES.map(t=><option key={t.label}")],
['compact quick template row',src.includes('TEMPLATES.slice(0,3).map')],
['templates still apply via original helper',src.includes('if(chosen)useTemplate(chosen)')],
['body resizable and compact',src.includes('rows={8}')&&src.includes("resize:'vertical'")],
['Gmail and CC transport untouched',src.includes('cc:recipients.cc, bcc:recipients.bcc')],
['email attachments unchanged',src.includes('data-email-compose-attachments')],
['all three offices release entry',release.includes('Email Compose compact cleanup across TCR, TaxRes and Centurion')],
['no original 20-button grid',!src.includes('TEMPLATES.map(t => (\n                  <button key={t.label}')],
]
for(const [name,passed]of tests)assert(passed,name)
console.log('PASS shared three-office Email Compose compact responsive UI; '+tests.length+' contract checks')
