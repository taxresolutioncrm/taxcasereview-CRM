import fs from 'node:fs'

function replaceBetween(source, start, end, replacement, label) {
  const a = source.indexOf(start)
  if (a < 0) throw new Error(`${label}: start anchor missing`)
  const b = source.indexOf(end, a)
  if (b < 0) throw new Error(`${label}: end anchor missing`)
  return source.slice(0, a) + replacement + source.slice(b)
}

function patchEmailPage() {
  const path = 'src/pages/Email.jsx'
  let s = fs.readFileSync(path, 'utf8')
  const original = s

  if (!s.includes('const [folderCounts, setFolderCounts]')) {
    // Match the state declaration semantically instead of depending on its exact
    // spacing. Prebuild scripts must remain idempotent as source formatting evolves.
    const match = s.match(/^\s*const \[emails, setEmails\]\s*=\s*useState\(\[\]\)\s*$/m)
    if (!match) throw new Error('Email.jsx: emails state declaration missing')
    const addition = `${match[0]}\n  // Authoritative unread counts are loaded separately from the visible 300-row\n  // message window so large mailboxes never show truncated/stale folder totals.\n  const [folderCounts, setFolderCounts] = useState(() => Object.fromEntries(TRIAGE.map(t => [t, 0])))\n  const countRefreshTimerRef = useRef(null)`
    s = s.replace(match[0], addition)
  }

  if (!s.includes('async function loadFolderCounts()')) {
    const anchor = `  async function load() {`
    if (!s.includes(anchor)) throw new Error('Email.jsx: load() anchor missing')
    const helper = `  async function loadFolderCounts() {\n    if (!user?.email) return\n    // Count on the server instead of fetching rows into JS. Supabase/PostgREST\n    // caps ordinary row queries, which made counts wrong once a mailbox grew\n    // past that ceiling. \"IS NOT TRUE\" intentionally treats legacy NULL\n    // is_read values as unread, matching the historical UI behavior.\n    const queries = TRIAGE.map(t => {\n      let q = supabase.from('emails')\n        .select('id', { count: 'exact', head: true })\n        .eq('mailbox_owner', user.email)\n        .is('deleted_at', null)\n        .not('is_read', 'is', true)\n      if (t === 'Inbox') q = q.or('triage.eq.Inbox,triage.is.null')\n      else q = q.eq('triage', t)\n      return q\n    })\n    const results = await Promise.all(queries)\n    const next = {}\n    TRIAGE.forEach((t, i) => {\n      if (results[i]?.error) console.error('[email-count] ' + t + ' count failed:', results[i].error.message)\n      next[t] = results[i]?.count || 0\n    })\n    setFolderCounts(next)\n  }\n\n  function scheduleFolderCountsRefresh() {\n    if (countRefreshTimerRef.current) clearTimeout(countRefreshTimerRef.current)\n    countRefreshTimerRef.current = setTimeout(() => { loadFolderCounts() }, 120)\n  }\n\n`
    s = s.replace(anchor, helper + anchor)
  }

  s = s.replace('    load(); loadGmailConfig()', '    load(); loadFolderCounts(); loadGmailConfig()')
  s = s.replace(
    `  useEffect(() => { if (lastSyncAt) load() }, [lastSyncAt])`,
    `  useEffect(() => { if (lastSyncAt) { load(); loadFolderCounts() } }, [lastSyncAt])`
  )

  s = s.replace(
    `.eq('mailbox_owner', user.email).order('created_at', { ascending: false }).limit(300)`,
    `.eq('mailbox_owner', user.email).is('deleted_at', null).order('created_at', { ascending: false }).limit(300)`
  )

  if (!s.includes('email-folder-counts-rt-')) {
    const anchor = `  async function loadGmailConfig() {`
    if (!s.includes(anchor)) throw new Error('Email.jsx: Gmail config anchor missing')
    const realtime = `  // Any local or provider-driven email UPDATE (read, unread, archive, delete,\n  // triage move) schedules one debounced count refresh. Bulk actions can emit\n  // dozens of row events; debouncing collapses them into one exact recount.\n  useEffect(() => {\n    if (!user?.email) return\n    const owner = user.email\n    const channel = supabase.channel(\`email-folder-counts-rt-\${owner}\`)\n      .on('postgres_changes', {\n        event: '*', schema: 'public', table: 'emails', filter: \`mailbox_owner=eq.\${owner}\`,\n      }, () => scheduleFolderCountsRefresh())\n      .subscribe()\n    return () => {\n      if (countRefreshTimerRef.current) clearTimeout(countRefreshTimerRef.current)\n      supabase.removeChannel(channel)\n    }\n  }, [user?.email])\n\n`
    s = s.replace(anchor, realtime + anchor)
  }

  const oldCounts = `  // Badge counts reflect UNREAD mail in each folder (standard inbox\n  // behavior) — this is what makes the Inbox number actually go down as\n  // things get read, instead of just showing a static total forever.\n  const counts = {}\n  TRIAGE.forEach(t => { counts[t] = emails.filter(e => (e.triage || 'Inbox') === t && !e.is_read).length })\n`
  if (s.includes(oldCounts)) {
    s = s.replace(oldCounts, `  // These are exact mailbox-wide unread counts, not counts from the visible\n  // 300-message window. Realtime keeps them current after bulk operations.\n  const counts = folderCounts\n`)
  }

  if (s !== original) fs.writeFileSync(path, s)
  console.log(`Email bulk/count synchronization ${s !== original ? 'patched' : 'already current'}.`)
}

function patchSidebar() {
  const path = 'src/components/layout/Sidebar.jsx'
  let s = fs.readFileSync(path, 'utf8')
  const original = s

  // The sidebar now uses the tenant-safe get_sidebar_badge_counts RPC. This
  // historical row-count repair must not replace that newer implementation or
  // search for legacy anchors that no longer exist.
  if (s.includes("supabase.rpc('get_sidebar_badge_counts')")) {
    console.log('Sidebar email counts already use authoritative badge RPC; legacy patch skipped.')
    return
  }
  const start = `    async function loadEmailTaskCounts() {`
  const end = `    if (!user) return`
  if (!s.includes(start) || !s.includes(end)) throw new Error('Sidebar.jsx: email count anchors missing')

  const replacement = `    async function loadEmailTaskCounts() {\n      if (!user?.email) return\n      // Exact server-side counts avoid PostgREST row ceilings and exclude\n      // soft-deleted messages. IS NOT TRUE preserves legacy NULL-as-unread\n      // behavior without downloading the whole mailbox into the browser.\n      const baseUnread = () => supabase.from('emails')\n        .select('id', { count: 'exact', head: true })\n        .eq('mailbox_owner', user.email)\n        .is('deleted_at', null)\n        .not('is_read', 'is', true)\n      const [inboxRes, inboxLegacyRes, actionRes, waitingRes, tasksRes] = await Promise.all([\n        baseUnread().eq('triage', 'Inbox'),\n        baseUnread().is('triage', null),\n        baseUnread().eq('triage', 'Action Needed'),\n        baseUnread().eq('triage', 'Waiting'),\n        supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('done', false).not('deleted','is',true),\n      ])\n      for (const [label, result] of [['Inbox', inboxRes], ['Legacy inbox', inboxLegacyRes], ['Action Needed', actionRes], ['Waiting', waitingRes]]) {\n        if (result.error) console.error(\`[badge] \${label} email count failed:\`, result.error.message)\n      }\n      setUnreadInbox((inboxRes.count || 0) + (inboxLegacyRes.count || 0) + (actionRes.count || 0) + (waitingRes.count || 0))\n      setEmailActionNeeded(actionRes.count || 0)\n      setEmailWaiting(waitingRes.count || 0)\n      setOpenTasks(tasksRes.count || 0)\n    }\n`

  s = replaceBetween(s, start, end, replacement, 'Sidebar email counts')
  if (s !== original) fs.writeFileSync(path, s)
  console.log(`Sidebar email counts ${s !== original ? 'patched' : 'already current'}.`)
}

patchEmailPage()
patchSidebar()
