const fs=require('fs');const assert=require('assert');
const s=fs.readFileSync('src/components/layout/Sidebar.jsx','utf8');
assert(s.includes("import { createPortal } from 'react-dom'"),'release modal must use React portal');
assert(s.includes("createPortal(")&&s.includes("document.body"),'release modal must render at document.body');
assert(s.includes("zIndex:2147483647"),'release modal must sit above app stacking contexts');
assert(s.includes("document.body.style.overflow = 'hidden'"),'release modal must lock body scroll');
assert(s.includes("if (e.key === 'Escape') setShowReleaseNotes(false)"),'release modal must close on Escape');
assert(s.includes('aria-modal="true"'),'release modal accessibility contract missing');
console.log('PASS release notes modal portal/stacking guard');
