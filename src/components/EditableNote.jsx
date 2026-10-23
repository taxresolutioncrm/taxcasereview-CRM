import { memo, useState } from 'react'
import { supabase } from '../lib/supabase'

const SYSTEM_PREFIX = /^(📧 Email (Sent|Received)|💬 (SMS|Text) (Sent|Received)|📠 Fax sent|📁 Case status changed|💳 Payment|🔄 Task status changed|📅 Appointment scheduled|✉️ Booking link|📞 Call Summary)/

export function isEmployeeEditableNote(note, contentField='text') {
  const author = String(note?.author || '').trim().toLowerCase()
  const content = String(note?.[contentField] || '')
  if (!note?.id) return false
  if (['system','ai','ai call summary'].includes(author) || author.startsWith('system ') || author.startsWith('ai ')) return false
  return !SYSTEM_PREFIX.test(content)
}

function NoteEditor({ note, kind, contentField, original, onSaved, onReload, onClose }) {
  const [draft,setDraft] = useState(original)
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState('')

  async function save() {
    const next = draft.trim()
    if (!next) { setError('Note cannot be empty.'); return }
    if (next === original.trim()) { onClose(); return }

    setSaving(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('edit_employee_note', {
      p_note_kind: kind,
      p_note_id: note.id,
      p_new_content: next,
      p_expected_version: Number(note.edit_version || 0),
    })
    setSaving(false)

    if (rpcError) {
      setError(rpcError.message || 'Could not save note.')
      if (/changed by another employee/i.test(rpcError.message || '')) onReload?.()
      return
    }

    const row = Array.isArray(data) ? data[0] : data
    onSaved?.({
      ...note,
      [contentField]: row?.content ?? next,
      last_edited_at: row?.last_edited_at,
      last_edited_by_employee_id: row?.last_edited_by_employee_id,
      last_edited_by_name: row?.last_edited_by_name,
      edit_version: row?.edit_version ?? Number(note.edit_version || 0) + 1,
    })
    onClose()
  }

  return (
    <div>
      <textarea
        value={draft}
        onChange={e=>setDraft(e.target.value)}
        rows={Math.max(3, Math.min(10, draft.split('\n').length + 2))}
        autoFocus
        style={{width:'100%',boxSizing:'border-box',padding:'8px 10px',borderRadius:8,border:'1px solid var(--br)',background:'var(--s1)',color:'var(--tx)',fontSize:13,lineHeight:1.55,fontFamily:'inherit',resize:'vertical'}}
      />
      {error && <div style={{fontSize:11,color:'var(--err,#dc2626)',marginTop:5}}>{error}</div>}
      <div style={{display:'flex',gap:6,marginTop:7}}>
        <button className="btn pri" style={{fontSize:11,padding:'5px 10px'}} disabled={saving||!draft.trim()} onClick={save}>{saving?'Saving…':'Save'}</button>
        <button className="btn sec" style={{fontSize:11,padding:'5px 10px'}} disabled={saving} onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

function EditableNote({
  note,
  kind,
  contentField='text',
  onSaved,
  onReload,
  textStyle,
}) {
  const [editing,setEditing] = useState(false)
  const original = String(note?.[contentField] || '')
  const editable = isEmployeeEditableNote(note,contentField)

  if (editing) {
    return (
      <NoteEditor
        note={note}
        kind={kind}
        contentField={contentField}
        original={original}
        onSaved={onSaved}
        onReload={onReload}
        onClose={()=>setEditing(false)}
      />
    )
  }

  return (
    <div>
      <div style={textStyle || {fontSize:13,lineHeight:1.6,color:'var(--tx)',whiteSpace:'pre-wrap'}}>{original}</div>
      {(note?.last_edited_at && note?.last_edited_by_name) || editable ? (
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginTop:5}}>
          {note?.last_edited_at && note?.last_edited_by_name && (
            <span style={{fontSize:10.5,color:'var(--t3)'}}>
              Last edited by: {note.last_edited_by_name} — {new Date(note.last_edited_at).toLocaleString()}
            </span>
          )}
          {editable && (
            <button type="button" onClick={()=>setEditing(true)}
              style={{background:'none',border:'none',padding:0,color:'var(--blue)',fontSize:11,fontWeight:700,cursor:'pointer'}}>
              Edit
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default memo(EditableNote)
