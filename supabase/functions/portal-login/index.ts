// SSN-last-four client login retired. All client authentication now occurs
// through email possession proof at /functions/v1/portal-email-login.
// This endpoint does not inspect, accept or compare an SSN or create a session.
const headers={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json',
  'Cache-Control':'no-store',
}
Deno.serve(req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers})
  return new Response(JSON.stringify({
    error:'SSN-based sign-in is retired. Use the secure email verification code on your Client Portal.',
  }),{status:410,headers})
})
