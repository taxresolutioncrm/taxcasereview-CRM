import { EN_ES, getStoredLanguage } from './i18n'
import { EN_ES_EXTRA } from './operationalI18n'

const EXTRA_ES = {
  'Compose': 'Redactar',
  'Gmail Connected': 'Gmail conectado',
  'Refresh Email': 'Actualizar correo',
  'Connect Microsoft 365': 'Conectar Microsoft 365',
  'Link your Outlook inbox and calendar directly to the CRM.': 'Vincule su bandeja de Outlook y calendario directamente al CRM.',
  'Setup in Settings': 'Configurar en Configuración',
  'Triage': 'Clasificación',
  'Inbox': 'Bandeja de entrada',
  'Action Needed': 'Acción necesaria',
  'Waiting': 'En espera',
  'Archive': 'Archivo',
  'Mark as New': 'Marcar como nuevo',
  'Reply': 'Responder',
  'Attach to File': 'Adjuntar al expediente',
  'Search emails…': 'Buscar correos…',
  'Search emails...': 'Buscar correos…',
  'Search mail…': 'Buscar correos…',
  'Search mail...': 'Buscar correos…',
  'Eastern': 'Este',
  'Central': 'Central',
  'Mountain': 'Montaña',
  'Pacific': 'Pacífico',
  'Alaska': 'Alaska',
  'Hawaii': 'Hawái',
  'View All': 'Ver todos',
  'All Tasks': 'Todas las tareas',
  'All Leads': 'Todos los prospectos',
  'All Clients': 'Todos los clientes',
  'AI Intelligence': 'Inteligencia de IA',
  'Client Intelligence Workspace': 'Espacio de inteligencia del cliente',
  'Private tenant-scoped analysis': 'Análisis privado limitado al tenant',
  'Select a client': 'Seleccione un cliente',
  'Choose File': 'Elegir archivo',
  'Upload & Analyze': 'Subir y analizar',
  'Select a client to analyze': 'Seleccione un cliente para analizar',
  'Choose a file to analyze': 'Elija un archivo para analizar',
  'Uploading & analyzing…': 'Subiendo y analizando…',
  'Open AI Intelligence': 'Abrir Inteligencia de IA',
  'AI Documents': 'Documentos de IA',
  'Overview': 'Resumen',
  'Entities': 'Entidades',
  'Tax Facts': 'Datos fiscales',
  'Documents': 'Documentos',
  'Findings': 'Hallazgos',
  'Deadlines & Notices': 'Fechas límite y avisos',
  'Resolution Analysis': 'Análisis de resolución',
  'Recommended Actions': 'Acciones recomendadas',
  'Ask AI': 'Preguntar a la IA',
  'IRS Resolution Analysis': 'Análisis de resolución del IRS',
  'Analyze Resolution Options': 'Analizar opciones de resolución',
  '✦ Analyze Resolution Options': '✦ Analizar opciones de resolución',
  '✦ Re-analyze Resolution Options': '✦ Volver a analizar opciones de resolución',
  'Analyzing resolution options…': 'Analizando opciones de resolución…',
  'Latest Resolution Strategy': 'Estrategia de resolución más reciente',
  'Resolution Opportunities': 'Oportunidades de resolución',
  'Latest AI strategy': 'Estrategia de IA más reciente',
  'View analysis': 'Ver análisis',
  'Strong candidate': 'Candidato sólido',
  'Possible candidate': 'Candidato posible',
  'Insufficient data': 'Datos insuficientes',
  'Not indicated': 'No indicado',
  'Why it fits': 'Por qué encaja',
  'Concerns': 'Consideraciones',
  'Missing information': 'Información faltante',
  'Likely forms / submissions': 'Formularios / presentaciones probables',
  'Next steps': 'Próximos pasos',
  'Practitioner review:': 'Revisión del profesional:',
  'No summary returned.': 'No se devolvió un resumen.',
  'No resolution analysis has been run yet.': 'Aún no se ha ejecutado un análisis de resolución.',
  'The latest resolution run has no candidate rows. Re-run the analysis.': 'El análisis de resolución más reciente no tiene candidatos. Vuelva a ejecutar el análisis.',
  'Recommended next actions': 'Próximas acciones recomendadas',
  'No AI-recommended follow-up is currently pending.': 'Actualmente no hay seguimiento recomendado por IA pendiente.',
  'Ask AI about this client': 'Preguntar a la IA sobre este cliente',
  'Ask a question about this client’s file…': 'Haga una pregunta sobre el expediente de este cliente…',
  'Ask AI': 'Preguntar a la IA',
  'Thinking…': 'Pensando…',
  'Findings that need review': 'Hallazgos que requieren revisión',
  'Deadlines & notices found in the client file': 'Fechas límite y avisos encontrados en el expediente del cliente',
  'Open Questions': 'Preguntas abiertas',
  'No facts extracted yet.': 'Aún no se han extraído datos.',
  'No entities extracted yet.': 'Aún no se han extraído entidades.',
  'No unresolved findings currently need review.': 'Actualmente no hay hallazgos sin resolver que requieran revisión.',
  'No notices or deadlines have been extracted yet.': 'Aún no se han extraído avisos ni fechas límite.',
  'Open source': 'Abrir fuente',
  'Source': 'Fuente',
  'Verify': 'Verificar',
  'Reject': 'Rechazar',
  'confidence': 'confianza',
  'AI confidence': 'confianza de IA',
  'Analyze': 'Analizar',
  'Reading…': 'Leyendo…',
  'Analyze All': 'Analizar todos',
  'Processing up to 3 documents at a time': 'Procesando hasta 3 documentos a la vez',
  'Finalizing client file…': 'Finalizando expediente del cliente…',
  'Search this client\'s files…': 'Buscar en los archivos de este cliente…',
  'No client documents are attached yet.': 'Aún no hay documentos adjuntos para este cliente.',
  'No client files match that search.': 'Ningún archivo del cliente coincide con esa búsqueda.',
  'Resolution analysis complete': 'Análisis de resolución completado',
}

const ES = { ...EN_ES, ...EN_ES_EXTRA, ...EXTRA_ES }
const EN = Object.fromEntries(Object.entries(ES).map(([en, es]) => [es, en]))
const PROTECTED = 'script,style,textarea,code,pre,[contenteditable="true"],[data-no-translate],.email-body,.message-body,.chat-message,.note-body,.user-content,.ql-editor'

const DAYS = {
  Sunday:'domingo', Monday:'lunes', Tuesday:'martes', Wednesday:'miércoles',
  Thursday:'jueves', Friday:'viernes', Saturday:'sábado'
}
const MONTHS = {
  January:'enero', February:'febrero', March:'marzo', April:'abril', May:'mayo', June:'junio',
  July:'julio', August:'agosto', September:'septiembre', October:'octubre', November:'noviembre', December:'diciembre'
}

function protectedNode(node) {
  const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
  return !el || !!el.closest?.(PROTECTED)
}

function translateDynamic(value, lang) {
  if (lang !== 'es') return value
  let out = value

  out = out.replace(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})$/,
    (_, d, m, day, year) => `${DAYS[d]}, ${day} de ${MONTHS[m]} de ${year}`)

  out = out.replace(/^(\$[\d,.]+)\s+outstanding$/i, '$1 pendiente')
  out = out.replace(/^Inv\. fees sold\s*·\s*Total:\s*(.+)$/i, 'Honorarios de investigación vendidos · Total: $1')
  out = out.replace(/^(\d+)\s+seat(s?)$/i, (_, n) => `${n} usuario${n === '1' ? '' : 's'}`)

  return out
}

function translateExact(value, lang) {
  const map = lang === 'es' ? ES : EN
  if (map[value]) return map[value]

  const dynamic = translateDynamic(value, lang)
  if (dynamic !== value) return dynamic

  // Handles labels such as "🗂 Active Cases" and "✅ Open Tasks".
  for (const [from, to] of Object.entries(map)) {
    if (!value.endsWith(from) || value === from) continue
    const prefix = value.slice(0, value.length - from.length)
    if (/^[^A-Za-z0-9À-ÿ]*$/.test(prefix)) return `${prefix}${to}`
  }

  const arrow = value.match(/^(.*?)(\s*[→↗])$/)
  if (arrow && map[arrow[1].trim()]) return `${map[arrow[1].trim()]}${arrow[2]}`

  return value
}

function translateTextNode(node, lang) {
  if (!node?.nodeValue || protectedNode(node)) return
  const raw = node.nodeValue
  const trimmed = raw.trim()
  if (!trimmed) return
  const translated = translateExact(trimmed, lang)
  if (translated === trimmed) return
  const lead = raw.match(/^\s*/)?.[0] || ''
  const trail = raw.match(/\s*$/)?.[0] || ''
  node.nodeValue = `${lead}${translated}${trail}`
}

function translateElement(el, lang) {
  if (!el || protectedNode(el)) return
  for (const attr of ['placeholder','title','aria-label']) {
    const current = el.getAttribute?.(attr)
    if (!current) continue
    const next = translateExact(current, lang)
    if (next !== current) el.setAttribute(attr, next)
  }
}

function translateTree(root, lang) {
  if (!root || protectedNode(root)) return
  if (root.nodeType === Node.TEXT_NODE) return translateTextNode(root, lang)
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return
  if (root.nodeType === Node.ELEMENT_NODE) translateElement(root, lang)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node, lang)
    else translateElement(node, lang)
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  let applying = false
  let lang = getStoredLanguage()
  let frame = 0
  let fullScan = false
  const pending = new Set()

  const apply = target => {
    if (applying) return
    applying = true
    try { translateTree(target || document.body, lang) } finally { applying = false }
  }

  const schedule = (target, forceFull = false) => {
    if (forceFull) {
      fullScan = true
      pending.clear()
    } else if (!fullScan && target) {
      pending.add(target)
    }
    if (frame) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      if (fullScan) {
        fullScan = false
        pending.clear()
        apply(document.body)
        return
      }
      const roots = [...pending]
      pending.clear()
      for (const root of roots) apply(root)
    })
  }

  const start = () => {
    apply(document.body)
    const observer = new MutationObserver(mutations => {
      if (applying) return
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') schedule(mutation.target)
        else if (mutation.type === 'attributes') schedule(mutation.target)
        else for (const node of mutation.addedNodes || []) schedule(node)
      }
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder','title','aria-label'],
    })

    window.addEventListener('taxres-language-change', e => {
      lang = e?.detail?.language === 'es' ? 'es' : 'en'
      schedule(document.body, true)
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true })
  else start()
}
