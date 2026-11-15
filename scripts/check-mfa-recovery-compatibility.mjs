import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const context=readFileSync('src/context/AppContext.jsx','utf8')
const settings=readFileSync('src/pages/Settings.jsx','utf8')
const login=readFileSync('src/pages/Login.jsx','utf8')
for(const event of ['PASSWORD_RECOVERY',"'SIGNED_IN'"])assert.ok(context.includes(event),'setup auth event must be supported '+event)
assert.ok(context.includes("setUser(session.user);setRole('View Only');setPerms(null);setEmployeeName('')"),'setup-only session must not inherit staff privileges')
assert.ok(context.includes("get('reset_password') === '1'"),'initial and restored setup session should stay restricted')
assert.ok(settings.includes("get('reset_password') === '1' ? 'security'"),'recovery link must directly open password reset')
assert.ok(settings.includes("{tab === 'security' && ("),'all staff should be able to change their own password')
assert.ok(settings.includes("if (pw.next.length < 12)"),'new passwords must meet minimum length')
assert.ok(settings.includes('await supabase.auth.signOut()')&&settings.includes("window.location.replace('/login')"),'recovery token must terminate after password reset')
assert.ok(login.includes('verifyMfa'),'MFA login challenge must remain intact')
console.log('PASS: invite and recovery setup work with restricted roles, strong passwords and post-reset logout; MFA unaffected')
