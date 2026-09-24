const fs = require('fs')

const src = fs.readFileSync('src/pages/Leads.jsx', 'utf8')
const failures = []

function need(text, msg) {
  if (!src.includes(text)) failures.push(msg)
}

need("if (status === 'Converted to Client') {\n      await convertToClient(l)", 'Converted status must route through convertToClient')
need("STATUSES.filter(s=>s!=='Converted to Client')", 'Generic lead editor must not offer Converted to Client as a normal status')
need("if (modal === 'edit' && form.status === 'Converted to Client')", 'Generic lead save must guard converted status')
need("if (Array.isArray(l.services)) return l.services", 'Lead services must be normalized to an array before client insert')
need("navigate('/clients/' + newClient.id)", 'Successful conversion must navigate to the new client record')
need("await supabase.from('leads').update({ status: 'Converted to Client' }).eq('id', l.id)", 'Lead status may only be marked converted from conversion path')
need("{['All',...STATUSES].map(s => (", 'Converted status must remain inspectable from Leads filters')

if (failures.length) {
  console.error('Lead conversion invariant check FAILED:')
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log('Lead conversion invariant check PASS')
