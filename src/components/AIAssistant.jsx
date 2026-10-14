import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getStoredLanguage } from '../lib/i18n'

const SUGGESTED = [
  'What resolution options work best for this client?',
  'What IRS forms do I need for this case?',
  'How do I calculate the CSED for this taxpayer?',
  'Draft a client update email for this case',
  'What are the OIC acceptance criteria?',
  'How do I request a Collection Due Process hearing?',
]

const ADMIN_SUGGESTED = [
  'Summarize the platform stats on this page',
  'Which offices are closest to renewal or at risk of churn?',
  'Draft a follow-up email to a prospect after a demo',
  'What should I price a 30-seat firm at?',
  'Help me write onboarding instructions for a new office',
  'Summarize my calendar today and flag anything urgent',
  'What emails need my attention right now?',
  'Draft a reply to the last email on screen',
]

const AI_ES = {
  'Ready': 'Listo',
  'New chat': 'Nuevo chat',
  'Close AI Assistant': 'Cerrar asistente de IA',
  'Open AI Assistant': 'Abrir asistente de IA',
  'Platform AI assistant': 'Asistente de IA de la plataforma',
  'TaxRes AI assistant': 'Asistente de IA de TaxRes',
  'Platform AI': 'IA de la plataforma',
  'TaxRes AI': 'IA de TaxRes',
  'Operations and platform copilot': 'Copiloto de operaciones y plataforma',
  'Resolution copilot · aware of this screen': 'Copiloto de resolución · conoce esta pantalla',
  'AI COPILOT': 'COPILOTO DE IA',
  'What do you want to run?': '¿Qué quieres ejecutar?',
  'What do you want to solve?': '¿Qué quieres resolver?',
  'Use the current screen as context or ask about operations, onboarding, pricing, calendar, and communications.': 'Usa la pantalla actual como contexto o pregunta sobre operaciones, incorporación, precios, calendario y comunicaciones.',
  'Use the current client and screen as context for case strategy, IRS procedures, forms, deadlines, and client communications.': 'Usa el cliente y la pantalla actuales como contexto para la estrategia del caso, procedimientos del IRS, formularios, fechas límite y comunicaciones con el cliente.',
  'What resolution options work best for this client?': '¿Qué opciones de resolución funcionan mejor para este cliente?',
  'What IRS forms do I need for this case?': '¿Qué formularios del IRS necesito para este caso?',
  'How do I calculate the CSED for this taxpayer?': '¿Cómo calculo la CSED para este contribuyente?',
  'Draft a client update email for this case': 'Redacta un correo de actualización para el cliente sobre este caso',
  'What are the OIC acceptance criteria?': '¿Cuáles son los criterios de aceptación de una OIC?',
  'How do I request a Collection Due Process hearing?': '¿Cómo solicito una audiencia de Collection Due Process?',
  'Summarize the platform stats on this page': 'Resume las estadísticas de la plataforma en esta página',
  'Which offices are closest to renewal or at risk of churn?': '¿Qué oficinas están más cerca de renovar o tienen riesgo de cancelación?',
  'Draft a follow-up email to a prospect after a demo': 'Redacta un correo de seguimiento para un prospecto después de una demostración',
  'What should I price a 30-seat firm at?': '¿Qué precio debo cobrar a una firma de 30 usuarios?',
  'Help me write onboarding instructions for a new office': 'Ayúdame a redactar instrucciones de incorporación para una oficina nueva',
  'Summarize my calendar today and flag anything urgent': 'Resume mi calendario de hoy y señala cualquier asunto urgente',
  'What emails need my attention right now?': '¿Qué correos necesitan mi atención ahora mismo?',
  'Draft a reply to the last email on screen': 'Redacta una respuesta al último correo que aparece en pantalla',
  'Working on it': 'Trabajando en ello',
  'Last request failed. Edit your prompt or retry.': 'La última solicitud falló. Edita tu mensaje o vuelve a intentarlo.',
  'Ask TaxRes AI…': 'Pregunta a TaxRes AI…',
  'Send message': 'Enviar mensaje',
  'Enter to send · Shift+Enter for a new line': 'Enter para enviar · Shift+Enter para una línea nueva',
  'Secure office context': 'Contexto seguro de la oficina',
  'Your session expired or is not authorized. Please sign in again and retry.': 'Tu sesión venció o no está autorizada. Inicia sesión nuevamente y vuelve a intentarlo.',
  'The AI service is busy right now. Please wait a moment and retry.': 'El servicio de IA está ocupado en este momento. Espera un momento y vuelve a intentarlo.',
  'The AI service is temporarily unavailable. Please retry.': 'El servicio de IA no está disponible temporalmente. Vuelve a intentarlo.',
  'Your session is no longer active. Please sign in again.': 'Tu sesión ya no está activa. Inicia sesión nuevamente.',
  'The AI service returned an empty response. Please retry.': 'El servicio de IA devolvió una respuesta vacía. Vuelve a intentarlo.',
  'Connection error. Please try again.': 'Error de conexión. Inténtalo de nuevo.',
}

function getPageContext() {
  const main = document.querySelector('.page-content') || document.querySelector('main') || document.body
  let text = main?.innerText || ''

  const emailRows = document.querySelectorAll('[data-email-row]')
  if (emailRows.length) {
    const emailCtx = Array.from(emailRows).slice(0, 10).map(r => r.innerText?.trim()).filter(Boolean).join('\n')
    text = `INBOX EMAILS:\n${emailCtx}\n\n${text}`
  }

  const calEvents = document.querySelectorAll('[data-cal-event]')
  if (calEvents.length) {
    const calCtx = Array.from(calEvents).slice(0, 15).map(r => r.innerText?.trim()).filter(Boolean).join('\n')
    text = `CALENDAR EVENTS:\n${calCtx}\n\n${text}`
  }

  return text.slice(0, 3000)
}

function safeError(data, status) {
  const raw = data?.error || data?.message || data?.detail || ''
  if (status === 401 || status === 403) return 'Your session expired or is not authorized. Please sign in again and retry.'
  if (status === 429) return 'The AI service is busy right now. Please wait a moment and retry.'
  if (status >= 500) return raw ? `AI service error: ${String(raw).slice(0, 220)}` : 'The AI service is temporarily unavailable. Please retry.'
  return raw ? String(raw).slice(0, 220) : `AI request failed (${status}). Please retry.`
}

export default function AIAssistant({ adminMode = false }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [lastError, setLastError] = useState('')
  const [language, setLanguage] = useState(() => getStoredLanguage())
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const t = value => language === 'es' ? (AI_ES[value] || value) : value

  useEffect(() => {
    const onLanguageChange = event => setLanguage(event?.detail?.language === 'es' ? 'es' : 'en')
    window.addEventListener('taxres-language-change', onLanguageChange)
    return () => window.removeEventListener('taxres-language-change', onLanguageChange)
  }, [])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 100)
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    return () => clearTimeout(t)
  }, [open, messages, loading])

  async function send(text) {
    const msg = (text || input).trim()
    if (!msg || loading) return

    setInput('')
    setLastError('')
    const userMsg = { role: 'user', content: msg }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setLoading(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Your session is no longer active. Please sign in again.')

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL || 'https://mpxgxfqdbquzkrvvejkh.supabase.co'}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            message: language === 'es' ? `Responde completamente en español profesional. Mantén sin traducir los nombres propios, números de formularios del IRS, secciones del código y siglas tributarias cuando corresponda.\n\n${msg}` : msg,
            context: getPageContext(),
            history: nextMessages.slice(-10, -1),
          }),
        }
      )

      const raw = await res.text()
      let data = {}
      try { data = raw ? JSON.parse(raw) : {} } catch { data = { error: raw } }

      if (!res.ok) throw new Error(safeError(data, res.status))
      if (!data?.reply?.trim()) throw new Error('The AI service returned an empty response. Please retry.')

      setMessages(prev => [...prev, { role: 'assistant', content: data.reply.trim() }])
    } catch (err) {
      const message = t(err?.message || 'Connection error. Please try again.')
      setLastError(message)
      setMessages(prev => [...prev, { role: 'assistant', content: message, error: true }])
    } finally {
      setLoading(false)
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const suggestions = adminMode ? ADMIN_SUGGESTED : SUGGESTED

  return (
    <>
      <button
        className="taxres-ai-fab"
        onClick={() => setOpen(v => !v)}
        title={t(open ? 'Close AI Assistant' : 'Open AI Assistant')}
        aria-label={t(open ? 'Close AI Assistant' : 'Open AI Assistant')}
      >
        {open ? '×' : '✦'}
      </button>

      {open && (
        <section className="taxres-ai-panel" aria-label={t(adminMode ? 'Platform AI assistant' : 'TaxRes AI assistant')}>
          <header className="taxres-ai-header">
            <div className="taxres-ai-mark">✦</div>
            <div className="taxres-ai-heading">
              <div className="taxres-ai-title-row">
                <strong>{t(adminMode ? 'Platform AI' : 'TaxRes AI')}</strong>
                <span className="taxres-ai-status"><i />{t('Ready')}</span>
              </div>
              <span>{t(adminMode ? 'Operations and platform copilot' : 'Resolution copilot · aware of this screen')}</span>
            </div>
            {messages.length > 0 && (
              <button className="taxres-ai-clear" onClick={() => { setMessages([]); setLastError('') }}>{t('New chat')}</button>
            )}
          </header>

          <div className="taxres-ai-body">
            {messages.length === 0 && (
              <div className="taxres-ai-welcome">
                <div className="taxres-ai-welcome-copy">
                  <span className="taxres-ai-eyebrow">{t('AI COPILOT')}</span>
                  <h3>{t(adminMode ? 'What do you want to run?' : 'What do you want to solve?')}</h3>
                  <p>
                    {adminMode
                      ? t('Use the current screen as context or ask about operations, onboarding, pricing, calendar, and communications.')
                      : t('Use the current client and screen as context for case strategy, IRS procedures, forms, deadlines, and client communications.')}
                  </p>
                </div>
                <div className="taxres-ai-suggestions">
                  {suggestions.slice(0, 6).map((s, i) => (
                    <button key={i} onClick={() => send(t(s))}>
                      <span>✦</span>
                      <span>{t(s)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`taxres-ai-message-row ${m.role === 'user' ? 'user' : 'assistant'}`}>
                {m.role === 'assistant' && <div className="taxres-ai-avatar">✦</div>}
                <div className={`taxres-ai-message ${m.role} ${m.error ? 'error' : ''}`}>{m.content}</div>
              </div>
            ))}

            {loading && (
              <div className="taxres-ai-thinking">
                <div className="taxres-ai-avatar">✦</div>
                <span>{t('Working on it')}<span className="taxres-ai-dots">•••</span></span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <footer className="taxres-ai-composer-wrap">
            {lastError && <div className="taxres-ai-error-note">{t('Last request failed. Edit your prompt or retry.')}</div>}
            <div className="taxres-ai-composer">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder={t('Ask TaxRes AI…')}
                rows={1}
              />
              <button onClick={() => send()} disabled={loading || !input.trim()} aria-label={t('Send message')}>↑</button>
            </div>
            <div className="taxres-ai-footer-meta">
              <span>{t('Enter to send · Shift+Enter for a new line')}</span>
              <span>{t('Secure office context')}</span>
            </div>
          </footer>
        </section>
      )}

      <style>{`
        .taxres-ai-fab{position:fixed;right:24px;bottom:80px;z-index:10000;width:56px;height:56px;border-radius:18px;border:1px solid rgba(255,255,255,.18);background:linear-gradient(135deg,#2563eb 0%,#4f46e5 52%,#7c3aed 100%);color:#fff;cursor:pointer;box-shadow:0 16px 38px rgba(37,99,235,.32);display:flex;align-items:center;justify-content:center;font-size:22px;transition:.18s ease}.taxres-ai-fab:hover{transform:translateY(-2px);box-shadow:0 20px 44px rgba(37,99,235,.4)}
        .taxres-ai-panel{position:fixed;right:24px;bottom:148px;z-index:9999;width:min(456px,calc(100vw - 32px));height:min(568px,calc(100vh - 180px));background:#0f172a;border:1px solid rgba(148,163,184,.2);border-radius:20px;box-shadow:0 28px 76px rgba(2,6,23,.62);overflow:hidden;display:flex;flex-direction:column;color:#e2e8f0;font-family:inherit}
        .taxres-ai-header{min-height:70px;padding:13px 15px;border-bottom:1px solid rgba(148,163,184,.13);background:linear-gradient(180deg,#111d33 0%,#0f172a 100%);display:flex;align-items:center;gap:11px}.taxres-ai-mark,.taxres-ai-avatar{display:flex;align-items:center;justify-content:center;color:#c7d2fe;background:linear-gradient(135deg,rgba(37,99,235,.28),rgba(124,58,237,.24));border:1px solid rgba(129,140,248,.22)}.taxres-ai-mark{width:38px;height:38px;border-radius:12px;font-size:17px;box-shadow:0 8px 20px rgba(37,99,235,.16)}.taxres-ai-heading{min-width:0;display:flex;flex-direction:column;gap:3px}.taxres-ai-title-row{display:flex;align-items:center;gap:8px}.taxres-ai-title-row strong{font-size:14px;color:#f8fafc}.taxres-ai-heading>span{font-size:11px;color:#8291a8}.taxres-ai-status{display:inline-flex;align-items:center;gap:5px;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#86efac;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.18);padding:2px 7px;border-radius:999px}.taxres-ai-status i{width:5px;height:5px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 3px rgba(74,222,128,.09)}.taxres-ai-clear{margin-left:auto;border:1px solid rgba(148,163,184,.14);background:rgba(15,23,42,.7);color:#94a3b8;border-radius:9px;padding:7px 9px;font-size:10.5px;cursor:pointer}
        .taxres-ai-body{flex:1;overflow-y:auto;padding:14px 14px 12px;display:flex;flex-direction:column;gap:11px;background:radial-gradient(circle at top right,rgba(79,70,229,.06),transparent 34%),#0b1322}.taxres-ai-welcome{display:flex;flex-direction:column;gap:12px}.taxres-ai-welcome-copy{padding:15px 15px 14px;border-radius:14px;background:linear-gradient(135deg,rgba(37,99,235,.1),rgba(79,70,229,.05));border:1px solid rgba(96,165,250,.13)}.taxres-ai-eyebrow{font-size:9px;font-weight:900;letter-spacing:.14em;color:#818cf8}.taxres-ai-welcome-copy h3{font-size:17px;line-height:1.25;color:#f8fafc;margin:6px 0 6px}.taxres-ai-welcome-copy p{font-size:11.75px;line-height:1.55;color:#94a3b8;margin:0}.taxres-ai-suggestions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.taxres-ai-suggestions button{text-align:left;min-height:56px;padding:9px 10px;border-radius:11px;background:#111c2f;border:1px solid rgba(148,163,184,.12);color:#cbd5e1;cursor:pointer;font-size:11px;line-height:1.38;display:flex;gap:8px;align-items:flex-start;transition:.16s ease}.taxres-ai-suggestions button:hover{border-color:rgba(96,165,250,.3);background:#14213a;transform:translateY(-1px)}.taxres-ai-suggestions button>span:first-child{color:#818cf8;font-size:10px;margin-top:2px}
        .taxres-ai-message-row{display:flex;align-items:flex-end;gap:7px}.taxres-ai-message-row.user{justify-content:flex-end}.taxres-ai-avatar{width:27px;height:27px;min-width:27px;border-radius:9px;font-size:11px}.taxres-ai-message{max-width:84%;padding:9px 11px;font-size:12.5px;line-height:1.57;white-space:pre-wrap}.taxres-ai-message.user{border-radius:13px 13px 4px 13px;background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff;box-shadow:0 7px 18px rgba(37,99,235,.17)}.taxres-ai-message.assistant{border-radius:13px 13px 13px 4px;background:#162236;border:1px solid rgba(148,163,184,.1);color:#dbe5f2}.taxres-ai-message.error{background:rgba(127,29,29,.24);border-color:rgba(248,113,113,.22);color:#fecaca}.taxres-ai-thinking{display:flex;align-items:center;gap:8px;color:#7f8fa7;font-size:11.5px}.taxres-ai-dots{animation:taxresAiPulse 1.2s infinite}
        .taxres-ai-composer-wrap{padding:10px 11px 9px;border-top:1px solid rgba(148,163,184,.11);background:#0d1627}.taxres-ai-error-note{font-size:10px;color:#fca5a5;margin:0 3px 7px}.taxres-ai-composer{display:flex;gap:7px;align-items:flex-end;background:#121f33;border:1px solid rgba(148,163,184,.15);border-radius:13px;padding:5px 5px 5px 10px;box-shadow:inset 0 1px 0 rgba(255,255,255,.025)}.taxres-ai-composer:focus-within{border-color:rgba(96,165,250,.42);box-shadow:0 0 0 3px rgba(37,99,235,.08)}.taxres-ai-composer textarea{flex:1;min-height:34px;max-height:92px;resize:none;overflow-y:auto;background:transparent;color:#f8fafc;border:0;padding:7px 0;outline:none;font-family:inherit;font-size:12.75px;line-height:1.45}.taxres-ai-composer textarea::placeholder{color:#64748b}.taxres-ai-composer button{width:36px;height:36px;min-width:36px;border-radius:10px;border:0;background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}.taxres-ai-composer button:disabled{background:#1e293b;color:#475569;cursor:default}.taxres-ai-footer-meta{display:flex;justify-content:space-between;gap:8px;margin-top:6px;padding:0 3px;font-size:9.5px;color:#4f6078}
        @keyframes taxresAiPulse{0%,100%{opacity:.3}50%{opacity:1}}
        @media(max-width:640px){.taxres-ai-fab{right:14px;bottom:72px}.taxres-ai-panel{right:10px;bottom:138px;width:calc(100vw - 20px);height:min(590px,calc(100vh - 156px));border-radius:17px}.taxres-ai-suggestions{grid-template-columns:1fr}.taxres-ai-composer textarea{font-size:16px}.taxres-ai-footer-meta span:first-child{display:none}}
      `}</style>
    </>
  )
}
