import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'

export default function GlobalTeamChatNotifier(){
  const { user, employeeName } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const [notice,setNotice]=useState(null)

  useEffect(()=>{
    if(!user?.email) return
    const me=employeeName || user.user_metadata?.name || user.email.split('@')[0]
    const ch=supabase.channel('global-teamchat-notifier-'+user.id)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages'},({new:msg})=>{
        if(!msg || msg.sender===me) return
        if(msg.invite_to && msg.invite_to!==me) return

        const isHuddle=!!msg.huddle_id
        const caller=(msg.text||'').replace(/^📞\s*/,'').replace(/ is calling you.*/,'').replace(/ invited .*/,'') || msg.sender || 'Team member'
        const target=isHuddle
          ? '/chat?huddle='+encodeURIComponent(msg.huddle_id)+'&from='+encodeURIComponent(caller)+'&c='+encodeURIComponent(msg.channel||'general')
          : '/chat?c='+encodeURIComponent(msg.channel||'general')

        if(isHuddle || !location.pathname.includes('/chat')){
          setNotice({
            title:isHuddle?'Incoming huddle':(msg.sender||'Team Chat'),
            body:isHuddle?(caller+' is inviting you to a huddle'):(msg.text||'Sent an attachment'),
            target,
            huddle:isHuddle
          })
        }

        if(typeof Notification!=='undefined' && Notification.permission==='granted' && document.hidden){
          const n=new Notification(isHuddle?'Incoming huddle':(msg.sender||'Team Chat'),{
            body:isHuddle?(caller+' is inviting you to a huddle'):(msg.text||'Sent an attachment').slice(0,160),
            tag:isHuddle?'teamchat-huddle-'+msg.huddle_id:'teamchat-'+(msg.channel||'general')
          })
          n.onclick=()=>{ window.focus(); navigate(target); n.close() }
        }
      }).subscribe()
    return()=>supabase.removeChannel(ch)
  },[user?.id,user?.email,employeeName,location.pathname,navigate])

  if(!notice) return null
  return <div style={{
    position:'fixed',right:18,bottom:18,zIndex:9999,width:330,
    background:'#1d1c1d',border:'1px solid #555',borderRadius:10,
    boxShadow:'0 10px 30px rgba(0,0,0,.45)',padding:14,color:'#fff'
  }}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start'}}>
      <div>
        <div style={{fontWeight:800,fontSize:14,marginBottom:4}}>{notice.title}</div>
        <div style={{fontSize:12,lineHeight:1.4,color:'#d1d2d3'}}>{notice.body}</div>
      </div>
      <button onClick={()=>setNotice(null)} style={{border:0,background:'transparent',color:'#aaa',fontSize:18,cursor:'pointer'}}>×</button>
    </div>
    <button onClick={()=>{const t=notice.target;setNotice(null);navigate(t)}} style={{
      marginTop:10,width:'100%',height:34,border:0,borderRadius:6,
      background:notice.huddle?'#007a5a':'#1264a3',color:'#fff',fontWeight:700,cursor:'pointer'
    }}>{notice.huddle?'Join huddle':'Open Team Chat'}</button>
  </div>
}
