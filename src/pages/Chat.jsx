import { validateFile, maybeCompressImage } from '../lib/uploadUtils'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { useCall } from '../context/CallContext'
import { FIRM } from '../lib/firmBranding'
import { useWebRTCRoom } from '../lib/webrtcRoom'
import { useVideoBackground } from '../lib/videoBackground'
import VirtualBackground from '../components/VirtualBackground'
import VideoTile from '../components/VideoTile'
import SlackEmojiPicker from '../components/SlackEmojiPicker'

// Channels are now loaded from the chat_channels table (per-tenant, persistent) [v2]
// CHANNELS is kept as a fallback only for the very first render before the DB loads
const CHANNELS = [
  { id: 'general', label: 'general', desc: 'All staff announcements' },
]

// TEAM is now loaded dynamically from employees table — see useEffect in Chat()

const QUICK_EMOJIS = ['👍','✅','🔥','💯','😊','🎉','👀','⚠️','📌','❤️','😂','🙏','💪','🤝','⏰','📋']
const ALL_EMOJIS   = ['👍','👎','❤️','🔥','✅','❌','⚠️','📌','📋','💯','🎉','😊','😂','🙏','💪','🤝','⏰','🕐','📞','📧','💬','🗒️','📁','💰','🏦','⚖️','📊','📈','📉','🔑','🔒','✉️','📨','📩','🚀','⭐','💡','🔔','🔕','👀','🤔','😅','🥳']

function colorFor(name) {
  if (!name) return 'var(--t3)'
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
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
function fmtDate(ts) {
  if (!ts) return ''
  const d = new Date(ts), today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate()-1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday:'long', month:'short', day:'numeric' })
}

function Avatar({ name, size = 36, color, avatarUrl }) {
  const bg = color || colorFor(name)
  if (avatarUrl) {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: bg }}>
        <img src={avatarUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
      </div>
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.33, fontWeight: 800, color: '#fff', flexShrink: 0
    }}>{initialsFor(name)}</div>
  )
}

function ChatAttachmentLink({ url, name }) {
  const [href, setHref] = useState(() => String(url || '').startsWith('storage://') ? '' : url)

  useEffect(() => {
    let cancelled = false
    const raw = String(url || '')
    if (!raw.startsWith('storage://')) { setHref(raw); return }
    const rest = raw.slice('storage://'.length)
    const slash = rest.indexOf('/')
    if (slash < 1) { setHref(''); return }
    const bucket = rest.slice(0, slash)
    const path = rest.slice(slash + 1)
    supabase.storage.from(bucket).createSignedUrl(path, 15 * 60).then(({ data, error }) => {
      if (!cancelled) setHref(!error && data?.signedUrl ? data.signedUrl : '')
    })
    return () => { cancelled = true }
  }, [url])

  return (
    <a href={href || undefined} target="_blank" rel="noreferrer"
      style={{ fontSize: 13, color: '#4f8ef7', fontWeight: 600, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: href ? 'pointer' : 'default' }}>
      {name || 'Attachment'}
    </a>
  )
}

export default function Chat() {
  const { user, role, myTenantId } = useApp()
  const { calling, active: activeCall } = useCall()
  const canManageChannels = ['Super Admin','Admin'].includes(role)
  // Deep link from a chat notification: /chat?c=<channel id>. Falls back to
  // the default channel when the param is absent or doesn't match anything.
  const [active, setActive]       = useState(() => {
    try {
      const want = new URLSearchParams(window.location.search).get('c')
      if (want) {
        const hit = CHANNELS.find(c => c.id === want)
        if (hit) return hit
        if (want.startsWith('dm_')) return { id: want, name: 'Direct Message' }
      }
    } catch (_) {}
    return CHANNELS[0]
  })
  const [messages, setMessages]   = useState([])
  const [input, setInput]         = useState('')
  const [mentionQuery, setMentionQuery] = useState(null) // null = hidden, string = query text
  const [sending, setSending]     = useState(false)
  const [loading, setLoading]     = useState(false)
  const [onlineUsers, setOnlineUsers] = useState(new Set()) // names of currently online employees
  const [presenceMeta, setPresenceMeta] = useState({}) // { name: { activity, label } }
  const presenceChRef = useRef(null)
  const [huddleId, setHuddleId]         = useState(null)  // unique room ID
  const [isHuddleHost, setIsHuddleHost]   = useState(false)
  const [showHuddleInvite, setShowHuddleInvite] = useState(false)
  const [incomingHuddle, setIncomingHuddle] = useState(null) // { from, huddleId }
  const webrtc = useWebRTCRoom('huddle')
  const peerConnsRef = webrtc.peerConnsRef
  const huddle = webrtc.joined
  const huddleMembers = webrtc.members
  const micOn = webrtc.micOn
  const cameraOn = webrtc.cameraOn
  const vbg = useVideoBackground()
  const rawHuddleRef = useRef(null)
  const [huddleProcessedStream, setHuddleProcessedStream] = useState(null)
  const [showBgPanel, setShowBgPanel] = useState(false)
  // Huddle screen share
  const [huddleScreenStream,  setHuddleScreenStream]  = useState(null)
  const [huddleSharingScreen, setHuddleSharingScreen] = useState(false)
  const huddleScreenTrackRef = useRef(null)
  // Full-screen huddle overlay state
  const [huddleFullscreen, setHuddleFullscreen] = useState(true)
  const [raisedHand, setRaisedHand]             = useState(false)
  const [raisedHands, setRaisedHands]           = useState({})
  const [floatReactions, setFloatReactions]     = useState([])
  const [huddleThread, setHuddleThread]         = useState([])
  const [huddleThreadInput, setHuddleThreadInput] = useState('')
  const [showHuddleThread, setShowHuddleThread] = useState(false)
  const [showHuddleReactPicker, setShowHuddleReactPicker] = useState(false)
  const floatReactionTimers = useRef({})
  const [chatToast, setChatToast] = useState('')
  const [notifyPermission,setNotifyPermission] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  function showToast(msg) { setChatToast(msg); setTimeout(() => setChatToast(''), 4000) }

  useEffect(() => {
    try {
      const params=new URLSearchParams(window.location.search)
      const room=params.get('huddle')
      if(room) setIncomingHuddle({from:params.get('from') || 'Team member',huddleId:room})
    } catch (_) {}
  }, [])

  async function enableDesktopNotifications(){
    if(typeof Notification==='undefined') return
    const result=await Notification.requestPermission()
    setNotifyPermission(result)
    showToast(result==='granted' ? 'Desktop Team Chat notifications enabled' : 'Desktop notifications were not enabled')
  }

  // Floating emoji reactions in huddle
  function fireHuddleReaction(emoji) {
    const id = Date.now() + Math.random()
    const x = 10 + Math.random() * 80 // % from left
    setFloatReactions(r => [...r, { id, emoji, x }])
    floatReactionTimers.current[id] = setTimeout(() => {
      setFloatReactions(r => r.filter(i => i.id !== id))
      delete floatReactionTimers.current[id]
    }, 3000)
    webrtc.broadcastHuddleEvent?.({ type:'reaction', emoji, sender:myName, eventId:String(id) })
    setShowHuddleReactPicker(false)
  }

  function toggleRaiseHand() {
    const next = !raisedHand
    setRaisedHand(next)
    setRaisedHands(h => ({ ...h, [myName]: next }))
    webrtc.broadcastHuddleEvent?.({ type:'raise-hand', sender:myName, raised:next })
    if (next) {
      const msg = { id: Date.now(), sender: myName, text: `✋ ${myName} raised their hand`, ts: new Date().toISOString(), system: true }
      setHuddleThread(t => [...t, msg])
    }
  }

  function sendHuddleThreadMsg() {
    if (!huddleThreadInput.trim()) return
    const msg = { id: Date.now(), sender: myName, text: huddleThreadInput.trim(), ts: new Date().toISOString() }
    setHuddleThread(t => [...t, msg])
    webrtc.broadcastHuddleEvent?.({ type:'thread', msg })
    setHuddleThreadInput('')
  }
  const [showEmoji, setShowEmoji]   = useState(false)
  const [customEmojis,setCustomEmojis] = useState([])
  const [showAllEmoji, setShowAllEmoji] = useState(false)
  const [hoverMsg, setHoverMsg]   = useState(null)
  const [reacting, setReacting]   = useState(null) // msg id
  const [reactions, setReactions] = useState({})   // { msgId: { emoji: count } }
  const [myReactions, setMyReactions] = useState(new Set())
  const [showMembers, setShowMembers] = useState(false)
  const [showChannelsMobile, setShowChannelsMobile] = useState(false)
  const [newChanName, setNewChanName] = useState('')
  const [showNewChan, setShowNewChan] = useState(false)
  const [dbChannels, setDbChannels]   = useState([])   // all channels from DB (replaces hardcoded + extraChans)
  const [thread, setThread]     = useState(null)  // message being replied to
  const [repMenu, setRepMenu]   = useState(null)   // { rep, x, y } — right-click context menu
  const [repPrefs, setRepPrefs] = useState({})     // { repName: { hidden, vip } } — per-viewer
  const [threadPanel, setThreadPanel] = useState(null) // parent message shown in thread side panel
  const [chanMenu, setChanMenu] = useState(null)   // { conv, convType, x, y } — channel/DM context menu
  const [convPrefs, setConvPrefs] = useState({})   // { convId: { starred, muted, section } } — per-viewer
  const [detailsPanel, setDetailsPanel] = useState(null) // { conv, convType } — shows Conversation/Channel details
  const [searchInConv, setSearchInConv] = useState(false)
  const [searchInConvQuery, setSearchInConvQuery] = useState('')
  function promptMoveToSection(convId, convType) {
    const section = window.prompt('Move to which section? (leave blank to remove from any custom section)')
    if (section === null) return
    const current = convPrefs[convId] || { starred: false, muted: false, section: null }
    const next = { ...current, section: section.trim() || null }
    setConvPrefs(p => ({ ...p, [convId]: next }))
    supabase.from('chat_conv_prefs').upsert(
      { viewer_name: myName, conv_id: convId, conv_type: convType, starred: next.starred, muted: next.muted, section: next.section },
      { onConflict: 'viewer_name,conv_id' }
    )
  }
  const [searchQ, setSearchQ]   = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [TEAM, setTEAM] = useState([])
  const [myEmpId, setMyEmpId] = useState(null)
  // Real display name from the employees table — messages were being sent
  // under user.email's local-part (e.g. "romy", "rcruz187") whenever Supabase
  // Auth's user_metadata.name wasn't set, which also broke avatar matching
  // downstream (avatars are looked up by exact name match against TEAM).
  // Resolving from the same employees row myEmpId already comes from fixes
  // both at once.
  const [myRealName, setMyRealName] = useState(null)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)
  const fileRef   = useRef(null)
  const pollerRef = useRef(null)

  const myName = myRealName || user?.user_metadata?.name || user?.email?.split('@')[0] || 'You'

  useEffect(() => {
    if (!webrtc.onHuddleEventRef) return
    webrtc.onHuddleEventRef.current = payload => {
      if (!payload || typeof payload !== 'object') return
      if (payload.type === 'reaction' && payload.emoji) {
        const id = payload.eventId || (Date.now() + Math.random())
        const x = 10 + Math.random() * 80
        setFloatReactions(r => [...r, { id, emoji:payload.emoji, x }])
        floatReactionTimers.current[id] = setTimeout(() => {
          setFloatReactions(r => r.filter(i => i.id !== id))
          delete floatReactionTimers.current[id]
        }, 3000)
      } else if (payload.type === 'thread' && payload.msg) {
        setHuddleThread(t => t.some(m => String(m.id) === String(payload.msg.id)) ? t : [...t, payload.msg])
      } else if (payload.type === 'raise-hand' && payload.sender) {
        setRaisedHands(h => ({ ...h, [payload.sender]: !!payload.raised }))
        if (payload.raised) {
          const msg = {
            id: 'raise-' + payload.sender + '-' + Date.now(),
            sender: payload.sender,
            text: `✋ ${payload.sender} raised their hand`,
            ts: new Date().toISOString(),
            system: true
          }
          setHuddleThread(t => [...t, msg])
        }
      }
    }
    return () => { if (webrtc.onHuddleEventRef) webrtc.onHuddleEventRef.current = null }
  }, [webrtc.onHuddleEventRef])
  // Use DB channels if loaded, otherwise the single fallback CHANNELS entry
  const allChannels = dbChannels.length > 0 ? dbChannels : CHANNELS
  // A DM lives in ONE symmetric channel keyed by BOTH employee ids (sorted),
  // so my view and the other person's view are the same conversation and nobody
  // can read a third party's DM wall by opening their roster entry. Legacy
  // messages used a one-sided 'dm_<recipient>' wall — those are reconstructed at
  // read time by sender (see loadMessages) so no history is orphaned.
  const dmPair = (a, b) => 'dm_' + [String(a), String(b)].sort().join('__')
  const isChannel = !active.id.startsWith('dm_')
  const channelId = (!isChannel && active.empId && myEmpId) ? dmPair(myEmpId, active.empId) : active.id
  const chatTenantId = myTenantId || null

  const customEmojiMap = useMemo(() => Object.fromEntries(customEmojis.map(e=>[':'+e.name+':',e])), [customEmojis])

  function renderChatText(text){
    if(!text) return null
    return String(text).split(/(:[a-z0-9_+-]{2,40}:)/g).map((part,i)=>{
      const custom=customEmojiMap[part]
      return custom
        ? <img key={i} src={custom.url} alt={part} title={part} style={{width:24,height:24,objectFit:'contain',verticalAlign:'middle',margin:'0 2px'}}/>
        : <span key={i}>{part}</span>
    })
  }

  function renderReactionToken(token){
    const custom=customEmojiMap[token]
    return custom ? <img src={custom.url} alt={token} title={token} style={{width:18,height:18,objectFit:'contain'}}/> : token
  }

  const loadCustomEmojis = useCallback(async () => {
    if(!chatTenantId) return
    const { data, error } = await supabase.from('chat_custom_emojis').select('id,name,image_path,created_by,created_at').eq('tenant_id', chatTenantId).order('name')
    if(error) return
    const rows=await Promise.all((data||[]).map(async e=>{
      const { data:urlData }=await supabase.storage.from('chat-emojis').createSignedUrl(e.image_path,31536000)
      return {...e,url:urlData?.signedUrl||''}
    }))
    setCustomEmojis(rows.filter(e=>e.url))
  }, [chatTenantId])

  useEffect(() => { loadCustomEmojis() }, [loadCustomEmojis])

  async function createCustomEmoji(file,name){
    if(!chatTenantId || !file) return
    if(file.size > 1024*1024){ showToast('Custom emoji must be 1 MB or smaller'); return }
    const ext=(file.name.split('.').pop()||'png').toLowerCase().replace(/[^a-z0-9]/g,'') || 'png'
    const path=`${chatTenantId}/${Date.now()}_${name}.${ext}`
    const { error:upErr }=await supabase.storage.from('chat-emojis').upload(path,file,{upsert:false,contentType:file.type||undefined})
    if(upErr){ showToast('Custom emoji upload failed: '+upErr.message); return }
    const { error:dbErr }=await supabase.from('chat_custom_emojis').insert([{tenant_id:chatTenantId,name,image_path:path,created_by:myName}])
    if(dbErr){
      await supabase.storage.from('chat-emojis').remove([path])
      showToast(dbErr.code==='23505' ? ':'+name+': already exists' : 'Custom emoji save failed: '+dbErr.message)
      return
    }
    await loadCustomEmojis()
    showToast('Custom emoji :'+name+': added')
  }

  // ── load channels from DB on mount ── [v3 - cache busted]
  useEffect(() => {
    if (!myTenantId) { setDbChannels([]); return }
    console.log('[Chat v4] loading tenant-scoped channels'); supabase.from('chat_channels').select('*').eq('tenant_id', myTenantId).order('position').order('label')
      .then(({ data }) => {
        if (data?.length) setDbChannels(data.map(c => ({ id: c.id, label: c.label, desc: c.description || '' })))
      })
  }, [myTenantId])

  // ── escape page-content padding ──
  useEffect(() => {
    const el = document.querySelector('.page-content')
    if (!el) return
    const op = el.style.padding, oo = el.style.overflow, oh = el.style.height, opos = el.style.position
    el.style.padding = '0'; el.style.overflow = 'hidden'; el.style.height = '100%'; el.style.position = 'relative'
    return () => { el.style.padding = op; el.style.overflow = oo; el.style.height = oh; el.style.position = opos }
  }, [])

  // ── Presence: online + live call/huddle state (Slack-style) ──
  useEffect(() => {
    if (!myName || myName === 'You') return
    const presenceCh = supabase.channel(`chat-presence:${myTenantId || 'unresolved'}`, { config: { presence: { key: myName } } })
    presenceChRef.current = presenceCh
    const syncPresence = () => {
      const state = presenceCh.presenceState()
      setOnlineUsers(new Set(Object.keys(state)))
      const next = {}
      for (const [name, entries] of Object.entries(state)) {
        const latest = Array.isArray(entries) ? entries[entries.length - 1] : null
        next[name] = { activity: latest?.activity || 'online', label: latest?.activity_label || 'Available' }
      }
      setPresenceMeta(next)
    }
    presenceCh
      .on('presence', { event: 'sync' }, syncPresence)
      .on('presence', { event: 'join' }, syncPresence)
      .on('presence', { event: 'leave' }, syncPresence)
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await presenceCh.track({ name: myName, online_at: new Date().toISOString(), activity: 'online', activity_label: 'Available' })
        }
      })
    return () => { presenceChRef.current = null; supabase.removeChannel(presenceCh) }
  }, [myName])

  // Re-track the existing realtime presence whenever this staff member enters
  // a CRM phone call or Team Chat huddle. No extra polling table is needed.
  useEffect(() => {
    const presenceCh = presenceChRef.current
    if (!presenceCh || !myName || myName === 'You') return
    const activity = huddle ? 'huddle' : calling ? 'call' : 'online'
    const activityLabel = huddle ? 'In a huddle' : calling ? 'On a call' : 'Available'
    presenceCh.track({
      name: myName,
      online_at: new Date().toISOString(),
      activity,
      activity_label: activityLabel,
      call_direction: calling ? (activeCall?.entityType || 'crm') : null,
    }).catch(() => {})
  }, [myName, huddle, calling, activeCall?.entityType])

  // A deep-linked DM starts as a placeholder (we only have the channel id
  // before the roster loads); swap in the real entry once TEAM arrives so the
  // header shows the person's name and avatar rather than "Direct Message".
  useEffect(() => {
    if (!active?.id?.startsWith('dm_') || active.empId) return
    const hit = TEAM.find(t => t.id === active.id)
    if (hit) setActive(hit)
  }, [TEAM, active])

  // ── fetch all employees for DM list ──
  useEffect(() => {
    if (!myTenantId) { setTEAM([]); setMyEmpId(null); setMyRealName(null); return }
    supabase.from('employees').select('id, name, role, avatar_url, email').eq('tenant_id', myTenantId).order('name').then(({ data }) => {
      if (!data) return
      const me = data.find(e => e.email && user?.email && e.email.toLowerCase() === user.email.toLowerCase())
      if (me) { setMyEmpId(me.id); setMyRealName(me.name) }
      let roster = data.map(e => ({
        id: 'dm_' + e.id,
        empId: e.id,
        name: e.name,
        role: e.role || '',
        color: colorFor(e.name),
        avatarUrl: e.avatar_url || null,
        email: e.email || '',
      }))
      // When platform admin is impersonating another tenant, inject Romy into
      // that tenant's roster so their staff can DM him directly
      try {
        const imp = sessionStorage.getItem('admin_impersonation')
        if (imp && user?.email === 'romy@taxrescrm.net') {
          const alreadyInRoster = roster.some(r => r.email === 'romy@taxrescrm.net')
          if (!alreadyInRoster) {
            const adminEntry = { id: 'dm_taxrescrm-admin', empId: 'taxrescrm-admin', name: 'Romy Cruz', role: 'TaxRes CRM Admin', color: colorFor('Romy Cruz'), avatarUrl: null, email: 'romy@taxrescrm.net' }
            roster = [adminEntry, ...roster]
            if (!me) { setMyEmpId('taxrescrm-admin'); setMyRealName('Romy Cruz') }
          }
        }
      } catch (_) {}
      setTEAM(roster)
    })
  }, [user?.email, myTenantId])

  // ── per-viewer rep prefs (hidden / VIP) ──
  useEffect(() => {
    if (!myName) return
    supabase.from('chat_rep_prefs').select('rep_name, hidden, vip').eq('viewer_name', myName)
      .then(({ data }) => {
        if (!data) return
        const map = {}
        data.forEach(r => { map[r.rep_name] = { hidden: r.hidden, vip: r.vip } })
        setRepPrefs(map)
      })
  }, [myName])

  async function toggleRepPref(repName, key) {
    const current = repPrefs[repName] || { hidden: false, vip: false }
    const next = { ...current, [key]: !current[key] }
    setRepPrefs(p => ({ ...p, [repName]: next }))
    await supabase.from('chat_rep_prefs').upsert(
      { viewer_name: myName, rep_name: repName, hidden: next.hidden, vip: next.vip },
      { onConflict: 'viewer_name,rep_name' }
    )
    setRepMenu(null)
  }

  function openRepMenu(e, rep) {
    e.preventDefault()
    setRepMenu({ rep, x: e.clientX, y: e.clientY })
  }

  // Close context menu on any outside click
  useEffect(() => {
    if (!repMenu) return
    const close = () => setRepMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [repMenu])

  // ── per-viewer conversation prefs (star / mute / section) ──
  useEffect(() => {
    if (!myName) return
    supabase.from('chat_conv_prefs').select('conv_id, starred, muted, section').eq('viewer_name', myName)
      .then(({ data }) => {
        if (!data) return
        const map = {}
        data.forEach(r => { map[r.conv_id] = { starred: r.starred, muted: r.muted, section: r.section } })
        setConvPrefs(map)
      })
  }, [myName])

  async function toggleConvPref(convId, convType, key) {
    const current = convPrefs[convId] || { starred: false, muted: false, section: null }
    const next = { ...current, [key]: !current[key] }
    setConvPrefs(p => ({ ...p, [convId]: next }))
    await supabase.from('chat_conv_prefs').upsert(
      { viewer_name: myName, conv_id: convId, conv_type: convType, starred: next.starred, muted: next.muted, section: next.section },
      { onConflict: 'viewer_name,conv_id' }
    )
    setChanMenu(null)
  }

  function openChanMenu(e, conv, convType) {
    e.preventDefault()
    setChanMenu({ conv, convType, x: e.clientX, y: e.clientY })
  }

  useEffect(() => {
    if (!chanMenu) return
    const close = () => setChanMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [chanMenu])

  const loadMessages = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    let data, error
    if (!isChannel && active.empId) {
      // DM: read the new symmetric pair channel PLUS the two legacy one-sided
      // walls, then keep only messages that belong to THIS pair — the pair
      // channel in full, and legacy wall messages filtered by sender so a third
      // party's messages on either wall are never shown to us.
      const pair    = myEmpId ? dmPair(myEmpId, active.empId) : null
      const dmOther = 'dm_' + active.empId
      const dmMine  = myEmpId ? 'dm_' + myEmpId : null
      const chans   = [...new Set([dmOther, ...(pair ? [pair] : []), ...(dmMine ? [dmMine] : [])])]
      const res = await supabase.from('chat_messages').select('*').eq('tenant_id', myTenantId).in('channel', chans)
        .order('created_at', { ascending: true }).limit(600)
      error = res.error
      data = (res.data || []).filter(m =>
        (pair && m.channel === pair) ||                              // new symmetric channel
        (m.channel === dmOther && m.sender === myName) ||            // legacy: I → them
        (dmMine && m.channel === dmMine && m.sender === active.name) // legacy: them → me
      )
    } else {
      const res = await supabase.from('chat_messages').select('*').eq('tenant_id', myTenantId).eq('channel', channelId)
        .order('created_at', { ascending: true }).limit(300)
      data = res.data; error = res.error
    }
    if (!silent) setLoading(false)
    if (error) {
      if (!silent) setMessages([{ id: 'sys', isSystem: true, text:
        error.code === '42P01'
          ? 'Run this SQL first:\n\nCREATE TABLE IF NOT EXISTS chat_messages (\n  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,\n  channel text NOT NULL,\n  sender text NOT NULL,\n  text text,\n  attachment_url text,\n  attachment_name text,\n  created_at timestamptz DEFAULT now()\n);\nALTER TABLE chat_messages DISABLE ROW LEVEL SECURITY;'
          : 'Error: ' + error.message
      }])
      return
    }
    setMessages(data || [])
  }, [channelId, isChannel, active.empId, active.name, myEmpId, myName, myTenantId])

  useEffect(() => {
    loadMessages(); inputRef.current?.focus()
    // Realtime subscription: new messages appear instantly without waiting for the poller.
    // The channel name includes channelId so it rebuilds automatically when switching conversations.
    const rt = supabase.channel('chat-active-' + channelId)
    rt.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages',
      filter: `channel=eq.${channelId}` }, ({ new: msg }) => {
      if (!myTenantId || msg?.tenant_id !== myTenantId) return
      loadMessages(true)
    }).subscribe()
    // 60-second heartbeat as a fallback for any missed realtime events.
    clearInterval(pollerRef.current)
    pollerRef.current = setInterval(() => loadMessages(true), 60000)
    return () => {
      clearInterval(pollerRef.current)
      supabase.removeChannel(rt)
    }
  }, [loadMessages, channelId])

  useEffect(() => {
    if (!showSearch) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!messages.length || !chatTenantId) { setReactions({}); setMyReactions(new Set()); return }
    const ids = messages.map(m=>m.id).filter(Boolean).filter(id=>id !== 'sys')
    if (!ids.length) return
    let cancelled=false
    const loadReactionState=async()=>{
      const { data, error } = await supabase.from('chat_reactions')
        .select('message_id,user_name,emoji').in('message_id', ids)
      if (cancelled || error) return
      const counts={}
      const mine=new Set()
      ;(data||[]).forEach(r=>{
        counts[r.message_id] ||= {}
        counts[r.message_id][r.emoji]=(counts[r.message_id][r.emoji]||0)+1
        if(r.user_name===myName) mine.add(r.message_id+'|'+r.emoji)
      })
      setReactions(counts); setMyReactions(mine)
    }
    loadReactionState()
    const rt=supabase.channel('chat-reactions-'+channelId)
      .on('postgres_changes',{event:'*',schema:'public',table:'chat_reactions'},loadReactionState)
      .subscribe()
    return()=>{cancelled=true;supabase.removeChannel(rt)}
  }, [messages, myName, channelId, chatTenantId])

  useEffect(() => {
    if (!messages.length || !chatTenantId || !myName || myName==='You') return
    const last=[...messages].reverse().find(m=>m.id && m.id!=='sys')
    if(!last) return
    supabase.from('chat_read_state').upsert({
      tenant_id:chatTenantId, viewer_name:myName, conv_id:channelId,
      last_read_message_id:last.id, last_read_at:new Date().toISOString()
    },{onConflict:'tenant_id,viewer_name,conv_id'}).then(()=>{})
  }, [messages, myName, channelId])



  async function send() {
    const text = input.trim()
    if (!text || sending || !myTenantId) return
    setSending(true)
    const payload = { tenant_id: myTenantId, channel: channelId, sender: myName, text, created_at: new Date().toISOString() }
    if (thread) payload.reply_to = thread.id
    await supabase.from('chat_messages').insert([payload])
    setSending(false); setInput(''); setThread(null)
    loadMessages(true)
    // Forward to Slack if sync is enabled for this tenant (fire-and-forget, never blocks the UI)
    if (myTenantId && isChannel) {
      supabase.functions.invoke('slack-send', {
        body: { tenant_id: myTenantId, channel: channelId, sender: myName, text }
      }).catch(() => {})
    }
  }

  async function sendFile(e) {
    const file = e.target.files[0]; if (!file) return
    const _v = validateFile(file)
    if (!_v.ok) { alert('❌ ' + _v.error); return }
    if (_v.warn) showToast('⚠️ ' + _v.warn)
    if (!chatTenantId) { alert('Upload failed: tenant could not be resolved'); return }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_')
    const path = `${chatTenantId}/${Date.now()}_${safeName}`
    const { error: upErr } = await supabase.storage.from('chat-attachments').upload(path, file, { upsert: false })
    if (upErr) { alert('Upload failed: ' + upErr.message); return }
    const { error: msgErr } = await supabase.from('chat_messages').insert([{
      tenant_id: chatTenantId, channel: channelId, sender: myName, text: '',
      attachment_url: 'storage://chat-attachments/' + path, attachment_name: file.name,
      created_at: new Date().toISOString()
    }])
    if (msgErr) {
      await supabase.storage.from('chat-attachments').remove([path]).catch(() => {})
      alert('Attachment message failed: ' + msgErr.message)
      return
    }
    loadMessages(true); e.target.value = ''
  }

  function handleKey(e) {
    if (e.key === 'Escape' && mentionQuery !== null) { e.preventDefault(); setMentionQuery(null); return }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  function switchTo(item) {
    setActive(item); setShowEmoji(false); setThread(null)
    setReacting(null); setShowSearch(false); setSearchQ('')
    setShowChannelsMobile(false)
  }

  async function addReaction(msgId, emoji) {
    if (!chatTenantId || !msgId || msgId==='sys') return
    const key=msgId+'|'+emoji
    if(myReactions.has(key)){
      await supabase.from('chat_reactions').delete()
        .eq('message_id',msgId).eq('user_name',myName).eq('emoji',emoji)
    }else{
      await supabase.from('chat_reactions').upsert({
        tenant_id:chatTenantId,message_id:msgId,user_name:myName,emoji
      },{onConflict:'message_id,user_name,emoji'})
    }
    setReacting(null)
  }

  // ── Huddle (video/audio call) — actual WebRTC logic lives in the
  // shared useWebRTCRoom hook now, used here and by the public client
  // Meeting Room. These are just the Chat-specific bits: generating a
  // room id, posting the "someone started a huddle" nudge into chat.
  async function startHuddle() {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2,7)}`
    setShowHuddleInvite(false)
    const result = await webrtc.join(id, myName, true)
    if (!result.ok) { showToast(result.reason || 'Could not start huddle'); return null }
    rawHuddleRef.current = webrtc.localStreamRef.current
    setHuddleId(id)
    setIsHuddleHost(true)
    return id  // caller needs this before React state update applies
  }

  async function joinHuddle(id) {
    setIncomingHuddle(null)
    const result = await webrtc.join(id, myName, true)
    if (!result.ok) { showToast(result.reason || 'Could not join huddle'); return }
    rawHuddleRef.current = webrtc.localStreamRef.current
    setHuddleId(id)
    setIsHuddleHost(false)
    // Register callback: if host ends the huddle, auto-leave
    // Directly call the stable webrtc.leave() + reset UI state — no stale closure risk
    webrtc.onHuddleEndRef.current = async () => {
      webrtc.onHuddleEndRef.current = null
      stopHuddleScreenShare()
      vbg.stopLoop()
      setHuddleProcessedStream(null)
      setShowBgPanel(false)
      await webrtc.leave()
      setIsHuddleHost(false)
      setHuddleId(null)
      setShowHuddleInvite(false)
    }
  }

  // Ring a specific person directly — posts into their DM pair channel with
  // invite_to so only they get the incoming call notification, not everyone.
  async function ringPerson(rep, explicitRoomId) {
    // explicitRoomId is passed by the caller (startHuddle returns the id directly)
    // because huddleId React state may not have updated yet (setState is async).
    // Falling back to huddleId handles the case where we're already in a huddle.
    const roomId = explicitRoomId || huddleId

    // Find the rep's empId to build the DM pair channel
    const repEmpId = rep.empId
    const pairChannel = (myEmpId && repEmpId) ? dmPair(myEmpId, repEmpId) : 'general'

    await supabase.from('chat_messages').insert([{
      channel: pairChannel,
      sender: '🔔 System',
      text: `📞 ${myName} is calling you`,
      huddle_id: roomId,
      invite_to: rep.name,
      created_at: new Date().toISOString()
    }])
  }

  async function inviteToHuddle(rep) {
    // Legacy path: used by the "+ Invite" panel inside an active huddle
    // where we don't have a rep object with empId — just post to general
    const name = typeof rep === 'string' ? rep : rep.name
    if (!huddleMembers.includes(name)) {
      const notifyChannel = isChannel ? channelId : 'general'
      await supabase.from('chat_messages').insert([{
        channel: notifyChannel, sender: '🔔 System',
        text: `📞 ${myName} invited ${name} to join the Huddle!`,
        huddle_id: huddleId, created_at: new Date().toISOString()
      }])
    }
  }

  async function leaveHuddle() {
    if (isHuddleHost) {
      // Host ending = end for everyone — broadcast before leaving
      webrtc.broadcastEnd()
      // Small delay so broadcast reaches peers before the channel is torn down
      await new Promise(r => setTimeout(r, 300))
    }
    webrtc.onHuddleEndRef.current = null // clear so we don't self-trigger
    stopHuddleScreenShare()
    vbg.stopLoop()
    setHuddleProcessedStream(null)
    setShowBgPanel(false)
    await webrtc.leave()
    setIsHuddleHost(false)
    setHuddleId(null)
    setShowHuddleInvite(false)
    setRaisedHand(false)
    setRaisedHands({})
    setHuddleThread([])
    setHuddleThreadInput('')
    setFloatReactions([])
  }

  async function startHuddleScreenShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, cursor: 'always' }, audio: true })
      const track  = stream.getVideoTracks()[0]
      huddleScreenTrackRef.current = track
      setHuddleScreenStream(stream)
      setHuddleSharingScreen(true)
      // Replace video track on every peer connection
      const pcs = webrtc.peerConnsRef.current
      Object.values(pcs).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (sender) sender.replaceTrack(track).catch(() => {})
      })
      track.onended = () => stopHuddleScreenShare()
    } catch (e) {
      if (e.name !== 'NotAllowedError') showToast('Screen share unavailable')
    }
  }

  function stopHuddleScreenShare() {
    if (huddleScreenTrackRef.current) {
      huddleScreenTrackRef.current.onended = null
      huddleScreenTrackRef.current.stop()
      huddleScreenTrackRef.current = null
    }
    if (huddleScreenStream) { huddleScreenStream.getTracks().forEach(t => t.stop()); setHuddleScreenStream(null) }
    setHuddleSharingScreen(false)
    // Restore camera track to all peers
    const camTrack = webrtc.localStreamRef.current?.getVideoTracks()[0]
    if (camTrack) {
      const pcs = webrtc.peerConnsRef.current
      Object.values(pcs).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (sender) sender.replaceTrack(camTrack).catch(() => {})
      })
    }
  }

  async function handleHuddleBgSelect(mode, presetId, customUrl) {
    const raw = rawHuddleRef.current
    if (!raw) return
    if (mode === 'none') {
      vbg.stopLoop()
      webrtc.localStreamRef.current = raw
      setHuddleProcessedStream(null)
      return
    }
    const out = await vbg.changeBackground(raw, mode, presetId, customUrl)
    if (!out) return
    webrtc.localStreamRef.current = out
    setHuddleProcessedStream(new MediaStream(out.getTracks()))
    try {
      const newTrack = out.getVideoTracks()[0]
      if (newTrack) {
        const pcs = Object.values(webrtc.peerConnsRef?.current || {})
        for (const pc of pcs) {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video')
          if (sender) sender.replaceTrack(newTrack).catch(() => {})
        }
      }
    } catch (_) {}
  }

  // Listen for incoming huddle invites via chat messages
  useEffect(() => {
    const ch = supabase.channel('huddle-notify')
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, ({ new: msg }) => {
      if (!msg.huddle_id || msg.sender !== '🔔 System' || huddle) return
      // Direct ring: invite_to must match my name (or be absent for legacy broadcasts)
      if (msg.invite_to && msg.invite_to !== myName) return
      // Extract caller name from "📞 X is calling you" or legacy "📞 X invited Y..."
      const caller = msg.text?.replace(/^📞\s*/, '').replace(/ is calling you.*/, '').replace(/ invited .*/, '') || 'Someone'
      setIncomingHuddle({ from: caller, huddleId: msg.huddle_id })
    }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [huddle, myName])

  // Huddles are scoped to this page (unlike phone calls, which persist
  // via CallContext at the Shell level) -- navigating away from Chat
  // ends the huddle, same as the original implementation always did.
  useEffect(() => {
    return () => { webrtc.leave() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function addChannel() {
    if (!canManageChannels || !myTenantId) return
    const name = newChanName.trim().toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'')
    if (!name) return
    const newChan = { id: 'ch_'+name.toLowerCase().replace(/\s+/g,'-'), label: name, desc: '' }
    // Persist to DB
    supabase.from('chat_channels').insert([{
      id: newChan.id, label: newChan.label, description: '',
      position: 99, tenant_id: myTenantId
    }]).then(() => {
      // Reload all channels to pick up the new one with correct tenant scoping
      supabase.from('chat_channels').select('*').eq('tenant_id', myTenantId).order('position').order('label')
        .then(({ data }) => { if (data?.length) setDbChannels(data.map(c => ({ id: c.id, label: c.label, desc: c.description || '' }))) })
    })
    setDbChannels(c => [...c, newChan])
    setNewChanName(''); setShowNewChan(false)
  }

  // Group messages
  const displayMsgs = showSearch && searchQ
    ? messages.filter(m => m.text?.toLowerCase().includes(searchQ.toLowerCase()) || m.sender?.toLowerCase().includes(searchQ.toLowerCase()))
    : messages

  const grouped = []
  let lastDate = null
  for (const m of displayMsgs) {
    const label = fmtDate(m.created_at)
    if (label !== lastDate) { grouped.push({ type: 'divider', label }); lastDate = label }
    grouped.push({ type: 'msg', ...m })
  }

  const s = {
    sidebar: { width: 240, flexShrink: 0, background: 'var(--nav)', borderRight: '1px solid var(--br)', display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden' },
    sectionHeader: { padding: '8px 16px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--t3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    chanRow: (active) => ({ padding: '4px 12px 4px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, borderRadius: 6, margin: '1px 6px', background: active ? 'rgba(79,142,247,.18)' : 'transparent', color: active ? 'var(--tx)' : 'var(--t2)', fontWeight: active ? 600 : 400, fontSize: 14, transition: 'background .1s' }),
  }

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'var(--bg)', overflow: 'hidden', flexDirection: 'column' }}>

      {chatToast && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: 'var(--s2)', border: '1px solid #f87171', color: '#fca5a5', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 1100, boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>{chatToast}</div>
      )}

      {/* ── Incoming Huddle Alert ── */}
      {incomingHuddle && !huddle && (
        <div style={{ background: 'linear-gradient(90deg,#14532d,#15803d)', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, color: '#dcfce7', flexShrink: 0, zIndex: 100 }}>
          <span style={{ fontSize: 24, animation: 'spin 1s linear infinite' }}>📞</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>Incoming call from {incomingHuddle.from}</div>
            <div style={{ fontSize: 12, opacity: .8, marginTop: 2 }}>Tap Accept to join the huddle</div>
          </div>
          <button onClick={() => joinHuddle(incomingHuddle.huddleId)}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
            ✅ Accept
          </button>
          <button onClick={() => setIncomingHuddle(null)}
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
            ❌ Decline
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      {/* ── LEFT SIDEBAR ── */}
      {showChannelsMobile && <div className="chat-sidebar-backdrop" onClick={() => setShowChannelsMobile(false)} />}
      <div style={s.sidebar} className={`chat-channel-sidebar${showChannelsMobile ? ' mobile-open' : ''}`}>
        <button onClick={() => setShowChannelsMobile(false)} className="chat-sidebar-close-btn" aria-label="Close">×</button>

        {/* Workspace header */}
        <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--br)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
            {(FIRM.name || 'TC').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'TC'}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--tx)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{FIRM.name || 'Tax Case Review'}</div>
            <div style={{ fontSize: 11, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }}/>
              {myName}
            </div>
          </div>
        </div>

        {/* Huddle button */}
        <div style={{ padding: '10px 10px 6px', flexShrink: 0 }}>
          {notifyPermission === 'default' && (
            <button onClick={enableDesktopNotifications} style={{width:'100%',marginBottom:6,padding:'6px 10px',borderRadius:7,border:'1px solid var(--br)',background:'transparent',color:'var(--t2)',fontSize:11,cursor:'pointer'}}>
              🔔 Enable Team Chat notifications
            </button>
          )}
          {!huddle ? (
            <button onClick={startHuddle} style={{ width: '100%', padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--s2)', color: 'var(--tx)', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13, transition: 'background .15s' }}
              onMouseEnter={e => e.currentTarget.style.background='var(--s3)'}
              onMouseLeave={e => e.currentTarget.style.background='var(--s2)'}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.18 1h3a2 2 0 012 1.72 12.05 12.05 0 00.7 2.81 2 2 0 01-.45 2.11L4.91 8.15a16 16 0 006.29 6.29l1.51-1.52a2 2 0 012.11-.45 12.05 12.05 0 002.81.7A2 2 0 0122 16.92z"/>
              </svg>
              Start Huddle
            </button>
          ) : (
            <div style={{ background: '#052e16', border: '1px solid #16a34a', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#4ade80' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', display: 'inline-block', animation: 'pulse 2s infinite' }}/>
                  Huddle Active
                </div>
                <div style={{ display:'flex', gap:4 }}>
                  <button onClick={webrtc.toggleMic} style={{ background: 'none', border: 'none', color: micOn ? '#4ade80' : '#f87171', fontSize: 11, cursor: 'pointer', fontWeight: 700, padding: '1px 5px' }} title={micOn ? 'Mute mic' : 'Unmute mic'}>
                    {micOn ? '🎤' : '🔇'}
                  </button>
                  <button onClick={webrtc.toggleCamera} style={{ background: 'none', border: 'none', color: cameraOn ? '#4ade80' : '#f87171', fontSize: 11, cursor: 'pointer', fontWeight: 700, padding: '1px 5px' }} title={cameraOn ? 'Turn camera off' : 'Turn camera on'}>
                    {cameraOn ? '📹' : '📷'}
                  </button>
                  <button onClick={leaveHuddle} style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 11, cursor: 'pointer', fontWeight: 700, padding: '1px 5px' }}>{isHuddleHost ? 'End' : 'Leave'}</button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
                {huddleMembers.map(name => (
                  <div key={name} title={name} style={{ position: 'relative' }}>
                    <Avatar name={name} size={24}/>
                    <span style={{ position: 'absolute', bottom: -1, right: -1, width: 7, height: 7, borderRadius: '50%', background: '#4ade80', border: '1px solid #052e16' }}/>
                  </div>
                ))}
                <button onClick={() => setShowHuddleInvite(h => !h)} style={{ width: 24, height: 24, borderRadius: '50%', border: '1px dashed #16a34a', background: 'none', color: '#4ade80', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
              </div>
              {showHuddleInvite && (
                <div style={{ background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 6, overflow: 'hidden' }}>
                  {TEAM.filter(t => !huddleMembers.includes(t.name)).map(t => (
                    <div key={t.id} onClick={() => inviteToHuddle(t.name)} style={{ padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--t2)' }}
                      onMouseEnter={e => e.currentTarget.style.background='var(--s2)'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                      <Avatar name={t.name} size={20} color={t.color}/>
                      {t.name}
                    </div>
                  ))}
                  {TEAM.every(t => huddleMembers.includes(t.name)) && (
                    <div style={{ padding: '6px 10px', fontSize: 12, color: 'var(--t3)' }}>Everyone's in!</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick nav — Threads / Huddles / Drafts / Directories */}
        <div style={{ padding: '4px 6px', flexShrink: 0 }}>
          {[
            { id: 'threads',     label: 'Threads',      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 12h6M9 16h4"/></svg> },
            { id: 'huddles',     label: 'Huddles',       icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 14a8 8 0 0116 0v1a3 3 0 01-3 3h-1v-5h4M3 14v1a3 3 0 003 3h1v-5H3"/></svg> },
            { id: 'drafts',      label: 'Drafts & sent', icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg> },
            { id: 'directories', label: 'Directories',   icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2M16 3.13a4 4 0 010 7.75M21 21v-2a4 4 0 00-3-3.85"/></svg> },
          ].map(item => {
            const isAct = active.id === item.id
            return (
              <div key={item.id} onClick={() => switchTo({ id: item.id, name: item.label })} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 6, cursor: 'pointer',
                color: isAct ? '#fff' : 'var(--t2)', background: isAct ? 'var(--blue)' : 'transparent', fontSize: 13, fontWeight: 600,
              }}
                onMouseEnter={e => { if (!isAct) e.currentTarget.style.background = 'var(--s2)' }}
                onMouseLeave={e => { if (!isAct) e.currentTarget.style.background = 'transparent' }}>
                {item.icon}{item.label}
              </div>
            )
          })}
        </div>

        <div style={{ height: 1, background: 'var(--s2)', margin: '6px 0', flexShrink: 0 }}/>

        {/* Channels */}
        <div style={{ marginTop: 8, flexShrink: 0 }}>
          <div style={s.sectionHeader}>
            <span>Channels</span>
            {canManageChannels && (
              <span onClick={() => setShowNewChan(v => !v)} style={{ fontSize: 17, cursor: 'pointer', color: 'var(--t3)', lineHeight: 1, padding: '0 2px' }} title="Add channel">+</span>
            )}
          </div>
          {showNewChan && canManageChannels && (
            <div style={{ display: 'flex', gap: 4, padding: '4px 10px 4px' }}>
              <input value={newChanName} onChange={e => setNewChanName(e.target.value)}
                onKeyDown={e => e.key==='Enter' && addChannel()}
                placeholder="channel-name" style={{ flex: 1, background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 5, color: 'var(--tx)', fontSize: 12, padding: '4px 8px', outline: 'none' }}/>
              <button onClick={addChannel} style={{ background: '#1d4ed8', border: 'none', color: '#fff', borderRadius: 5, padding: '4px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>Add</button>
            </div>
          )}
          {allChannels.map(ch => {
            const isAct = active.id === ch.id
            const isMuted = convPrefs[ch.id]?.muted
            const isStarred = convPrefs[ch.id]?.starred
            return (
              <div key={ch.id} onClick={() => switchTo(ch)} onContextMenu={e => openChanMenu(e, ch, 'channel')} style={s.chanRow(isAct)}
                onMouseEnter={e => { if (!isAct) e.currentTarget.style.background = 'var(--s2)' }}
                onMouseLeave={e => { if (!isAct) e.currentTarget.style.background = 'transparent' }}>
                <span style={{ fontSize: 16, color: isAct ? '#93c5fd' : 'var(--t3)', lineHeight: 1 }}>#</span>
                <span style={{ flex: 1, opacity: isMuted ? 0.5 : 1 }}>{ch.label}</span>
                {isStarred && <span style={{ fontSize: 11, color: '#f59e0b' }}>★</span>}
                {isMuted && <span style={{ fontSize: 11, color: 'var(--t3)' }}>🔕</span>}
              </div>
            )
          })}
        </div>

        <div style={{ height: 1, background: 'var(--s2)', margin: '10px 0', flexShrink: 0 }}/>

        {/* Direct Messages */}
        <div style={{ flexShrink: 0 }}>
          <div style={s.sectionHeader}>
            <span>Direct Messages</span>
          </div>
          {TEAM
            .filter(dm => !repPrefs[dm.name]?.hidden)
            .sort((a, b) => {
              const aVip = repPrefs[a.name]?.vip ? 1 : 0
              const bVip = repPrefs[b.name]?.vip ? 1 : 0
              return bVip - aVip
            })
            .map(dm => {
            const isAct = active.id === dm.id
            const isVip = repPrefs[dm.name]?.vip
            return (
              <div key={dm.id} onClick={() => switchTo(dm)} onContextMenu={e => openRepMenu(e, dm)} style={{ ...s.chanRow(isAct), gap: 10 }}
                onMouseEnter={e => { if (!isAct) e.currentTarget.style.background = 'var(--s2)' }}
                onMouseLeave={e => { if (!isAct) e.currentTarget.style.background = 'transparent' }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <Avatar name={dm.name} size={26} color={dm.color} avatarUrl={dm.avatarUrl}/>
                  <span style={{ position: 'absolute', bottom: -1, right: -1, width: 8, height: 8, borderRadius: '50%', background: onlineUsers.has(dm.name) ? '#22c55e' : '#475569', border: '2px solid #0d1526' }}/>
                </div>
                <span style={{ fontSize: 14, flex: 1 }}>{dm.name}</span>
                {['call','huddle'].includes(presenceMeta[dm.name]?.activity) && <span title={presenceMeta[dm.name]?.label || (presenceMeta[dm.name]?.activity === 'huddle' ? 'In a huddle' : 'On a call')} aria-label={presenceMeta[dm.name]?.label || 'Busy'} style={{fontSize:13,opacity:.82,lineHeight:1,flexShrink:0}}>🎧</span>}
                {isVip && <span style={{ fontSize: 11, color: '#f59e0b' }} title="VIP">★</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── MAIN AREA ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--sf)' }}>

      {active.id === 'threads' ? (
        <ThreadsView TEAM={TEAM} myName={myName} switchToThread={setThreadPanel} />
      ) : active.id === 'huddles' ? (
        <HuddlesView TEAM={TEAM} />
      ) : active.id === 'drafts' ? (
        <DraftsView TEAM={TEAM} myName={myName} channels={allChannels} />
      ) : active.id === 'directories' ? (
        <DirectoriesView TEAM={TEAM} myName={myName} myEmail={user?.email} onUpdated={() => {
          supabase.from('employees').select('id, name, role, avatar_url, email').eq('tenant_id', myTenantId).order('name').then(({ data }) => {
            if (!data) return
            setTEAM(data.map(e => ({ id: 'dm_' + e.id, empId: e.id, name: e.name, role: e.role || '', color: colorFor(e.name), avatarUrl: e.avatar_url || null, email: e.email || '' })))
          })
        }} />
      ) : (
      <>
        {/* Full-screen Huddle Overlay */}
        {huddle && huddleFullscreen && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 9000,
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {floatReactions.map(r => (
              <div key={r.id} style={{
                position: 'absolute', bottom: 80, left: `${r.x}%`,
                fontSize: 36, pointerEvents: 'none', zIndex: 9010,
                animation: 'huddleFloatUp 3s ease-out forwards',
              }}>{r.emoji}</div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', flexShrink: 0, background: 'rgba(0,0,0,.3)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 8px #4ade80', display: 'inline-block' }}/>
              <span style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>Huddle</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 4 }}>
                {huddleMembers.map(n => (
                  <div key={n} style={{ position: 'relative' }}>
                    <Avatar name={n} size={26} color={colorFor(n)}/>
                    {raisedHands[n] && <span style={{ position: 'absolute', top: -8, right: -8, fontSize: 14 }}>✋</span>}
                  </div>
                ))}
              </div>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{huddleMembers.join(', ')}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button onClick={() => setShowHuddleThread(t => !t)}
                  style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${showHuddleThread ? '#6366f1' : 'rgba(255,255,255,.2)'}`, background: showHuddleThread ? 'rgba(99,102,241,.2)' : 'rgba(255,255,255,.08)', color: showHuddleThread ? '#a5b4fc' : '#e2e8f0', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  💬 Thread {huddleThread.length > 0 && <span style={{ background: '#6366f1', color: '#fff', borderRadius: 10, padding: '0 5px', fontSize: 10, marginLeft: 4 }}>{huddleThread.length}</span>}
                </button>
                <button onClick={() => setHuddleFullscreen(false)}
                  style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,.2)', background: 'rgba(255,255,255,.08)', color: '#e2e8f0', cursor: 'pointer', fontSize: 12 }}>
                  ⬇ Minimize
                </button>
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 12, padding: 16, alignContent: 'center', overflowY: 'auto', alignItems: 'center', justifyContent: 'center' }}>
                {huddleSharingScreen && huddleScreenStream && (
                  <div style={{ width: '100%', borderRadius: 12, overflow: 'hidden', border: '2px solid #7c3aed', background: '#000', maxHeight: '55%', position: 'relative' }}>
                    <video autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                      ref={el => { if (el && huddleScreenStream) el.srcObject = huddleScreenStream }}/>
                    <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(124,58,237,.85)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>You are sharing</div>
                  </div>
                )}
                <div style={{ width: huddleMembers.length <= 2 ? 380 : 280, borderRadius: 12, overflow: 'hidden', flexShrink: 0, position: 'relative', border: '2px solid rgba(255,255,255,.12)' }}>
                  <VideoTile stream={huddleProcessedStream || webrtc.localStream} name={myName} label={`${myName} (you)`} muted mirror videoEnabled={cameraOn}/>
                  {raisedHand && <div style={{ position: 'absolute', top: 8, right: 8, fontSize: 20, background: 'rgba(0,0,0,.55)', borderRadius: 8, padding: '2px 6px' }}>✋</div>}
                  {!micOn && <div style={{ position: 'absolute', bottom: 8, left: 8, background: 'rgba(0,0,0,.6)', borderRadius: 20, padding: '2px 8px', fontSize: 11, color: '#fca5a5' }}>🔇</div>}
                </div>
                {huddleMembers.filter(n => n !== myName).map(n => (
                  <div key={n} style={{ width: huddleMembers.length <= 2 ? 380 : 280, borderRadius: 12, overflow: 'hidden', flexShrink: 0, position: 'relative', border: '2px solid rgba(255,255,255,.12)' }}>
                    <VideoTile stream={webrtc.remoteStreams[n]} name={n}/>
                    {raisedHands[n] && <div style={{ position: 'absolute', top: 8, right: 8, fontSize: 20, background: 'rgba(0,0,0,.55)', borderRadius: 8, padding: '2px 6px' }}>✋</div>}
                  </div>
                ))}
              </div>
              {showHuddleThread && (
                <div style={{ width: 300, flexShrink: 0, background: 'rgba(15,23,42,.95)', borderLeft: '1px solid rgba(255,255,255,.1)', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,.08)', fontWeight: 700, color: '#fff', fontSize: 14 }}>
                    💬 Huddle Thread
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 400, marginTop: 2 }}>Saved after huddle ends</div>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {huddleThread.length === 0 && <div style={{ color: '#475569', fontSize: 12, textAlign: 'center', marginTop: 20 }}>No messages yet</div>}
                    {huddleThread.map(m => (
                      <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <Avatar name={m.sender} size={24}/>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: m.system ? '#f59e0b' : '#a5b4fc', marginBottom: 2 }}>{m.sender}</div>
                          <div style={{ fontSize: 13, color: m.system ? '#fde68a' : '#e2e8f0', lineHeight: 1.4 }}>{m.text}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', gap: 8 }}>
                    <input value={huddleThreadInput} onChange={e => setHuddleThreadInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && sendHuddleThreadMsg()}
                      placeholder="Message thread…"
                      style={{ flex: 1, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, padding: '7px 10px', color: '#f1f5f9', fontSize: 13, outline: 'none' }}/>
                    <button onClick={sendHuddleThreadMsg} style={{ background: '#6366f1', border: 'none', borderRadius: 8, padding: '7px 12px', color: '#fff', cursor: 'pointer', fontSize: 13 }}>↑</button>
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 24px', background: 'rgba(0,0,0,.45)', flexShrink: 0, flexWrap: 'wrap' }}>
              {[
                { icon: micOn ? '🎤' : '🔇', label: micOn ? 'Mute' : 'Unmuted', onClick: webrtc.toggleMic, active: micOn, danger: !micOn },
                { icon: cameraOn ? '📹' : '📷', label: cameraOn ? 'Camera' : 'Off', onClick: webrtc.toggleCamera, active: cameraOn, danger: !cameraOn },
              ].map(b => (
                <button key={b.label} onClick={b.onClick}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: b.danger ? 'rgba(239,68,68,.25)' : 'rgba(255,255,255,.12)', border: `1px solid ${b.danger ? '#ef4444' : 'rgba(255,255,255,.2)'}`, borderRadius: 12, padding: '8px 16px', cursor: 'pointer', color: b.danger ? '#fca5a5' : '#e2e8f0', minWidth: 64 }}>
                  <span style={{ fontSize: 20 }}>{b.icon}</span>
                  <span style={{ fontSize: 10, fontWeight: 600 }}>{b.label}</span>
                </button>
              ))}
              <button onClick={huddleSharingScreen ? stopHuddleScreenShare : startHuddleScreenShare}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: huddleSharingScreen ? 'rgba(124,58,237,.3)' : 'rgba(255,255,255,.12)', border: `1px solid ${huddleSharingScreen ? '#7c3aed' : 'rgba(255,255,255,.2)'}`, borderRadius: 12, padding: '8px 16px', cursor: 'pointer', color: huddleSharingScreen ? '#c4b5fd' : '#e2e8f0', minWidth: 64 }}>
                <span style={{ fontSize: 20 }}>🖥️</span>
                <span style={{ fontSize: 10, fontWeight: 600 }}>{huddleSharingScreen ? 'Stop' : 'Share'}</span>
              </button>
              <div style={{ position: 'relative' }}>
                <button onClick={() => setShowBgPanel(p => !p)}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: showBgPanel ? 'rgba(59,130,246,.25)' : 'rgba(255,255,255,.12)', border: `1px solid ${showBgPanel ? '#3b82f6' : 'rgba(255,255,255,.2)'}`, borderRadius: 12, padding: '8px 16px', cursor: 'pointer', color: showBgPanel ? '#93c5fd' : '#e2e8f0', minWidth: 64 }}>
                  <span style={{ fontSize: 20 }}>🖼️</span>
                  <span style={{ fontSize: 10, fontWeight: 600 }}>BG</span>
                </button>
                {showBgPanel && (
                  <div style={{ position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 9020 }}>
                    <VirtualBackground bgMode={vbg.bgMode} bgPreset={vbg.bgPreset} segStatus={vbg.segStatus} onSelect={handleHuddleBgSelect}/>
                  </div>
                )}
              </div>
              <button onClick={toggleRaiseHand}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: raisedHand ? 'rgba(245,158,11,.25)' : 'rgba(255,255,255,.12)', border: `1px solid ${raisedHand ? '#f59e0b' : 'rgba(255,255,255,.2)'}`, borderRadius: 12, padding: '8px 16px', cursor: 'pointer', color: raisedHand ? '#fde68a' : '#e2e8f0', minWidth: 64 }}>
                <span style={{ fontSize: 20 }}>✋</span>
                <span style={{ fontSize: 10, fontWeight: 600 }}>{raisedHand ? 'Lower' : 'Raise'}</span>
              </button>
              <div style={{ position: 'relative' }}>
                <button onClick={() => setShowHuddleReactPicker(p => !p)}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 12, padding: '8px 16px', cursor: 'pointer', color: '#e2e8f0', minWidth: 64 }}>
                  <span style={{ fontSize: 20 }}>😊</span>
                  <span style={{ fontSize: 10, fontWeight: 600 }}>React</span>
                </button>
                {showHuddleReactPicker && (
                  <div style={{ position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)', background: '#1e293b', border: '1px solid rgba(255,255,255,.15)', borderRadius: 12, padding: 10, display: 'flex', gap: 6, flexWrap: 'wrap', width: 200, zIndex: 9020, boxShadow: '0 8px 32px rgba(0,0,0,.5)' }}>
                    {['👍','❤️','😂','🎉','🔥','😮','👏','🙏','💯','🤝','✅','👀'].map(e => (
                      <button key={e} onClick={() => fireHuddleReaction(e)}
                        style={{ fontSize: 22, background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, padding: 3, lineHeight: 1 }}
                        onMouseEnter={ev => ev.currentTarget.style.background='rgba(255,255,255,.12)'}
                        onMouseLeave={ev => ev.currentTarget.style.background='none'}>
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <button onClick={() => setShowHuddleInvite(h => !h)}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 12, padding: '8px 16px', cursor: 'pointer', color: '#e2e8f0', minWidth: 64 }}>
                  <span style={{ fontSize: 20 }}>👥</span>
                  <span style={{ fontSize: 10, fontWeight: 600 }}>Invite</span>
                </button>
                {showHuddleInvite && (
                  <div style={{ position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)', background: '#1e293b', border: '1px solid rgba(255,255,255,.15)', borderRadius: 10, padding: 6, zIndex: 9020, minWidth: 200, boxShadow: '0 8px 32px rgba(0,0,0,.5)' }}>
                    {TEAM.filter(t => !huddleMembers.includes(t.name)).map(t => (
                      <div key={t.id} onClick={() => inviteToHuddle(t.name)}
                        style={{ padding: '7px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e2e8f0', borderRadius: 6 }}
                        onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.08)'}
                        onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                        <Avatar name={t.name} size={24} color={t.color}/>{t.name}
                      </div>
                    ))}
                    {TEAM.every(t => huddleMembers.includes(t.name)) && <div style={{ padding: '7px 12px', fontSize: 12, color: '#64748b' }}>Everyone's in!</div>}
                  </div>
                )}
              </div>
              <button onClick={leaveHuddle}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'rgba(239,68,68,.2)', border: '1px solid #ef4444', borderRadius: 12, padding: '8px 16px', cursor: 'pointer', color: '#fca5a5', minWidth: 64 }}>
                <span style={{ fontSize: 20 }}>📵</span>
                <span style={{ fontSize: 10, fontWeight: 600 }}>{isHuddleHost ? 'End' : 'Leave'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Minimized huddle bar */}
        {huddle && !huddleFullscreen && (
          <div style={{ background: '#052e16', borderBottom: '1px solid #16a34a', padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4ade80', display: 'inline-block', animation: 'pulse 2s infinite' }}/>
            <span style={{ fontWeight: 700, color: '#dcfce7', fontSize: 13 }}>Huddle active</span>
            <span style={{ color: '#86efac', fontSize: 12 }}>{huddleMembers.join(', ')}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button onClick={webrtc.toggleMic} style={{ padding: '3px 10px', borderRadius: 5, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', color: '#dcfce7', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>{micOn ? '🎤' : '🔇'}</button>
              <button onClick={webrtc.toggleCamera} style={{ padding: '3px 10px', borderRadius: 5, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', color: '#dcfce7', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>{cameraOn ? '📹' : '📷'}</button>
              <button onClick={() => setHuddleFullscreen(true)} style={{ padding: '3px 10px', borderRadius: 5, background: 'rgba(99,102,241,.2)', border: '1px solid #6366f1', color: '#a5b4fc', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>⬆ Open</button>
              <button onClick={leaveHuddle} style={{ padding: '3px 10px', borderRadius: 5, background: 'rgba(239,68,68,.15)', border: '1px solid #ef4444', color: '#fca5a5', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>{isHuddleHost ? 'End' : 'Leave'}</button>
            </div>
          </div>
        )}
        <style>{`@keyframes huddleFloatUp { 0%{opacity:1;transform:translateY(0) scale(1)} 80%{opacity:.8;transform:translateY(-120px) scale(1.3)} 100%{opacity:0;transform:translateY(-160px) scale(.8)} }`}</style>

        {/* Channel header */}
        {/* Channel header */}
        <div style={{ height: 52, borderBottom: '1px solid var(--br)', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12, flexShrink: 0, background: 'var(--sf)' }}>
          <button onClick={() => setShowChannelsMobile(true)} title="Channels" className="chat-channel-toggle-btn"
            style={{ width: 32, height: 32, background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, color: 'var(--t2)', cursor: 'pointer', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--tx)', display: 'flex', alignItems: 'center', gap: 6 }}>
              {isChannel ? <><span style={{ color: 'var(--t3)', fontWeight: 400, fontSize: 18 }}>#</span>{active.label}</> : active.name}
            </div>
            {isChannel && active.desc && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 1 }}>{active.desc}</div>}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            {/* Search */}
            {showSearch ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input value={searchQ} onChange={e => setSearchQ(e.target.value)} autoFocus
                  placeholder="Search messages…"
                  style={{ background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, color: 'var(--tx)', fontSize: 12, padding: '5px 10px', outline: 'none', width: 180 }}/>
                <button onClick={() => { setShowSearch(false); setSearchQ('') }} style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', fontSize: 16 }}>×</button>
              </div>
            ) : (
              <button onClick={() => setShowSearch(true)} title="Search" style={{ width: 32, height: 32, background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, color: 'var(--t2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              </button>
            )}
            <button onClick={() => setShowMembers(m => !m)} title="Members" style={{ width: 32, height: 32, background: showMembers ? '#1d4ed8' : 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, color: 'var(--t2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
            </button>
            <button onClick={() => loadMessages()} title="Refresh" style={{ width: 32, height: 32, background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, color: 'var(--t2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>⟳</button>
          </div>
        </div>

        {/* Body = messages + optional members panel */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 4px', display: 'flex', flexDirection: 'column' }}>
            {loading && <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 40, fontSize: 14 }}>Loading…</div>}
            {!loading && messages.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--t3)', padding: '60px 20px', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--s2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, marginBottom: 16 }}>
                  {isChannel ? '#' : '💬'}
                </div>
                <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 6, color: 'var(--tx)' }}>{isChannel ? `Welcome to #${active.label}` : `DM with ${active.name}`}</div>
                <div style={{ fontSize: 14 }}>{isChannel ? active.desc + ' — be the first to say something!' : 'Send a direct message.'}</div>
              </div>
            )}

            {!loading && grouped.map((item, i) => {
              if (item.type === 'divider') return (
                <div key={'div'+i} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 10px', color: 'var(--t3)', fontSize: 12 }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--s2)' }}/>
                  <span style={{ fontWeight: 600, background: 'var(--sf)', padding: '2px 10px', borderRadius: 20, border: '1px solid var(--br)' }}>{item.label}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--s2)' }}/>
                </div>
              )
              if (item.isSystem) return (
                <div key={item.id} style={{ background: 'var(--s2)', borderRadius: 8, padding: '12px 16px', margin: '4px 0', border: '1px solid var(--br)' }}>
                  <pre style={{ fontSize: 12, color: 'var(--t2)', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'monospace' }}>{item.text}</pre>
                </div>
              )

              const prev = grouped[i-1]
              const cont = prev && prev.type === 'msg' && prev.sender === item.sender && !prev.isSystem
                && (new Date(item.created_at) - new Date(prev.created_at)) < 5*60*1000
              const msgReactions = reactions[item.id] || {}
              const isHovered = hoverMsg === item.id

              return (
                <div key={item.id}
                  onMouseEnter={() => setHoverMsg(item.id)}
                  onMouseLeave={() => { setHoverMsg(null); if (reacting === item.id) setReacting(null) }}
                  style={{ display: 'flex', gap: 12, padding: cont ? '1px 0 1px 48px' : '7px 0 1px', alignItems: 'flex-start', position: 'relative', borderRadius: 6, background: isHovered ? 'rgba(255,255,255,.02)' : 'transparent' }}>

                  {/* Hover toolbar */}
                  {isHovered && (
                    <div style={{ position: 'absolute', right: 0, top: -4, display: 'flex', gap: 2, background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 8, padding: '3px 4px', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,.4)' }}>
                      {QUICK_EMOJIS.slice(0,5).map(e => (
                        <span key={e} onClick={() => addReaction(item.id, e)} style={{ fontSize: 16, cursor: 'pointer', padding: '2px 4px', borderRadius: 4, transition: 'background .1s' }}
                          onMouseEnter={ev => ev.target.style.background='var(--b2c)'}
                          onMouseLeave={ev => ev.target.style.background='transparent'}>{e}</span>
                      ))}
                      <span onClick={() => setReacting(id => id === item.id ? null : item.id)} style={{ fontSize: 14, cursor: 'pointer', padding: '2px 6px', borderRadius: 4, color: 'var(--t2)', display: 'flex', alignItems: 'center' }}
                        onMouseEnter={ev => ev.target.style.background='var(--b2c)'}
                        onMouseLeave={ev => ev.target.style.background='transparent'}>＋</span>
                      <div style={{ width: 1, background: 'var(--b2c)', margin: '2px 2px' }}/>
                      <span onClick={() => setThread(item)} title="Reply in thread" style={{ fontSize: 13, cursor: 'pointer', padding: '2px 6px', borderRadius: 4, color: 'var(--t2)', display: 'flex', alignItems: 'center', gap: 3 }}
                        onMouseEnter={ev => ev.target.style.background='var(--b2c)'}
                        onMouseLeave={ev => ev.target.style.background='transparent'}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>
                        Reply
                      </span>
                    </div>
                  )}

                  {/* Avatar */}
                  {!cont && <Avatar name={item.sender} size={36} avatarUrl={TEAM.find(t => t.name === item.sender)?.avatarUrl}/>}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {!cont && (
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--tx)' }}>{item.sender}</span>
                        <span style={{ fontSize: 11, color: 'var(--t3)' }}>{fmtTime(item.created_at)}</span>
                      </div>
                    )}
                    {item.reply_to && (
                      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 3, paddingLeft: 8, borderLeft: '2px solid #334155' }}>↩ Reply</div>
                    )}
                    {item.text && (
                      <div style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--tx)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderChatText(item.text)}</div>
                    )}
                    {item.attachment_url && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 8, padding: '8px 14px', marginTop: 4, maxWidth: 340 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4f8ef7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <ChatAttachmentLink url={item.attachment_url} name={item.attachment_name} />
                      </div>
                    )}
                    {/* Reactions */}
                    {Object.entries(msgReactions).length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                        {Object.entries(msgReactions).map(([emoji, count]) => (
                          <span key={emoji} onClick={() => addReaction(item.id, emoji)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(79,142,247,.12)', border: '1px solid rgba(79,142,247,.3)', borderRadius: 12, padding: '1px 8px', fontSize: 13, cursor: 'pointer', color: '#93c5fd' }}>
                            {renderReactionToken(emoji)} <span style={{ fontSize: 11, fontWeight: 700 }}>{count}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Full emoji picker */}
                    {reacting === item.id && (
                      <div style={{position:'relative',height:1,marginTop:6}}>
                        <SlackEmojiPicker customEmojis={customEmojis} onCreateCustom={createCustomEmoji} onPick={emoji => addReaction(item.id, emoji)} />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef}/>
          </div>

          {/* Members panel */}
          {showMembers && (
            <div className="chat-members-panel" style={{ width: 220, flexShrink: 0, borderLeft: '1px solid var(--br)', background: 'var(--nav)', padding: '16px 0', overflowY: 'auto' }}>
              <div style={{ padding: '0 16px 10px', fontSize: 12, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Members — {TEAM.length}</div>
              {TEAM.map(m => (
                <div key={m.id} onClick={() => { switchTo(m); setShowMembers(false) }} style={{ padding: '7px 16px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background='var(--s2)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <Avatar name={m.name} size={30} color={m.color}/>
                    <span style={{ position: 'absolute', bottom: 0, right: 0, width: 8, height: 8, borderRadius: '50%', background: '#22c55e', border: '2px solid #0d1526' }}/>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx)' }}>{m.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{m.role}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Thread reply notice */}
        {thread && (
          <div style={{ padding: '6px 20px', background: 'var(--sf)', borderTop: '1px solid var(--br)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--t2)', flexShrink: 0 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>
            Replying to <strong style={{ color: 'var(--tx)' }}>{thread.sender}</strong>: <span style={{ color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{thread.text?.slice(0, 60)}{thread.text?.length > 60 ? '…' : ''}</span>
            <button onClick={() => setThread(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--t3)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
        )}

        {/* Input bar — Slack-style composer */}
        <div style={{ padding: '10px 16px 14px', borderTop: '1px solid var(--br)', background: 'var(--sf)', flexShrink: 0, position:'relative' }}>
          {showEmoji && <SlackEmojiPicker customEmojis={customEmojis} onCreateCustom={createCustomEmoji} onPick={emoji => { setInput(v => v + emoji); setShowEmoji(false); inputRef.current?.focus() }} />}
          <div style={{ background:'var(--s2)', border:'1px solid var(--br)', borderRadius:10, overflow:'visible', position:'relative' }}>
            {mentionQuery !== null && (
              <div style={{ position: 'absolute', bottom: 58, left: 10, background: 'var(--s2)', border: '1px solid var(--b2)', borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,.3)', zIndex: 310, minWidth: 220, maxHeight: 240, overflowY: 'auto', padding: '4px 0' }}>
                <div style={{ padding: '6px 14px 4px', fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1 }}>Mention someone</div>
                {TEAM.filter(t => t.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 8).map(t => (
                  <div key={t.empId} onClick={() => {
                    setInput(prev => prev.replace(/@\w*$/, '@' + t.name + ' '))
                    setMentionQuery(null)
                    inputRef.current?.focus()
                  }} style={{ padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}
                  onMouseEnter={e => e.currentTarget.style.background='var(--s3)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: colorFor(t.name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#fff', fontWeight: 600, flexShrink: 0 }}>
                      {t.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}
                    </div>
                    <span style={{ color: 'var(--tx)' }}>{t.name}</span>
                    {t.role && <span style={{ color: 'var(--t3)', fontSize: 12 }}>{t.role}</span>}
                  </div>
                ))}
              </div>
            )}
            <textarea ref={inputRef} value={input} onChange={e => {
                const val=e.target.value; setInput(val); const match=val.match(/@(\w*)$/); setMentionQuery(match?match[1]:null)
              }} onKeyDown={handleKey}
              placeholder={`Message ${isChannel ? '#'+active.label : active.name}`}
              rows={2}
              style={{ width:'100%', resize:'none', border:'none', outline:'none', background:'transparent', color:'var(--tx)', fontSize:15, lineHeight:1.5, padding:'10px 12px 4px', fontFamily:'inherit', minHeight:52, maxHeight:160, boxSizing:'border-box' }}/>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'4px 7px 7px'}}>
              <div style={{display:'flex',alignItems:'center',gap:2}}>
                <button onClick={() => fileRef.current?.click()} title="Add attachment" style={{width:30,height:30,borderRadius:'50%',border:'none',background:'var(--s3)',color:'var(--tx)',cursor:'pointer',fontSize:20,lineHeight:1}}>+</button>
                <input ref={fileRef} type="file" style={{ display:'none' }} onChange={sendFile}/>
                <button title="Formatting" style={{height:30,border:0,background:'transparent',color:'var(--t2)',cursor:'default',fontSize:14,padding:'0 7px'}}>Aa</button>
                <button onClick={() => setShowEmoji(v=>!v)} title="Emoji" style={{height:30,border:0,background:'transparent',cursor:'pointer',fontSize:18,padding:'0 6px'}}>☺</button>
                <button onClick={() => {
                  if (mentionQuery !== null) {
                    setMentionQuery(null)
                    setInput(v=>v.replace(/@[\w]*$/,''))
                  } else {
                    setInput(v=>/@[\w]*$/.test(v) ? v : v+'@')
                    setMentionQuery('')
                  }
                  inputRef.current?.focus()
                }} title="Mention" style={{height:30,border:0,background:'transparent',color:'var(--t2)',cursor:'pointer',fontSize:17,padding:'0 6px'}}>@</button>
                <button title="More actions" style={{height:30,border:0,background:'transparent',color:'var(--t2)',cursor:'default',fontSize:18,padding:'0 6px'}}>…</button>
              </div>
              <div style={{display:'flex',alignItems:'center'}}>
                <button onClick={send} disabled={sending || !input.trim()} title="Send message" style={{width:36,height:30,border:0,borderRadius:'6px 0 0 6px',background:input.trim()?'#007a5a':'transparent',color:input.trim()?'#fff':'var(--t3)',cursor:input.trim()?'pointer':'default',fontSize:16}}>
                  {sending ? '…' : '➤'}
                </button>
                <button disabled={!input.trim()} title="Send options" style={{width:24,height:30,border:0,borderLeft:'1px solid rgba(255,255,255,.18)',borderRadius:'0 6px 6px 0',background:input.trim()?'#007a5a':'transparent',color:input.trim()?'#fff':'var(--t3)',fontSize:12}}>⌄</button>
              </div>
            </div>
          </div>
          <div style={{ fontSize:11, color:'var(--t3)', marginTop:5, paddingLeft:4 }}>Enter to send · Shift+Enter for new line</div>
        </div>
      </>
      )}
      </div>
      </div>

      {/* Right-click context menu on a rep — visible to all employees, same as Slack's per-user Hide/VIP */}
      {repMenu && (
        <ContextMenu pos={repMenu}>
          <MenuHeader>{repMenu.rep.name}</MenuHeader>
          <MenuItem onClick={() => {
            const rep = repMenu.rep; setRepMenu(null)
            if (huddle) { ringPerson(rep) }
            else { startHuddle().then(newRoomId => { if (newRoomId) ringPerson(rep, newRoomId) }) }
          }}>🎙️ Start huddle with {repMenu.rep.name.split(' ')[0]}</MenuItem>
          <MenuDivider/>
          <MenuItem onClick={() => { setDetailsPanel({ conv: repMenu.rep, convType: 'dm' }); setRepMenu(null) }}>Conversation details</MenuItem>
          <MenuItem onClick={() => { navigator.clipboard.writeText(repMenu.rep.name); setRepMenu(null); showToast('Copied') }}>Copy name</MenuItem>
          <MenuItem onClick={() => toggleConvPref(repMenu.rep.id, 'dm', 'starred')}>
            {convPrefs[repMenu.rep.id]?.starred ? '★ Unstar conversation' : '☆ Star conversation'}
          </MenuItem>
          <MenuItem onClick={() => { setRepMenu(null); promptMoveToSection(repMenu.rep.id, 'dm') }}>Move to new section</MenuItem>
          <MenuDivider/>
          <MenuItem onClick={() => toggleRepPref(repMenu.rep.name, 'vip')}>
            {repPrefs[repMenu.rep.name]?.vip ? '★ Remove from VIP' : '☆ Add to VIP'}
          </MenuItem>
          <MenuItem onClick={() => toggleConvPref(repMenu.rep.id, 'dm', 'muted')}>
            {convPrefs[repMenu.rep.id]?.muted ? '🔔 Unmute' : '🔕 Mute'}
          </MenuItem>
          <MenuItem danger onClick={() => toggleRepPref(repMenu.rep.name, 'hidden')}>Hide {repMenu.rep.name}</MenuItem>
        </ContextMenu>
      )}

      {chanMenu && (
        <ContextMenu pos={chanMenu}>
          <MenuHeader>#{chanMenu.conv.label}</MenuHeader>
          <MenuItem onClick={() => { setDetailsPanel({ conv: chanMenu.conv, convType: 'channel' }); setChanMenu(null) }}>Channel details</MenuItem>
          <MenuItem onClick={() => { navigator.clipboard.writeText(chanMenu.conv.label); setChanMenu(null); showToast('Copied') }}>Copy channel name</MenuItem>
          <MenuItem onClick={() => toggleConvPref(chanMenu.conv.id, 'channel', 'starred')}>
            {convPrefs[chanMenu.conv.id]?.starred ? '★ Unstar channel' : '☆ Star channel'}
          </MenuItem>
          <MenuItem onClick={() => { setChanMenu(null); promptMoveToSection(chanMenu.conv.id, 'channel') }}>Move to new section</MenuItem>
          <MenuDivider/>
          <MenuItem onClick={() => toggleConvPref(chanMenu.conv.id, 'channel', 'muted')}>
            {convPrefs[chanMenu.conv.id]?.muted ? '🔔 Notify: All new posts' : '🔕 Mute and hide'}
          </MenuItem>
          {canManageChannels && !['general','cases','billing','irs','hr'].includes(chanMenu.conv.id) && (
            <>
              <MenuDivider/>
              <MenuItem danger onClick={() => { supabase.from('chat_channels').delete().eq('id', chanMenu.conv.id).then(() => {
                  supabase.from('chat_channels').select('*').order('position').order('label')
                    .then(({ data }) => { if (data?.length) setDbChannels(data.map(c => ({ id: c.id, label: c.label, desc: c.description || '' }))) })
                })
                setDbChannels(c => c.filter(ch => ch.id !== chanMenu.conv.id))
                if (active.id === chanMenu.conv.id) switchTo(allChannels[0] || CHANNELS[0])
                setChanMenu(null) }}>
                Delete #{chanMenu.conv.label}
              </MenuItem>
            </>
          )}
        </ContextMenu>
      )}

      {detailsPanel && (
        <DetailsPanel detailsPanel={detailsPanel} convPrefs={convPrefs} onClose={() => setDetailsPanel(null)}/>
      )}
    </div>
  )
}

// ── Small shared context-menu building blocks ──
function ContextMenu({ pos, children }) {
  return (
    <div onClick={e => e.stopPropagation()} style={{
      position: 'fixed', top: pos.y, left: pos.x, zIndex: 2000,
      background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 10,
      boxShadow: '0 12px 32px rgba(0,0,0,.5)', minWidth: 220, overflow: 'hidden', padding: '6px 0',
    }}>{children}</div>
  )
}
function MenuHeader({ children }) {
  return <div style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700, color: 'var(--t3)', borderBottom: '1px solid var(--br)' }}>{children}</div>
}
function MenuItem({ onClick, danger, disabled, title, children }) {
  return (
    <div onClick={disabled ? undefined : onClick} title={title} style={{
      padding: '8px 14px', fontSize: 13, cursor: disabled ? 'default' : 'pointer',
      color: disabled ? 'var(--t3)' : danger ? '#f87171' : 'var(--tx)', opacity: disabled ? 0.6 : 1,
    }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--s3)' }}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      {children}
    </div>
  )
}
function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--br)', margin: '4px 0' }}/>
}

// ── Conversation/Channel details side panel ──
function DetailsPanel({ detailsPanel, convPrefs, onClose }) {
  const { conv, convType } = detailsPanel
  const isChannel = convType === 'channel'
  return (
    <div onClick={e => e.stopPropagation()} style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 320, background: 'var(--sf)',
      borderLeft: '1px solid var(--br)', zIndex: 1500, boxShadow: '-8px 0 24px rgba(0,0,0,.4)',
      display: 'flex', flexDirection: 'column', padding: '18px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--tx)' }}>{isChannel ? 'Channel details' : 'Conversation details'}</span>
        <span onClick={onClose} style={{ cursor: 'pointer', fontSize: 18, color: 'var(--t3)' }}>×</span>
      </div>
      {isChannel ? (
        <>
          <div style={{ fontSize: 22, marginBottom: 6 }}>#{conv.label}</div>
          <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 16 }}>{conv.desc || 'No description set.'}</div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Avatar name={conv.name} size={48} color={conv.color} avatarUrl={conv.avatarUrl}/>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--tx)' }}>{conv.name}</div>
            <div style={{ fontSize: 12, color: 'var(--t3)' }}>{conv.role || 'Team member'}</div>
          </div>
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--t3)', borderTop: '1px solid var(--br)', paddingTop: 12 }}>
        {convPrefs[conv.id]?.starred ? '★ Starred' : 'Not starred'} · {convPrefs[conv.id]?.muted ? '🔕 Muted' : '🔔 Notifications on'}
      </div>
    </div>
  )
}


// ── Threads View — every message in the workspace that has replies ──
function ThreadsView({ TEAM, myName }) {
  const [parents, setParents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data: all } = await supabase.from('chat_messages').select('*').order('created_at', { ascending: false }).limit(500)
      if (cancelled || !all) { setLoading(false); return }
      const repliesByParent = {}
      all.forEach(m => { if (m.reply_to) { (repliesByParent[m.reply_to] = repliesByParent[m.reply_to] || []).push(m) } })
      const parentIds = Object.keys(repliesByParent)
      const parentMsgs = all.filter(m => parentIds.includes(String(m.id)))
        .map(m => ({ ...m, replies: repliesByParent[m.id].sort((a,b) => new Date(a.created_at) - new Date(b.created_at)) }))
        .sort((a, b) => new Date(b.replies[b.replies.length-1].created_at) - new Date(a.replies[a.replies.length-1].created_at))
      setParents(parentMsgs)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--tx)', marginBottom: 4 }}>Threads</h2>
      <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 20 }}>Every conversation with replies, across all channels and DMs.</div>
      {loading ? (
        <div style={{ color: 'var(--t3)', fontSize: 13 }}>Loading…</div>
      ) : parents.length === 0 ? (
        <div style={{ color: 'var(--t3)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>No threads yet. Hover a message and click Reply to start one.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {parents.map(p => (
            <div key={p.id} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <Avatar name={p.sender} size={24} avatarUrl={TEAM.find(t => t.name === p.sender)?.avatarUrl}/>
                <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--tx)' }}>{p.sender}</span>
                <span style={{ fontSize: 11, color: 'var(--t3)' }}>{fmtDate(p.created_at)} · {fmtTime(p.created_at)}</span>
              </div>
              <div style={{ fontSize: 14, color: 'var(--tx)', marginBottom: 8, paddingLeft: 32 }}>{p.text}</div>
              <div style={{ fontSize: 12, color: 'var(--t3)', paddingLeft: 32 }}>
                💬 {p.replies.length} repl{p.replies.length === 1 ? 'y' : 'ies'} — last by <strong style={{ color: 'var(--t2)' }}>{p.replies[p.replies.length-1].sender}</strong>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Huddles View — call history log ──
function HuddlesView({ TEAM }) {
  const [huddles, setHuddles] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      // Huddle starts are logged as chat_messages with a huddle_id and the
      // "started a Huddle" text — group by huddle_id to build a session log.
      const { data } = await supabase.from('chat_messages').select('*').not('huddle_id', 'is', null).order('created_at', { ascending: false }).limit(300)
      if (cancelled || !data) { setLoading(false); return }
      const byId = {}
      data.forEach(m => {
        if (!byId[m.huddle_id]) byId[m.huddle_id] = { id: m.huddle_id, started_at: m.created_at, starter: null, participants: new Set() }
        const entry = byId[m.huddle_id]
        if (new Date(m.created_at) < new Date(entry.started_at)) entry.started_at = m.created_at
        const name = m.text?.match(/^📞 (.+?) (started|invited)/)?.[1]
        if (name) {
          if (m.text.includes('started')) entry.starter = name
          entry.participants.add(name)
        }
      })
      const list = Object.values(byId).map(h => ({ ...h, participants: Array.from(h.participants) }))
        .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
      setHuddles(list)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--tx)', marginBottom: 4 }}>Huddles</h2>
      <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 20 }}>Recent huddle calls across the workspace.</div>
      {loading ? (
        <div style={{ color: 'var(--t3)', fontSize: 13 }}>Loading…</div>
      ) : huddles.length === 0 ? (
        <div style={{ color: 'var(--t3)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>No huddles yet. Click "Start Huddle" in the sidebar to begin one.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {huddles.map(h => (
            <div key={h.id} className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 14a8 8 0 0116 0v1a3 3 0 01-3 3h-1v-5h4M3 14v1a3 3 0 003 3h1v-5H3"/></svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx)' }}>{h.starter || 'Huddle'}</div>
                <div style={{ fontSize: 12, color: 'var(--t3)' }}>{fmtDate(h.started_at)} · {fmtTime(h.started_at)}</div>
              </div>
              <div style={{ display: 'flex', gap: -6 }}>
                {h.participants.slice(0, 4).map(n => (
                  <Avatar key={n} name={n} size={22} avatarUrl={TEAM.find(t => t.name === n)?.avatarUrl}/>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Drafts & Sent View — composed messages this employee has sent, keyed by them ──
function DraftsView({ TEAM, myName, channels }) {
  const [sent, setSent] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase.from('chat_messages').select('*').eq('sender', myName).order('created_at', { ascending: false }).limit(200)
      if (!cancelled) setSent(data || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [myName])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--tx)', marginBottom: 4 }}>Drafts & sent</h2>
      <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 20 }}>Every message you've sent, most recent first.</div>
      {loading ? (
        <div style={{ color: 'var(--t3)', fontSize: 13 }}>Loading…</div>
      ) : sent.length === 0 ? (
        <div style={{ color: 'var(--t3)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>Nothing sent yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sent.map(m => {
            const chan = channels.find(c => c.id === m.channel)
            return (
              <div key={m.id} className="card" style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue)' }}>{chan ? '#'+chan.label : m.channel}</span>
                  <span style={{ fontSize: 11, color: 'var(--t3)' }}>{fmtDate(m.created_at)} · {fmtTime(m.created_at)}</span>
                </div>
                {m.text && <div style={{ fontSize: 14, color: 'var(--tx)' }}>{m.text}</div>}
                {m.attachment_name && <div style={{ fontSize: 12, color: 'var(--t3)' }}>📎 {m.attachment_name}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Directories View — every employee, with self-serve photo upload ──
function DirectoriesView({ TEAM, myName, myEmail, onUpdated }) {
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [bucketMissing, setBucketMissing] = useState(false)
  const fileRef = useRef()

  // Actually check the avatars bucket exists, instead of assuming the SQL
  // migration was run. Lists it with a 0-byte limit query — cheap, and
  // tells us definitively rather than guessing from upload behavior.
  useEffect(() => {
    supabase.storage.from('avatars').list('', { limit: 1 }).then(({ error }) => {
      if (error) setBucketMissing(true)
    })
  }, [])
  // Match by email first (reliable — comes straight from auth), fall back
  // to name match (works if metadata name happens to line up), then to no
  // match at all — in which case we still show an upload card below using
  // whatever empId we can find, so the button is never just silently gone.
  const me = TEAM.find(t => myEmail && t.email && t.email.toLowerCase() === myEmail.toLowerCase())
    || TEAM.find(t => t.name === myName)

  // selfPick lets someone manually claim their own card if auto-match
  // (by email or name) didn't find them — covers cases where the employee
  // record's email differs slightly from the login email.
  const [selfPick, setSelfPick] = useState(null)
  const effectiveMe = me || selfPick

  async function uploadMyPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!effectiveMe?.empId) {
      alert('Could not identify your employee record — pick your name from the dropdown above first.')
      return
    }
    setUploading(true)
    const path = `${effectiveMe.empId}-${Date.now()}-${file.name}`
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (upErr) {
      setUploading(false)
      alert('Photo upload failed: ' + upErr.message + (upErr.message?.includes('not found') ? '\n\nThe avatars storage bucket may not exist yet — run the chat_directories_avatars.sql migration in Supabase.' : ''))
      return
    }
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    const { error: dbErr } = await supabase.from('employees').update({ avatar_url: urlData.publicUrl }).eq('id', effectiveMe.empId)
    setUploading(false)
    if (dbErr) {
      alert('Photo uploaded but saving to your profile failed: ' + dbErr.message)
      return
    }
    onUpdated()
  }

  const filtered = TEAM.filter(t => t.name.toLowerCase().includes(search.toLowerCase()) || t.role.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', maxWidth: 760, margin: '0 auto', width: '100%' }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--tx)', marginBottom: 4 }}>Directories</h2>
      <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 16 }}>Everyone at the firm. Upload your own photo below — it'll show across Chat, Huddles, and Threads.</div>

      {bucketMissing && (
        <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '12px 16px', marginBottom: 18, fontSize: 13, color: '#fca5a5' }}>
          ⚠️ Photo uploads aren't set up yet — the storage bucket is missing. Run <code style={{ background: 'rgba(0,0,0,.3)', padding: '1px 6px', borderRadius: 4 }}>chat_directories_avatars.sql</code> in Supabase SQL Editor, then refresh this page.
        </div>
      )}

      {effectiveMe ? (
        <div className="card" style={{ padding: '14px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar name={effectiveMe.name} size={48} avatarUrl={effectiveMe.avatarUrl}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx)' }}>{effectiveMe.name}</div>
            <div style={{ fontSize: 12, color: 'var(--t3)' }}>{effectiveMe.role || 'Team member'}</div>
          </div>
          <button className="btn sec" onClick={() => fileRef.current.click()} disabled={uploading} style={{ fontSize: 12 }}>
            {uploading ? 'Uploading…' : '📤 Upload my photo'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={uploadMyPhoto}/>
        </div>
      ) : (
        <div className="card" style={{ padding: '14px 16px', marginBottom: 20 }}>
          <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 10 }}>We couldn't automatically match your login to an employee record. Tap your name below to set up your photo:</div>
          <select onChange={e => setSelfPick(TEAM.find(t => t.empId === e.target.value) || null)} defaultValue=""
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--br)', background: 'var(--s2)', color: 'var(--tx)', fontSize: 13 }}>
            <option value="" disabled>Select your name…</option>
            {TEAM.map(t => <option key={t.empId} value={t.empId}>{t.name}</option>)}
          </select>
        </div>
      )}

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people..."
        style={{ width: '100%', marginBottom: 16, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--br)', background: 'var(--s2)', color: 'var(--tx)', fontSize: 13, outline: 'none' }}/>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        {filtered.map(t => (
          <div key={t.id} className="card" style={{ padding: '16px 12px', textAlign: 'center' }}>
            <Avatar name={t.name} size={56} color={t.color} avatarUrl={t.avatarUrl}/>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tx)', marginTop: 10 }}>{t.name}</div>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{t.role || 'Team member'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
