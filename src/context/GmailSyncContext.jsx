import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from './AppContext'

// ──────────────────────────────────────────────────────────────────────
// Gmail sync runs in a single shared scheduled edge function
// (supabase/functions/gmail-sync-cron), on a schedule no matter how many
// people are logged in — but as of the per-employee Gmail rework, that
// cron job loops through EVERY employee's own connected mailbox and syncs
// each one separately. This context reads THIS employee's own sync status
// row (employee_gmail_accounts), not a single shared status for everyone.
// "Sync now" invokes the same shared edge function, which still syncs
// every connected employee in one pass (cheaper than one function call per
// person), but the status shown here is filtered to just this employee.
// ──────────────────────────────────────────────────────────────────────

const GmailSyncContext = createContext(null)
export function useGmailSync() { return useContext(GmailSyncContext) }

export function GmailSyncProvider({ children }) {
  const { user } = useApp()
  const [lastSyncAt, setLastSyncAt] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [lastError, setLastError] = useState(null)

  useEffect(() => {
    if (!user?.email) return
    let cancelled = false

    async function loadInitial() {
      const { data } = await supabase.from('employee_gmail_accounts')
        .select('gmail_last_sync_at, gmail_last_error')
        .eq('employee_email', user.email).maybeSingle()
      if (cancelled || !data) return
      if (data.gmail_last_sync_at) setLastSyncAt(new Date(data.gmail_last_sync_at))
      if (data.gmail_last_error) setLastError(data.gmail_last_error)
    }
    loadInitial()

    // Push-based update instead of polling — only fires when the cron
    // function actually finishes syncing THIS employee's mailbox.
    const ch = supabase.channel('gmail-sync-status-' + user.email)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'employee_gmail_accounts', filter: `employee_email=eq.${user.email}` }, ({ new: row }) => {
        if (row.gmail_last_sync_at) setLastSyncAt(new Date(row.gmail_last_sync_at))
        setLastError(row.gmail_last_error || null)
      })
      .subscribe()

    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [user?.email])

  // Manual "Sync now" — invokes the shared edge function directly instead
  // of running the sync logic in this browser tab. It syncs every
  // connected employee in one pass; the realtime listener above will pick
  // up this employee's own row once that pass finishes.
  async function syncNow() {
    setSyncing(true)
    setLastError(null)
    try {
      const { data, error } = await supabase.functions.invoke('gmail-sync-cron', {
        body: { mode:'manual_sync' },
      })
      if (error) {
        setLastError(error.message || String(error))
        return { ok:false, error:error.message || String(error) }
      }
      if (!data?.ok) {
        const message = data?.error || 'Email sync failed'
        setLastError(message)
        return { ok:false, error:message }
      }
      setLastError(null)
      setLastSyncAt(new Date())
      return { ok:true, ...data }
    } catch (e) {
      const message = e?.message || String(e)
      setLastError(message)
      return { ok:false, error:message }
    } finally {
      setSyncing(false)
    }
  }

  return (
    <GmailSyncContext.Provider value={{ lastSyncAt, syncing, lastError, syncNow }}>
      {children}
    </GmailSyncContext.Provider>
  )
}
