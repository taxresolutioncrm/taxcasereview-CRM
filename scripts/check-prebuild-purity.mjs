import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync('package.json','utf8'))
const prebuild = String(pkg.scripts?.prebuild || '')
const tasks = prebuild.split('&&').map(s => s.trim()).filter(Boolean)

const forbiddenTasks = [
  'manual:style',
  'storage:fix-display',
  'email:state-sync',
  'email:count-sync',
  'sidebar:badge-rpc',
  'forms:state-esign-prefill',
  'forms:irs-current',
  'reports:accuracy',
  'accounting:oauth-state',
  'cases:modal-scope',
  'ui:quick-create',
  'perf:refresh'
]

const failures = []
for (const task of forbiddenTasks) {
  if (tasks.includes('npm run ' + task)) failures.push('prebuild must not execute source mutator: ' + task)
}

if (!tasks.includes('npm run source:verify-current')) {
  failures.push('prebuild must verify the tracked source is clean')
}

if (failures.length) {
  console.error('Prebuild purity contract failed:')
  failures.forEach(x => console.error(' - ' + x))
  process.exit(1)
}

console.log('PASS  prebuild is verification-only; source repair scripts are not executed during build')
