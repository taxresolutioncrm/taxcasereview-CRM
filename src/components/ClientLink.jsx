import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ── ClientLink ──
// Renders a client (or lead) name as a link that opens their file, from
// anywhere in the app — Cases, Deadlines, Dialer, SMS, Fax, E-Sign, billing,
// Tax Returns, Entities, etc. Resolves the name to a client id (or lead id)
// once and caches it process-wide so a table of 50 rows doesn't fire 50
// queries. Falls back to plain text when no matching file exists.
//
// Usage: <ClientLink name={row.clientName} />
//   or, if you already know the id: <ClientLink name={c.name} clientId={c.id} />

// Shared caches across every ClientLink instance (survive re-renders).
const clientCache = new Map() // lowercased name -> { id } | null
const leadCache = new Map()
let clientsLoaded = false
let clientsPromise = null

async function loadDirectories() {
  if (clientsLoaded) return
  if (!clientsPromise) {
    clientsPromise = (async () => {
      try {
        const [c, l] = await Promise.all([
          supabase.from('clients').select('id,name'),
          supabase.from('leads').select('id,name'),
        ])
        for (const row of c.data || []) if (row.name) clientCache.set(row.name.toLowerCase().trim(), { id: row.id })
        for (const row of l.data || []) if (row.name) leadCache.set(row.name.toLowerCase().trim(), { id: row.id })
        clientsLoaded = true
      } catch { /* leave caches empty — links just render as text */ }
    })()
  }
  return clientsPromise
}

export default function ClientLink({ name, clientId, style, className, subtle = false, plainIfMissing = true }) {
  const navigate = useNavigate()
  const [hover, setHover] = useState(false)
  const [target, setTarget] = useState(
    clientId ? { kind: 'client', id: clientId } : null
  )
  const [resolved, setResolved] = useState(!!clientId)

  useEffect(() => {
    let alive = true
    if (clientId || !name) { setResolved(true); return }
    const key = name.toLowerCase().trim()
    // Fast path: already cached
    if (clientsLoaded) {
      const c = clientCache.get(key)
      const l = !c ? leadCache.get(key) : null
      setTarget(c ? { kind: 'client', id: c.id } : l ? { kind: 'lead', id: l.id } : null)
      setResolved(true)
      return
    }
    loadDirectories().then(() => {
      if (!alive) return
      const c = clientCache.get(key)
      const l = !c ? leadCache.get(key) : null
      setTarget(c ? { kind: 'client', id: c.id } : l ? { kind: 'lead', id: l.id } : null)
      setResolved(true)
    })
    return () => { alive = false }
  }, [name, clientId])

  if (!name) return null

  // Not a known client/lead → plain text (or nothing to link to)
  if (resolved && !target) {
    return <span style={style} className={className}>{name}</span>
  }

  const href = target ? (target.kind === 'client' ? `/clients/${target.id}` : `/leads/${target.id}`) : undefined

  function go(e) {
    e.stopPropagation()
    if (!target || !href) return
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(href)
  }

  return (
    <a
      href={href}
      onClick={go}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Open file"
      style={subtle
        ? { color: 'inherit', cursor: 'pointer', textDecoration: hover ? 'underline' : 'none', textUnderlineOffset: 2, ...style }
        : { color: 'var(--blue, #2563eb)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2, ...style }}
      className={className}
    >
      {name}
    </a>
  )
}
