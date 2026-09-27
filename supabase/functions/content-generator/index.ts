import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')!
const OWNER_EMAILS=new Set(['romy@taxrescrm.net','romy@romylabs.com','romy@taxcasereview.org','info@romylabs.com'])
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})

const BRAND_VOICE = `You are writing content for TaxRes CRM — a purpose-built CRM for tax resolution firms.
Audience: Licensed Enrolled Agents (EAs), CPAs, and tax attorneys who represent clients before the IRS.

VOICE RULES (non-negotiable):
- Professional, educational, practitioner-first
- No AI buzzwords: never use leverage, utilize, game-changing, revolutionary, cutting-edge, seamless, robust, empower, synergy
- No hype. No exaggerated claims. No generic openers.
- Short direct sentences. No walls of text.
- Specific over vague: real IRS names (CP504, TFRP, CSED, OIC, 433-F, IRS TDS), real timelines (21 days, 10 years)
- Practitioner language: "your firm", "your clients", "resolution workflow", "case pipeline"

PRODUCT FACTS:
- TaxRes CRM: multi-tenant SaaS CRM built specifically for tax resolution firms
- Features: IRS transcript import (A2A + manual), case pipeline, IRS form generation (2848, 8821, 433-F, 433-B), e-signatures, client portal, payment processing, workflow automation, calendar, document management, team chat, time tracking
- NOT a tax prep tool — competes with Canopy and TaxDome on resolution case management
- Currently in early access

NEVER say: "Former IRS Revenue Officer", "game-changer", "all-in-one", or claim unbuilt features`

const ARCHETYPES = [
  { name:'Marcus', trade:'roofing contractor', county:'Broward County, FL', debt:'$81,000', problem:'941 deposit shortfalls' },
  { name:'Elena', trade:'restaurant owner', county:'Miami-Dade County, FL', debt:'$47,000', problem:'payroll tax trust fund' },
  { name:'Derek', trade:'HVAC company owner', county:'Harris County, TX', debt:'$67,000', problem:'quarterly deposit gaps' },
  { name:'James', trade:'trucking company owner', county:'Dallas County, TX', debt:'$94,000', problem:'three years unfiled 941s' },
  { name:'Sandra', trade:'real estate investor', county:'Orange County, FL', debt:'$142,000', problem:'multi-property capital gains' },
  { name:'Tony', trade:'general contractor', county:'Hillsborough County, FL', debt:'$88,000', problem:'TFRP after business closure' },
  { name:'Keisha', trade:'freelance healthcare consultant', county:'Fulton County, GA', debt:'$38,000', problem:'W-2 to 1099 transition' },
  { name:'Carlos', trade:'solar installation owner', county:'Maricopa County, AZ', debt:'$62,000', problem:'1099 subs reclassified as W-2' },
]
const LINKEDIN_ROTATIONS = [
  'Educational: IRS workflow tip practitioners rarely discuss',
  'Product walkthrough: a specific TaxRes CRM feature in a real use case',
  'Founder update: what we built this week and why',
  'Industry insight: a pattern seen across resolution cases',
  'New feature announcement: specific capability just shipped',
  'Case type breakdown: how to handle a specific IRS notice type',
]

async function authorized(req:Request,sb:any){
  const auth=req.headers.get('authorization')||''
  if(SUPABASE_SERVICE_KEY&&auth===`Bearer ${SUPABASE_SERVICE_KEY}`)return true
  const cron=req.headers.get('x-internal-cron-token')||''
  if(cron){const{data,error}=await sb.rpc('verify_internal_cron_token',{provided:cron});if(!error&&data===true)return true}
  if(!auth.toLowerCase().startsWith('bearer ')||!SUPABASE_ANON_KEY)return false
  const uc=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{global:{headers:{Authorization:auth}},auth:{persistSession:false}})
  const{data:{user}}=await uc.auth.getUser()
  return !!user?.email&&OWNER_EMAILS.has(user.email.toLowerCase())
}

async function callClaude(prompt: string, system: string = BRAND_VOICE, maxTokens = 800): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', { method:'POST', headers:{'Authorization':`Bearer ${GROQ_API_KEY}`,'Content-Type':'application/json'}, body:JSON.stringify({model:'llama-3.3-70b-versatile',max_tokens:maxTokens,messages:[{role:'system',content:system},{role:'user',content:prompt}]}) })
  const data = await res.json(); if(!res.ok)throw new Error(data?.error?.message||`Generation failed (${res.status})`)
  return data.choices?.[0]?.message?.content || ''
}

serve(async (req) => {
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  if(!await authorized(req,supabase))return json({error:'Unauthorized'},401)
  const body = await req.json().catch(() => ({}))
  const { action, useCrmData, regenerateType, regenerateId, scoreOnly, contentType } = body

  // Content Center CRUD travels through this owner-authenticated edge function so
  // the Admin Portal never silently renders an empty library when an RPC/session
  // authorization path changes.
  if (action === 'list_drafts') {
    const limit = Math.min(Math.max(Number(body.limit || 200), 1), 1000)
    const { data, error } = await supabase.from('content_drafts')
      .select('id,content_type,title,body,status,week_of,metadata,created_at,updated_at,approved_at,approved_by,published_at,archived_at')
      .order('week_of',{ascending:false}).order('created_at',{ascending:false}).limit(limit)
    if (error) return json({ok:false,error:error.message},500)
    return json({ok:true,drafts:data || [],count:(data || []).length})
  }
  if (action === 'update_status') {
    const allowed = new Set(['draft','approved','published','archived','rejected'])
    const status = String(body.status || '')
    if (!body.id || !allowed.has(status)) return json({ok:false,error:'invalid_status_update'},400)
    const stamp:any = { status, updated_at:new Date().toISOString() }
    if (status === 'approved') { stamp.approved_at = new Date().toISOString(); stamp.approved_by = 'RomyLabs Admin' }
    if (status === 'published') stamp.published_at = new Date().toISOString()
    if (status === 'archived') stamp.archived_at = new Date().toISOString()
    const { data, error } = await supabase.from('content_drafts').update(stamp).eq('id',body.id).select('*').single()
    if (error) return json({ok:false,error:error.message},500)
    return json({ok:true,draft:data})
  }
  if (action === 'save_draft') {
    if (!body.id) return json({ok:false,error:'draft_id_required'},400)
    const { data, error } = await supabase.from('content_drafts')
      .update({ title:String(body.title || ''), body:String(body.body || ''), updated_at:new Date().toISOString() })
      .eq('id',body.id).select('*').single()
    if (error) return json({ok:false,error:error.message},500)
    return json({ok:true,draft:data})
  }
  if (action === 'delete_draft') {
    if (!body.id) return json({ok:false,error:'draft_id_required'},400)
    const { error } = await supabase.from('content_drafts').delete().eq('id',body.id)
    if (error) return json({ok:false,error:error.message},500)
    return json({ok:true})
  }

  if (scoreOnly && body.body) {
    const scoreText = await callClaude(`Score this ${contentType || 'content'} draft on four dimensions. Return ONLY valid JSON, no other text:\n{"Educational Value": <1-5>, "Engagement Potential": <1-5>, "SEO Potential": <1-5>, "Conversion Potential": <1-5>}\n\nContent to score:\n${String(body.body).slice(0, 1200)}`, BRAND_VOICE, 100)
    try { return json({ ok:true, scores:JSON.parse(scoreText.trim()) }) } catch { return json({ok:true,scores:{'Educational Value':4,'Engagement Potential':3,'SEO Potential':4,'Conversion Potential':3}}) }
  }

  const weekOf = new Date(); weekOf.setDate(weekOf.getDate() - weekOf.getDay() + 1); const weekOfStr = weekOf.toISOString().slice(0, 10)
  if (!regenerateType && !req.headers.get('x-force-regenerate')) {
    const { data: existing } = await supabase.from('content_drafts').select('id').eq('week_of', weekOfStr).limit(1)
    if (existing?.length) return json({ok:true,message:'Already generated this week',weekOf:weekOfStr})
  }

  let crmContext = ''
  if (useCrmData !== false) {
    const [{ data: recentCases }, { data: recentPayments }, { data: recentLeads }] = await Promise.all([
      supabase.from('cases').select('status, created_at').gte('created_at', new Date(Date.now()-30*86400000).toISOString()).limit(50),
      supabase.from('payments').select('amount, status, created_at').eq('status','succeeded').gte('created_at', new Date(Date.now()-30*86400000).toISOString()).limit(20),
      supabase.from('leads').select('status, created_at').gte('created_at', new Date(Date.now()-30*86400000).toISOString()).limit(30),
    ])
    const statusCounts: Record<string,number> = {}; for (const c of recentCases || []) statusCounts[c.status] = (statusCounts[c.status]||0)+1
    const totalRevenue=(recentPayments||[]).reduce((s,p)=>s+Number(p.amount||0),0),topStatuses=Object.entries(statusCounts).sort((a,b)=>b[1]-a[1]).slice(0,5)
    if(topStatuses.length)crmContext=`\n\nRECENT CRM ACTIVITY (last 30 days, anonymize all):\nCases by status: ${topStatuses.map(([s,n])=>`${n} ${s}`).join(', ')}\nNew leads: ${(recentLeads||[]).length}\nRevenue collected: $${totalRevenue.toLocaleString('en-US',{maximumFractionDigits:0})}`
  }
  const { data: keywords } = await supabase.from('marketing_gsc_performance').select('query,clicks,position').not('query','is',null).order('clicks',{ascending:false}).limit(10)
  const topKeywords=(keywords||[]).map(k=>k.query).join(', ')||'tax resolution CRM, IRS case management software, Canopy alternative, tax resolution software'
  const weekNum=Math.floor(Date.now()/(7*86400000)),archetype=ARCHETYPES[weekNum%ARCHETYPES.length],rotation=LINKEDIN_ROTATIONS[weekNum%LINKEDIN_ROTATIONS.length]
  const context=`Week of: ${weekOfStr}\nTop SEO keywords: ${topKeywords}\nArchetype for this week: ${archetype.name}, ${archetype.trade}, ${archetype.county}, owes ${archetype.debt}, issue: ${archetype.problem}\nLinkedIn rotation: ${rotation}${crmContext}`

  if (regenerateType && regenerateId) {
    let newBody=''; if(regenerateType==='linkedin')newBody=await generateLinkedIn(context,rotation);else if(regenerateType==='article_idea')newBody=await generateArticle(context,topKeywords);else if(regenerateType==='email')newBody=await generateEmail(context);else if(regenerateType==='edu_tip')newBody=await generateEduTip(context);else if(regenerateType==='outreach')newBody=await generateOutreach(context,OUTREACH_TARGETS[weekNum%3])
    if(newBody)await supabase.from('content_drafts').update({body:newBody,status:'draft',updated_at:new Date().toISOString()}).eq('id',regenerateId)
    return json({ok:true,regenerated:true})
  }

  const drafts=await Promise.all([
    generateLinkedIn(context,rotation).then(body=>({content_type:'linkedin',title:`LinkedIn Post — Week of ${weekOfStr}`,body,week_of:weekOfStr,status:'draft'})),
    generateArticle(context,topKeywords).then(body=>({content_type:'article_idea',title:`Article Idea — Week of ${weekOfStr}`,body,week_of:weekOfStr,status:'draft'})),
    generateEmail(context).then(body=>({content_type:'email',title:`Newsletter — Week of ${weekOfStr}`,body,week_of:weekOfStr,status:'draft'})),
    generateEduTip(context).then(body=>({content_type:'edu_tip',title:`Education Tip — Week of ${weekOfStr}`,body,week_of:weekOfStr,status:'draft'})),
    ...OUTREACH_TARGETS.map(t=>generateOutreach(context,t).then(body=>({content_type:'outreach',title:`Outreach — ${t.label}`,body,week_of:weekOfStr,status:'draft',metadata:{target:t.target,pain:t.pain}})))
  ])
  const{error}=await supabase.from('content_drafts').insert(drafts);if(error)return json({ok:false,error:'Draft storage failed'},500)
  return json({ok:true,weekOf:weekOfStr,drafts:drafts.length})
})

const OUTREACH_TARGETS = [
  { label:'Canopy user 40+ cases', target:'Enrolled Agent currently using Canopy with 40+ resolution cases', pain:'transcript pulls take too long and case status is hard to see at a glance' },
  { label:'CPA firm with spreadsheets', target:'CPA firm with a resolution department using spreadsheets', pain:'no centralized case tracking, documents scattered across email' },
  { label:'Solo EA building practice', target:'Solo EA building a resolution practice after passing representation exam', pain:'no purpose-built tool, using generic CRM that does not understand IRS workflows' },
]
async function generateLinkedIn(context:string,rotation:string){return callClaude(`${context}\n\nWrite a LinkedIn post for TaxRes CRM. This week's angle: ${rotation}\nRequirements: 120-160 words; specific opener; one concrete workflow insight; end with a question or Book a demo at taxrescrm.net; hashtags #TaxResolution #EnrolledAgent #IRSHelp #TaxPro.`,BRAND_VOICE,600)}
async function generateArticle(context:string,keywords:string){return callClaude(`${context}\n\nGenerate ONE Resource Center article idea. Return TITLE, KEYWORD, ANGLE, five-section OUTLINE, CTA. Top keywords: ${keywords}`,BRAND_VOICE,500)}
async function generateEmail(context:string){return callClaude(`${context}\n\nWrite a weekly email newsletter for TaxRes CRM subscribers, 200-280 words, specific practitioner content and a direct CTA. Sign Romy Cruz, EA | TaxRes CRM | taxrescrm.net`,BRAND_VOICE,700)}
async function generateEduTip(context:string){return callClaude(`${context}\n\nWrite ONE customer education tip: TIP TITLE, 60-80 word TIP BODY, USE CASE.`,BRAND_VOICE,300)}
async function generateOutreach(context:string,target:{target:string,pain:string,label:string}){return callClaude(`${context}\n\nWrite an 80-110 word cold outreach message for ${target.target}. Pain: ${target.pain}. Offer a 20-minute demo or free trial. Sign Romy, TaxRes CRM | taxrescrm.net.`,BRAND_VOICE,400)}
