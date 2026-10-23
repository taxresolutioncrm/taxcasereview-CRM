const fs=require('fs');const assert=require('assert');
const d=fs.readFileSync('src/pages/Dashboard.jsx','utf8');
assert(d.includes("const TCR_TENANT_ID = '61a89aef-0e7e-4ea2-b222-44ab2024655a'"),'TCR tenant guard missing');
assert(d.includes("FIRM.tenantId === TCR_TENANT_ID"),'TCR-specific lead scope missing');
assert(d.includes("supabase.from('leads').select('*')).is('deleted_at', null)"),'TCR deleted lead filter missing');
assert(d.includes("FIRM.tenantId === NASHVILLE_TENANT_ID"),'Nashville snapshot branch must remain intact');
assert(d.includes("openLeads: (leads || []).filter(l => !['Converted to Client', 'Dead', 'Do Not Contact'].includes(l.status)).length"),'Open Leads calculation changed unexpectedly');
console.log('PASS TCR dashboard reporting accuracy guard');
