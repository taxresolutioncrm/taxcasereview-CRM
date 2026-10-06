import fs from 'node:fs'

const migration = fs.readFileSync('supabase/migrations/20261006193000_lock_down_fantasy_public_tables.sql','utf8')
const fail = m => { console.error('FANTASY PUBLIC RLS REGRESSION:', m); process.exit(1) }

for (const table of ['fantasy_bridge_probe','fantasy_league_meta','fantasy_live_snapshots']) {
  if (!migration.includes(`alter table public.${table} enable row level security;`)) fail(`${table} is missing RLS enablement`)
  if (!migration.includes(`revoke all privileges on table public.${table} from anon, authenticated;`)) fail(`${table} is missing anon/authenticated privilege revocation`)
}

console.log('PASS: fantasy integration tables are locked behind RLS and have no anon/authenticated table grants.')
