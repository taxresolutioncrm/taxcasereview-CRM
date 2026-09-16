// AdminChat — Cross-office chat inbox for the TaxRes CRM admin.
// Shows ALL messages across ALL tenant offices in real-time.
// Romy can read messages from any office and reply into any channel.
// Each office's chat is isolated by tenant_id — replies go to the right office.

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

function colorFor(name) {
  if (!name) return '#64748b'
  const palette = ['#4f8ef7','#a855f7','#22c55e','#f59e0b','#ec4899','#06b6d4','#ef4444','#8b5cf6','#f97316','#14b8a6']
  let h = 0; for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return palette[Math.abs(h) % palette.length]
}
function initialsFor(name) {
  if (!name) return '?'
  const p = name.trim().split(' ')
  return p.length >= 2 ? p[0][0] + p[p.length-1][0] : name[0].toUpperCase()
}
function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  if (isToday) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
function fmtAgo(ts) {
  if (!ts) return ''
  const s = (Date.now() - new Date(ts).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}

async function hydrateChatAttachment(row) {
  if (!row || typeof row !== 'object') return row
  const raw = String(row.attachment_url || '')
  if (!raw.startsWith('storage://')) return row
  const rest = raw.slice('storage://'.length)
  const slash = rest.indexOf('/')
  if (slash < 1) return { ...row, attachment_url: null }
  const bucket = rest.slice(0, slash)
  const path = rest.slice(slash + 1)
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 15 * 60)
  return { ...row, attachment_url: !error && data?.signedUrl ? data.signedUrl : null }
}

async function hydrateChatAttachments(rows) {
  return Promise.all((rows || []).map(hydrateChatAttachment))
}

function Avatar({ name, size = 32, avatarUrl }) {
  const bg = colorFor(name)
  if (avatarUrl) return (
    <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
      <img src={avatarUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
    </div>
  )
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.34, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
      {initialsFor(name)}
    </div>
  )
}

export default function AdminChat() {
  const [offices, setOffices]       = useState([])   // [{id, firm_name, brand_color}]
  const [selectedOffice, setSelectedOffice] = useState(null) // full office object
  const [channels, setChannels]     = useState([])
  const [selectedChan, setSelectedChan] = useState(null)
  const [messages, setMessages]     = useState([])
  const [allRecent, setAllRecent]   = useState([])   // recent msgs across ALL offices
  const [input, setInput]           = useState('')
  const [sending, setSending]       = useState(false)
  const [loading, setLoading]       = useState(false)
  const [unread, setUnread]         = useState({})   // { tenantId: count }
  const [view, setView]             = useState('inbox') // 'inbox' | 'office'
  const bottomRef = useRef(null)
  const rtRef = useRef(null)

  // Load all offices on mount
  useEffect(() => {
    supabase.rpc('admin_tenant_overview').then(({ data }) => {
      const offs = (data || []).filter(o => o.status === 'active' || o.status === 'trial')
      setOffices(offs)
    })
    loadInbox()
  }, [])

  // Real-time subscription to ALL chat_messages (admin has cross-tenant access)
  useEffect(() => {
    const rt = supabase.channel('admin-chat-all')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, async ({ new: msg }) => {
        const hydrated = await hydrateChatAttachment(msg)
        setAllRecent(prev => [hydrated, ...prev].slice(0, 300))
        if (selectedOffice && selectedChan && hydrated.channel === selectedChan) {
          setMessages(prev => [...prev, hydrated])
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
        }
      })
      .subscribe()
    rtRef.current = rt
    return () => { supabase.removeChannel(rt) }
  }, [selectedOffice, selectedChan])

  async function loadInbox() {
    setLoading(true)
    const { data } = await supabase.rpc('admin_get_all_chat_messages', { p_limit: 300 })
    setAllRecent(await hydrateChatAttachments(data || []))
    setLoading(false)
  }

  async function openOffice(office) {
    setSelectedOffice(office)
    setView('office')
    setMessages([])
    setSelectedChan(null)

    // Impersonate office to get its channels
    await supabase.rpc('set_admin_tenant_override', { p_tenant_id: office.id }).catch(() => {})

    const { data: chans } = await supabase
      .from('chat_channels')
      .select('*')
      .order('position')
      .order('label')
    setChannels(chans || [{ id: 'general', label: 'general', desc: 'All staff' }])

    // Auto-select first channel
    const first = (chans || [])[0] || { id: 'general', label: 'general' }
    setSelectedChan(first.id)
    loadChannelMessages(first.id, office.id)
  }

  async function loadChannelMessages(chanId, officeId) {
    setLoading(true)
    const { data } = await supabase.rpc('admin_get_all_chat_messages', {
      p_limit: 200,
      p_channel: chanId,
      p_tenant_id: officeId || selectedOffice?.id || null,
    })
    // RPC returns DESC, reverse for chronological display
    const hydrated = await hydrateChatAttachments(data || [])
    setMessages(hydrated.reverse())
    setLoading(false)
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  async function selectChannel(chan) {
    setSelectedChan(chan.id)
    setMessages([])
    loadChannelMessages(chan.id, selectedOffice?.id)
  }

  async function sendMessage() {
    if (!input.trim() || !selectedChan || sending) return
    setSending(true)
    const payload = {
      channel: selectedChan,
      sender: 'Romy Cruz (Admin)',
      text: input.trim(),
      created_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('chat_messages').insert([payload])
    if (!error) {
      setMessages(prev => [...prev, { ...payload, id: Date.now() }])
      setInput('')
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
    setSending(false)
  }

  // Group inbox messages by office (based on tenant_id if available, else channel prefix)
  const inboxByOffice = offices.map(o => {
    // Recent messages for this office — filter by tenant_id or approximate by channel
    const msgs = allRecent.filter(m => {
      if (m.tenant_id === o.id) return true
      // fallback: try to match by known employees (imperfect but good enough for inbox)
      return false
    }).slice(0, 3)
    const last = msgs[0]
    return { office: o, msgs, last }
  }).filter(x => x.last) // only show offices with activity

  // For offices without tenant_id on messages, show all recent grouped differently
  const ungrouped = allRecent.filter(m => !m.tenant_id).slice(0, 50)

  const S = {
    card: { background: 'rgba(255,255,255,.03)', border: '1px solid rgba(99,102,241,.18)', borderRadius: 12 },
  }

  if (view === 'office' && selectedOffice) {
    const currentChan = channels.find(c => c.id === selectedChan)
    return (
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0a0918' }}>

        {/* Channel sidebar */}
        <div style={{ width: 220, flexShrink: 0, background: '#0d0c1a', borderRight: '1px solid rgba(99,102,241,.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid rgba(99,102,241,.12)' }}>
            <button onClick={() => { setView('inbox'); setSelectedOffice(null); supabase.rpc('set_admin_tenant_override', { p_tenant_id: null }).catch(() => {}) }}
              style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0, marginBottom: 8 }}>← All Offices</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {selectedOffice.brand_color && <div style={{ width: 10, height: 10, borderRadius: '50%', background: selectedOffice.brand_color, flexShrink: 0 }}/>}
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedOffice.firm_name}</div>
            </div>
            <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{selectedOffice.employee_count} employees</div>
          </div>

          <div style={{ padding: '8px 6px', overflowY: 'auto', flex: 1 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '.07em', padding: '4px 8px 6px' }}>Channels</div>
            {channels.filter(c => !c.id.startsWith('dm_')).map(c => (
              <div key={c.id} onClick={() => selectChannel(c)}
                style={{ padding: '6px 10px', borderRadius: 6, cursor: 'pointer', marginBottom: 1, display: 'flex', alignItems: 'center', gap: 6,
                  background: selectedChan === c.id ? 'rgba(99,102,241,.2)' : 'transparent',
                  color: selectedChan === c.id ? '#a5b4fc' : '#64748b',
                  fontWeight: selectedChan === c.id ? 700 : 400, fontSize: 13 }}
                onMouseEnter={e => { if (selectedChan !== c.id) e.currentTarget.style.background = 'rgba(255,255,255,.04)' }}
                onMouseLeave={e => { if (selectedChan !== c.id) e.currentTarget.style.background = 'transparent' }}>
                <span style={{ color: '#475569', fontWeight: 400 }}>#</span>{c.label}
              </div>
            ))}
          </div>
        </div>

        {/* Message area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ height: 52, borderBottom: '1px solid rgba(99,102,241,.15)', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 10, flexShrink: 0, background: 'rgba(255,255,255,.02)' }}>
            <span style={{ color: '#475569', fontSize: 18 }}>#</span>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>{currentChan?.label || selectedChan}</span>
            {currentChan?.desc && <span style={{ fontSize: 12, color: '#475569' }}> — {currentChan.desc}</span>}
            <div style={{ marginLeft: 'auto', fontSize: 11, color: '#475569' }}>
              Viewing as Admin · replies go to {selectedOffice.firm_name}
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {loading && <div style={{ textAlign: 'center', color: '#475569', padding: 40 }}>Loading…</div>}
            {!loading && messages.length === 0 && (
              <div style={{ textAlign: 'center', color: '#475569', padding: '60px 20px' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>#</div>
                <div style={{ fontSize: 14 }}>No messages in #{currentChan?.label || selectedChan} yet</div>
              </div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1]
              const sameAuthor = prev?.sender === m.sender && (new Date(m.created_at) - new Date(prev?.created_at)) < 300000
              return (
                <div key={m.id || i} style={{ display: 'flex', gap: 10, padding: sameAuthor ? '1px 0' : '8px 0 1px', alignItems: 'flex-start' }}>
                  {!sameAuthor ? (
                    <Avatar name={m.sender} size={34}/>
                  ) : (
                    <div style={{ width: 34, flexShrink: 0 }}/>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {!sameAuthor && (
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: m.sender === 'Romy Cruz (Admin)' ? '#6366f1' : '#e2e8f0' }}>{m.sender}</span>
                        <span style={{ fontSize: 11, color: '#475569' }}>{fmtTime(m.created_at)}</span>
                      </div>
                    )}
                    {m.text && <div style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.55, wordBreak: 'break-word' }}>{m.text}</div>}
                    {m.attachment_url && (
                      <a href={m.attachment_url} target="_blank" rel="noreferrer"
                        style={{ display: 'inline-block', marginTop: 4, fontSize: 12, color: '#6366f1', textDecoration: 'none', background: 'rgba(99,102,241,.1)', padding: '3px 10px', borderRadius: 6 }}>
                        📎 {m.attachment_name || 'Attachment'}
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef}/>
          </div>

          {/* Input */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(99,102,241,.12)', flexShrink: 0, background: 'rgba(255,255,255,.02)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(99,102,241,.25)', borderRadius: 10, padding: '8px 12px' }}>
              <textarea value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder={`Message #${currentChan?.label || selectedChan} as Admin…`}
                rows={1}
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#f1f5f9', fontSize: 14, resize: 'none', lineHeight: 1.5, fontFamily: 'inherit', maxHeight: 80, overflowY: 'auto' }}/>
              <button onClick={sendMessage} disabled={!input.trim() || sending}
                style={{ width: 32, height: 32, borderRadius: 8, border: 'none', cursor: input.trim() ? 'pointer' : 'default', background: input.trim() ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'rgba(255,255,255,.06)', color: input.trim() ? '#fff' : '#475569', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>↑</button>
            </div>
            <div style={{ fontSize: 10, color: '#334155', marginTop: 4 }}>Enter to send · Shift+Enter for new line · Sending as Romy Cruz (Admin)</div>
          </div>
        </div>
      </div>
    )
  }

  // ── INBOX VIEW ──
  return (
    <div style={{ padding: '28px 32px', maxWidth: 1000, height: '100vh', overflowY: 'auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 4 }}>💬 Cross-Office Chat</div>
          <div style={{ fontSize: 14, color: '#475569' }}>All office channels · Read and reply as Admin</div>
        </div>
        <button onClick={loadInbox} style={{ background: 'rgba(99,102,241,.12)', border: '1px solid rgba(99,102,241,.25)', color: '#a5b4fc', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>⟳ Refresh</button>
      </div>

      {/* Office cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px,1fr))', gap: 14, marginBottom: 32 }}>
        {offices.map(o => {
          const offMsgs = allRecent.filter(m => m.tenant_id === o.id)
          const last = offMsgs[0]
          const count = offMsgs.length
          return (
            <div key={o.id} onClick={() => openOffice(o)}
              style={{ ...S.card, padding: '16px 18px', cursor: 'pointer', transition: 'transform .15s, box-shadow .15s' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(99,102,241,.2)' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: o.brand_color ? o.brand_color + '22' : 'rgba(99,102,241,.15)', border: `2px solid ${o.brand_color || '#6366f1'}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: o.brand_color || '#6366f1', flexShrink: 0 }}>
                  {(o.firm_name || '?')[0]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.firm_name}</div>
                  <div style={{ fontSize: 11, color: '#475569' }}>{o.employee_count} employees</div>
                </div>
                {count > 0 && <span style={{ background: 'rgba(99,102,241,.2)', color: '#a5b4fc', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>{count} msgs</span>}
              </div>
              {last ? (
                <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: '#94a3b8', fontWeight: 600 }}>{last.sender}: </span>{last.text || '📎 Attachment'}
                  <span style={{ color: '#334155', marginLeft: 6 }}>{fmtAgo(last.created_at)}</span>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#334155' }}>No recent messages</div>
              )}
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 11, color: '#6366f1', fontWeight: 600 }}>Open chat →</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* All recent messages feed */}
      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 14 }}>
        Recent Activity — All Offices
      </div>
      <div style={{ ...S.card, overflow: 'hidden' }}>
        {loading && <div style={{ padding: 24, color: '#475569', fontSize: 13 }}>Loading…</div>}
        {!loading && allRecent.length === 0 && <div style={{ padding: 24, color: '#475569', fontSize: 13 }}>No messages yet across any office.</div>}
        {allRecent.slice(0, 50).map((m, i) => {
          const office = offices.find(o => o.id === m.tenant_id)
          return (
            <div key={m.id || i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 18px', borderBottom: i < Math.min(allRecent.length, 50) - 1 ? '1px solid rgba(99,102,241,.07)' : 'none' }}>
              <Avatar name={m.sender} size={32}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0' }}>{m.sender}</span>
                  {office && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: office.brand_color ? office.brand_color + '22' : 'rgba(99,102,241,.15)', color: office.brand_color || '#6366f1' }}>
                      {office.firm_name}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: '#334155' }}>#{m.channel}</span>
                  <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>{fmtAgo(m.created_at)}</span>
                </div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.text || (m.attachment_name ? `📎 ${m.attachment_name}` : '—')}
                </div>
              </div>
              {office && (
                <button onClick={() => openOffice(office)}
                  style={{ background: 'rgba(99,102,241,.1)', border: '1px solid rgba(99,102,241,.2)', color: '#a5b4fc', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                  Reply →
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
