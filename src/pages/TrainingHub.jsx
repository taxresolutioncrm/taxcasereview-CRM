import { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import LiveTraining from './Training'
import { FIRM } from '../lib/firmBranding'

const LESSONS = [
  { id:'orientation', title:'Getting started in CRM', area:'Basics', minutes:4, path:'/dashboard',
    steps:['Sign in using your own CRM employee account.','Open the dashboard and review your assigned work.','Use the left navigation to find Clients, Tasks, Documents, and Communications.','For detailed reference instructions, open the CRM Manual.'],
    question:'Which account should you use for CRM CRM?', options:['A coworker\'s login','Your own employee account','A shared administrator account'], correct:1 },
  { id:'clients', title:'Find and review a client', area:'Clients', minutes:5, path:'/clients',
    steps:['Open Clients and search for the client by name.','Open the correct record and check the client information and assigned team.','Review the Notes, Documents, and Cases areas as needed.','Only change client information when you are authorized to do so.'],
    question:'What should you check before changing a client record?', options:['That it is the correct client','Only the client\'s first name','Nothing'], correct:0 },
  { id:'newclient', title:'Create and verify a new client file', area:'Clients', minutes:6, path:'/clients',
    steps:['Open Clients and choose Add Client.','Enter the required information carefully. The Client Since field defaults to today but remains editable.','Save the client once and make sure there is no error.','Reopen the file and confirm address, ZIP, DOB, and other entered values persisted.','Never create duplicate records when a save looks uncertain; report the error.'],
    question:'What should you do after saving a new client?', options:['Assume every field saved','Reopen and verify the information','Create a second copy'], correct:1 },
  { id:'notes', title:'Add and find client notes', area:'Clients', minutes:4, path:'/clients',
    steps:['Open the correct client record.','Select Notes; the Add Note area appears above the note history.','Write a clear factual note and check visibility settings before saving.','Save, then verify the note appears in the history.'],
    question:'Before saving a note, what should you review?', options:['Client and visibility settings','The color theme','Other employees\' passwords'], correct:0 },
  { id:'tasks', title:'Manage assigned tasks', area:'Daily work', minutes:4, path:'/tasks',
    steps:['Open Tasks and review work assigned to you.','Check due dates and task details before acting.','Update task progress as work is completed.','Avoid changing another employee\'s assigned tasks without authorization.'],
    question:'Which tasks should you prioritize?', options:['Only the oldest tasks','Assigned work and due dates','Random tasks'], correct:1 },
  { id:'documents', title:'Work with client documents', area:'Daily work', minutes:5, path:'/clients',
    steps:['Open the correct client record and locate Documents.','Review the document name and client before uploading.','Upload only authorized documents to the proper client file.','Open the document preview to verify it is legible and correctly filed.'],
    question:'After uploading a document, what should you verify?', options:['That it exists in the correct client file','That the page refreshed','Nothing'], correct:0 },
  { id:'communications', title:'Email, fax, and communication basics', area:'Communication', minutes:5, path:'/email',
    steps:['Choose the correct communication module in the navigation.','Verify the recipient and client association before sending.','Review templates and attachments, especially sensitive tax information.','Confirm success or any error in the application; never assume a failed send succeeded.'],
    question:'What is essential before sending a client communication?', options:['Verify recipient and attachments','Skip reviewing the message','Use any available client'], correct:0 },
  { id:'training', title:'Live training and recordings', area:'Basics', minutes:3, path:'/training',
    steps:['This Learning Center contains self-paced lessons and knowledge checks.','Switch to Live Sessions to host or join a screen-share training session.','A host can start a live session and share the invitation link.','Use the Recordings tab in Live Sessions to review recordings that have been saved.'],
    question:'What is the difference between Learn and Live Sessions?', options:['They are identical','Learn has guided lessons; Live Sessions supports screen sharing','Learn changes client permissions'], correct:1 },
]
const doneKey = (name, firm) => 'taxres-family-learning-v1:' + (firm || 'office') + ':' + (name || 'employee').toLowerCase().trim()
export default function TrainingHub() {
  const { employeeName } = useApp()
  const [view,setView] = useState('learn')
  const [active,setActive] = useState(LESSONS[0].id)
  const [answers,setAnswers] = useState({})
  const [completed,setCompleted] = useState([])
  useEffect(() => {
    try { setCompleted(JSON.parse(localStorage.getItem(doneKey(employeeName, FIRM.tenantId)) || '[]')) }
    catch { setCompleted([]) }
  },[employeeName])
  const lesson=LESSONS.find(x=>x.id===active) || LESSONS[0]
  const success=answers[lesson.id] === lesson.correct
  const markDone=() => {
    if (!success) return
    const next=Array.from(new Set([...completed,lesson.id]))
    setCompleted(next)
    try { localStorage.setItem(doneKey(employeeName, FIRM.tenantId),JSON.stringify(next)) } catch {}
  }
  const card={background:'var(--s1)',border:'1px solid var(--br)',borderRadius:12,padding:18}
  const button={padding:'9px 14px',borderRadius:8,border:'1px solid var(--br)',background:'var(--s2)',color:'var(--tx)',cursor:'pointer'}
  return <div style={{padding:'24px 28px',maxWidth:1120,margin:'0 auto',color:'var(--tx)'}}>
    <header style={{marginBottom:20}}>
      <h1 style={{fontSize:25,margin:'0 0 6px'}}>🎓 Training Center</h1>
      <p style={{color:'var(--t3)',margin:0}}>Learn the CRM at your own pace or conduct a live screen-sharing session.</p>
    </header>
    <div style={{display:'flex',gap:10,marginBottom:20,flexWrap:'wrap'}}>
      <button style={{...button,background:view==='learn'?'#1d4ed8':'var(--s2)',color:view==='learn'?'white':'var(--tx)'}} onClick={()=>setView('learn')}>📚 Learn the CRM</button>
      <button style={{...button,background:view==='live'?'#1d4ed8':'var(--s2)',color:view==='live'?'white':'var(--tx)'}} onClick={()=>setView('live')}>🖥️ Live Sessions & Recordings</button>
      <a href="/manual" style={{...button,textDecoration:'none'}}>📖 CRM Manual</a>
    </div>
    {view==='live'?<LiveTraining/>:<>
      <div style={{...card,marginBottom:18}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <div><strong>Your learning progress</strong><div style={{fontSize:12,color:'var(--t3)',marginTop:4}}>Saved in this browser for your employee profile</div></div>
          <strong>{completed.filter(id=>LESSONS.some(l=>l.id===id)).length} of {LESSONS.length} lessons</strong>
        </div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={LESSONS.length} aria-valuenow={completed.length} style={{background:'var(--s2)',height:9,borderRadius:8,marginTop:12,overflow:'hidden'}}><div style={{height:'100%',width:`${100*completed.length/LESSONS.length}%`,background:'#2563eb'}}/></div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:18,alignItems:'start'}}>
        <nav aria-label="Training lessons" style={card}>
          <h2 style={{fontSize:16,margin:'0 0 12px'}}>Learning modules</h2>
          {LESSONS.map(l=><button key={l.id} onClick={()=>setActive(l.id)} style={{...button,width:'100%',textAlign:'left',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:8,borderColor:active===l.id?'#2563eb':'var(--br)',background:active===l.id?'rgba(37,99,235,.12)':'var(--s2)'}}>
            <span><strong style={{display:'block',fontSize:13}}>{l.title}</strong><small style={{color:'var(--t3)'}}>{l.area} · {l.minutes} min</small></span>
            <span aria-label={completed.includes(l.id)?'Completed':'Not completed'}>{completed.includes(l.id)?'✅':'○'}</span>
          </button>)}
        </nav>
        <article style={{...card,gridColumn:'span 2'}}>
          <div style={{fontSize:12,fontWeight:700,color:'var(--t3)',textTransform:'uppercase'}}>{lesson.area} · {lesson.minutes} min</div>
          <h2 style={{fontSize:21,margin:'8px 0 16px'}}>{lesson.title}</h2>
          <ol style={{lineHeight:1.75,paddingLeft:23}}>{lesson.steps.map((s,i)=><li key={i} style={{marginBottom:9}}>{s}</li>)}</ol>
          <a href={lesson.path} style={{...button,display:'inline-block',textDecoration:'none',margin:'7px 0 18px'}}>Open this area of the CRM ↗</a>
          <div style={{borderTop:'1px solid var(--br)',paddingTop:18}}>
            <h3 style={{fontSize:16,margin:'0 0 12px'}}>Quick knowledge check</h3>
            <p style={{fontWeight:600}}>{lesson.question}</p>
            {lesson.options.map((o,i)=><label key={i} style={{display:'flex',alignItems:'center',gap:9,padding:'9px 0',cursor:'pointer'}}>
              <input type="radio" name={'quiz-'+lesson.id} checked={answers[lesson.id]===i} onChange={()=>setAnswers(a=>({...a,[lesson.id]:i}))}/>{o}
            </label>)}
            {answers[lesson.id]!==undefined&&<p role="status" style={{fontSize:13,color:success?'#22c55e':'var(--t3)'}}>{success?'Correct! You can complete this lesson.':'Try again — review the steps above.'}</p>}
            <button disabled={!success||completed.includes(lesson.id)} onClick={markDone} style={{...button,background:success&&!completed.includes(lesson.id)?'#2563eb':'var(--s2)',color:success&&!completed.includes(lesson.id)?'white':'var(--t3)',cursor:success?'pointer':'not-allowed'}}>{completed.includes(lesson.id)?'✓ Completed':'Mark lesson complete'}</button>
          </div>
        </article>
      </div>
    </>}
  </div>
}
