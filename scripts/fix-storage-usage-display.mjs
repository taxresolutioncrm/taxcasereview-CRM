import fs from 'node:fs'

const path = 'src/pages/Settings.jsx'
let s = fs.readFileSync(path, 'utf8')
let changed = false
let skipped = 0

// Current TaxRes-family Storage implementation is authoritative. The historical
// repair script must never rewrite it during prebuild, especially by restoring
// the old automatic storage RPC that the manual Refresh flow intentionally removed.
const currentRefreshFlow =
  s.includes('async function refreshProjectStorage()') &&
  s.includes("supabase.rpc('get_project_storage_usage')") &&
  s.includes("'↻ Refresh'") &&
  !s.includes("storageRes] = await Promise.all")

if (currentRefreshFlow) {
  const rpcCount = (s.match(/get_project_storage_usage/g) || []).length
  if (rpcCount !== 1) {
    console.error(`Storage usage display invariant failed: expected exactly 1 get_project_storage_usage call, found ${rpcCount}.`)
    process.exit(1)
  }
  console.log('Storage usage display already current (manual Refresh flow preserved).')
  process.exit(0)
}

function once(from, to) {
  if (s.includes(to)) return
  if (!s.includes(from)) {
    // Settings.jsx evolves independently of this historical repair script.
    // Missing legacy anchors must never make production builds fail. If the
    // replacement is not already present, leave the current implementation
    // untouched and report the skipped legacy patch for follow-up.
    skipped += 1
    console.warn(`Storage patch legacy anchor not found; skipping: ${from.slice(0, 100)}`)
    return
  }
  s = s.replace(from, to)
  changed = true
}

once(
  `const [usageLoading, setUsageLoading] = useState(true)`,
  `const [usageLoading, setUsageLoading] = useState(true)\n  const [projectStorage, setProjectStorage] = useState(null)`
)

once(
`      const [{ count: callCount }, { count: smsCount }, { count: faxCount }, { count: emailCount }] = await Promise.all([
        supabase.from('calllog').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', monthStart),
        supabase.from('sms_messages').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', monthStart),
        supabase.from('fax_logs').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', monthStart),
        supabase.from('emails').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', monthStart),
      ])`,
`      const [{ count: callCount }, { count: smsCount }, { count: faxCount }, { count: emailCount }, storageRes] = await Promise.all([
        supabase.from('calllog').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', monthStart),
        supabase.from('sms_messages').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', monthStart),
        supabase.from('fax_logs').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', monthStart),
        supabase.from('emails').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).gte('created_at', monthStart),
        supabase.rpc('get_project_storage_usage'),
      ])
      if (storageRes.error) console.error('Storage Usage: exact project usage RPC failed —', storageRes.error.message)
      else setProjectStorage(storageRes.data)`
)

once(
`  const FREE_LIMIT = 1024 * 1024 * 1024  // 1 GB Supabase free tier
  const totalBytes  = docs.reduce((s, d) => s + (d.file_size || 0), 0)
  const pct         = Math.min(100, (totalBytes / FREE_LIMIT) * 100)
  const barColor    = pct > 80 ? 'var(--bad)' : pct > 60 ? 'var(--warn)' : 'var(--green)'`,
`  // Exact project storage comes from storage.objects metadata via a protected RPC.
  // documents.file_size remains useful for tenant/document-type detail, but it is
  // not complete enough to represent actual disk usage (generated e-sign/package
  // files and other buckets are not guaranteed to have matching documents rows).
  const trackedDocumentBytes = docs.reduce((sum, d) => sum + (Number(d.file_size) || 0), 0)
  const projectBytes = Number(projectStorage?.total_bytes || 0)
  const totalBytes = projectBytes || trackedDocumentBytes`
)

once(
`    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'`,
`    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'`
)

const start = `      {/* Usage bar */}`
const end = `      {/* By type */}`
if (!s.includes('Exact Supabase project storage')) {
  const a = s.indexOf(start)
  const b = s.indexOf(end, a)
  if (a >= 0 && b >= 0) {
    const replacement = `      {/* Exact Supabase project storage */}
      <div className="card">
        <div className="card-header"><span className="card-title">💾 Storage Usage</span></div>
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:10, marginBottom:14 }}>
            <div style={{background:'var(--s2)',borderRadius:10,padding:'12px 14px'}}>
              <div style={{fontSize:25,fontWeight:900,color:'var(--tx)'}}>{fmt(totalBytes)}</div>
              <div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>Actual project storage used</div>
            </div>
            <div style={{background:'var(--s2)',borderRadius:10,padding:'12px 14px'}}>
              <div style={{fontSize:25,fontWeight:900,color:'var(--tx)'}}>{projectStorage?.total_objects ?? '—'}</div>
              <div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>Stored objects</div>
            </div>
            <div style={{background:'var(--s2)',borderRadius:10,padding:'12px 14px'}}>
              <div style={{fontSize:25,fontWeight:900,color:'var(--tx)'}}>{fmt(trackedDocumentBytes)}</div>
              <div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>Tenant document rows with size metadata</div>
            </div>
          </div>
          <div style={{background:'rgba(26,127,212,.08)',border:'1px solid rgba(26,127,212,.22)',borderRadius:9,padding:'10px 13px',fontSize:12,color:'var(--t2)',lineHeight:1.65,marginBottom:14}}>
            <strong style={{color:'var(--tx)'}}>Measured from Supabase Storage itself.</strong> This includes generated packages, signed copies, firm assets, avatars and every storage bucket — not only rows in the CRM documents table. Your plan quota is intentionally not hardcoded because it changes with the Supabase plan.
          </div>
          {(projectStorage?.buckets || []).map(b => (
            <div key={b.bucket_id} style={{display:'flex',alignItems:'center',gap:12,padding:'8px 0',borderBottom:'1px solid var(--br)'}}>
              <div style={{flex:1,fontSize:13,fontWeight:650}}>{b.bucket_id}</div>
              <div style={{fontSize:11,color:'var(--t3)'}}>{b.objects} object{Number(b.objects)===1?'':'s'}</div>
              <div style={{width:90,textAlign:'right',fontSize:12,fontWeight:700,color:'var(--t2)'}}>{fmt(Number(b.bytes)||0)}</div>
            </div>
          ))}
          {!projectStorage && <div style={{fontSize:12,color:'var(--warn)',marginTop:10}}>Exact project usage is unavailable for this login; showing tracked document metadata only.</div>}
        </div>
      </div>

`
    s = s.slice(0, a) + replacement + s.slice(b)
    changed = true
  } else {
    skipped += 1
    console.warn('Storage Usage card legacy anchors not found; leaving current Settings implementation unchanged.')
  }
}

if (changed) fs.writeFileSync(path, s)
console.log(`Storage usage display ${changed ? 'patched' : 'already current'}${skipped ? ` (${skipped} legacy patch${skipped===1?'':'es'} skipped)` : ''}.`)
