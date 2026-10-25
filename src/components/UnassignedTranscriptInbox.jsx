/**
 * UnassignedTranscriptInbox
 * ─────────────────────────
 * Persistent inbox for IRS transcripts that arrived with no matching CRM client.
 * Each item is stored in Supabase (unassigned_transcripts table) and survives
 * page refreshes, browser closures, and employee logouts.
 *
 * Employees can:
 *   • Assign to Existing Client  — search current client list, confirm, file.
 *   • Create New Client          — navigate to client creation (link only).
 *   • Discard                    — requires typed confirmation + reason.
 *
 * Every action requires explicit employee confirmation. Nothing auto-files.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../context/AppContext'
import {
  loadUnassignedTranscripts,
  assignUnassignedTranscript,
  discardUnassignedTranscript,
} from '../lib/transcriptPull'

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(isoStr) {
  if (!isoStr) return '—'
  try {
    return new Date(isoStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  } catch { return isoStr }
}

function intakeLabel(source) {
  const map = {
    'folder-scan': 'Folder watch',
    'tds-helper': 'TDS Helper',
    'sor-bridge': 'SOR Bridge',
    'sor-manual': 'SOR manual upload',
    'manual-upload': 'Manual upload',
    'unknown': 'Unknown',
  }
  return map[source] || source || 'Unknown'
}

const CONFIRM_WORD = 'DISCARD'

// ── Main component ─────────────────────────────────────────────────────────
export default function UnassignedTranscriptInbox({ clients = [], onAssigned, onCountChange }) {
  const { employeeName } = useApp()

  // ── Inbox state ──────────────────────────────────────────────────────────
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [expanded, setExpanded] = useState(null)

  // ── Assignment dialog state ──────────────────────────────────────────────
  const [assignItem, setAssignItem] = useState(null)      // item being assigned
  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState(null) // { id, name }
  const [dropOpen, setDropOpen] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [assignConfirmed, setAssignConfirmed] = useState(false)

  // ── Discard dialog state ─────────────────────────────────────────────────
  const [discardItem, setDiscardItem] = useState(null)
  const [discardReason, setDiscardReason] = useState('')
  const [discardConfirmWord, setDiscardConfirmWord] = useState('')
  const [discarding, setDiscarding] = useState(false)
  const [discardError, setDiscardError] = useState('')

  // ── Flash message ────────────────────────────────────────────────────────
  const [flash, setFlash] = useState('')
  const flashTimeout = useRef(null)

  function showFlash(msg) {
    setFlash(msg)
    clearTimeout(flashTimeout.current)
    flashTimeout.current = setTimeout(() => setFlash(''), 6000)
  }

  // ── Load inbox ───────────────────────────────────────────────────────────
  const loadInbox = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const rows = await loadUnassignedTranscripts()
      setItems(rows)
      onCountChange?.(rows.length)
    } catch (e) {
      setLoadError(e?.message || 'Could not load unassigned transcripts.')
    } finally {
      setLoading(false)
    }
  }, [onCountChange])

  useEffect(() => { loadInbox() }, [loadInbox])

  // ── Client search dropdown helpers ───────────────────────────────────────
  const clientDropRef = useRef(null)
  const clientInputRef = useRef(null)

  const clientMatches = (() => {
    const q = clientSearch.trim().toLowerCase()
    if (!q) return clients.slice(0, 50)
    return clients.filter(c => c.name && c.name.toLowerCase().includes(q)).slice(0, 50)
  })()

  useEffect(() => {
    function onDown(e) {
      if (clientDropRef.current && !clientDropRef.current.contains(e.target) &&
          clientInputRef.current && !clientInputRef.current.contains(e.target)) {
        setDropOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // ── Open assignment dialog ───────────────────────────────────────────────
  function openAssign(item) {
    setAssignItem(item)
    setClientSearch('')
    setSelectedClient(null)
    setDropOpen(false)
    setAssigning(false)
    setAssignError('')
    setAssignConfirmed(false)
  }

  function closeAssign() {
    setAssignItem(null)
    setClientSearch('')
    setSelectedClient(null)
    setDropOpen(false)
    setAssigning(false)
    setAssignError('')
    setAssignConfirmed(false)
  }

  function selectClient(c) {
    setSelectedClient(c)
    setClientSearch(c.name)
    setDropOpen(false)
    setAssignConfirmed(false)
    setAssignError('')
  }

  async function confirmAssign() {
    if (!assignItem || !selectedClient || assigning) return
    setAssigning(true)
    setAssignError('')
    try {
      const analysisId = await assignUnassignedTranscript(
        assignItem,
        selectedClient.id,
        selectedClient.name,
        employeeName || 'Unknown employee'
      )
      closeAssign()
      await loadInbox()
      if (onAssigned) onAssigned(analysisId)
      showFlash(`✅ Transcript filed to ${selectedClient.name} and added to their Documents → Transcripts.`)
    } catch (e) {
      setAssignError(e?.message || 'Could not file transcript. Please try again.')
    } finally {
      setAssigning(false)
    }
  }

  // ── Open discard dialog ──────────────────────────────────────────────────
  function openDiscard(item) {
    setDiscardItem(item)
    setDiscardReason('')
    setDiscardConfirmWord('')
    setDiscarding(false)
    setDiscardError('')
  }

  function closeDiscard() {
    setDiscardItem(null)
    setDiscardReason('')
    setDiscardConfirmWord('')
    setDiscarding(false)
    setDiscardError('')
  }

  async function confirmDiscard() {
    if (!discardItem || discarding) return
    if (discardConfirmWord.trim().toUpperCase() !== CONFIRM_WORD) {
      setDiscardError(`Type ${CONFIRM_WORD} to confirm.`)
      return
    }
    setDiscarding(true)
    setDiscardError('')
    try {
      await discardUnassignedTranscript(
        discardItem,
        employeeName || 'Unknown employee',
        discardReason.trim() || null
      )
      closeDiscard()
      await loadInbox()
      showFlash(`🗑️ Transcript discarded. Audit record kept for compliance.`)
    } catch (e) {
      setDiscardError(e?.message || 'Could not discard transcript.')
    } finally {
      setDiscarding(false)
    }
  }

  // ── Styles ───────────────────────────────────────────────────────────────
  const cardStyle = {
    background: 'var(--sf)',
    border: '1px solid var(--br)',
    borderRadius: 10,
    padding: '14px 16px',
    marginBottom: 10,
  }

  const labelStyle = {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--t3)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 2,
  }

  const valueStyle = { fontSize: 13, color: 'var(--tx)', marginBottom: 8 }

  const pillStyle = (color) => ({
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 12,
    padding: '2px 10px',
    background: color + '22',
    color,
    marginRight: 6,
  })

  const btnPrimary = {
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 7,
    padding: '8px 18px',
    fontWeight: 700,
    fontSize: 13,
    cursor: 'pointer',
  }

  const btnDanger = {
    background: 'transparent',
    color: 'var(--bad)',
    border: '1px solid var(--bad)',
    borderRadius: 7,
    padding: '7px 14px',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  }

  const btnGhost = {
    background: 'transparent',
    color: 'var(--t2)',
    border: '1px solid var(--br)',
    borderRadius: 7,
    padding: '7px 14px',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  }

  const overlayStyle = {
    position: 'fixed', inset: 0, zIndex: 1000,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '0 16px',
  }

  const dialogStyle = {
    background: 'var(--bg)',
    border: '1px solid var(--br)',
    borderRadius: 14,
    padding: '28px 24px',
    maxWidth: 500,
    width: '100%',
    boxShadow: '0 12px 48px rgba(0,0,0,0.22)',
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--tx)', display: 'flex', alignItems: 'center', gap: 8 }}>
            Unassigned IRS Transcripts
            {items.length > 0 && (
              <span style={{ background: 'var(--warn)', color: '#fff', borderRadius: 12, fontSize: 11, fontWeight: 700, padding: '2px 8px' }}>
                {items.length}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>
            Transcripts received with no matching client. Persistent — survives refresh and logout.
          </div>
        </div>
        <button onClick={loadInbox} disabled={loading} style={{ ...btnGhost, fontSize: 12 }}>
          {loading ? '…' : '↺ Refresh'}
        </button>
      </div>

      {/* Flash */}
      {flash && (
        <div style={{ background: flash.startsWith('✅') ? 'var(--ok)' : 'var(--warn)', color: '#fff', borderRadius: 8, padding: '9px 14px', marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
          {flash}
        </div>
      )}

      {/* Load error */}
      {loadError && (
        <div style={{ background: 'var(--bad)', color: '#fff', borderRadius: 8, padding: '9px 14px', marginBottom: 12, fontSize: 13 }}>
          ❌ {loadError}
        </div>
      )}

      {/* Loading */}
      {loading && !loadError && (
        <div style={{ color: 'var(--t3)', fontSize: 13, padding: '18px 0', textAlign: 'center' }}>
          Loading unassigned inbox…
        </div>
      )}

      {/* Empty state */}
      {!loading && !loadError && items.length === 0 && (
        <div style={{ background: 'var(--s2)', borderRadius: 10, padding: '28px 20px', textAlign: 'center', color: 'var(--t3)', fontSize: 14 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>No unassigned transcripts</div>
          <div style={{ fontSize: 12 }}>Transcripts received with no matching client will appear here.</div>
        </div>
      )}

      {/* Inbox items */}
      {items.map(item => {
        const isExpanded = expanded === item.id
        const hasConflict = Boolean(item.conflict_reason)

        return (
          <div key={item.id} style={{ ...cardStyle, borderLeft: `3px solid ${hasConflict ? 'var(--warn)' : 'var(--blue)'}` }}>
            {/* Title row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--tx)', marginBottom: 4 }}>
                  {item.taxpayer_name || 'Taxpayer name not extracted'}
                  {hasConflict && (
                    <span style={pillStyle('var(--warn)')}>TIN CONFLICT</span>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {item.transcript_type && <span style={pillStyle('var(--blue)')}>{item.transcript_type}</span>}
                  {item.tax_year && <span style={pillStyle('var(--t2)')}>{item.tax_year}</span>}
                  <span style={pillStyle('var(--t3)')}>{intakeLabel(item.intake_source)}</span>
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--t3)', whiteSpace: 'nowrap' }}>
                {fmt(item.received_at)}
                {item.received_by && <div>{item.received_by}</div>}
              </div>
            </div>

            {/* File name */}
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 10, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              📄 {item.file_name}
            </div>

            {/* Conflict reason */}
            {hasConflict && (
              <div style={{ background: 'var(--warn)18', border: '1px solid var(--warn)44', borderRadius: 7, padding: '8px 12px', fontSize: 12, color: 'var(--warn)', marginBottom: 10 }}>
                ⚠ {item.conflict_reason}
              </div>
            )}

            {/* Expandable details */}
            {isExpanded && (
              <div style={{ marginBottom: 10, borderTop: '1px solid var(--br)', paddingTop: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div>
                    <div style={labelStyle}>Taxpayer Name</div>
                    <div style={valueStyle}>{item.taxpayer_name || '—'}</div>
                  </div>
                  <div>
                    <div style={labelStyle}>Tax Year</div>
                    <div style={valueStyle}>{item.tax_year || '—'}</div>
                  </div>
                  <div>
                    <div style={labelStyle}>Transcript Type</div>
                    <div style={valueStyle}>{item.transcript_type || '—'}</div>
                  </div>
                  <div>
                    <div style={labelStyle}>Intake Source</div>
                    <div style={valueStyle}>{intakeLabel(item.intake_source)}</div>
                  </div>
                </div>
                {/* Audit log */}
                {Array.isArray(item.audit_log) && item.audit_log.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={labelStyle}>Audit Log</div>
                    {item.audit_log.map((entry, i) => (
                      <div key={i} style={{ fontSize: 11, color: 'var(--t3)', padding: '3px 0', borderBottom: '1px solid var(--br)' }}>
                        <strong>{entry.event}</strong>
                        {entry.at ? ` · ${fmt(entry.at)}` : ''}
                        {entry.by ? ` · ${entry.by}` : ''}
                        {entry.source ? ` · via ${intakeLabel(entry.source)}` : ''}
                        {entry.conflict ? ` · ⚠ ${entry.conflict}` : ''}
                        {entry.client ? ` → ${entry.client}` : ''}
                        {entry.reason ? ` · reason: ${entry.reason}` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Action row */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                style={btnPrimary}
                onClick={() => openAssign(item)}
              >
                Assign to Client
              </button>
              <a
                href="/clients/new"
                target="_blank"
                rel="noreferrer"
                style={{ ...btnGhost, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                + Create Client
              </a>
              <button
                style={btnGhost}
                onClick={() => setExpanded(isExpanded ? null : item.id)}
              >
                {isExpanded ? 'Hide details' : 'Details'}
              </button>
              <button
                style={{ ...btnDanger, marginLeft: 'auto' }}
                onClick={() => openDiscard(item)}
              >
                Discard
              </button>
            </div>
          </div>
        )
      })}

      {/* ── Assignment Dialog ─────────────────────────────────────────────── */}
      {assignItem && (
        <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) closeAssign() }}>
          <div style={dialogStyle}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6 }}>Assign Transcript to Client</div>
            <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 16 }}>
              <strong>{assignItem.taxpayer_name || assignItem.file_name}</strong>
              {assignItem.tax_year && ` · ${assignItem.tax_year}`}
              {assignItem.transcript_type && ` · ${assignItem.transcript_type}`}
            </div>

            {/* Client search */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ ...labelStyle, display: 'block', marginBottom: 6 }}>Search existing clients</label>
              <div style={{ position: 'relative' }} ref={clientDropRef}>
                <input
                  ref={clientInputRef}
                  type="text"
                  value={clientSearch}
                  onChange={e => {
                    setClientSearch(e.target.value)
                    setSelectedClient(null)
                    setDropOpen(true)
                    setAssignConfirmed(false)
                    setAssignError('')
                  }}
                  onFocus={() => setDropOpen(true)}
                  placeholder="Type client name…"
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '9px 12px',
                    border: '1px solid var(--br)', borderRadius: 7,
                    background: 'var(--sf)', color: 'var(--tx)', fontSize: 14,
                  }}
                  autoFocus
                />
                {dropOpen && clientMatches.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                    background: 'var(--bg)', border: '1px solid var(--br)', borderRadius: 7,
                    boxShadow: '0 4px 20px rgba(0,0,0,0.18)', maxHeight: 220, overflowY: 'auto',
                    marginTop: 2,
                  }}>
                    {clientMatches.map(c => (
                      <div
                        key={c.id}
                        onClick={() => selectClient(c)}
                        style={{
                          padding: '9px 14px', cursor: 'pointer', fontSize: 13, color: 'var(--tx)',
                          borderBottom: '1px solid var(--br)',
                          background: selectedClient?.id === c.id ? 'var(--blt)' : 'transparent',
                        }}
                        onMouseOver={e => e.currentTarget.style.background = 'var(--s2)'}
                        onMouseOut={e => e.currentTarget.style.background = selectedClient?.id === c.id ? 'var(--blt)' : 'transparent'}
                      >
                        {c.name}
                      </div>
                    ))}
                  </div>
                )}
                {dropOpen && clientMatches.length === 0 && clientSearch.trim().length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                    background: 'var(--bg)', border: '1px solid var(--br)', borderRadius: 7,
                    padding: '10px 14px', fontSize: 13, color: 'var(--t3)',
                    marginTop: 2,
                  }}>
                    No clients match "{clientSearch}" — <a href="/clients/new" target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>Create client</a> first, then return to assign.
                  </div>
                )}
              </div>
            </div>

            {/* Selected client confirmation */}
            {selectedClient && (
              <div style={{
                background: 'var(--ok)18', border: '1px solid var(--ok)44', borderRadius: 8,
                padding: '10px 14px', marginBottom: 16,
              }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ok)', marginBottom: 4 }}>
                  ✓ Selected: {selectedClient.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--t2)' }}>
                  Filing this transcript to <strong>{selectedClient.name}</strong> will add it to their
                  Documents → Transcripts and make AI analysis available immediately.
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={assignConfirmed}
                    onChange={e => { setAssignConfirmed(e.target.checked); setAssignError('') }}
                  />
                  I confirm this transcript belongs to <strong>&nbsp;{selectedClient.name}</strong>
                </label>
              </div>
            )}

            {/* Error */}
            {assignError && (
              <div style={{ color: 'var(--bad)', fontSize: 13, marginBottom: 12, background: 'var(--bad)18', borderRadius: 7, padding: '8px 12px' }}>
                ❌ {assignError}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <button style={btnGhost} onClick={closeAssign} disabled={assigning}>
                Cancel
              </button>
              <button
                style={{
                  ...btnPrimary,
                  opacity: (selectedClient && assignConfirmed && !assigning) ? 1 : 0.45,
                  cursor: (selectedClient && assignConfirmed && !assigning) ? 'pointer' : 'not-allowed',
                }}
                onClick={confirmAssign}
                disabled={!selectedClient || !assignConfirmed || assigning}
              >
                {assigning ? 'Filing…' : 'File Transcript'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Discard Dialog ────────────────────────────────────────────────── */}
      {discardItem && (
        <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) closeDiscard() }}>
          <div style={dialogStyle}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 6, color: 'var(--bad)' }}>
              Discard Transcript
            </div>
            <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 16 }}>
              <strong>{discardItem.taxpayer_name || discardItem.file_name}</strong>
              {discardItem.tax_year && ` · ${discardItem.tax_year}`}
            </div>

            <div style={{ background: 'var(--bad)11', border: '1px solid var(--bad)44', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--bad)' }}>
              ⚠ Discarded transcripts cannot be re-assigned without re-importing the PDF.
              An audit record with your name and the date will be retained for compliance.
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ ...labelStyle, display: 'block', marginBottom: 5 }}>Reason (optional)</label>
              <input
                type="text"
                value={discardReason}
                onChange={e => setDiscardReason(e.target.value)}
                placeholder="e.g. Duplicate, wrong office, test file…"
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '8px 12px',
                  border: '1px solid var(--br)', borderRadius: 7,
                  background: 'var(--sf)', color: 'var(--tx)', fontSize: 13,
                }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ ...labelStyle, display: 'block', marginBottom: 5 }}>
                Type <strong>{CONFIRM_WORD}</strong> to confirm
              </label>
              <input
                type="text"
                value={discardConfirmWord}
                onChange={e => { setDiscardConfirmWord(e.target.value); setDiscardError('') }}
                placeholder={CONFIRM_WORD}
                autoFocus
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '8px 12px',
                  border: `1px solid ${discardConfirmWord.trim().toUpperCase() === CONFIRM_WORD ? 'var(--ok)' : 'var(--br)'}`,
                  borderRadius: 7,
                  background: 'var(--sf)', color: 'var(--tx)', fontSize: 14, fontWeight: 700,
                  letterSpacing: '0.08em',
                }}
              />
            </div>

            {discardError && (
              <div style={{ color: 'var(--bad)', fontSize: 13, marginBottom: 10 }}>
                {discardError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button style={btnGhost} onClick={closeDiscard} disabled={discarding}>Cancel</button>
              <button
                style={{
                  ...btnDanger,
                  background: 'var(--bad)',
                  color: '#fff',
                  opacity: (discardConfirmWord.trim().toUpperCase() === CONFIRM_WORD && !discarding) ? 1 : 0.4,
                  cursor: (discardConfirmWord.trim().toUpperCase() === CONFIRM_WORD && !discarding) ? 'pointer' : 'not-allowed',
                }}
                onClick={confirmDiscard}
                disabled={discardConfirmWord.trim().toUpperCase() !== CONFIRM_WORD || discarding}
              >
                {discarding ? 'Discarding…' : 'Discard Transcript'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
