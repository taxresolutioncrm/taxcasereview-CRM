import { useEffect } from 'react'
import { EN_ES, getStoredLanguage, storeLanguage } from '../lib/i18n'

const ES_LOCAL = {
  'Dashboard':'Panel principal','Calendar':'Calendario','Leads':'Prospectos','Clients':'Clientes','Cases':'Casos','Tasks':'Tareas',
  'Transcripts':'Transcripciones','IRS Forms':'Formularios del IRS','Deadlines':'Fechas límite','Invoices':'Facturas','Payments':'Pagos',
  'Email':'Correo','Documents':'Documentos','E-Signatures':'Firmas electrónicas','Time Clock':'Reloj de tiempo','Payroll':'Nómina',
  'Employees':'Empleados','Reports':'Informes','Settings':'Configuración','Books':'Libros','Dialer':'Marcador','Team Chat':'Chat del equipo',
  'Tax Returns':'Declaraciones de impuestos','Accounts Receivable':'Cuentas por cobrar','State Forms':'Formularios estatales',
  'IRS Reference':'Referencia del IRS','Time Off Requests':'Solicitudes de tiempo libre','Workflows':'Flujos de trabajo','Clock-In Kiosk':'Kiosco de entrada',
  'Overview':'Resumen','Home':'Inicio','Client Work':'Trabajo de clientes','Communications':'Comunicaciones','Billing':'Facturación',
  'Transactions':'Transacciones','Time & Billing':'Tiempo y facturación','Books & Ledger':'Libros y contabilidad',
  'IRS & State Resolution':'Resolución IRS y estatal','IRS Forms & Docs':'Formularios y documentos del IRS','State Forms & Docs':'Formularios y documentos estatales',
  'IRS & State Reference':'Referencia IRS y estatal','IRS TDS/SOR Portal':'Portal TDS/SOR del IRS','Tax Returns & Entities':'Declaraciones y entidades',
  'HR & Payroll':'RR. HH. y nómina','Time Kiosk':'Kiosco de tiempo','Employee Portal':'Portal del empleado','Time Off':'Tiempo libre',
  'Activity Report':'Informe de actividad','Firm':'Firma','Training':'Capacitación','CRM Manual':'Manual del CRM',
  'Search clients, cases, leads…':'Buscar clientes, casos, prospectos…','Search clients, cases, leads...':'Buscar clientes, casos, prospectos…',
  'Searching…':'Buscando…','No matching clients, cases, or leads.':'No se encontraron clientes, casos o prospectos.',
  '+ New':'+ Nuevo','✕ Close':'✕ Cerrar','Create New':'Crear nuevo','What would you like to add?':'¿Qué desea agregar?',
  'New Case':'Nuevo caso','Open a case':'Abrir un caso','New Client':'Nuevo cliente','Add a client file':'Agregar expediente de cliente',
  'New Corp':'Nueva empresa','Formation case':'Caso de formación','New Document':'Nuevo documento','Upload document':'Subir documento',
  'New E-Sign':'Nueva firma electrónica','Request signature':'Solicitar firma','New Email':'Nuevo correo','Compose email':'Redactar correo',
  'New Entry':'Nueva entrada','New Event':'Nuevo evento','Add to calendar':'Agregar al calendario','New Fax':'Nuevo fax','Send a fax':'Enviar fax',
  'New Invoice':'Nueva factura','Bill a client':'Facturar a un cliente','New Lead':'Nuevo prospecto','Add a prospect':'Agregar prospecto',
  'New Payment':'Nuevo pago','Record a payment':'Registrar un pago','New Task':'Nueva tarea','Assign work':'Asignar trabajo',
  'New Transcript':'Nueva transcripción','Add transcript':'Agregar transcripción',
  'Support':'Soporte','Submit a support ticket':'Enviar un ticket de soporte','Open menu':'Abrir menú',
  'Notification sounds on — click to mute':'Sonidos activados — haga clic para silenciar',
  'Notification sounds muted — click to unmute':'Sonidos silenciados — haga clic para activar',
  'Switch to light mode':'Cambiar a modo claro','Switch to dark mode':'Cambiar a modo oscuro',
  'Loading…':'Cargando…','Access Restricted':'Acceso restringido','You don\'t have permission to view this page.':'No tiene permiso para ver esta página.',
  'Contact Romy Cruz to request access.':'Contacte a Romy Cruz para solicitar acceso.','Plan Required':'Plan requerido',
  'Save':'Guardar','Cancel':'Cancelar','Close':'Cerrar','Delete':'Eliminar','Edit':'Editar','Add':'Agregar','Create':'Crear','Update':'Actualizar',
  'Search':'Buscar','Filter':'Filtrar','All':'Todos','Active':'Activo','Inactive':'Inactivo','Pending':'Pendiente','Completed':'Completado',
  'Open':'Abierto','Closed':'Cerrado','Status':'Estado','Name':'Nombre','Phone':'Teléfono','Address':'Dirección','City':'Ciudad','State':'Estado',
  'ZIP':'Código postal','Notes':'Notas','Description':'Descripción','Date':'Fecha','Due Date':'Fecha límite','Amount':'Monto','Total':'Total',
  'Client':'Cliente','Case':'Caso','Lead':'Prospecto','Employee':'Empleado','Role':'Rol','Actions':'Acciones','Details':'Detalles',
  'Upload':'Subir','Download':'Descargar','Send':'Enviar','Resend':'Reenviar','Sign':'Firmar','Signed':'Firmado','Awaiting':'Pendiente de firma',
  'Welcome back':'Bienvenido de nuevo','Sign in':'Iniciar sesión','Signing in…':'Iniciando sesión…','EMAIL':'CORREO ELECTRÓNICO','PASSWORD':'CONTRASEÑA',
  'Secure office access':'Acceso seguro para el equipo','Secure practice access':'Acceso seguro para la firma',
  'Good morning':'Buenos días','Good afternoon':'Buenas tardes','Good evening':'Buenas noches',
}

const ES = { ...EN_ES, ...ES_LOCAL }
const EN = Object.fromEntries(Object.entries(ES).map(([k,v]) => [v,k]))

function translateExact(value, lang) {
  const map = lang === 'es' ? ES : EN
  if (map[value]) return map[value]

  // Preserve emoji/bullet prefixes used by dashboard section headers.
  for (const [from, to] of Object.entries(map)) {
    if (!value.endsWith(from) || value === from) continue
    const prefix = value.slice(0, value.length - from.length)
    if (/^[^A-Za-z0-9À-ÿ]*$/.test(prefix)) return `${prefix}${to}`
  }

  // Preserve trailing arrow affordances on dashboard buttons.
  const arrow = value.match(/^(.*?)(\s*[→↗])$/)
  if (arrow && map[arrow[1].trim()]) return `${map[arrow[1].trim()]}${arrow[2]}`

  return value
}

function translateTextNode(node, lang) {
  if (!node?.nodeValue || !node.parentElement) return
  const tag = node.parentElement.tagName
  if (['SCRIPT','STYLE','TEXTAREA','CODE','PRE'].includes(tag)) return
  const raw = node.nodeValue
  const trimmed = raw.trim()
  if (!trimmed) return
  const translated = translateExact(trimmed, lang)
  if (translated === trimmed) return
  const lead = raw.match(/^\s*/)?.[0] || ''
  const trail = raw.match(/\s*$/)?.[0] || ''
  node.nodeValue = `${lead}${translated}${trail}`
}

function translateElement(root, lang) {
  if (!root) return
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root, lang)
    return
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return
  const el = root.nodeType === Node.ELEMENT_NODE ? root : null
  if (el) {
    for (const attr of ['placeholder','title','aria-label']) {
      const v = el.getAttribute?.(attr)
      if (v) {
        const n = translateExact(v, lang)
        if (n !== v) el.setAttribute(attr, n)
      }
    }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) translateTextNode(n, lang)
}

function currentLang() {
  return getStoredLanguage()
}

function styleControls() {
  if (document.getElementById('taxres-global-ui-style')) return
  const s = document.createElement('style')
  s.id = 'taxres-global-ui-style'
  s.textContent = `
    #taxres-topbar-utilities{display:flex;align-items:center;gap:7px;flex-shrink:0}
    #taxres-topbar-utilities .taxres-support{height:34px;padding:0 10px;display:inline-flex;align-items:center;gap:5px;text-decoration:none;white-space:nowrap;font-size:12px;font-weight:800}
    #taxres-lang-pill{display:flex;align-items:center;background:var(--s2);border:1px solid var(--br);border-radius:8px;padding:2px;gap:1px}
    #taxres-lang-pill button{border:0;background:transparent;color:var(--t3);font-size:10px;font-weight:800;padding:4px 7px;border-radius:6px;cursor:pointer}
    #taxres-lang-pill button.active{background:var(--sf);color:var(--tx);box-shadow:0 1px 4px rgba(0,0,0,.2)}
    @media(max-width:900px){#taxres-topbar-utilities .support-word{display:none}}
  `
  document.head.appendChild(s)
}

function syncLoginToggle(lang) {
  if (window.location.pathname !== '/login') return
  const buttons = Array.from(document.querySelectorAll('button')).filter(b => ['EN','ES'].includes((b.textContent || '').trim()))
  const target = buttons.find(b => (b.textContent || '').trim() === lang.toUpperCase())
  const active = buttons.find(b => b.classList.contains('active'))
  if (target && target !== active) target.click()
}

function mountTopbar(lang, setLanguage) {
  const topbar = document.querySelector('.topbar')
  if (!topbar) return

  document.getElementById('romylabs-support-shortcut')?.remove()
  let wrap = document.getElementById('taxres-topbar-utilities')
  if (!wrap) {
    wrap = document.createElement('div')
    wrap.id = 'taxres-topbar-utilities'

    const support = document.createElement('a')
    support.className = 'btn taxres-support'
    support.href = '/support'
    support.setAttribute('aria-label', 'Submit a support ticket')
    support.innerHTML = '🎫 <span class="support-word">Support</span>'

    const pill = document.createElement('div')
    pill.id = 'taxres-lang-pill'
    pill.setAttribute('role', 'group')
    pill.setAttribute('aria-label', 'Language')
    for (const code of ['en','es']) {
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.lang = code
      b.textContent = code.toUpperCase()
      b.addEventListener('click', () => setLanguage(code))
      pill.appendChild(b)
    }
    wrap.append(support, pill)

    const newBtn = Array.from(topbar.querySelectorAll('button')).find(b => /\+ New|\+ Nuevo|✕ Close|✕ Cerrar/.test(b.textContent || ''))
    if (newBtn) topbar.insertBefore(wrap, newBtn)
    else topbar.appendChild(wrap)
  }

  const supportWord = wrap.querySelector('.support-word')
  if (supportWord) supportWord.textContent = lang === 'es' ? 'Soporte' : 'Support'
  wrap.querySelectorAll('[data-lang]').forEach(b => b.classList.toggle('active', b.dataset.lang === lang))
}

export default function GlobalUiBridge() {
  useEffect(() => {
    styleControls()
    // One canonical language source for the entire tax CRM. Older builds used
    // taxres-ui-language here while the rest of the product used tcr-language,
    // which allowed the shell and page content to disagree.
    try {
      const legacy = localStorage.getItem('taxres-ui-language')
      if (!localStorage.getItem('tcr-language') && (legacy === 'en' || legacy === 'es')) {
        storeLanguage(legacy)
      }
      localStorage.removeItem('taxres-ui-language')
    } catch (_) {}
    let lang = currentLang()
    let translating = false

    const apply = () => {
      if (translating) return
      translating = true
      document.documentElement.lang = lang === 'es' ? 'es' : 'en'
      translateElement(document.body, lang)
      mountTopbar(lang, setLanguage)
      syncLoginToggle(lang)
      translating = false
    }

    const setLanguage = next => {
      lang = next === 'es' ? 'es' : 'en'
      storeLanguage(lang)
      apply()
    }

    const clickCapture = e => {
      if (!e.isTrusted) return
      const b = e.target?.closest?.('button')
      if (!b) return
      const text = (b.textContent || '').trim()
      if (text !== 'EN' && text !== 'ES') return
      const parentText = (b.parentElement?.textContent || '').replace(/\s+/g,'').toUpperCase()
      if (parentText.includes('EN') && parentText.includes('ES')) setLanguage(text.toLowerCase())
    }

    const onLanguageChange = e => {
      const next = e?.detail?.language === 'es' ? 'es' : 'en'
      if (next === lang) return
      lang = next
      apply()
    }
    window.addEventListener('taxres-language-change', onLanguageChange)
    window.addEventListener('nashville-language-change', onLanguageChange)

    document.addEventListener('click', clickCapture, true)
    const observer = new MutationObserver(mutations => {
      if (translating) return
      translating = true
      for (const m of mutations) {
        m.addedNodes.forEach(n => translateElement(n, lang))
      }
      mountTopbar(lang, setLanguage)
      translating = false
    })
    observer.observe(document.body, { childList:true, subtree:true })
    const timer = setInterval(apply, 1000)
    apply()

    return () => {
      observer.disconnect()
      clearInterval(timer)
      document.removeEventListener('click', clickCapture, true)
      window.removeEventListener('taxres-language-change', onLanguageChange)
      window.removeEventListener('nashville-language-change', onLanguageChange)
      document.getElementById('taxres-topbar-utilities')?.remove()
    }
  }, [])

  return null
}
