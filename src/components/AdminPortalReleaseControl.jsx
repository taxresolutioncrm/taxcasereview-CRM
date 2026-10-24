import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ADMIN_PORTAL_RELEASE, ADMIN_PORTAL_HISTORY } from '../releases/adminPortalRelease'

export default function AdminPortalReleaseControl() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
        style={{display:'block',width:'100%',padding:'9px 5px',textAlign:'left',background:'transparent',border:'none',color:'#a5b4fc',fontSize:11,cursor:'pointer'}}>
        RomyLabs Admin · v{ADMIN_PORTAL_RELEASE.version}
      </button>
      {open && createPortal(
        <div onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}
          style={{position:'fixed',inset:0,zIndex:2147483647,background:'rgba(3,7,18,.80)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div role="dialog" aria-modal="true" aria-label="RomyLabs Admin Portal release history"
            style={{width:'min(580px,100%)',maxHeight:'85vh',overflowY:'auto',borderRadius:16,border:'1px solid rgba(165,180,252,.25)',background:'#141426',color:'#e2e8f0',boxShadow:'0 24px 80px rgba(0,0,0,.5)',padding:24}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16}}>
              <h2 style={{fontSize:20,margin:0}}>What's New / Release History</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close release history"
                style={{background:'transparent',border:0,color:'#e2e8f0',fontSize:24,cursor:'pointer'}}>×</button>
            </div>
            {ADMIN_PORTAL_HISTORY.map(release => (
              <section key={release.version} style={{marginTop:20,paddingTop:16,borderTop:'1px solid rgba(165,180,252,.18)'}}>
                <div style={{fontWeight:700}}>v{release.version} — {release.title}</div>
                <div style={{fontSize:12,color:'#94a3b8',marginTop:5}}>
                  {release.productionDate || 'Production date to be confirmed after successful release'}
                </div>
                <ul style={{lineHeight:1.7,paddingLeft:20}}>{release.changes.map(change=><li key={change}>{change}</li>)}</ul>
              </section>
            ))}
          </div>
        </div>, document.body)}
    </>
  )
}
