// Regression guard for the Time & Billing client picker.
// Deliberately avoids mutating billing calculations or save behavior.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = fs.readFileSync('src/pages/TimeEntry.jsx', 'utf8');
assert.match(source, /if \(!form\.client_id\) setShowClientDrop\(true\)/, 'selected clients must not reopen suggestions on focus');
assert.match(source, /onBlur=\{\(\) => setShowClientDrop\(false\)\}/, 'suggestions must close on blur');
assert.match(source, /onMouseDown=\{e => \{ e\.preventDefault\(\); fld\('client_id', c\.id\); fld\('client_name', c\.name\); setClientSearch\(c\.name\); setShowClientDrop\(false\)/, 'selection must keep database id and close before blur');
console.log('PASS time entry client picker selection invariants');
