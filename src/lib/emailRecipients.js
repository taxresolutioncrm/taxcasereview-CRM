// Shared recipient parsing and strict pre-send checks.
export function parseEmailRecipients(input, label = 'Recipient') {
  const values=(Array.isArray(input)?input:String(input||'').split(/[;,]/)).map(x=>String(x).trim()).filter(Boolean)
  if(values.length>25)throw Error(label+' allows at most 25 addresses')
  const result=[...new Set(values.map(x=>x.toLowerCase()))]
  for(const email of result)if(!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)||/[\r\n]/.test(email))
    throw Error('Invalid '+label+' address: '+email)
  return result
}
export function validateEmailRecipients({to,cc,bcc}) {
  const groups={to:parseEmailRecipients(to,'To'),cc:parseEmailRecipients(cc,'CC'),bcc:parseEmailRecipients(bcc,'BCC')}
  if(!groups.to.length)throw Error('A To recipient is required')
  const all=[...groups.to,...groups.cc,...groups.bcc]
  if(all.length>25)throw Error('Maximum 25 recipients per message')
  if(new Set(all).size!==all.length)throw Error('Address duplicated across To, CC or BCC')
  return groups
}
