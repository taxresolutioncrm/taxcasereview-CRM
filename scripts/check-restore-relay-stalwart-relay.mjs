import { readFileSync } from 'node:fs'
const src=readFileSync('supabase/functions/support-api/index.ts','utf8')
const must=[
  "restore_relay: new Set(['booking_invite', 'booking_confirmation', 'booking_office_notification', 'training_invite', 'client_meeting_invite'])",
  "name: 'Restore Relay'",
  "{ p_product_key: product }",
  "romylabs_stalwart_transport_for_product",
  "sendSystemMailViaStalwart",
  "provider: 'STALWART_JMAP'",
  "npm:@noble/hashes@1.8.0/hmac.js",
  "npm:@noble/hashes@1.8.0/sha2.js",
]
for(const marker of must){
  if(!src.includes(marker)) throw new Error('Restore Relay central Stalwart relay guard missing: '+marker)
}
if(src.includes("if (product !== 'arcvena') return authError()")) throw new Error('Central system-mail relay still Arcvena-only')
console.log('PASS Restore Relay booking and live-session mail are authorized through the central Stalwart/JMAP relay')
console.log('PASS central relay keeps per-product kind and branding restrictions')

if(src.includes("crypto.subtle.sign('HMAC'")||src.includes('crypto.subtle.sign("HMAC"')) throw new Error('Central HMAC verification must not use the WebCrypto path that EarlyDrop-hung in production')
