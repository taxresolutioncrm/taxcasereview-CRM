import React,{useEffect,useMemo,useState} from 'react'
import {supabase} from '../../lib/supabase'

const shell={border:'1px solid rgba(129,140,248,.2)',borderRadius:12,background:'rgba(255,255,255,.025)',padding:16,marginBottom:18}
const field={width:'100%',boxSizing:'border-box',padding:'9px 11px',borderRadius:8,background:'#100f1d',border:'1px solid rgba(129,140,248,.3)',color:'#e2e8f0',fontSize:12}
const button={borderRadius:8,border:'1px solid rgba(129,140,248,.34)',background:'rgba(99,102,241,.15)',color:'#c7d2fe',padding:'8px 13px',fontWeight:800,cursor:'pointer',fontSize:12}
const fields=[['subject_override','Subject line (without company name or month)',180],['opening_text','Additional opening paragraph',1200],['additional_text','Extra details, instructions or announcement',2400],['closing_text','Closing message',900]]
const blank=()=>({subject_override:'',opening_text:'',additional_text:'',closing_text:'',
  send_day:'',send_time:'',send_timezone:'',is_enabled:''})
const ZONES=[
  ['America/New_York','Eastern (New York)'],
  ['America/Chicago','Central (Chicago)'],
  ['America/Denver','Mountain (Denver)'],
  ['America/Los_Angeles','Pacific (Los Angeles)'],
  ['America/Phoenix','Arizona (no DST)'],
  ['America/Anchorage','Alaska'],
  ['Pacific/Honolulu','Hawaii'],
  ['America/Puerto_Rico','Puerto Rico'],
  ['America/Toronto','Toronto'],
  ['America/Santo_Domingo','Santo Domingo'],
  ['UTC','UTC']
]
const TIME_OPTIONS=Array.from({length:96},(_,i)=>{
  const h=Math.floor(i/4),m=(i%4)*15
  const v=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')
  return [v,new Date(2026,0,1,h,m).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})]
})
export default function RomyLabsMonthlyReminderEditor({products=[],accounts=[],officeRegistry=[]}){
  const [product,setProduct]=useState('taxres_crm')
  const [office,setOffice]=useState('')
  const [all,setAll]=useState([])
  const [draft,setDraft]=useState(blank)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [preview,setPreview]=useState(false)
  const [loaded,setLoaded]=useState(false)
  const productName=products.find(([id])=>id===product)?.[1]||product
  // Registry, not billing, is the source of truth for customer offices.
  // Exclude demo/internal records without hiding genuine trials or cancelled
  // customers who might still have an active billing account.
  const officeChoices=useMemo(()=>{
    const isReal=(name,meta)=>{
      const n=String(name||'').trim().toLowerCase()
      return Boolean(n)&&meta?.demo!==true&&meta?.required_demo_office!==true&&
        !/(^|\s)demo(\s|$)/i.test(n)&&
        !['main office','tax case review','internal','romylabs internal'].includes(n)
    }
    const items=new Map()
    for(const r of officeRegistry.filter(o=>o.product_key===product&&isReal(o.firm_name,o.metadata))){
      const linked=accounts.find(a=>a.product_key===r.product_key&&
        String(a.external_tenant_id||'')===String(r.external_office_id||''))
      const key=linked?'office:'+linked.id:'registry:'+r.id
      items.set(key,{key,account:linked||null,registry:r,label:r.firm_name,
        billingReady:Boolean(linked)})
    }
    for(const a of accounts.filter(a=>a.product_key===product)){
      if(!isReal(a.account_name))continue
      const already=[...items.values()].some(o=>o.account?.id===a.id)
      if(!already)items.set('office:'+a.id,{key:'office:'+a.id,account:a,registry:null,
        label:a.account_name,billingReady:true})
    }
    return [...items.values()].sort((a,b)=>a.label.localeCompare(b.label))
  },[accounts,officeRegistry,product])
  const selectedOffice=officeChoices.find(o=>o.key===office)
  const selectedAccount=selectedOffice?.account||null
  const scopeKey=office||'product:'+product
  const productRow=all.find(r=>r.scope_key==='product:'+product)
  const exact=all.find(r=>r.scope_key===scopeKey)
  const current=useMemo(()=>({
    ...Object.fromEntries(fields.map(([name])=>[name,exact?.[name]||''])),
    send_day:exact?.send_day==null?'':String(exact.send_day),
    send_time:exact?.send_time||'',
    send_timezone:exact?.send_timezone||'',
    is_enabled:exact?.is_enabled==null?'':String(exact.is_enabled)
  }),[exact,scopeKey])
  const inherited=(key,fallback)=>productRow?.[key]??fallback
  const effective=(key,fallback)=>draft[key]!==''?(key==='send_day'?Number(draft[key]):key==='is_enabled'?draft[key]==='true':draft[key]):office?inherited(key,fallback):fallback
  const effectiveDay=effective('send_day',1)
  const effectiveTime=effective('send_time','09:00')
  const effectiveZone=effective('send_timezone','America/New_York')
  const effectiveEnabled=effective('is_enabled',true)
  const scheduleChange=(key,value)=>setDraft(d=>({...d,[key]:value}))

  const read=async()=>{
    setBusy(true);setError('');setNotice('')
    const {data,error:e}=await supabase.from('romylabs_monthly_reminder_content')
      .select('scope_key,product_key,account_id,registry_office_id,subject_override,opening_text,additional_text,closing_text,send_day,send_time,send_timezone,is_enabled,updated_at')
    if(e){setError('Could not load reminder settings: '+e.message);setLoaded(false)}
    else {setAll(data||[]);setLoaded(true)}
    setBusy(false)
  }
  useEffect(()=>{void read()},[])
  useEffect(()=>{setDraft(current);setPreview(false)},[current])
  useEffect(()=>{if(office&&!officeChoices.some(a=>a.id===office))setOffice('')},[office,officeChoices])
  const save=async()=>{
    if(busy||!loaded)return
    if(fields.some(([name,,max])=>draft[name].length>max)){setError('A text field is too long.');return}
    setBusy(true);setError('');setNotice('')
    const {error:e}=await supabase.from('romylabs_monthly_reminder_content').upsert({
      scope_key:scopeKey,product_key:product,
      account_id:selectedOffice?.account?.id||null,
      registry_office_id:selectedOffice&&!selectedOffice.account?selectedOffice.registry.id:null,
      ...Object.fromEntries(fields.map(([name])=>[name,draft[name]])),
      send_day:draft.send_day===''?null:Number(draft.send_day),
      send_time:draft.send_time||null,
      send_timezone:draft.send_timezone||null,
      is_enabled:draft.is_enabled===''?null:draft.is_enabled==='true'
    },{onConflict:'scope_key'})
    if(e){setError('Could not save: '+e.message);setBusy(false);return}
    const {data,error:reloadError}=await supabase.from('romylabs_monthly_reminder_content')
      .select('scope_key,product_key,account_id,registry_office_id,subject_override,opening_text,additional_text,closing_text,send_day,send_time,send_timezone,is_enabled,updated_at')
    if(reloadError){setError('Saved, but refresh failed: '+reloadError.message)}
    else {setAll(data||[]);setNotice('Reminder changes saved for '+(selectedOffice?.label||productName)+'. Future monthly emails use these settings.')}
    setBusy(false)
  }
  const reset=async()=>{
    if(busy||!loaded)return
    if(!window.confirm('Remove the custom reminder text for '+(selectedOffice?.label||productName)+'? The standard template will be used.'))return
    setBusy(true);setError('');setNotice('')
    const {error:e}=await supabase.from('romylabs_monthly_reminder_content').delete().eq('scope_key',scopeKey)
    if(e)setError('Could not reset: '+e.message)
    else {setAll(rows=>rows.filter(r=>r.scope_key!==scopeKey));setNotice('Custom content removed. Default content is restored.')}
    setBusy(false)
  }
  const display=key=>draft[key]||(!office?'':productRow?.[key])||''
  return <details style={shell}>
    <summary style={{cursor:'pointer',color:'#c7d2fe',fontSize:13,fontWeight:800}}>Monthly reminders · Edit message and send schedule</summary>
    <div style={{fontSize:12,color:'#94a3b8',lineHeight:1.6,margin:'12px 0 16px'}}>
      Customize your monthly reminders and when they send, without a code deployment. Choose a CRM default or an individual office override.
      The company sender, logo, subscription amount, Zelle exceptions, autopay notices, and credit/debit processing disclosures are protected.
      This editor does not send emails or create payment links.
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:12,marginBottom:14}}>
      <label style={{fontSize:11,color:'#cbd5e1',fontWeight:750}}>CRM / industry
        <select aria-label="Select reminder CRM" value={product} onChange={e=>{setProduct(e.target.value);setOffice('')}} style={{...field,marginTop:6}}>
          {products.map(([id,name])=><option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <label style={{fontSize:11,color:'#cbd5e1',fontWeight:750}}>Apply to
        <select aria-label="Select reminder office" value={office} onChange={e=>setOffice(e.target.value)} style={{...field,marginTop:6}}>
          <option value="">All offices in {productName}</option>
          {officeChoices.map(o=><option key={o.key} value={o.key}>{o.label}{o.billingReady?'':' · Not billing yet'}</option>)}
        </select>
      </label>
    </div>
    {office&&<div style={{fontSize:11,color:'#94a3b8',marginBottom:12}}>
      Blank office-specific fields inherit the CRM defaults. Company-level identity and mandatory payment details cannot be overridden.
      {!selectedOffice?.billingReady&&<strong style={{display:'block',color:'#fbbf24',marginTop:6}}>
        Registry-only office — you can save its reminder template and schedule, but no emails or invoices
        will be generated until this office has an active SaaS billing account.
      </strong>}
    </div>}
    <div style={{padding:'14px 16px',border:'1px solid rgba(129,140,248,.22)',borderRadius:10,marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:800,color:'#e2e8f0',marginBottom:4}}>Monthly send schedule</div>
      <div style={{fontSize:11,lineHeight:1.6,color:'#94a3b8',marginBottom:12}}>
        Changes take effect on the next eligible send. The same office is never emailed twice in a month.
        Days 29–31 send on the last day in shorter months. Blank settings inherit the CRM schedule, or the system default (1st at 9 AM Eastern).
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(165px,1fr))',gap:12}}>
        <label style={{fontSize:11,color:'#cbd5e1',fontWeight:700}}>Send day of month
          <select aria-label="Monthly send day" value={draft.send_day} onChange={e=>scheduleChange('send_day',e.target.value)} style={{...field,marginTop:6}}>
            <option value="">Inherit / default</option>
            {Array.from({length:31},(_,i)=><option key={i+1} value={i+1}>Day {i+1}</option>)}
          </select>
        </label>
        <label style={{fontSize:11,color:'#cbd5e1',fontWeight:700}}>Local send time
          <select aria-label="Monthly send time" value={draft.send_time} onChange={e=>scheduleChange('send_time',e.target.value)} style={{...field,marginTop:6}}>
            <option value="">Inherit / default</option>
            {TIME_OPTIONS.map(([v,label])=><option key={v} value={v}>{label}</option>)}
          </select>
        </label>
        <label style={{fontSize:11,color:'#cbd5e1',fontWeight:700}}>Time zone
          <select aria-label="Reminder time zone" value={draft.send_timezone} onChange={e=>scheduleChange('send_timezone',e.target.value)} style={{...field,marginTop:6}}>
            <option value="">Inherit / default</option>
            {ZONES.map(([v,label])=><option key={v} value={v}>{label}</option>)}
          </select>
        </label>
        <label style={{fontSize:11,color:'#cbd5e1',fontWeight:700}}>Delivery
          <select aria-label="Monthly reminder delivery" value={draft.is_enabled} onChange={e=>scheduleChange('is_enabled',e.target.value)} style={{...field,marginTop:6}}>
            <option value="">Inherit / default</option>
            <option value="true">Enabled</option>
            <option value="false">Paused — do not send</option>
          </select>
        </label>
      </div>
      <div role="status" style={{fontSize:11,fontWeight:700,color:effectiveEnabled?'#86efac':'#fbbf24',marginTop:13}}>
        Effective schedule: {effectiveEnabled?'Day '+effectiveDay+' at '+(TIME_OPTIONS.find(([v])=>v===effectiveTime)?.[1]||effectiveTime)+' · '+(ZONES.find(([v])=>v===effectiveZone)?.[1]||effectiveZone):'Paused — no monthly emails'}
      </div>
    </div>

    {fields.map(([name,label,max])=><label key={name} style={{display:'block',fontSize:12,fontWeight:700,color:'#cbd5e1',marginBottom:12}}>
      <span>{label}</span>
      {name==='subject_override'
        ?<input aria-label={label} value={draft[name]} maxLength={max} onChange={e=>setDraft(d=>({...d,[name]:e.target.value}))} placeholder={office?productRow?.[name]||'Use standard subject':'Use standard subject'} style={{...field,marginTop:6}}/>
        :<textarea aria-label={label} value={draft[name]} maxLength={max} rows={name==='additional_text'?5:3} onChange={e=>setDraft(d=>({...d,[name]:e.target.value}))} placeholder={office?productRow?.[name]||'Use standard message':'Optional custom text'} style={{...field,marginTop:6,resize:'vertical'}}/>}
      <span style={{display:'block',textAlign:'right',fontSize:10,color:'#64748b'}}>{draft[name].length}/{max}</span>
    </label>)}
    {error&&<div role="alert" style={{color:'#fca5a5',fontSize:12,marginBottom:12}}>{error}</div>}
    {notice&&<div role="status" style={{color:'#86efac',fontSize:12,marginBottom:12}}>{notice}</div>}
    <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
      <button type="button" onClick={save} disabled={busy||!loaded} style={{...button,opacity:busy||!loaded?0.5:1}}>Save reminder</button>
      <button type="button" onClick={()=>setPreview(x=>!x)} style={button}>{preview?'Hide preview':'Preview message'}</button>
      <button type="button" onClick={reset} disabled={busy||!loaded||!exact} style={{...button,opacity:busy||!loaded||!exact?0.5:1}}>Restore defaults</button>
      <button type="button" onClick={read} disabled={busy} style={button}>Refresh</button>
      {exact?.updated_at&&<span style={{fontSize:10,color:'#64748b'}}>Saved {new Date(exact.updated_at).toLocaleString()}</span>}
    </div>
    {preview&&<div style={{marginTop:16,padding:20,background:'#f8fafc',borderRadius:12,color:'#1e293b',border:'1px solid #cbd5e1',fontSize:13,lineHeight:1.7}}>
      <strong style={{fontSize:16}}>{productName} — {display('subject_override')||'Monthly subscription reminder'}</strong>
      <p>Hello {selectedOffice?.label||'[Office name]'},</p>
      <p>Your {productName} monthly subscription reminder includes the verified account amount and payment status.</p>
      <p><strong>Scheduled:</strong> {effectiveEnabled?'Day '+effectiveDay+' at '+effectiveTime+' ('+effectiveZone+')':'Paused'}</p>
      {display('opening_text')&&<p style={{whiteSpace:'pre-wrap'}}>{display('opening_text')}</p>}
      <div style={{background:'#d8eaff',padding:12,borderRadius:8}}>Subscription balance: <strong>{selectedAccount?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(selectedAccount.monthly_amount_cents||0)/100):'[Actual office amount]'}</strong></div>
      <p>The standard, protected company-specific payment method and processing-fee section appears here in the actual message.</p>
      {display('additional_text')&&<p style={{whiteSpace:'pre-wrap'}}>{display('additional_text')}</p>}
      {display('closing_text')&&<p style={{whiteSpace:'pre-wrap'}}>{display('closing_text')}</p>}
      <strong>{productName} Billing Team</strong>
      <p style={{fontSize:11,color:'#64748b'}}>Content preview only — not a sent email. Branding and legally required disclosures are rendered by the live mail template.</p>
    </div>}
  </details>
}
