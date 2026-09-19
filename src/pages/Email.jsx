import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FIRM } from '../lib/firmBranding'
import { supabase } from '../lib/supabase'
import { sendGmailEmail, downloadGmailAttachment, fetchGmailAttachmentBlob } from '../lib/gmailUtils'
import { EMAIL_TEMPLATES as TEMPLATES } from '../lib/emailTemplatesList'
import { useGmailSync } from '../context/GmailSyncContext'
import { useApp } from '../context/AppContext'
import { DOC_FOLDERS } from './Clients'


const TRIAGE = ['Inbox','Action Needed','Waiting','Sent','Archive']
const TRIAGE_COLORS = { 'Action Needed':'var(--bad)', 'Waiting':'var(--warn)', 'Inbox':'var(--blue)', 'Sent':'var(--ok)', 'Archive':'var(--t3)' }
const BLANK = { recipient:'', clientName:'', subject:'', body:'', triage:'Sent', status:'Sent', routeId:'', replyFrom:'', threadId:'', inReplyTo:'', references:'', productId:'', m365MessageId:'' }
const NASHVILLE_TENANT_ID = '489ace07-1a6b-4864-833a-4f8420568b40'

export default function Email() {
  const [emails, setEmails]     = useState([])
  // Authoritative unread counts are loaded separately from the visible 300-row
  // message window so large mailboxes never show truncated/stale folder totals.
  const [folderCounts, setFolderCounts] = useState(() => Object.fromEntries(TRIAGE.map(t => [t, 0])))
  const countRefreshTimerRef = useRef(null)
  const [clients, setClients]   = useState([])
  const [leads, setLeads]       = useState([])
  const [attachPickerFor, setAttachPickerFor] = useState(null) // attachmentId currently showing the manual picker
  const [attachSearch, setAttachSearch] = useState('')
  const [attachFolder, setAttachFolder] = useState('Correspondence')
  const [attaching, setAttaching] = useState(null) // attachmentId currently being attached
  const [form, setForm]         = useState(BLANK)
  const [sug, setSug]           = useState([])
  const [saving, setSaving]     = useState(false)
  const [toast, setToast]       = useState('')
  const [view, setView]         = useState('inbox') // inbox | compose | templates
  const [searchParams] = useSearchParams()
  useEffect(() => { if (searchParams.get('new') === '1') { setForm(BLANK); setView('compose') } }, [searchParams])
  useEffect(() => {
    const emailId = searchParams.get('email')
    if (!emailId || emails.length === 0) return
    const match = emails.find(row => String(row.id) === String(emailId))
    if (!match) return
    setTriageFilter(match.triage || 'Inbox')
    setSelected(match)
    if (!match.is_read) markRead(match)
    setView('inbox')
  }, [searchParams, emails])
  const [readLayout, setReadLayout] = useState(() => localStorage.getItem('tcr_email_layout') || 'side') // side | stacked
  const [listSize, setListSize] = useState(() => ({
    side: parseInt(localStorage.getItem('tcr_email_list_width')) || 320,
    stacked: parseInt(localStorage.getItem('tcr_email_list_height')) || 260,
  }))
  const [resizing, setResizing] = useState(false)
  const [triageFilter, setTriageFilter] = useState('Inbox')
  const [selected, setSelected] = useState(null)
  const [dragOverFolder, setDragOverFolder] = useState(null)
  const [search, setSearch]     = useState('')
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailConnectedEmail, setGmailConnectedEmail] = useState('')
  const [gmailClientId, setGmailClientId] = useState('')
  const [m365Connected, setM365Connected] = useState(false)
  const [m365ConnectedEmail, setM365ConnectedEmail] = useState('')
  const [m365ClientId, setM365ClientId] = useState('')
  const [signature, setSignature] = useState({ text: '', logoUrl: '' })
  const { lastSyncAt, syncing, lastError, syncNow } = useGmailSync()
  const { user, myTenantId } = useApp()
  const userEmailLower = user?.email?.toLowerCase() || ''
  const isDemoMailbox = userEmailLower === 'demo@taxrescrm.net'
  const CLOUDCPA_TENANT_ID = 'ecd3d3ce-016a-4bb4-800e-f090f51e4cae'
  const isNashville = myTenantId === NASHVILLE_TENANT_ID
  const isCloudCpaPlatformRelay = myTenantId === CLOUDCPA_TENANT_ID && !gmailConnected
  const isRomyLabsMailboxAdmin = ['info@romylabs.com','romy@romylabs.com'].includes(userEmailLower)
  const centralMailboxOwner = isRomyLabsMailboxAdmin ? 'info@romylabs.com' : (user?.email || '')
  const DEMO_TENANT_ID = 'a0000000-0000-0000-0000-000000000001'
  // Display-only tick — re-renders the "Synced Xs ago" text once a
  // second so it doesn't look frozen between real sync updates. Purely
  // local state, no Supabase calls.
  const [, forceTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => forceTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Multi-select for bulk archive. checkedIds = the actual selection;
  // focusIndex/anchorIndex track keyboard navigation within the currently
  // filtered list so Shift+Arrow can extend a range from wherever
  // selection started.
  const [checkedIds, setCheckedIds] = useState(() => new Set())
  const [focusIndex, setFocusIndex] = useState(-1)
  const anchorIndexRef = useRef(-1)
  const listRef = useRef(null)

  // Scroll the active email row into view when navigating with arrow keys
  useEffect(() => {
    if (focusIndex < 0 || !listRef.current) return
    const rows = listRef.current.querySelectorAll('[data-email-row]')
    const row = rows[focusIndex]
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusIndex])

  useEffect(() => {
    load(); loadFolderCounts(); loadGmailConfig()
    const onFocus = () => loadGmailConfig()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [user?.email])

  // Global Delete/Backspace — archive; Shift+Delete — permanently delete (Archive folder only)
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return
      if (!selected) return
      e.preventDefault()
      if (e.shiftKey && triageFilter === 'Archive') {
        permanentlyDeleteEmail(selected.id)
      } else {
        archiveEmail(selected.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, triageFilter])

  // Refresh the visible list whenever the background sync (running
  // globally, not just on this page) picks up anything new.
  useEffect(() => { if (lastSyncAt) { load(); loadFolderCounts() } }, [lastSyncAt])

  // Realtime subscription — fires immediately when a new inbound email arrives
  useEffect(() => {
    if (!user?.email) return
    const owner = centralMailboxOwner || user.email
    const channel = supabase
      .channel(`email-inbox-notify-${owner}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'emails',
        filter: `mailbox_owner=eq.${owner}`,
      }, (payload) => {
        const e = payload.new
        // Only notify for inbound (triage=Inbox means it came in, Sent means we sent it)
        if (e.triage === 'Sent') return
        // Add directly to state — no stale-closure load() call
        setEmails(prev => {
          if (prev.some(x => x.id === e.id)) return prev
          return [e, ...prev]
        })
        // Browser notification
        const title = 'New Email'
        const body = `From: ${e.clientName || e.recipient || 'Unknown'} — ${e.subject || '(no subject)'}`
        function fireEmailNotif() {
          const n = new Notification(title, { body, icon: '/favicon.png', requireInteraction: false })
          n.onclick = () => { window.focus(); window.location.hash = ''; n.close() }
        }
        if (Notification.permission === 'granted') {
          fireEmailNotif()
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(perm => { if (perm === 'granted') fireEmailNotif() })
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user?.email])

  // Any local or provider-driven email UPDATE (read, unread, archive, delete,
  // triage move) schedules one debounced count refresh. Bulk actions can emit
  // dozens of row events; debouncing collapses them into one exact recount.
  useEffect(() => {
    if (!user?.email) return
    const owner = user.email
    const channel = supabase.channel(`email-folder-counts-rt-${owner}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'emails', filter: `mailbox_owner=eq.${owner}`,
      }, () => scheduleFolderCountsRefresh())
      .subscribe()
    return () => {
      if (countRefreshTimerRef.current) clearTimeout(countRefreshTimerRef.current)
      supabase.removeChannel(channel)
    }
  }, [user?.email])

  async function loadGmailConfig() {
    // gmail_client_id stays shared (the app's own OAuth registration, not a
    // personal secret) — but whether GMAIL IS CONNECTED is now per-employee,
    // not the old single shared settings.gmail_refresh_token check.
    const { data } = await supabase.from('settings').select('gmail_client_id,email_signature,email_signature_logo_url').not('gmail_client_id', 'is', null).limit(1).maybeSingle()
    if (data?.gmail_client_id) setGmailClientId(data.gmail_client_id)
    if (user?.email) {
      if (isDemoMailbox) {
        // Demo is a first-class Stalwart mailbox. Do not query or depend on Gmail OAuth state.
        setGmailConnected(false)
        setGmailConnectedEmail('')
      } else {
        const { data: acct } = await supabase.from('employee_gmail_accounts')
          .select('gmail_refresh_token,gmail_connected_email').eq('employee_email', user.email).maybeSingle()
        setGmailConnected(!!acct?.gmail_refresh_token)
        setGmailConnectedEmail(acct?.gmail_connected_email || '')
      }
      // Check M365 connection
      const { data: m365Acct } = await supabase.from('employee_m365_accounts')
        .select('m365_refresh_token,m365_email').eq('employee_email', user.email).maybeSingle()
      setM365Connected(!!m365Acct?.m365_refresh_token)
      setM365ConnectedEmail(m365Acct?.m365_email || '')
    }
    // Get M365 client ID for the connect button
    const { data: m365Settings } = await supabase.from('settings').select('m365_client_id,m365_tenant_id').not('m365_client_id', 'is', null).limit(1).maybeSingle()
    if (m365Settings?.m365_client_id) setM365ClientId(m365Settings.m365_client_id)

    // Each employee has their own signature now — fall back to the firm
    // default only if they haven't set a personal one yet.
    let sigText = data?.email_signature || ''
    let sigLogo = data?.email_signature_logo_url || ''
    if (user?.email) {
      const { data: emp } = await supabase.from('employees')
        .select('email_signature,email_signature_logo_url')
        .eq('email', user.email).maybeSingle()
      if (emp?.email_signature) sigText = emp.email_signature
      if (emp?.email_signature_logo_url) sigLogo = emp.email_signature_logo_url
    }
    // The signature image is its own settings field. When a tenant hasn't set
    // one, fall back to their firm logo rather than leaving the shared default,
    // which showed Tax Case Review's logo on every other firm's signature.
    setSignature({ text: sigText, logoUrl: sigLogo || FIRM.logoUrl || '' })
  }

  async function loadFolderCounts() {
    if (!user?.email) return
    // Count on the server instead of fetching rows into JS. Supabase/PostgREST
    // caps ordinary row queries, which made counts wrong once a mailbox grew
    // past that ceiling. "IS NOT TRUE" intentionally treats legacy NULL
    // is_read values as unread, matching the historical UI behavior.
    const queries = TRIAGE.map(t => {
      let q = supabase.from('emails')
        .select('id', { count: 'exact', head: true })
        .eq('mailbox_owner', user.email)
        .is('deleted_at', null)
        .not('is_read', 'is', true)
      if (t === 'Inbox') q = q.or('triage.eq.Inbox,triage.is.null')
      else q = q.eq('triage', t)
      return q
    })
    const results = await Promise.all(queries)
    const next = {}
    TRIAGE.forEach((t, i) => {
      if (results[i]?.error) console.error('[email-count] ' + t + ' count failed:', results[i].error.message)
      next[t] = results[i]?.count || 0
    })
    setFolderCounts(next)
  }

  function scheduleFolderCountsRefresh() {
    if (countRefreshTimerRef.current) clearTimeout(countRefreshTimerRef.current)
    countRefreshTimerRef.current = setTimeout(() => { loadFolderCounts() }, 120)
  }

  async function load() {
    if (!user?.email) return
    const [{ data: e }, { data: c }, { data: l }] = await Promise.all([
      // Each employee now has their own separate Gmail connection — this
      // used to load every email ever synced regardless of whose mailbox
      // it came from, which is exactly the leak Romy caught (logging in as
      // one account and seeing another employee's personal correspondence).
      // Reverted to select('*'): narrowing the projection broke the inbox in
      // production. A column name that doesn't exist makes PostgREST fail the
      // whole query, and the page then renders no mail at all.
      supabase.from('emails').select('*').eq('mailbox_owner', centralMailboxOwner || user.email).is('deleted_at', null).order('created_at', { ascending: false }).limit(300),
      supabase.from('clients').select('id,name,email'),
      supabase.from('leads').select('id,name,email'),
    ])
    if (e) setEmails(e)
    if (c) setClients(c)
    if (l) setLeads(l)
  }

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3500) }

  // Match an inbound email's sender address against known clients/leads by
  // email, purely to suggest who an attachment probably belongs to —
  // attaching still always requires a click either way.
  function matchByEmail(address) {
    if (!address) return null
    const addr = address.toLowerCase()
    const c = clients.find(c => c.email && c.email.toLowerCase() === addr)
    if (c) return { ...c, _type: 'Client' }
    const l = leads.find(l => l.email && l.email.toLowerCase() === addr)
    if (l) return { ...l, _type: 'Lead' }
    return null
  }

  // Fetches an email attachment's actual bytes from Gmail and copies it
  // straight into a lead/client's Docs tab — unlike fax/SMS attachments,
  // this one re-hosts the file in our own storage since we have to fetch
  // the real bytes from Gmail anyway (no persistent public URL otherwise).
  async function attachEmailAttachmentToFile(email, att, targetName, folder) {
    if (!targetName) { showToast('Pick who this belongs to first'); return }
    setAttaching(att.attachmentId)
    try {
      const blob = await fetchGmailAttachmentBlob(supabase, {
        gmailMessageId: email.gmail_message_id, attachmentId: att.attachmentId, mimeType: att.mimeType,
        employeeEmail: email.mailbox_owner || user?.email,
      })
      const path = `docs/${targetName.replace(/\s+/g,'-')}/${Date.now()}_${att.filename}`
      const { error: upErr } = await supabase.storage.from('documents').upload(path, blob, { upsert: true, contentType: att.mimeType })
      if (upErr) throw upErr
      const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(path, 94608000)
      const { error } = await supabase.from('documents').insert([{
        name: att.filename, client: targetName, docType: folder || 'Correspondence',
        notes: `Received via email from ${email.recipient || email.clientName || 'unknown sender'} on ${email.created_at ? new Date(email.created_at).toLocaleString() : 'unknown date'}`,
        file_url: urlData?.signedUrl || '', file_name: att.filename, file_size: att.size || null,
        created_at: new Date().toISOString(),
      }])
      if (error) throw error
      showToast(`✅ Attached to ${targetName}'s ${folder} folder`)
      setAttachPickerFor(null); setAttachSearch(''); setAttachFolder('Correspondence')
    } catch (e) {
      showToast('Error attaching: ' + e.message)
    }
    setAttaching(null)
  }
  function setLayout(l) { setReadLayout(l); localStorage.setItem('tcr_email_layout', l) }
  function startResize(e) {
    e.preventDefault()
    setResizing(true)
    const startX = e.clientX, startY = e.clientY
    const startSize = listSize[readLayout]
    function onMove(ev) {
      let next
      if (readLayout === 'side') {
        next = Math.min(600, Math.max(220, startSize + (ev.clientX - startX)))
      } else {
        next = Math.min(600, Math.max(120, startSize + (ev.clientY - startY)))
      }
      setListSize(s => ({ ...s, [readLayout]: next }))
    }
    function onUp() {
      setResizing(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setListSize(s => {
        localStorage.setItem(readLayout === 'side' ? 'tcr_email_list_width' : 'tcr_email_list_height', s[readLayout])
        return s
      })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }
  function fld(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function searchClient(val) {
    fld('clientName', val)
    if (val.length < 2) { setSug([]); return }
    const m = clients.filter(c => c.name.toLowerCase().includes(val.toLowerCase())).slice(0, 5)
    setSug(m)
    const match = clients.find(c => c.name.toLowerCase() === val.toLowerCase())
    if (match?.email) fld('recipient', match.email)
  }

  function useTemplate(t) {
    const name = form.clientName || '{name}'
    setForm(f => ({ ...f, subject: t.subject, body: t.body.replace(/{name}/g, name) }))
    setView('compose')
  }

  async function send() {
    if (!form.subject || !form.body) { showToast('Subject and body required'); return }
    if (!form.recipient) { showToast('Recipient email address required to send'); return }
    setSaving(true)
    let status = 'Logged'
    let alreadyStored = false

    // Routed RomyLabs replies are never allowed to fall through to Gmail.
    // The backend resolves routeId to the exact original receiving mailbox
    // and refuses to send if that SMTP identity is not configured.
    if (form.routeId) {
      try {
        const refs = [form.references, form.inReplyTo].filter(Boolean).join(' ').trim()
        const { data, error } = await supabase.functions.invoke('smtp-send', {
          body: {
            route_id: form.routeId,
            to: form.recipient,
            subject: form.subject,
            text_body: form.body,
            from_name: form.replyFrom ? form.replyFrom.split('@')[0] : undefined,
            in_reply_to: form.inReplyTo || undefined,
            references: refs || undefined,
            thread_id: form.threadId || undefined,
          },
        })
        if (error) throw error
        if (!data?.ok) throw new Error(data?.error || 'Routed SMTP send failed')
        status = 'Sent'
        alreadyStored = true
      } catch (e) {
        setSaving(false)
        showToast('Reply not sent: ' + (e?.message || e))
        return
      }
    } else if (isDemoMailbox) {
      // Demo uses Stalwart directly and never evaluates Gmail connection state.
      try {
        const { data, error } = await supabase.functions.invoke('demo-send-email', {
          body: {
            to: form.recipient,
            subject: form.subject,
            text: form.body,
            clientName: form.clientName || undefined,
          },
        })
        if (error) throw error
        if (!data?.success || data?.via !== 'stalwart_jmap' || data?.from !== 'romy@taxrescrm.net' || data?.mailbox_owner !== 'demo@taxrescrm.net') {
          throw new Error(data?.error || 'Demo mail delivery was not confirmed by Stalwart')
        }
        status = 'Sent'
        alreadyStored = true
      } catch (e) {
        setSaving(false)
        showToast('Demo email not sent: ' + (e?.message || e))
        return
      }
    } else if (isCloudCpaPlatformRelay) {
      try {
        const { data, error } = await supabase.functions.invoke('send-email', {
          body: {
            tenant_id: myTenantId,
            to: form.recipient,
            subject: form.subject,
            text: form.body,
            from_email: 'tony@thecloudcpa.net',
            from_name: 'CloudCPA Inc',
          },
        })
        if (error) throw error
        if (!data?.success || data?.via !== 'taxres_platform_relay' || data?.reply_to !== 'tony@thecloudcpa.net') {
          throw new Error(data?.error || 'CloudCPA platform relay did not confirm delivery')
        }
        status = 'Sent'
        alreadyStored = true
      } catch (e) {
        setSaving(false)
        showToast('CloudCPA email not sent: ' + (e?.message || e))
        return
      }
    } else if (isNashville && m365Connected) {
      try {
        const isReply = !!form.m365MessageId
        const { data, error } = await supabase.functions.invoke('m365-mail-gateway', {
          body: isReply
            ? { action:'reply', m365_message_id:form.m365MessageId, body:form.body }
            : { action:'send', to:form.recipient, subject:form.subject, body:form.body },
        })
        if (error) throw error
        if (!data?.success || data?.provider !== 'm365') throw new Error(data?.error || 'Microsoft 365 did not confirm delivery')
        status = 'Sent'
      } catch (e) {
        setSaving(false)
        showToast('Microsoft 365 send failed: ' + (e?.message || e))
        return
      }
    } else if (gmailConnected) {
      try {
        await sendGmailEmail(supabase, { to: form.recipient, subject: form.subject, body: form.body, senderEmployeeEmail: user?.email })
        status = 'Sent'
      } catch (e) {
        setSaving(false)
        showToast('Gmail send failed: ' + e.message)
        return
      }
    }

    if (!alreadyStored) {
      const { routeId, replyFrom, threadId, inReplyTo, references, productId, ...loggableForm } = form
      const emailRow = { ...loggableForm, status, created_at: new Date().toISOString(), mailbox_owner: centralMailboxOwner || user?.email || null }
      if (isDemoMailbox) {
        emailRow.tenant_id = DEMO_TENANT_ID
        emailRow.from_address = 'romy@taxrescrm.net'
        emailRow.reply_from = 'demo@taxrescrm.net'
        emailRow.direction = 'outbound'
        emailRow.received_at = emailRow.created_at
        emailRow.is_read = true
      }
      const { error } = await supabase.from('emails').insert([emailRow])
      if (error) { setSaving(false); showToast('Error: ' + error.message); return }
    }
    setSaving(false)

    // Auto-log to client activity history
    if (form.clientName) {
      const preview = (form.body || '').slice(0, 120).replace(/\n/g, ' ').trim()
      let authorName = user?.email || 'Staff'
      if (user?.email) {
        const { data: empRec } = await supabase.from('employees').select('name').eq('email', user.email).maybeSingle()
        if (empRec?.name) authorName = empRec.name
      }
      await supabase.from('client_notes').insert({
        clientname: form.clientName,
        text: `📧 Email Sent — "${form.subject}"\n${preview}${form.body?.length > 120 ? '…' : ''}`,
        note_type: 'Email',
        author: authorName,
        created_at: new Date().toISOString(),
      })
    }

    showToast(form.routeId && status === 'Sent' ? `✅ Reply sent from ${form.replyFrom}` : isDemoMailbox && status === 'Sent' ? '✅ Demo email sent via Stalwart' : isCloudCpaPlatformRelay && status === 'Sent' ? '✅ CloudCPA email sent through the TaxRes platform relay' : isNashville && m365Connected && status === 'Sent' ? '✅ Email sent via Microsoft 365!' : status === 'Sent' ? '✅ Email sent via Gmail!' : '⚠️ No connected email provider — this was only saved as a log entry, nothing was emailed')
    setForm(BLANK); setView('inbox'); load()
  }

  async function runMailboxAction(emailIds, action) {
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

  async function moveTriage(id, triage) {
    const current = emails.find(e => e.id === id)
    if (selected?.id === id) setSelected(prev => ({ ...prev, triage }))
    setEmails(prev => prev.map(e => e.id === id ? { ...e, triage } : e))
    try {
      if (triage === 'Archive') {
        await runMailboxAction(id, 'archive')
      } else {
        if (current?.triage === 'Archive' && triage !== 'Sent') await runMailboxAction(id, 'inbox')
        const { error } = await supabase.from('emails').update({ triage }).eq('id', id)
        if (error) throw error
      }
      showToast(`Moved to ${triage}`)
    } catch (e) {
      await load()
      showToast('Email move failed: ' + e.message)
    }
  }

  // The trash icon archives instead of permanently deleting. Two reasons:
  // Romy asked for this directly, and it also fixes a real bug — actually
  // deleting a synced email left its gmail_message_id gone from our table,
  // so the very next Gmail sync saw it as "new" and pulled it right back
  // in. Archiving keeps the row (with its gmail_message_id) so sync never
  // re-imports it.
  async function archiveEmail(id) {
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
      showToast(`Archived ${ids.length} email${ids.length === 1 ? '' : 's'}`)
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
      showToast(`Deleted ${ids.length} email${ids.length === 1 ? '' : 's'}`)
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

  function openEmail(email, index) {
    setSelected(email)
    setFocusIndex(index)
    anchorIndexRef.current = index
    setCheckedIds(new Set())
    markRead(email)
  }

  function toggleChecked(id) {
    setCheckedIds(s => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  // Shift+Up/Down extends a checked range from wherever the selection
  // started (anchorIndexRef) to the new focus position — same convention
  // as a file explorer. Plain Up/Down without Shift just moves which
  // single email is open for reading, clearing any multi-select.
  function onListKeyDown(e) {
    // Delete/Backspace: archive; Shift+Delete in Archive folder: permanently delete
    if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      e.preventDefault()
      if (e.shiftKey && triageFilter === 'Archive') {
        if (checkedIds.size > 0) { permanentlyDeleteSelected(); return }
        if (selected) { permanentlyDeleteEmail(selected.id); return }
      } else {
        if (checkedIds.size > 0) { archiveSelected(); return }
        if (selected) { archiveEmail(selected.id); return }
      }
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if (filtered.length === 0) return
    e.preventDefault()
    const dir = e.key === 'ArrowDown' ? 1 : -1
    const next = Math.min(filtered.length - 1, Math.max(0, focusIndex + dir))

    if (e.shiftKey) {
      if (anchorIndexRef.current === -1) anchorIndexRef.current = focusIndex === -1 ? 0 : focusIndex
      const lo = Math.min(anchorIndexRef.current, next)
      const hi = Math.max(anchorIndexRef.current, next)
      setCheckedIds(new Set(filtered.slice(lo, hi + 1).map(e => e.id)))
      setFocusIndex(next)
    } else {
      openEmail(filtered[next], next)
    }
  }

  const filtered = emails.filter(e => {
    const t = e.triage || 'Inbox'
    if (triageFilter !== t) return false
    if (search && !e.subject?.toLowerCase().includes(search.toLowerCase()) && !e.clientName?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // These are exact mailbox-wide unread counts, not counts from the visible
  // 300-message window. Realtime keeps them current after bulk operations.
  const counts = folderCounts

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 52px)', margin: '-16px', overflow: 'hidden', background: 'var(--bg)', position: 'relative' }}>
      {toast && <div className="toast show">{toast}</div>}

      {/* ── Left sidebar ── */}
      <div className="email-sidebar" style={{ width: 220, flexShrink: 0, background: 'var(--nav)', borderRight: '1px solid var(--br)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 14px 10px' }}>
          <button className="btn pri" style={{ width: '100%', justifyContent: 'center', fontWeight: 700 }} onClick={() => { setForm(BLANK); setView('compose') }}>
            ✏️ Compose
          </button>
        </div>

        {/* Email provider connect banner */}
        {isDemoMailbox ? (
          <div style={{ margin: '0 10px 10px', padding: '8px 12px', background: 'rgba(34,197,94,.12)', borderRadius: 8, border: '1px solid rgba(34,197,94,.3)', fontSize: 11, fontWeight: 700, color: 'var(--ok)' }}>
            ✅ Stalwart Connected — demo@taxrescrm.net
            <div style={{ marginTop: 4, fontSize: 10, fontWeight: 400, color: 'var(--t3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span>TaxRes CRM mailbox ready</span>
              <button
                className="btn"
                onClick={async () => {
                  await load()
                  showToast('✅ Stalwart inbox refreshed')
                }}
                style={{ padding:'4px 8px', fontSize:10, fontWeight:700, whiteSpace:'nowrap' }}
              >
                ↻ Refresh Email
              </button>
            </div>
          </div>
        ) : gmailConnected ? (
          <div style={{ margin: '0 10px 10px', padding: '8px 12px', background: 'rgba(34,197,94,.12)', borderRadius: 8, border: '1px solid rgba(34,197,94,.3)', fontSize: 11, fontWeight: 700, color: 'var(--ok)' }}>
            ✅ Gmail Connected{gmailConnectedEmail ? ` — ${gmailConnectedEmail}` : ''}
            <div style={{ marginTop: 4, fontSize: 10, fontWeight: 400, color: 'var(--t3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span>
                {syncing ? '🔄 Syncing…' : lastSyncAt ? `Synced ${Math.max(0, Math.round((Date.now() - lastSyncAt.getTime()) / 1000))}s ago` : 'Starting sync…'}
              </span>
              <button
                className="btn"
                disabled={syncing}
                onClick={async () => {
                  await syncNow()
                  await load()
                  showToast(lastError ? 'Email sync error: ' + lastError : '✅ Email refreshed')
                }}
                style={{ padding:'4px 8px', fontSize:10, fontWeight:700, whiteSpace:'nowrap' }}
              >
                {syncing ? '⟳ Refreshing…' : '↻ Refresh Email'}
              </button>
            </div>
            {lastError && (
              <div style={{ marginTop: 4, fontSize: 10, color: 'var(--bad)' }}>⚠️ {lastError}</div>
            )}
            {lastError && gmailClientId && (
              <button onClick={() => {
                const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${gmailClientId}&redirect_uri=${encodeURIComponent(window.location.origin + '/auth/callback')}&response_type=code&scope=https://mail.google.com/&access_type=offline&prompt=consent`
                window.open(url, '_blank')
                showToast('Complete authorization in the popup window')
              }} style={{ marginTop: 6, width: '100%', padding: '4px 0', borderRadius: 6, border: 'none', background: 'var(--blue)', color: '#fff', cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>
                🔗 Reconnect Gmail
              </button>
            )}
          </div>
        ) : (
          <div style={{ margin: '0 10px 10px', padding: '10px 12px', background: 'rgba(26,127,212,.12)', borderRadius: 8, border: '1px solid rgba(26,127,212,.3)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', marginBottom: 4 }}>📧 Connect Gmail</div>
            <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 8, lineHeight: 1.5 }}>Link your Gmail account to send & receive emails directly.</div>
            {gmailClientId ? (
              <button onClick={() => {
                const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${gmailClientId}&redirect_uri=${encodeURIComponent(window.location.origin + '/auth/callback')}&response_type=code&scope=https://mail.google.com/&access_type=offline&prompt=consent`
                window.open(url, '_blank')
                showToast('Complete authorization in the popup window')
              }} style={{ width: '100%', padding: '5px 0', borderRadius: 6, border: 'none', background: 'var(--blue)', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                🔗 Connect Gmail
              </button>
            ) : (
              <button onClick={() => showToast('Go to Settings → Integrations to add your Gmail Client ID first')} style={{ width: '100%', padding: '5px 0', borderRadius: 6, border: '1px solid var(--br)', background: 'var(--s2)', color: 'var(--t3)', cursor: 'pointer', fontSize: 11 }}>
                ⚙️ Setup in Settings
              </button>
            )}
          </div>
        )}

        {/* Microsoft 365 connect */}
        {m365Connected ? (
          <div style={{ margin: '0 10px 10px', padding: '8px 12px', background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.25)', borderRadius: 8, fontSize: 10, color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>✅</span><span>Microsoft 365 connected{m365ConnectedEmail ? ` (${m365ConnectedEmail})` : ''}</span>
          </div>
        ) : (
          <div style={{ margin: '0 10px 10px', padding: '10px 12px', background: 'rgba(0,120,212,.1)', borderRadius: 8, border: '1px solid rgba(0,120,212,.3)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#0078d4', marginBottom: 4 }}>📧 Connect Microsoft 365</div>
            <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 8, lineHeight: 1.5 }}>Link your Outlook inbox and calendar directly to the CRM.</div>
            {m365ClientId ? (
              <button onClick={async () => {
                try {
                  if (isNashville) {
                    const { data, error } = await supabase.functions.invoke('m365-oauth-start', { body:{} })
                    if (error) throw error
                    if (!data?.authorize_url) throw new Error(data?.error || 'Microsoft authorization URL was not returned')
                    window.open(data.authorize_url, '_blank')
                  } else {
                    const state = encodeURIComponent(JSON.stringify({ employeeEmail: user?.email, tenantId: FIRM.tenantId, origin: window.location.origin }))
                    const redirectUri = encodeURIComponent(`${window.location.origin.replace(/\/taxcasereview-CRM.*/, '')}/functions/v1/m365-oauth-callback`.replace('https://taxresolutioncrm.github.io', 'https://mpxgxfqdbquzkrvvejkh.supabase.co'))
                    const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${m365ClientId}&response_type=code&redirect_uri=${redirectUri}&scope=offline_access+Mail.Read+Mail.Send+Calendars.ReadWrite+User.Read&state=${state}`
                    window.open(url, '_blank')
                  }
                  showToast('Complete Microsoft sign-in in the popup window')
                } catch (e) {
                  showToast('Microsoft 365 connection failed: ' + (e?.message || e))
                }
              }} style={{ width: '100%', padding: '5px 0', borderRadius: 6, border: 'none', background: '#0078d4', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                🔗 Connect Microsoft 365
              </button>
            ) : (
              <button onClick={() => showToast('Go to Settings → Integrations to set up Microsoft 365 first')} style={{ width: '100%', padding: '5px 0', borderRadius: 6, border: '1px solid var(--br)', background: 'var(--s2)', color: 'var(--t3)', cursor: 'pointer', fontSize: 11 }}>
                ⚙️ Setup in Settings
              </button>
            )}
          </div>
        )}

        {/* Triage folders */}
        <div style={{ padding: '4px 0' }}>
          <div style={{ padding: '6px 14px 4px', fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Triage</div>
          {TRIAGE.map(t => (
            <div key={t}
              onClick={() => { setTriageFilter(t); setView('inbox'); setSelected(null); setCheckedIds(new Set()); setFocusIndex(-1); anchorIndexRef.current = -1 }}
              onDragOver={ev => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; setDragOverFolder(t) }}
              onDragLeave={() => setDragOverFolder(null)}
              onDrop={ev => {
                ev.preventDefault()
                const id = ev.dataTransfer.getData('emailId')
                if (id) moveTriage(id, t)
                setDragOverFolder(null)
              }}
              style={{
                padding: '7px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: dragOverFolder === t ? (TRIAGE_COLORS[t] + '22') : triageFilter === t && view === 'inbox' ? 'rgba(26,127,212,.18)' : 'transparent',
                borderLeft: dragOverFolder === t ? `3px solid ${TRIAGE_COLORS[t] || 'var(--blue)'}` : triageFilter === t && view === 'inbox' ? '3px solid var(--blue)' : '3px solid transparent',
                borderRadius: 0, transition: 'all .1s',
                outline: dragOverFolder === t ? `1px dashed ${TRIAGE_COLORS[t] || 'var(--blue)'}` : 'none',
              }}>
              <span style={{ fontSize: 13, color: triageFilter === t && view === 'inbox' ? 'var(--blue)' : 'var(--t2)', fontWeight: triageFilter === t ? 700 : 400 }}>
                {t === 'Action Needed' ? '🔴' : t === 'Waiting' ? '🟡' : t === 'Inbox' ? '📥' : t === 'Sent' ? '📤' : '📦'} {t}
              </span>
              {counts[t] > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: TRIAGE_COLORS[t] + '33', color: TRIAGE_COLORS[t] }}>{counts[t]}</span>
              )}
            </div>
          ))}
        </div>

        <div style={{ height: 1, background: 'var(--br)', margin: '8px 0' }} />

        {/* Templates shortcut */}
        <div onClick={() => setView('templates')} style={{
          padding: '7px 14px', cursor: 'pointer', fontSize: 13, color: 'var(--t2)',
          borderLeft: view === 'templates' ? '3px solid var(--blue)' : '3px solid transparent',
          background: view === 'templates' ? 'rgba(26,127,212,.18)' : 'transparent',
        }}>
          📋 Templates ({TEMPLATES.length})
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Email list */}
        {view === 'inbox' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: readLayout === 'side' ? 'row' : 'column', overflow: 'hidden' }}>
            <div style={{
              width: readLayout === 'side' ? listSize.side : '100%',
              height: readLayout === 'side' ? '100%' : listSize.stacked,
              flexShrink: 0,
              borderRight: readLayout === 'side' ? '1px solid var(--br)' : 'none',
              borderBottom: readLayout === 'stacked' ? '1px solid var(--br)' : 'none',
              display: 'flex', flexDirection: 'column', background: 'var(--sf)'
            }}>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--br)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  title="Select all"
                  checked={filtered.length > 0 && filtered.every(e => checkedIds.has(e.id))}
                  ref={el => { if (el) el.indeterminate = checkedIds.size > 0 && !filtered.every(e => checkedIds.has(e.id)) }}
                  onChange={e => {
                    if (e.target.checked) {
                      setCheckedIds(new Set(filtered.map(e => e.id)))
                    } else {
                      setCheckedIds(new Set()); anchorIndexRef.current = -1
                    }
                  }}
                  style={{ cursor: 'pointer', flexShrink: 0, width: 15, height: 15 }}
                />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search emails…"
                  style={{ flex: 1, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--br)', background: 'var(--s2)', color: 'var(--tx)', fontSize: 13 }} />
                <div style={{ display: 'flex', border: '1px solid var(--br)', borderRadius: 7, overflow: 'hidden', flexShrink: 0 }}>
                  <button title="Side-by-side" onClick={() => setLayout('side')} style={{ padding: '6px 9px', background: readLayout === 'side' ? 'rgba(26,127,212,.18)' : 'transparent', color: readLayout === 'side' ? 'var(--blue)' : 'var(--t3)', border: 'none', cursor: 'pointer', fontSize: 13 }}>▥</button>
                  <button title="Top and bottom" onClick={() => setLayout('stacked')} style={{ padding: '6px 9px', background: readLayout === 'stacked' ? 'rgba(26,127,212,.18)' : 'transparent', color: readLayout === 'stacked' ? 'var(--blue)' : 'var(--t3)', border: 'none', cursor: 'pointer', fontSize: 13 }}>▤</button>
                </div>
              </div>

              {/* Bulk action bar — appears once anything is checked */}
              {checkedIds.size > 0 && (
                <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--br)', background: 'rgba(26,127,212,.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue)' }}>{checkedIds.size} email{checkedIds.size !== 1 ? 's' : ''} selected</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      defaultValue=""
                      onChange={async e => {
                        const folder = e.target.value
                        if (!folder) return
                        e.target.value = ''
                        const ids = [...checkedIds]
                        await supabase.from('emails').update({ triage: folder }).in('id', ids)
                        if (selected && ids.includes(selected.id)) setSelected(null)
                        setCheckedIds(new Set()); anchorIndexRef.current = -1
                        showToast(`Moved ${ids.length} to ${folder}`)
                        load()
                      }}
                      style={{ fontSize: 11, padding: '4px 8px', background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, color: 'var(--tx)', cursor: 'pointer' }}>
                      <option value="">Move to…</option>
                      {TRIAGE.filter(t => t !== triageFilter).map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <button className="btn sec" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => { setCheckedIds(new Set()); anchorIndexRef.current = -1 }}>Clear</button>
                    {triageFilter === 'Archive'
                      ? <button className="btn del" style={{ fontSize: 11, padding: '4px 12px', fontWeight: 700 }} onClick={permanentlyDeleteSelected}>🗑 Delete</button>
                      : <button className="btn del" style={{ fontSize: 11, padding: '4px 12px', fontWeight: 700 }} onClick={archiveSelected}>🗑 Archive Selected</button>
                    }
                  </div>
                </div>
              )}

              <div
                ref={listRef}
                tabIndex={0}
                onKeyDown={onListKeyDown}
                style={{ flex: 1, overflow: 'auto', outline: 'none' }}>
                {filtered.length === 0 ? (
                  <div style={{ padding: 30, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>No emails in {triageFilter}</div>
                ) : filtered.map((e, i) => {
                  let isDragging = false
                  return (
                  <div key={e.id}
                    data-email-row
                    onClick={() => { if (!isDragging) openEmail(e, i) }}
                    draggable
                    onDragStart={ev => { isDragging = true; ev.dataTransfer.setData('emailId', e.id); ev.dataTransfer.effectAllowed = 'move' }}
                    onDragEnd={() => { setTimeout(() => { isDragging = false }, 100) }}
                    style={{
                    padding: '12px 14px', borderBottom: '1px solid var(--br)', cursor: 'grab',
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    background: checkedIds.has(e.id) ? 'rgba(26,127,212,.10)' : selected?.id === e.id ? 'rgba(26,127,212,.14)' : 'transparent',
                    borderLeft: selected?.id === e.id ? '3px solid var(--blue)' : '3px solid transparent',
                  }}>
                    <input
                      type="checkbox"
                      checked={checkedIds.has(e.id)}
                      onClick={ev => ev.stopPropagation()}
                      onChange={() => { toggleChecked(e.id); anchorIndexRef.current = i; setFocusIndex(i) }}
                      style={{ marginTop: 3, flexShrink: 0, cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3 }}>
                        <div style={{ fontWeight: e.is_read ? 600 : 800, fontSize: 13, color: 'var(--tx)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {!e.is_read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--blue)', flexShrink: 0 }} />}
                          {e.clientName || e.recipient || 'Unknown'}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0, marginLeft: 8 }}>
                          {e.created_at ? new Date(e.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: e.is_read ? 600 : 800, color: 'var(--t2)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
                        {e.subject}
                        {e.attachments?.length > 0 && <span title={`${e.attachments.length} attachment(s)`} style={{ flexShrink: 0 }}>📎</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.body?.slice(0, 80)}</div>
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>

            {/* Drag handle to resize the list pane */}
            <div
              onMouseDown={startResize}
              style={{
                cursor: readLayout === 'side' ? 'col-resize' : 'row-resize',
                width: readLayout === 'side' ? 5 : '100%',
                height: readLayout === 'side' ? '100%' : 5,
                flexShrink: 0,
                background: resizing ? 'var(--blue)' : 'transparent',
              }}
            />

            {/* Email detail */}
            <div style={{ flex: 1, overflow: 'auto', padding: 24, background: 'var(--bg)' }}>
              {selected ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--tx)', marginBottom: 6 }}>{selected.subject}</div>
                      <div style={{ fontSize: 13, color: 'var(--t3)' }}>From: {selected.clientName || selected.clientname || selected.from_address || selected.sender || 'Unknown'} {selected.from_address ? `<${selected.from_address}>` : ''}</div>
                      {selected.received_mailbox && <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>Received by: <strong style={{ color:'var(--blue)' }}>{selected.received_mailbox}</strong>{selected.assigned_to ? ` · Assigned to ${selected.assigned_to}` : ' · Unassigned'}</div>}
                      <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{selected.created_at ? new Date(selected.created_at).toLocaleString() : ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {/* Move triage */}
                      {TRIAGE.filter(t => t !== (selected.triage || 'Inbox') && t !== 'Sent').map(t => (
                        <button key={t} className="btn sec" style={{ fontSize: 12, padding: '6px 14px', fontWeight: 600 }} onClick={() => moveTriage(selected.id, t)}>→ {t}</button>
                      ))}
                      <button className="btn" style={{ fontSize: 12, padding: '6px 14px', fontWeight: 600 }} onClick={() => { const replyRecipient = selected.from_address || selected.sender || selected.recipient; const replySubject = String(selected.subject || '').toLowerCase().startsWith('re:') ? selected.subject : 'Re: ' + (selected.subject || ''); setForm({ ...BLANK, clientName: selected.clientName || selected.clientname || replyRecipient, recipient: replyRecipient || '', subject: replySubject, routeId: selected.route_id || '', replyFrom: selected.reply_from || selected.received_mailbox || '', threadId: selected.thread_id || '', inReplyTo: selected.message_id || '', references: selected.references_header || '', productId: selected.product_id || '', m365MessageId: selected.m365_message_id || '' }); setView('compose') }}>↩ Reply</button>
                      <button className="btn" style={{ fontSize: 12, padding: '6px 14px', fontWeight: 600, background: 'var(--blue)', color: '#fff', border: 'none' }} onClick={() => markUnread(selected)}>● Mark as New</button>
                      {triageFilter === 'Archive'
                        ? <button className="btn del" style={{ fontSize: 12, padding: '6px 14px', fontWeight: 600 }} onClick={() => permanentlyDeleteEmail(selected.id)}>🗑 Delete</button>
                        : <button className="btn del" style={{ fontSize: 12, padding: '6px 14px', fontWeight: 600 }} onClick={() => archiveEmail(selected.id)}>🗑 Archive</button>
                      }
                    </div>
                  </div>
                  {selected.body_html ? (
                    <SafeHtmlEmail html={selected.body_html} />
                  ) : (
                    <div style={{ background: 'var(--sf)', border: '1px solid var(--br)', borderRadius: 10, padding: 20, fontSize: 14, lineHeight: 1.8, color: 'var(--tx)', whiteSpace: 'pre-wrap' }}>
                      {selected.body}
                    </div>
                  )}
                  {selected.attachments?.length > 0 && (() => {
                    const match = matchByEmail(selected.from_address || selected.recipient)
                    return (
                    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {selected.attachments.map((att, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button className="btn sec" style={{ fontSize: 12, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
                              onClick={async () => {
                                try {
                                  await downloadGmailAttachment(supabase, {
                                    gmailMessageId: selected.gmail_message_id, attachmentId: att.attachmentId,
                                    filename: att.filename, mimeType: att.mimeType,
                                    employeeEmail: selected.mailbox_owner || user?.email,
                                  })
                                } catch (e) { showToast('Could not download: ' + e.message) }
                              }}>
                              📎 {att.filename} {att.size ? `(${Math.round(att.size / 1024)}KB)` : ''}
                            </button>
                            <button className="btn sec" style={{ fontSize: 11, padding: '5px 10px' }}
                              onClick={() => { setAttachPickerFor(attachPickerFor === att.attachmentId ? null : att.attachmentId); setAttachSearch(''); setAttachFolder('Correspondence') }}>
                              📁 {match ? `Attach to ${match.name}'s file` : 'Attach to file'}
                            </button>
                          </div>
                        ))}
                      </div>
                      {selected.attachments.map((att, i) => attachPickerFor === att.attachmentId && (
                        <div key={'picker-'+i} style={{ background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 360 }}>
                          {match ? (
                            <div style={{ fontSize: 13, fontWeight: 600 }}>Attaching to: {match.name} <span style={{ color: 'var(--t3)', fontWeight: 400, fontSize: 11 }}>({match._type}, matched by email)</span></div>
                          ) : (
                            <>
                              <input autoFocus placeholder="Search client or lead name…" value={attachSearch}
                                onChange={e => setAttachSearch(e.target.value)}
                                style={{ fontSize: 13, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--br)', background: 'var(--bg)', color: 'var(--tx)' }}/>
                              {attachSearch.length >= 2 && [...clients.map(c=>({...c,_type:'Client'})), ...leads.map(l=>({...l,_type:'Lead'}))]
                                .filter(p => p.name.toLowerCase().includes(attachSearch.toLowerCase())).slice(0, 6)
                                .map(p => (
                                  <div key={p._type+p.id} onClick={() => setAttachSearch(p.name)}
                                    style={{ fontSize: 13, padding: '6px 10px', cursor: 'pointer', borderRadius: 6, background: attachSearch===p.name?'var(--br)':'transparent' }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--br)'}
                                    onMouseLeave={e => e.currentTarget.style.background = attachSearch===p.name?'var(--br)':''}>
                                    {p.name} <span style={{ color: 'var(--t3)', fontSize: 11 }}>({p._type})</span>
                                  </div>
                              ))}
                            </>
                          )}
                          <div className="field"><label style={{fontSize:11}}>Folder</label>
                            <select value={attachFolder} onChange={e=>setAttachFolder(e.target.value)} style={{fontSize:13,padding:'6px 10px'}}>
                              {DOC_FOLDERS.map(f=><option key={f}>{f}</option>)}
                            </select>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn pri" style={{ fontSize: 12, padding: '5px 12px' }} disabled={attaching === att.attachmentId || (!match && !attachSearch)}
                              onClick={() => attachEmailAttachmentToFile(selected, att, match ? match.name : attachSearch, attachFolder)}>
                              Confirm Attach
                            </button>
                            <button className="btn sec" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => { setAttachPickerFor(null); setAttachSearch(''); setAttachFolder('Correspondence') }}>Cancel</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    )
                  })()}
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--t3)' }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--tx)', marginBottom: 6 }}>Select an email to read</div>
                  <div style={{ fontSize: 13 }}>Or compose a new one</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Compose */}
        {view === 'compose' && (
          <div style={{ flex: 1, overflow: 'auto', padding: 32, maxWidth: 700 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <button className="btn" onClick={() => setView('inbox')}>← Back</button>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--tx)' }}>New Email</div>
            </div>

            <div className="field" style={{ position: 'relative' }}>
              <label>Client Name (optional)</label>
              <input value={form.clientName} onChange={e => searchClient(e.target.value)} placeholder="Search client…" autoComplete="off" onBlur={() => setTimeout(() => setSug([]), 150)} />
              {sug.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--s3)', border: '1px solid var(--br)', borderRadius: 7, zIndex: 100 }}>
                  {sug.map(c => <div key={c.id} onClick={() => { fld('clientName', c.name); if (c.email) fld('recipient', c.email); setSug([]) }} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}>{c.name} {c.email ? `— ${c.email}` : ''}</div>)}
                </div>
              )}
            </div>
            {form.routeId && form.replyFrom && (
              <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.25)' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>Reply identity</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ok)' }}>From: {form.replyFrom}</div>
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 3 }}>Locked to the mailbox that received this conversation.</div>
              </div>
            )}
            <div className="field"><label>To (email address)</label>
              <input type="email" value={form.recipient} onChange={e => fld('recipient', e.target.value)} placeholder="client@email.com" />
            </div>
            <div className="field"><label>Subject *</label>
              <input value={form.subject} onChange={e => fld('subject', e.target.value)} placeholder="Email subject…" />
            </div>

            {/* Quick templates */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Quick Templates</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {TEMPLATES.map(t => (
                  <button key={t.label} className="btn sec" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => useTemplate(t)}>{t.label}</button>
                ))}
              </div>
            </div>

            <div className="field"><label>Body *</label>
              <textarea value={form.body} onChange={e => fld('body', e.target.value)} rows={14} spellCheck={true} lang="en" style={{ minHeight: 280, fontFamily: 'inherit', lineHeight: 1.7 }} placeholder="Email body…" />
            </div>

            {/* Signature preview — not part of the editable body, appended automatically on send */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ margin: 0 }}>Signature</label>
                <a href="/settings" style={{ fontSize: 11, color: 'var(--blue)' }}>Edit in Settings →</a>
              </div>
              {signature.text || signature.logoUrl ? (
                <div style={{ background: 'var(--s2)', border: '1px dashed var(--br)', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>Automatically added when sent</div>
                  {signature.logoUrl && <img src={signature.logoUrl} alt="" style={{ maxHeight: 50, maxWidth: 220, display: 'block', marginBottom: 8 }} />}
                  {signature.text && <div style={{ fontSize: 13, color: 'var(--t2)', whiteSpace: 'pre-wrap', fontFamily: 'Arial, sans-serif' }}>{signature.text}</div>}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--t3)', padding: '10px 14px', background: 'var(--s2)', borderRadius: 8 }}>
                  No signature set yet — <a href="/settings" style={{ color: 'var(--blue)' }}>add one in Settings</a> and it'll be appended to every email sent through {isDemoMailbox ? 'Stalwart' : 'Gmail'}.
                </div>
              )}
            </div>
            <div className="field"><label>Triage</label>
              <select value={form.triage} onChange={e => fld('triage', e.target.value)}>
                {TRIAGE.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn" onClick={() => setView('inbox')}>Cancel</button>
              <button className="btn pri" style={{ flex: 1, justifyContent: 'center', padding: 12 }} onClick={send} disabled={saving}>
                {saving ? 'Saving…' : '📤 Log Email'}
              </button>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--t3)', textAlign: 'center' }}>
              {isDemoMailbox ? 'TaxRes CRM email is connected through Stalwart.' : isCloudCpaPlatformRelay ? 'CloudCPA outbound email is active through the TaxRes platform relay. Replies go to tony@thecloudcpa.net until CloudCPA connects its own mailbox.' : 'Connect Gmail in the sidebar to send directly. Until then, emails are logged for tracking.'}
            </div>
          </div>
        )}

        {/* Templates library */}
        {view === 'templates' && (
          <div style={{ flex: 1, overflow: 'auto', padding: 32 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--tx)', marginBottom: 20 }}>📋 Email Templates</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
              {TEMPLATES.map(t => (
                <div key={t.label} className="card" style={{ padding: 20 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--tx)', marginBottom: 4 }}>{t.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--blue)', marginBottom: 10 }}>{t.subject}</div>
                  <div style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'hidden' }}>{t.body}</div>
                  <button className="btn pri" style={{ marginTop: 14, width: '100%', justifyContent: 'center', fontSize: 12 }} onClick={() => useTemplate(t)}>
                    Use Template
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Renders a full HTML email body inside a sandboxed iframe. sandbox=
// "allow-same-origin" (deliberately WITHOUT "allow-scripts") means no
// <script> tag or inline event handler in the email can ever execute —
// that's what actually blocks XSS — while still letting this component
// read the iframe's rendered height to auto-size it. allow-same-origin
// alone is inert without allow-scripts; there's no script context to
// exploit it with. Safe even for HTML from senders we don't control.
function SafeHtmlEmail({ html }) {
  const ref = useRef(null)
  const [height, setHeight] = useState(200)

  // Force every link to open in a real new tab instead of trying to
  // navigate the sandboxed iframe itself (which the sandbox blocks).
  const docWithBaseTarget = `<base target="_blank">${html || ''}`

  function resize() {
    const doc = ref.current?.contentDocument
    if (doc?.body) setHeight(doc.body.scrollHeight + 24)
  }

  return (
    <div style={{ background: '#fff', border: '1px solid var(--br)', borderRadius: 10, overflow: 'hidden' }}>
      <iframe
        ref={ref}
        srcDoc={docWithBaseTarget}
        // allow-same-origin: needed to read scrollHeight for auto-resize
        // allow-popups + allow-popups-to-escape-sandbox: required for link
        // clicks to actually open — without these, clicking any link inside
        // a sandboxed iframe is silently swallowed by the browser.
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        onLoad={resize}
        title="Email content"
        style={{ width: '100%', height, border: 'none', display: 'block' }}
      />
    </div>
  )
}
