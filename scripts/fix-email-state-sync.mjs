import fs from 'node:fs'

const path = 'src/pages/Email.jsx'
let s = fs.readFileSync(path, 'utf8')
let changed = false

function replaceBetween(start, end, replacement) {
  const a = s.indexOf(start)
  if (a < 0) throw new Error(`Email state patch start anchor missing: ${start.slice(0, 80)}`)
  const b = s.indexOf(end, a)
  if (b < 0) throw new Error(`Email state patch end anchor missing: ${end.slice(0, 80)}`)
  const current = s.slice(a, b)
  if (current === replacement) return
  s = s.slice(0, a) + replacement + s.slice(b)
  changed = true
}

function replaceBetweenAny(start, ends, replacement, label) {
  const a = s.indexOf(start)
  if (a < 0) throw new Error(`${label} start anchor missing: ${start.slice(0, 80)}`)
  let best = -1
  for (const end of ends) {
    const idx = s.indexOf(end, a)
    if (idx >= 0 && (best < 0 || idx < best)) best = idx
  }
  if (best < 0) throw new Error(`${label} end anchor missing`)
  const current = s.slice(a, best)
  if (current === replacement) return
  s = s.slice(0, a) + replacement + s.slice(best)
  changed = true
}

// Once Gmail mutations are awaited, the database is the source of truth.
// The old localRead preservation masked real unread changes after Refresh.
const oldLoad = `    if (e) {
      // Preserve is_read=true for any email the user already opened this session.
      // Without this, a background lastSyncAt reload resets the unread dot on
      // emails the user just clicked — the DB write from markRead() can race
      // with the reload and the fetch wins with the old value.
      setEmails(prev => {
        const localRead = new Set(prev.filter(x => x.is_read).map(x => x.id))
        return e.map(row => localRead.has(row.id) ? { ...row, is_read: true } : row)
      })
    }`
const newLoad = `    if (e) setEmails(e)`
if (s.includes(oldLoad)) {
  s = s.replace(oldLoad, newLoad)
  changed = true
}

const actionBlock = `  async function runMailboxAction(emailIds, action) {
    const ids = Array.isArray(emailIds) ? emailIds : [emailIds]
    const chunks = []
    for (let i = 0; i < ids.length; i += 5) chunks.push(ids.slice(i, i + 5))

    async function invokeChunk(chunk, attempt = 0) {
      try {
        const chunkRows = chunk.map(id => emails.find(row => String(row.id) === String(id))).filter(Boolean)
        const useM365 = isNashville && chunkRows.length > 0 && chunkRows.every(row => !!row.m365_message_id)
        const { data, error } = useM365
          ? await supabase.functions.invoke('m365-mail-gateway', {
              body: { action:'message_action', email_ids:chunk, message_action:action },
            })
          : await supabase.functions.invoke('gmail-sync-cron', {
              body: { mode:'message_action', email_ids:chunk, action },
            })
        if (error) throw new Error(error.message || String(error))
        if (!data?.ok) {
          const detail = data?.failures?.[0]?.error || data?.error || 'Mailbox action failed'
          throw new Error(detail)
        }
        return data
      } catch (e) {
        if (attempt < 1) {
          await new Promise(resolve => setTimeout(resolve, 700))
          return invokeChunk(chunk, attempt + 1)
        }
        throw e
      }
    }

    const succeeded = []
    const failures = []
    for (let i = 0; i < chunks.length; i += 3) {
      const wave = chunks.slice(i, i + 3)
      const results = await Promise.allSettled(wave.map(chunk => invokeChunk(chunk)))
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') succeeded.push(...(result.value?.succeeded || wave[idx]))
        else failures.push({ ids: wave[idx], error: result.reason?.message || String(result.reason) })
      })
    }
    if (failures.length) throw new Error(failures[0].error || 'Mailbox action failed')
    return { ok: true, action, succeeded, failures: [] }
  }

`
if (s.includes('  async function runMailboxAction(')) {
  replaceBetween(`  async function runMailboxAction(`, `  async function moveTriage(id, triage) {`, actionBlock)
} else {
  const anchor = `  async function moveTriage(id, triage) {`
  if (!s.includes(anchor)) throw new Error('moveTriage anchor missing')
  s = s.replace(anchor, actionBlock + anchor)
  changed = true
}

replaceBetweenAny(
  `  async function moveTriage(id, triage) {`,
  [
    `  // The trash icon archives instead of permanently deleting.`,
    `  async function archiveEmail(id) {`,
  ],
`  async function moveTriage(id, triage) {
    const current = emails.find(e => e.id === id)
    if (selected?.id === id) setSelected(prev => ({ ...prev, triage }))
    setEmails(prev => prev.map(e => e.id === id ? { ...e, triage } : e))
    try {
      if (triage === 'Archive') {
        await runMailboxAction(id, 'archive')
      } else if (triage === 'Spam') {
        await runMailboxAction(id, 'spam')
      } else if (triage === 'Inbox' && current?.triage === 'Spam') {
        await runMailboxAction(id, 'inbox')
      } else {
        if (current?.triage === 'Archive' && triage !== 'Sent') await runMailboxAction(id, 'inbox')
        const { error } = await supabase.from('emails').update({ triage }).eq('id', id)
        if (error) throw error
      }
      showToast(\`Moved to \${triage}\`)
    } catch (e) {
      await load()
      showToast('Email move failed: ' + e.message)
    }
  }

`,
  'moveTriage patch'
)

replaceBetweenAny(
  `  async function archiveEmail(id) {`,
  [`  function openEmail(email, index) {`],
`  async function archiveEmail(id) {
    const previous = emails
    setEmails(es => es.map(e => e.id === id ? { ...e, triage: 'Archive' } : e))
    if (selected?.id === id) setSelected(null)
    setCheckedIds(set => { const next = new Set(set); next.delete(id); return next })
    try {
      await runMailboxAction(id, 'archive')
      showToast('Archived')
    } catch (e) {
      setEmails(previous)
      await load()
      showToast('Archive failed: ' + e.message)
    }
  }

  async function archiveSelected() {
    if (checkedIds.size === 0) return
    const ids = [...checkedIds]
    const previous = emails
    setEmails(es => es.map(e => ids.includes(e.id) ? { ...e, triage: 'Archive' } : e))
    if (selected && ids.includes(selected.id)) setSelected(null)
    setCheckedIds(new Set())
    try {
      await runMailboxAction(ids, 'archive')
      showToast(\`Archived \${ids.length} email\${ids.length === 1 ? '' : 's'}\`)
    } catch (e) {
      setEmails(previous)
      await load()
      showToast('Bulk archive failed: ' + e.message)
    }
  }

  async function permanentlyDeleteEmail(id) {
    const previous = emails
    setEmails(es => es.filter(e => e.id !== id))
    if (selected?.id === id) setSelected(null)
    setCheckedIds(set => { const next = new Set(set); next.delete(id); return next })
    try {
      await runMailboxAction(id, 'trash')
      showToast('Deleted')
    } catch (e) {
      setEmails(previous)
      await load()
      showToast('Delete failed: ' + e.message)
    }
  }

  async function permanentlyDeleteSelected() {
    if (checkedIds.size === 0) return
    const ids = [...checkedIds]
    const previous = emails
    setEmails(es => es.filter(e => !ids.includes(e.id)))
    if (selected && ids.includes(selected.id)) setSelected(null)
    setCheckedIds(new Set())
    try {
      await runMailboxAction(ids, 'trash')
      showToast(\`Deleted \${ids.length} email\${ids.length === 1 ? '' : 's'}\`)
    } catch (e) {
      setEmails(previous)
      await load()
      showToast('Bulk delete failed: ' + e.message)
    }
  }

  async function markRead(email) {
    if (email.is_read) return
    setEmails(es => es.map(e => e.id === email.id ? { ...e, is_read: true } : e))
    if (selected?.id === email.id) setSelected(prev => ({ ...prev, is_read: true }))
    try {
      await runMailboxAction(email.id, 'read')
    } catch (e) {
      await load()
      showToast('Could not mark email read: ' + e.message)
    }
  }

  async function markUnread(email) {
    setEmails(es => es.map(e => e.id === email.id ? { ...e, is_read: false } : e))
    if (selected?.id === email.id) setSelected(prev => ({ ...prev, is_read: false }))
    try {
      await runMailboxAction(email.id, 'unread')
      showToast('Marked as new')
    } catch (e) {
      await load()
      showToast('Could not mark email unread: ' + e.message)
    }
  }

`,
  'mailbox action patch'
)

s = s.replaceAll('🗑 Delete Permanently', '🗑 Delete')

if (changed) fs.writeFileSync(path, s)
console.log(`Email Gmail-state synchronization ${changed ? 'patched' : 'already current'}.`)
