export function parseYearSpec(spec) {
  const out = new Set()
  if (!spec) return out
  const s = String(spec)
  const ranges = s.match(/((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})/g) || []
  for (const r of ranges) {
    const [a, b] = r.match(/(?:19|20)\d{2}/g).map(Number)
    for (let y = Math.min(a, b); y <= Math.max(a, b); y++) out.add(String(y))
  }
  const rest = s.replace(/((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})/g, ' ')
  for (const m of rest.match(/(?:19|20)\d{2}/g) || []) out.add(m)
  return out
}

function typeKey(v) {
  let x = String(v || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (x === 'tax return transcript') x = 'return transcript'
  if (x === 'wage income') x = 'wage and income'
  if (x === 'wage income transcript') x = 'wage and income transcript'
  return x
}

function sameTranscriptType(a, b) {
  const x = typeKey(a), y = typeKey(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

export function requestCoverageSatisfied(req, rows) {
  const wantedYears = parseYearSpec(req?.tax_years)
  const wantedTypes = (req?.transcript_types || []).filter(Boolean)
  const have = rows || []
  if (wantedYears.size === 0 && wantedTypes.length === 0) return have.length > 0
  if (wantedYears.size > 0 && wantedTypes.length > 0) {
    return [...wantedYears].every(year => wantedTypes.every(type => have.some(r => String(r.tax_year || '') === year && sameTranscriptType(r.transcript_type, type))))
  }
  if (wantedYears.size > 0) return [...wantedYears].every(year => have.some(r => String(r.tax_year || '') === year))
  return wantedTypes.every(type => have.some(r => sameTranscriptType(r.transcript_type, type)))
}
