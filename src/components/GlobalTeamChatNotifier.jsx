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
    const host=window.location.hostname.toLowerCase()
    const isCentralNotificationRuntime=host!=='nashville.taxrescrm.app'
    const me=employeeName || user.user_metadata?.name || user.email.split('@')[0]

    function handleHuddleMessage(msg){
      if(!msg || msg.sender===me) return
      if(msg.invite_to && msg.invite_to!==me) return
      if(!msg.huddle_id) return

      const caller=(msg.text||'').replace(/^📞\s*/,'').replace(/ is calling you.*/,'').replace(/ invited .*/,'') || msg.sender || 'Team member'
      const target='/chat?huddle='+encodeURIComponent(msg.huddle_id)+'&from='+encodeURIComponent(caller)+'&c='+encodeURIComponent(msg.channel||'general')

      // When Team Chat is already visible its own incoming-call banner is the
      // only in-app huddle UI. Everywhere else, show the global Join card.
      if(!location.pathname.includes('/chat')){
        setNotice({
          title:'Incoming huddle',
          body:caller+' is inviting you to a huddle',
          target,
          huddle:true
        })
      }

      // If the tab is hidden, the global notifier owns the OS notification
      // even when /chat is the current route.
      if(typeof Notification!=='undefined' && Notification.permission==='granted' && document.hidden){
        const n=new Notification('Incoming huddle',{
          body:caller+' is inviting you to a huddle',
          tag:'teamchat-huddle-'+msg.huddle_id
        })
        n.onclick=()=>{ window.focus(); navigate(target); n.close() }
      }
    }

    if(isCentralNotificationRuntime){
      const onCentralInvite=(event)=>handleHuddleMessage(event.detail?.msg)
      window.addEventListener('taxres:huddle-invite',onCentralInvite)
      return()=>window.removeEventListener('taxres:huddle-invite',onCentralInvite)
    }

    const ch=supabase.channel('global-teamchat-notifier-'+user.id)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages'},({new:msg})=>handleHuddleMessage(msg))
      .subscribe()
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
