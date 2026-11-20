import {serve} from 'https://deno.land/std@0.177.0/http/server.ts'
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2'

// Read-only merchant reporting. Never accept Stripe account IDs or URLs from callers.
const root=Deno.env.get('SUPABASE_URL')||''
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
const anon=Deno.env.get('SUPABASE_ANON_KEY')||''
const cors={
  'Access-Control-Allow-Origin':'https://admin.romylabs.com',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Cache-Control':'no-store',
  'Content-Type':'application/json'
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors})
const compact=(row:any,keys:string[])=>Object.fromEntries(keys.map(k=>[k,row?.[k]??null]))
serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return json({error:'Method not allowed'},405)
  if(!root||!service||!anon)return json({error:'Merchant reporting unavailable'},503)
  const auth=req.headers.get('authorization')||''
  if(!/^Bearer \S+$/.test(auth))return json({error:'Sign-in required'},401)
  const user=createClient(root,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}})
  const {data:isAdmin,error:adminError}=await user.rpc('_is_platform_admin')
  if(adminError||isAdmin!==true)return json({error:'RomyLabs administrator required'},403)
  const db=createClient(root,service,{auth:{persistSession:false}})
  const {data:settings,error:settingsError}=await db.from('romylabs_stripe_settings')
    .select('stripe_account_id,mode').eq('id',true).single()
  if(settingsError||settings?.stripe_account_id!=='acct_1UaFszFomt0HrzTf'||settings.mode!=='live')
    return json({error:'Live RomyLabs merchant not verified'},409)
  const {data:key,error:keyError}=await db.rpc('romylabs_stripe_merchant_secret',{
    p_name:'romylabs_stripe_live_key',p_new_value:null
  })
  if(keyError||!key)return json({error:'Live merchant credential unavailable'},503)
  const fetchStripe=async(path:string)=>{
    const res=await fetch('https://api.stripe.com/v1/'+path,{
      headers:{Authorization:'Bearer '+String(key),'Stripe-Version':'2026-09-30.endive'}
    })
    const body=await res.json().catch(()=>({}))
    if(!res.ok)throw Error(res.status===403?'Permission required in Stripe restricted key':String(body?.error?.code||'Stripe read unavailable'))
    return body
  }
  const types=['payment_intents','subscriptions','invoices','payouts','refunds','disputes','balance_transactions','balance'] as const
  const paths=['payment_intents?limit=50','subscriptions?status=all&limit=50',
    'invoices?limit=50','payouts?limit=50','refunds?limit=50','disputes?limit=50',
    'balance_transactions?limit=50','balance']
  const results=await Promise.allSettled(paths.map(path=>fetchStripe(path)))
  const data:Record<string,unknown>={}
  const errors:Record<string,string>={}
  for(let i=0;i<types.length;i++){
    const result=results[i]
    if(result.status==='rejected'){
      errors[types[i]]=String(result.reason?.message||'Stripe read unavailable')
      continue
    }
    const value=result.value
    if(types[i]==='balance'){
      data.balance={available:(value.available||[]).filter((v:any)=>v.currency==='usd')
        .map((v:any)=>compact(v,['amount','currency'])),
        pending:(value.pending||[]).filter((v:any)=>v.currency==='usd')
        .map((v:any)=>compact(v,['amount','currency']))}
    }else{
      const rows=(value.data||[])
      data[types[i]]={has_more:Boolean(value.has_more),rows:rows.map((v:any)=>{
        if(types[i]==='payment_intents')return compact(v,['id','amount','amount_received','currency','status','created','description','customer','latest_charge'])
        if(types[i]==='subscriptions')return {...compact(v,['id','customer','status','currency','created','cancel_at','current_period_end','description']),
          amount_cents:Number(v.items?.data?.[0]?.price?.unit_amount||0)*Number(v.items?.data?.[0]?.quantity||1),
          office:String(v.metadata?.office||''),product_key:String(v.metadata?.romylabs_term||'')}
        if(types[i]==='invoices')return {...compact(v,['id','number','customer','status','currency','created','amount_due','amount_paid','amount_remaining','hosted_invoice_url']),
          subscription_id:String(v.parent?.subscription_details?.subscription||'')}
        if(types[i]==='payouts')return compact(v,['id','amount','currency','status','created','arrival_date','method','failure_code'])
        if(types[i]==='balance_transactions')return compact(v,['id','amount','fee','net','currency','type','reporting_category','created','source','available_on','status'])
        if(types[i]==='refunds')return compact(v,['id','amount','currency','status','created','payment_intent','reason'])
        return compact(v,['id','amount','currency','status','created','payment_intent','reason'])
      })}
    }
  }
  // A restricted Stripe key may lack invoices:read while signed Stripe
  // subscription events have already reconciled paid invoices into our
  // protected RomyLabs SaaS ledger. Display those verified rows, clearly
  // marked as a partial ledger view; never pretend they cover all Stripe invoices.
  if(errors.invoices){
    const {data:ledger,error:ledgerError}=await db.from('romylabs_invoices')
      .select('provider_invoice_id,invoice_number,amount_cents,amount_paid_cents,status,issued_at,account_id,hosted_invoice_url')
      .eq('provider','stripe').like('provider_invoice_id','in_%')
      .order('issued_at',{ascending:false}).limit(50)
    if(!ledgerError && Array.isArray(ledger) && ledger.length>0){
      const accountIds=[...new Set(ledger.map((row:any)=>row.account_id).filter(Boolean))]
      const {data:accounts,error:accountsError}=await db.from('romylabs_billing_accounts')
        .select('id,account_name,product_key').in('id',accountIds)
      if(!accountsError){
        const accountById=new Map((accounts||[]).map((a:any)=>[a.id,a]))
        data.invoices={
          source:'romylabs_reconciled_ledger',
          coverage:'reconciled_stripe_invoices_only',
          has_more:ledger.length===50,
          rows:ledger.map((i:any)=>{
            const account:any=accountById.get(i.account_id)
            const paid=Number(i.amount_paid_cents||0),total=Number(i.amount_cents||0)
            return {
              id:i.provider_invoice_id,number:i.invoice_number,
              customer:null,status:i.status,currency:'usd',
              created:Math.floor(new Date(i.issued_at).getTime()/1000),
              amount_due:total,amount_paid:paid,
              amount_remaining:Math.max(0,total-paid),
              hosted_invoice_url:i.hosted_invoice_url||null,
              subscription_id:'',account_name:account?.account_name||'',
              product_key:account?.product_key||''
            }
          })
        }
        delete errors.invoices
      }
    }
  }
  return json({ok:true,merchant:'Romy Labs, LLC',mode:'live',as_of:new Date().toISOString(),data,errors})
})
