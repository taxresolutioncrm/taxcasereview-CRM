import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const APP_URL='https://nashville.taxrescrm.app'
const cors={'Access-Control-Allow-Origin':APP_URL,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, OPTIONS','content-type':'application/json'}
const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:cors})

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='GET') return json({ok:false,message:'GET only'},405)
  try{
    const ru=new URL(req.url)
    const code=ru.searchParams.get('code')||''
    const realmId=ru.searchParams.get('realmId')||''
    const state=ru.searchParams.get('state')||''
    const oauthError=ru.searchParams.get('error')||''
    if(oauthError) return json({ok:false,message:'QuickBooks authorization was cancelled.'},400)
    if(!code||!realmId||!state) return json({ok:false,message:'QuickBooks authorization response was incomplete.'},400)

    const supaUrl=Deno.env.get('SUPABASE_URL')||''
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
    if(!supaUrl||!service) return json({ok:false,message:'QuickBooks connection is unavailable.'},503)
    const admin=createClient(supaUrl,service,{auth:{persistSession:false,autoRefreshToken:false}})

    const {data:tenantId,error:stateErr}=await admin.rpc('consume_accounting_oauth_state',{p_token:state,p_provider:'quickbooks'})
    if(stateErr||!tenantId) return json({ok:false,message:'QuickBooks connection request expired or was already used.'},400)

    const {data:settings}=await admin.from('settings').select('qb_client_id,qb_client_secret').eq('tenant_id',tenantId).maybeSingle()
    if(!settings?.qb_client_id||!settings?.qb_client_secret) return json({ok:false,message:'QuickBooks app credentials are not configured.'},400)

    const redirectUri=`${APP_URL}/auth/quickbooks-callback`
    const tokenRes=await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',{
      method:'POST',
      headers:{Authorization:`Basic ${btoa(`${settings.qb_client_id}:${settings.qb_client_secret}`)}`,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
      body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirectUri})
    })
    const tokenData=await tokenRes.json().catch(()=>({}))
    if(!tokenRes.ok||!tokenData.access_token||!tokenData.refresh_token){
      return json({ok:false,message:'QuickBooks token exchange failed.'},400)
    }

    const companyRes=await fetch(`https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(realmId)}/companyinfo/${encodeURIComponent(realmId)}?minorversion=75`,{
      headers:{Authorization:`Bearer ${tokenData.access_token}`,Accept:'application/json'}
    })
    const companyData=await companyRes.json().catch(()=>({}))
    if(!companyRes.ok){
      return json({ok:false,message:'QuickBooks authorized the app, but the selected company could not be read. Please choose the Nashville company and try again.'},400)
    }
    const companyName=companyData?.CompanyInfo?.CompanyName||null

    const {data:existing}=await admin.from('accounting_connections')
      .select('id,connected_at')
      .eq('tenant_id',tenantId).eq('provider','quickbooks').maybeSingle()

    const row={
      id:existing?.id||`${tenantId}:quickbooks`,
      tenant_id:tenantId,
      provider:'quickbooks',
      external_company_id:realmId,
      external_company_name:companyName,
      access_token:tokenData.access_token,
      refresh_token:tokenData.refresh_token,
      token_expires_at:new Date(Date.now()+Number(tokenData.expires_in||3600)*1000).toISOString(),
      connected_by:null,
      connected_at:existing?.connected_at||new Date().toISOString(),
      last_sync_result:{ok:true,stage:'oauth_connected',company_id:realmId,company_name:companyName},
      status:'connected'
    }
    const {error:saveErr}=await admin.from('accounting_connections').upsert(row,{onConflict:'id'})
    if(saveErr) return json({ok:false,message:'QuickBooks connection could not be saved.'},500)

    return json({ok:true,message:companyName?`Connected to ${companyName}`:'QuickBooks connected.',company_name:companyName,company_id:realmId})
  }catch(e){
    console.error('[quickbooks-oauth-callback]',e)
    return json({ok:false,message:'QuickBooks connection failed.'},500)
  }
})