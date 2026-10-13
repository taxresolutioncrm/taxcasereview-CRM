Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }
  return new Response(JSON.stringify({
    error: 'This office uses a dedicated runtime.',
    code: 'DEDICATED_RUNTIME_REQUIRED',
  }), {
    status: 410,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
})
