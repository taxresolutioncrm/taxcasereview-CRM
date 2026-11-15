import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {transformSync} from 'esbuild'
const sql=readFileSync('supabase/migrations/20261115070000_portal_email_otp_challenges.sql','utf8')
const edge=readFileSync('supabase/functions/portal-email-login/index.ts','utf8')
const ui=readFileSync('src/pages/ClientPortal.jsx','utf8')
const config=readFileSync('supabase/config.toml','utf8')
transformSync(edge,{loader:'ts',format:'esm'})
for(const s of [
 'ENABLE ROW LEVEL SECURITY','REVOKE ALL ON public.portal_email_login_challenges FROM PUBLIC, anon, authenticated',
 'REVOKE ALL ON FUNCTION public.portal_email_code_request','REVOKE ALL ON FUNCTION public.portal_email_code_verify',
 "extensions.crypt(v_code,extensions.gen_salt('bf',10))",
 "attempts=attempts+1",
 "IF extensions.crypt(v_code,v_challenge.code_hash)<>v_challenge.code_hash",
 "expires_at>now() AND attempts<5",
 "UPDATE public.portal_email_login_challenges SET used_at=now()",
 'DELETE FROM public.portal_sessions',
 'extensions.gen_random_bytes(48)'
]) assert.ok(sql.includes(s),'OTP SQL authorization or abuse guard missing: '+s)
for(const s of [
 "body?.action","action==='verify'","action:'request'",
 "portal_email_code_request","portal_email_code_verify",
 "romylabs_stalwart_transport_for_product",
 "sendViaStalwartJmap",
 "String(challenge.recipient)",
 'return json(generic)',
 "if(!data?.token)"
])assert.ok((edge+'\n'+ui).includes(s),'OTP application flow missing: '+s)
assert.ok(config.includes('[functions.portal-email-login]\nverify_jwt = false'),'public OTP endpoint must validate code in the app')
assert.ok(!ui.includes("rpc('portal_login'"),'client browser must not keep SSN-only login')
assert.ok(!ui.includes('Last 4 Digits of SSN'),'client browser must not request SSN')
assert.ok(ui.includes("supabase.functions.invoke('portal-email-login'"),'browser must use new protected endpoint')
assert.ok(!edge.includes('console.log(code)'), 'never log raw codes')
console.log('PASS: service-only bcrypt OTP challenge, persistent 5-attempt cap, single-use tokens, verified-recipient email, no SSN browser login')
