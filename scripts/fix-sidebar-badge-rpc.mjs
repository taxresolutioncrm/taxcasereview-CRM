import fs from 'node:fs'

const path = 'src/components/layout/Sidebar.jsx'
const s = fs.readFileSync(path, 'utf8')

// The current Nashville/TaxRes sidebar uses one consolidated authenticated
// badge RPC and one Realtime channel per browser. Older repair logic created
// multiple independent loaders/channels and is intentionally retired.
const required = [
  "supabase.rpc('get_sidebar_badges_v2'",
  "sidebar-badges-",
  "tcr_sidebar_seen_leads",
  "tcr_sidebar_seen_clients",
  "tcr_sidebar_seen_cases",
]
for (const token of required) {
  if (!s.includes(token)) throw new Error(`Sidebar consolidated badge invariant missing: ${token}`)
}
const channelCount = (s.match(/supabase\.channel\(/g) || []).length
if (channelCount !== 1) throw new Error(`Sidebar must use exactly one Realtime channel; found ${channelCount}`)
console.log('Sidebar badge semantics current: one consolidated RPC + one Realtime channel.')
