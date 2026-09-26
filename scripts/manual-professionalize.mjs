import fs from 'node:fs'

const manualPath = 'src/pages/Manual.jsx'
const mainPath = 'src/main.jsx'

let manual = fs.readFileSync(manualPath, 'utf8').replace(/\r\n/g, '\n')
let changed = false

const replaceOnce = (from, to, alreadyPresent = to) => {
  if (manual.includes(alreadyPresent)) return
  if (!manual.includes(from)) throw new Error(`Manual patch anchor missing: ${from.slice(0, 80)}`)
  manual = manual.replace(from, to)
  changed = true
}

if (!manual.includes(`../lib/firmBranding`)) {
  const anchor = `import { useState } from 'react'`
  if (!manual.includes(anchor)) throw new Error('Manual import anchor missing')
  manual = manual.replace(anchor, `${anchor}\nimport { FIRM } from '../lib/firmBranding'`)
  changed = true
}

replaceOnce(
  `<div style={{ display:'flex', height: sidebarH, overflow:'hidden', ...(standalone ? {} : { margin:'0 -32px', padding:'0 0 0 32px' }) }}>`,
  `<div className="manual-shell" style={{ display:'flex', height: sidebarH, overflow:'hidden', ...(standalone ? {} : { margin:'0 -32px', padding:'0 0 0 32px' }) }}>`
)
replaceOnce(`<div style={S.sidebar}>`, `<div className="manual-sidebar" style={S.sidebar}>`)
replaceOnce(`<div style={S.content}>`, `<div className="manual-content" style={S.content}>
        <section className="manual-hero">
          <div className="manual-kicker">▣ {FIRM.name || 'TaxRes CRM'} Help Center</div>
          <h1>Know the system. Run the office faster.</h1>
          <p>Search the current operating guide, jump into the workflows your team uses most, or browse by the part of the office you’re working in.</p>
          <div className="manual-hero-search">
            <span>⌕</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search leads, payroll, email, IRS forms, reports…" />
          </div>
        </section>

        <section className="manual-popular">
          <div className="manual-popular-head">
            <div><div className="manual-popular-eyebrow">Popular workflows</div><div className="manual-popular-title">Jump right in</div></div>
            <div className="manual-popular-note">Built for the current CRM release</div>
          </div>
          <div className="manual-popular-grid">
            <button className="manual-jump" onClick={() => setSelected('leads')}><span className="manual-jump-icon">🎯</span><div className="manual-jump-title">New lead → active client</div><div className="manual-jump-body">Capture, qualify, send the package, collect payment and convert.</div></button>
            <button className="manual-jump" onClick={() => setSelected('esign')}><span className="manual-jump-icon">✍️</span><div className="manual-jump-title">Send & track signatures</div><div className="manual-jump-body">Full package, IRS authorizations and client agreements.</div></button>
            <button className="manual-jump" onClick={() => setSelected('dashboard')}><span className="manual-jump-icon">📊</span><div className="manual-jump-title">Run the daily dashboard</div><div className="manual-jump-body">Cases, tasks, deadlines, AR and production at a glance.</div></button>
            <button className="manual-jump" onClick={() => setSelected('reports')}><span className="manual-jump-icon">⚡</span><div className="manual-jump-title">Reports & office controls</div><div className="manual-jump-body">Production, billing, activity, employees and operational health.</div></button>
          </div>
        </section>`,
  'className="manual-content"'
)
replaceOnce(`<div style={{ paddingTop:4, marginBottom:20, paddingBottom:16, borderBottom:'1px solid var(--br)' }}>`, `<div className="manual-section-head" style={{ paddingTop:4, marginBottom:20, paddingBottom:16, borderBottom:'1px solid var(--br)' }}>`)

manual = manual.replaceAll(`style={S.card}`, `className="manual-card" style={S.card}`)
manual = manual.replaceAll(`style={S.h3}`, `className="manual-h3" style={S.h3}`)
manual = manual.replaceAll(`style={S.navItem(selected === s.id)}`, `className="manual-nav-item" style={S.navItem(selected === s.id)}`)
manual = manual.replaceAll(`<div key={i} style={{ overflowX:'auto', margin:'12px 0 20px' }}>`, `<div key={i} className="manual-table-wrap" style={{ overflowX:'auto', margin:'12px 0 20px' }}>`)

if (changed) fs.writeFileSync(manualPath, manual)

let main = fs.readFileSync(mainPath, 'utf8')
let mainChanged = false
if (!main.includes(`./manual-premium.css`)) {
  const anchor = `import './index.css'`
  if (!main.includes(anchor)) throw new Error('main.jsx index.css import anchor missing')
  main = main.replace(anchor, `${anchor}\nimport './manual-premium.css'`)
  mainChanged = true
}
if (!main.includes(`./lib/routePrefetch`)) {
  const anchor = `import './manual-premium.css'`
  if (!main.includes(anchor)) throw new Error('main.jsx manual CSS import anchor missing')
  main = main.replace(anchor, `${anchor}\nimport './lib/routePrefetch'`)
  mainChanged = true
}
if (mainChanged) fs.writeFileSync(mainPath, main)

console.log(`Manual professional shell ${changed ? 'applied' : 'already current'}; office branding + route prefetch installed.`)
