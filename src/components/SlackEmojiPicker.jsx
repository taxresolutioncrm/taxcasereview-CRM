import { useMemo, useState } from 'react'

const GROUPS = [
  { name:'Frequently Used', emojis:['👍','👎','❤️','🔥','✅','❌','⚠️','📌','💯','🎉','😊','😂','🙏','💪','🤝','⏰','👀','🤔','🥳'] },
  { name:'Getting Work Done', emojis:['✅','👀','🙌','🙏','➕','👏','💡','🎯','👋','👍','🎉','1️⃣','2️⃣','3️⃣','📣','⚪','🔵','🔴','🆗','🆘','🚨','🚀','🔥','❤️','💯'] },
  { name:'Smileys & People', emojis:['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🫣','🤭','🫢','🫡','🤫','🫠','🤥','😶','🫥','😐','🫤','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕'] },
  { name:'Gestures', emojis:['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','💪'] },
  { name:'Hearts & Symbols', emojis:['💌','💘','💝','💖','💗','💓','💞','💕','💟','❣️','💔','❤️‍🔥','❤️‍🩹','❤️','🩷','🧡','💛','💚','💙','🩵','💜','🤎','🖤','🩶','🤍','💋','💯','💢','💥','💫','💦','💨','💬','💭','💤','⭐','🌟','✨','⚡','🔥','🎯','🚀'] },
  { name:'Objects & Work', emojis:['📞','📱','💻','⌨️','🖥️','🖨️','🧮','📧','✉️','📨','📩','📤','📥','📦','📁','📂','📄','📃','📑','📊','📈','📉','📌','📍','📎','🖇️','✂️','📝','✏️','🔍','🔎','🔒','🔓','🔑','🗝️','💰','💵','💳','🏦','⚖️','🏛️','🗓️','📅','⏰','⏱️','✅','❌','⚠️','🚨'] }
]

export default function SlackEmojiPicker({ onPick }) {
  const [query,setQuery] = useState('')
  const filtered = useMemo(() => {
    const q=query.trim().toLowerCase()
    if(!q) return GROUPS
    return GROUPS.map(g=>({...g,emojis:g.emojis.filter(e=>e.includes(q))})).filter(g=>g.emojis.length)
  },[query])

  return (
    <div style={{
      position:'absolute',left:0,bottom:'calc(100% + 8px)',width:330,maxHeight:420,
      background:'#1f2125',border:'1px solid #55585f',borderRadius:10,boxShadow:'0 12px 36px rgba(0,0,0,.45)',
      zIndex:300,overflow:'hidden'
    }}>
      <div style={{padding:10,borderBottom:'1px solid #3c3f45'}}>
        <input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search all emoji"
          style={{width:'100%',height:34,borderRadius:7,border:'1px solid #22a7d8',background:'#1a1d21',color:'#fff',padding:'0 10px',outline:'none',fontSize:13}}/>
      </div>
      <div style={{overflowY:'auto',maxHeight:365,padding:'6px 8px 12px'}}>
        {filtered.map(group=>(
          <div key={group.name} style={{marginTop:6}}>
            <div style={{fontSize:12,fontWeight:700,color:'#d1d2d3',padding:'4px 2px 6px'}}>{group.name}</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(9,1fr)',gap:2}}>
              {group.emojis.map((emoji,idx)=>(
                <button key={emoji+idx} onClick={()=>onPick(emoji)} title={emoji}
                  style={{height:32,border:0,borderRadius:5,background:'transparent',fontSize:21,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}
                  onMouseEnter={e=>e.currentTarget.style.background='#35373b'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{emoji}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
