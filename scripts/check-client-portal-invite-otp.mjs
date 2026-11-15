import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const clients=readFileSync('src/pages/Clients.jsx','utf8')
const start=clients.indexOf('function InlinePortalForm(')
const end=clients.indexOf('\nfunction ', start+1)
const invite=clients.slice(start,end<0?undefined:end)
assert.ok(start>=0,'Client portal invite form must exist')
assert.ok(invite.includes('one-time verification code'), 'Email invite must explain email OTP')
assert.ok(invite.includes('one-time code sent'), 'Invite UI must explain email OTP')
assert.ok(!/last 4|last four|SSN/i.test(invite), 'Client invite must not request retired SSN authentication')
assert.ok(invite.includes('client?.email'), 'Email identity must remain visible')
assert.ok(invite.includes('disabled={sending || !client?.email}'), 'Invite send must require email, not SSN')
assert.ok(!invite.includes('last4'), 'Removed SSN variable must not be referenced')
console.log('PASS: client portal invitation uses email OTP only')
