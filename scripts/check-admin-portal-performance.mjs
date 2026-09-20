import fs from 'node:fs'

const source = fs.readFileSync('src/pages/AdminPortal.jsx', 'utf8')
const failures = []

const requireMarker = (marker, label) => {
  if (!source.includes(marker)) failures.push(label)
}
const forbidMarker = (marker, label) => {
  if (source.includes(marker)) failures.push(label)
}

requireMarker('const PLATFORM_OFFICE_CACHE_MS = 20000', 'Overview office data cache is missing')
requireMarker("const metricsTimeout = (promise, label, ms = 4000)", 'Remote metrics timeout is missing')
requireMarker('void Promise.allSettled(registrySyncJobs.map(job => job.promise))', 'Registry synchronization still blocks Overview rendering')
requireMarker("const prospectsPromise = supabase.from('prospects')", 'Command Center prospect query is not started in parallel')
requireMarker("withTimeout(prospectsPromise, 'prospects')", 'Command Center prospect query is not part of the parallel load')
requireMarker("const [emailMounted, setEmailMounted]", 'Lazy SnappyMail mount state is missing')
requireMarker('{emailMounted && <div style={{', 'SnappyMail iframe is not lazy-mounted')
requireMarker("client_count:null", 'Registry fallback must not fabricate client counts when live usage is unavailable')
requireMarker("lead_count:null", 'Registry fallback must not fabricate lead counts when live usage is unavailable')
requireMarker("storage_bytes:null", 'Registry fallback must not fabricate storage usage when live usage is unavailable')
requireMarker("r.storage_bytes == null ? '—' : fmtBytes(r.storage_bytes)", 'Overview must render unknown storage as unavailable, not zero')
forbidMarker("const prospectsRes = await supabase.from('prospects')", 'Command Center prospects are still serial')
forbidMarker('const registrySyncResults = await Promise.all(registrySyncJobs.map(job => job.promise))', 'Registry writes are still on the Overview critical path')

if (failures.length) {
  console.error('Admin Portal performance guard FAILED')
  for (const failure of failures) console.error('- ' + failure)
  process.exit(1)
}

console.log('PASS Admin Portal performance guard')
