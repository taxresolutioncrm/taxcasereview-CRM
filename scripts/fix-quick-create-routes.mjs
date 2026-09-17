import fs from 'node:fs'

function patch(path, mutate) {
  const raw = fs.readFileSync(path, 'utf8')
  const before = raw.replace(/\r\n/g, '\n')
  const after = mutate(before)
  if (after === before) {
    console.log(`quick-create: ${path} already patched or no-op`)
  } else {
    fs.writeFileSync(path, after)
    console.log(`quick-create: patched ${path}`)
  }
}

function insertBeforeFirstEffect(s, inject, label) {
  const re = /(^|\n)(\s*)useEffect\s*\(\s*\(\)\s*=>\s*\{/m
  const m = re.exec(s)
  if (!m) throw new Error(`${label} quick-create effect anchor not found`)
  const pos = m.index + (m[1] ? m[1].length : 0)
  return s.slice(0, pos) + inject + s.slice(pos)
}

patch('src/components/layout/TopBar.jsx', s => {
  // /transcripts is a redirect to /irsportal, so New Transcript must target
  // the real page or the ?new=1 intent is lost during navigation.
  s = s.replace(
    "{ icon: '📝', label: 'New Transcript', sub: 'Add transcript',        path: '/transcripts', color: '#14b8a6' },",
    "{ icon: '📝', label: 'New Transcript', sub: 'Pull or add transcript', path: '/irsportal',   color: '#14b8a6' },"
  )

  return s.replace(/const MODAL_PATHS\s*=\s*new Set\(\[([^\]]*)\]\)/, (full, body) => {
    const needed = ['/formacorp','/books','/transcripts','/irsportal'].filter(p => !body.includes(`'${p}'`))
    if (!needed.length) return full
    const trimmed = body.trim().replace(/,\s*$/, '')
    return `const MODAL_PATHS = new Set([${trimmed}${trimmed ? ',' : ''}${needed.map(p=>`'${p}'`).join(',')}])`
  })
})

patch('src/pages/Fax.jsx', s => {
  if (s.includes("qp.get('new') === '1'")) return s
  const inject = "  useEffect(() => {\n    if (qp.get('new') === '1') {\n      setForm(prev => ({ ...BLANK, from_number: prev.from_number || '', client_name: qp.get('client') || '', to_number: (qp.get('phone') || '').replace(/\\D/g,'') }))\n      setFile(null)\n      setModal(true)\n    }\n  }, [location.search])\n\n"
  const loadEffect = /(^|\n)(\s*)useEffect\s*\(\s*\(\)\s*=>\s*\{\s*\n?\s*load\(\)/m
  const m = loadEffect.exec(s)
  if (m) {
    const pos = m.index + (m[1] ? m[1].length : 0)
    return s.slice(0,pos) + inject + s.slice(pos)
  }
  return insertBeforeFirstEffect(s, inject, 'Fax')
})

// Keep the legacy Transcripts page quick-create capable for direct links,
// even though the global New action now correctly targets IRS Portal.
patch('src/pages/Transcripts.jsx', s => {
  if (!s.includes("from 'react-router-dom'")) {
    s = s.replace(/import \{ useState, useEffect \} from 'react'\s*\n/, "import { useState, useEffect } from 'react'\nimport { useLocation } from 'react-router-dom'\n")
  }
  if (!s.includes('const location = useLocation()')) {
    s = s.replace(/export default function Transcripts\(\)\s*\{\s*\n/, 'export default function Transcripts() {\n  const location = useLocation()\n')
  }
  if (!s.includes("new URLSearchParams(location.search).get('new') === '1'")) {
    const inject = "  useEffect(() => {\n    if (new URLSearchParams(location.search).get('new') === '1') {\n      setForm(BLANK)\n      setEditId(null)\n      setModal(true)\n    }\n  }, [location.search])\n\n"
    s = insertBeforeFirstEffect(s, inject, 'Transcripts')
  }
  return s
})

patch('src/pages/IRSPortal.jsx', s => {
  if (!s.includes("from 'react-router-dom'")) {
    s = s.replace(/import \{ useState, useEffect \} from 'react'\s*\n/, "import { useState, useEffect } from 'react'\nimport { useLocation } from 'react-router-dom'\n")
  }
  if (!s.includes('const location = useLocation()')) {
    s = s.replace(/export default function IRSPortal\(\)\s*\{\s*\n/, 'export default function IRSPortal() {\n  const location = useLocation()\n')
  }
  if (!s.includes("new URLSearchParams(location.search).get('new') === '1'")) {
    const anchor = "  const [tab, setTab] = useState('transcripts')\n"
    if (!s.includes(anchor)) throw new Error('IRS Portal quick-create tab anchor not found')
    s = s.replace(anchor, anchor + "  useEffect(() => {\n    if (new URLSearchParams(location.search).get('new') === '1') setTab('pull')\n  }, [location.search])\n")
  }
  return s
})

patch('src/pages/Books.jsx', s => {
  if (s.includes("params.get('new') === '1'")) return s
  const inject = "  useEffect(() => {\n    if (params.get('new') === '1') setShowForm(true)\n  }, [location.search])\n\n"
  return insertBeforeFirstEffect(s, inject, 'Books')
})

// FormaCorp now has a thin shared wrapper plus the preserved legacy tracker.
// Keep the quick-create contract on the legacy tracker because it owns the
// original new-formation modal and state.
patch('src/pages/FormaCorpLegacy.jsx', s => {
  if (!s.includes("from 'react-router-dom'")) {
    s = s.replace(/import \{ useState, useEffect, useRef \} from 'react'\s*\n/, "import { useState, useEffect, useRef } from 'react'\nimport { useLocation } from 'react-router-dom'\n")
  }
  if (!s.includes('const location = useLocation()')) {
    s = s.replace(/export default function FormaCorp\(\)\s*\{\s*\n(\s*const \{ showToast \} = useApp\(\)\s*\n)?/, m => m + '  const location = useLocation()\n')
  }
  if (!s.includes("new URLSearchParams(location.search).get('new') === '1'")) {
    const inject = "  useEffect(() => {\n    if (new URLSearchParams(location.search).get('new') === '1') {\n      setDetail(null)\n      setForm(BLANK)\n      setModal('new')\n    }\n  }, [location.search])\n\n"
    s = insertBeforeFirstEffect(s, inject, 'FormaCorp')
  }
  return s
})

const assertions = [
  ['src/components/layout/TopBar.jsx', ["path: '/irsportal'", '/formacorp','/books','/irsportal']],
  ['src/pages/Fax.jsx', ["qp.get('new') === '1'"]],
  ['src/pages/Transcripts.jsx', ["get('new') === '1'", 'const location = useLocation()']],
  ['src/pages/IRSPortal.jsx', ["get('new') === '1'", "setTab('pull')", 'const location = useLocation()']],
  ['src/pages/Books.jsx', ["params.get('new') === '1'"]],
  ['src/pages/FormaCorpLegacy.jsx', ["get('new') === '1'", 'const location = useLocation()']],
]
for (const [path, needles] of assertions) {
  const text = fs.readFileSync(path, 'utf8')
  for (const needle of needles) if (!text.includes(needle)) throw new Error(`quick-create verification failed: ${path} missing ${needle}`)
}
console.log('quick-create: all global New routes verified')
