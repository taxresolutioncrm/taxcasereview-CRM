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
forbidMarker("const prospectsRes = await supabase.from('prospects')", 'Command Center prospects are still serial')
forbidMarker('const registrySyncResults = await Promise.all(registrySyncJobs.map(job => job.promise))', 'Registry writes are still on the Overview critical path')

if (failures.length) {
  console.error('Admin Portal performance guard FAILED')
  for (const failure of failures) console.error('- ' + failure)
  process.exit(1)
}

console.log('PASS Admin Portal performance guard')
console.log('PASS Overview remote metrics are bounded and cached')
console.log('PASS office registry sync is off the render critical path')
console.log('PASS Command Center starts independent queries concurrently')
console.log('PASS SnappyMail does not boot until Email is first visited')
