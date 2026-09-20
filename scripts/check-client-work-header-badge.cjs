const fs=require('fs')
const sidebar=fs.readFileSync('src/components/layout/Sidebar.jsx','utf8')

const checks=[
  ['Client Work header never shows aggregate badge',
    sidebar.includes("section.key !== 'clientwork'")],
  ['child notification badges remain enabled',
    sidebar.includes("BADGE_COUNTS[item.badge]") && sidebar.includes("item.badge")],
  ['Client Work child routes keep their own badges',
    ["badge: 'leads'","badge: 'clients'","badge: 'cases'","badge: 'deadlines'"].every(x=>sidebar.includes(x))],
  ['other collapsed groups can still show aggregate attention badges',
    sidebar.includes("sectionNeedsAttention && <span className=\"nav-badge\">{sectionAlertCount}</span>")],
]
let failed=0
for(const [name,ok] of checks){
  console.log(`${ok?'PASS':'FAIL'}  ${name}`)
  if(!ok) failed++
}
if(failed) process.exit(1)
console.log('PASS  Client Work header badge behavior')
