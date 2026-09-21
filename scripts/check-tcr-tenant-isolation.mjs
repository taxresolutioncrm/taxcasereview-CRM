import fs from 'node:fs'

const read = p => fs.readFileSync(p, 'utf8')
const failures = []
const must = (ok, msg) => { if (!ok) failures.push(msg) }

const chat = read('src/pages/Chat.jsx')
const app = read('src/context/AppContext.jsx')
const sidebar = read('src/components/layout/Sidebar.jsx')
const migration = read('supabase/migrations/20260921211500_restore_employee_tenant_isolation.sql')
const ioMigration = read('supabase/migrations/20260920002500_taxres_disk_io_guardrails.sql')
const reports = read('src/pages/Reports.jsx')
const employees = read('src/pages/Employees.jsx')

must(chat.includes("const { user, role, myTenantId } = useApp()"), 'Chat must resolve the active tenant from AppContext')
must(chat.includes("const chatTenantId = myTenantId || null"), 'Chat must fail closed instead of deriving tenant from messages/branding')
must(chat.includes(".from('employees').select('id, name, role, avatar_url, email').eq('tenant_id', myTenantId)"), 'Chat employee roster must be tenant-scoped')
must(chat.includes(".from('chat_channels').select('*').eq('tenant_id', myTenantId)"), 'Chat channels must be tenant-scoped')
must(chat.includes(".from('chat_messages').select('*').eq('tenant_id', myTenantId)"), 'Chat message reads must be tenant-scoped')
must(chat.includes("const payload = { tenant_id: myTenantId, channel: channelId"), 'Chat message writes must carry tenant_id')
must(chat.includes("tenant_id: chatTenantId, channel: channelId"), 'Chat attachment messages must carry tenant_id')
must(chat.includes("payload?.new?.tenant_id !== myTenantId"), 'Active-chat realtime must reject foreign-tenant messages')
must(!chat.includes("tenant_id: undefined // DB default fills this via current_tenant_id()"), 'Chat channel writes must not rely on an implicit tenant default')

must(app.includes("payload?.new?.tenant_id !== myTenantId"), 'Global realtime notifications must reject foreign-tenant rows')
must(app.includes("await supabase.rpc('set_admin_tenant_override', { p_tenant_id: null })"), 'Normal startup must clear stale database tenant overrides')
must(app.includes("supabase.rpc('set_admin_tenant_override', { p_tenant_id: null })"), 'Normal sign-in must clear stale database tenant overrides')
must(sidebar.includes(".eq('tenant_id', myTenantId)"), 'Sidebar unread chat query must be tenant-scoped')
must(sidebar.includes("payload.new?.tenant_id === myTenantId"), 'Sidebar realtime badge must reject foreign-tenant rows')
must(reports.includes("bookwhip-scroll"), 'TCR Book Whip must keep Nashville-style horizontal scroll treatment')
must(reports.includes("bookWhipMonths.map"), 'TCR Book Whip must expose available monthly snapshots')
must(!reports.includes("Nashville_Book_Whip_"), 'TCR Book Whip export must remain office-neutral')
must(employees.includes("gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))'"), 'Employee cards must use the widened responsive layout')

must(/create policy hide_qa_certification_employees_from_staff[\s\S]*?as restrictive[\s\S]*?for select/i.test(ioMigration),
  'I/O migration must not recreate employee visibility policy as PERMISSIVE')
must(/create policy hide_qa_certification_employees_from_staff[\s\S]*?as restrictive[\s\S]*?for select/i.test(migration),
  'Employee QA visibility policy must remain RESTRICTIVE')
must(/policyname='hide_qa_certification_employees_from_staff'[\s\S]*?RESTRICTIVE/i.test(migration),
  'Employee isolation migration must self-verify the policy mode')

if (failures.length) {
  console.error('TCR tenant-isolation guard FAILED:')
  failures.forEach(f => console.error(' - ' + f))
  process.exit(1)
}
console.log('✓ TCR tenant-isolation guard: Team Chat, realtime, sidebar and employee RLS are fail-closed')
