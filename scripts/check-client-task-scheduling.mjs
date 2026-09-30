import fs from 'node:fs'

const source = fs.readFileSync('src/pages/Clients.jsx', 'utf8')
const fail = msg => { console.error('CLIENT TASK SCHEDULING REGRESSION:', msg); process.exit(1) }

const required = [
  "const [taskAssignedTo, setTaskAssignedTo] = useState('')",
  "const [taskStatusValue, setTaskStatusValue] = useState('')",
  "const [taskNotes, setTaskNotes] = useState('')",
  "assignedTo:taskAssignedTo||null",
  "dueDate:taskDueDate||null",
  "status_category",
  "status_label",
  "notes:taskNotes.trim()||null",
  "Disposition / Status",
  "Assigned To",
  "Schedule Task",
]

for (const needle of required) {
  if (!source.includes(needle)) fail('Missing required client task scheduling control: ' + needle)
}

const quickStart = source.indexOf('async function addQuickTask()')
const quickEnd = source.indexOf('async function addClientNote', quickStart)
if (quickStart < 0 || quickEnd < 0) fail('Could not inspect quick-add flow.')
const quickBody = source.slice(quickStart, quickEnd)
if (quickBody.includes("supabase.from('tasks').insert")) {
  fail('Quick-add bypasses the scheduling form and creates incomplete tasks.')
}
if (!quickBody.includes('openTaskComposer')) {
  fail('Quick-add does not route through the full scheduling form.')
}

console.log('PASS: client-file task creation requires full scheduling details.')
