import { Link, useParams } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { useOfficeWorkspace } from '../hooks/useOfficeDepartments'
import { ALL_DEPARTMENTS, DEPARTMENT_HOME_PATHS, isRouteInDepartments } from '../lib/departmentWorkspaces'

// Each department gets a real landing page rather than an empty menu.
// Links lead to existing, permission-checked application routes. These cards
// never imply a database metric, filing, payment or payroll action happened.
const DEPARTMENTS = {
  resolution:{
    title:'Tax Resolution',icon:'⚖️',intro:'IRS and state representation, client cases, deadlines, and required documents—one focused starting point.',
    primary:{title:'Open Resolution Cases',path:'/cases'},
    actions:[
      {title:'Resolution Cases',desc:'Review active IRS and state matters',path:'/cases',icon:'📁'},
      {title:'Deadlines',desc:'Stay on top of response dates and case tasks',path:'/deadlines',icon:'📅'},
      {title:'IRS Forms & Docs',desc:'Prepare and track IRS documents',path:'/irsforms',icon:'📄'},
      {title:'State Forms & Docs',desc:'Work on state tax matters',path:'/stateforms',icon:'🏛️'},
      {title:'IRS TDS / SOR Portal',desc:'Access authorized transcript workflows',path:'/irsportal',icon:'🔎'},
    ],
  },
  preparation:{
    title:'Tax Preparation',icon:'🧾',intro:'Keep tax returns, client information, supporting documents, and preparation follow-ups together.',
    primary:{title:'Open Tax Returns',path:'/taxreturns'},
    actions:[
      {title:'Tax Returns',desc:'Open return preparation workflows',path:'/taxreturns',icon:'🧾'},
      {title:'Clients',desc:'Find a taxpayer and their documents',path:'/clients',icon:'👥'},
      {title:'Documents',desc:'Review and manage tax records',path:'/documents',icon:'📂'},
      {title:'Tasks',desc:'Follow up on preparation work',path:'/tasks',icon:'✅'},
      {title:'Calendar',desc:'Plan appointments and key dates',path:'/calendar',icon:'📅'},
    ],
  },
  bookkeeping:{
    title:'Bookkeeping & Accounting',icon:'📚',intro:'Organize your client books, accounting work, invoices, and recurring office responsibilities.',
    primary:{title:'Open Books & Ledger',path:'/books'},
    actions:[
      {title:'Books & Ledger',desc:'Work with client bookkeeping records',path:'/books',icon:'📚'},
      {title:'Clients',desc:'Open business and accounting profiles',path:'/clients',icon:'👥'},
      {title:'Invoices',desc:'Manage invoices and client charges',path:'/invoices',icon:'🧾'},
      {title:'Payments',desc:'Review recorded client payments',path:'/payments',icon:'💳'},
      {title:'Tasks',desc:'Keep recurring client work moving',path:'/tasks',icon:'✅'},
    ],
  },
  formation:{
    title:'Business Formation',icon:'🏢',intro:'Business entity setup, client information, filing preparation, and follow-up through FormaCorp.',
    primary:{title:'Open FormaCorp',path:'/formacorp'},
    actions:[
      {title:'FormaCorp',desc:'Prepare and track business formation work',path:'/formacorp',icon:'🏢'},
      {title:'Clients',desc:'Keep entity details on the business profile',path:'/clients',icon:'👥'},
      {title:'Documents',desc:'Organize formation paperwork',path:'/documents',icon:'📂'},
      {title:'Tasks',desc:'Follow up on state filing steps',path:'/tasks',icon:'✅'},
      {title:'E-Signatures',desc:'Send documents for approved signatures',path:'/esign',icon:'✍️'},
    ],
  },
  hr:{
    title:'HR & Payroll',icon:'🕒',intro:'An organized place for employee timekeeping, leave, and payroll workflows. Attendance is separate from billable client work.',
    primary:{title:'Open Employee Directory',path:'/employees'},
    actions:[
      {title:'Employees',desc:'Manage staff records and office permissions',path:'/employees',icon:'👥'},
      {title:'Time Clock',desc:'Record employee work hours',path:'/timeclock',icon:'🕒'},
      {title:'Time Kiosk',desc:'Employee timekeeping access',path:'/kiosk',icon:'📲'},
      {title:'Time Off',desc:'Review and manage PTO workflows',path:'/timeoff',icon:'🌴'},
      {title:'Payroll',desc:'Prepare payroll through authorized workflows',path:'/payroll',icon:'💵'},
      {title:'Activity Report',desc:'Review staff activity',path:'/activity-report',icon:'📈'},
    ],
  },
}

export default function DepartmentHome() {
  const { department } = useParams()
  const { myTenantId, can, employeeName } = useApp()
  const { departments, hrFeatures } = useOfficeWorkspace(myTenantId)
  const config=DEPARTMENTS[department]
  if(!config || !ALL_DEPARTMENTS.includes(department))return <section style={{padding:26,color:'var(--tx)'}}>Department not found. <Link to="/">Back to Office Overview</Link></section>
  if(!departments.includes(department))return <section role="status" style={{padding:26,color:'var(--tx)'}}>This department isn't enabled for this office. <Link to="/">Back to Office Overview</Link></section>
  const visible=config.actions.filter(action=>isRouteInDepartments(action.path,departments,hrFeatures))
  const primary=visible.find(x=>x.path===config.primary.path) || visible[0]
  const others=ALL_DEPARTMENTS.filter(key=>key!==department && departments.includes(key))
  return <div style={{maxWidth:1150,margin:'0 auto',padding:'clamp(12px,2vw,28px)',color:'var(--tx)'}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap',marginBottom:19}}>
      <Link to="/" style={{fontSize:12,color:'var(--t2)',textDecoration:'none'}}>← Office Overview</Link>
      <span style={{fontSize:11,color:'var(--t2)'}}>Your office workspace · {department==='hr'?'Time & people operations':'Focused department'}</span>
    </div>
    <header style={{padding:'clamp(22px,3vw,34px)',background:'var(--s2)',border:'1px solid var(--br)',borderRadius:16,marginBottom:24}}>
      <div style={{fontSize:11,fontWeight:750,letterSpacing:'.08em',color:'var(--t2)',marginBottom:13}}>DEPARTMENT HOME</div>
      <h1 style={{fontSize:'clamp(25px,2.8vw,36px)',letterSpacing:'-.035em',lineHeight:1.18,margin:'0 0 12px',color:'var(--tx)'}}>{config.icon} {config.title}</h1>
      <p style={{fontSize:14,lineHeight:1.75,color:'var(--t2)',maxWidth:740,margin:'0 0 20px'}}>{config.intro}</p>
      {primary && <Link className="btn pri" to={primary.path} style={{display:'inline-flex',textDecoration:'none',alignItems:'center',gap:8}}>{config.primary.path===primary.path?config.primary.title:primary.title} →</Link>}
    </header>
    <h2 style={{fontSize:18,margin:'0 0 14px',color:'var(--tx)'}}>Your daily tools</h2>
    {visible.length ? <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(215px,1fr))',gap:12}}>
      {visible.map(item=><Link key={item.path} to={item.path} style={{display:'flex',flexDirection:'column',gap:9,minHeight:134,padding:19,border:'1px solid var(--br)',background:'var(--s2)',borderRadius:12,color:'var(--tx)',textDecoration:'none'}}>
        <span style={{fontSize:23}} aria-hidden="true">{item.icon}</span>
        <strong style={{fontSize:14}}>{item.title} →</strong>
        <span style={{fontSize:12,lineHeight:1.5,color:'var(--t2)'}}>{item.desc}</span>
      </Link>)}
    </div> : <p style={{color:'var(--t2)'}}>No department tools are enabled for your current access. Contact your office administrator.</p>}
    {department==='hr' && <p style={{color:'var(--t2)',fontSize:12,lineHeight:1.65,marginTop:20}}>Time Tracking and Payroll Processing are independently controlled by your platform administrator. The employee directory stays under shared office administration.</p>}
    {others.length>0 && <section style={{marginTop:30,paddingTop:20,borderTop:'1px solid var(--br)'}}>
      <h2 style={{fontSize:15,margin:'0 0 12px',color:'var(--tx)'}}>Switch department</h2>
      <div style={{display:'flex',flexWrap:'wrap',gap:9}}>{others.map(key=><Link key={key} className="btn" to={DEPARTMENT_HOME_PATHS[key]} style={{textDecoration:'none',fontSize:12}}>{DEPARTMENTS[key].icon} {DEPARTMENTS[key].title}</Link>)}</div>
    </section>}
  </div>
}
