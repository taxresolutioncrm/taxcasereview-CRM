const fs=require('fs');const assert=require('assert');
const s=fs.readFileSync('src/components/layout/Sidebar.jsx','utf8');
assert(s.includes("import { createPortal } from 'react-dom'"),'release modal must use React portal');
assert(s.includes("createPortal(")&&s.includes("document.body"),'release modal must render at document.body');
assert(s.includes("zIndex:2147483647"),'release modal must sit above app stacking contexts');
assert(s.includes("document.body.style.overflow = 'hidden'"),'release modal must lock body scroll');
assert(s.includes("if (e.key === 'Escape') setShowReleaseNotes(false)"),'release modal must close on Escape');
assert(s.includes('aria-modal="true"'),'release modal accessibility contract missing');
// Modal has a deliberately dark surface in both themes. Text must not inherit
// light-theme dark tokens; users must be able to read release notes in either mode.
const modal = s.slice(s.indexOf('aria-label="Release notes"'), s.indexOf('document.body',s.indexOf('aria-label="Release notes"')))
assert(modal.includes("background:'#0f2237'"),'release modal dark surface missing')
assert(modal.includes("padding:22,color:'#f1f5f9'"),'release modal text must have explicit high-contrast light color')
assert(!modal.includes("color:'var(--tx)'"),'release modal must not inherit light theme black text')
assert(!modal.includes("color:'var(--t3)'"),'release modal secondary text must remain legible in light theme')
assert(modal.includes("color:'#b5c9dc'"),'release modal secondary text contrast missing')
assert(modal.includes("background:'#182e45',border:'1px solid #35536e'"),'version panel must contrast on dark modal')
console.log('PASS release notes modal portal/stacking guard');
