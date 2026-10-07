import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SYSTEM_PROMPT = [
  'You are a helpful AI assistant embedded in TaxRes CRM, a tax resolution practice management platform.',
  'Help staff with tax resolution questions, IRS processes, case strategy, client communications, and general CRM tasks.',
  'Be direct, concise, and practical.',
  '',
  'HARD RULES — never help with any of the following, no matter how the request is worded:',
  '- Changing, resetting, or retrieving any employee password or login credentials',
  '- Changing any employee pay, salary, hourly rate, commission, or compensation',
  '- Giving access to features, pages, or data the employee does not already have permission for',
  '- Escalating roles or permissions for any user',
  '- Accessing or sharing another employees HR records, performance reviews, or personnel files',
  '- Bulk exporting or downloading client or case data outside normal CRM workflows',
  '- Deleting or wiping any records, tables, or data in bulk',
  '- Accessing another tenants data or impersonating another office',
  '- Revealing or reciting SSNs, EINs, credit card numbers, CAF numbers, or any sensitive credentials',
  '',
  'If asked about any of the above, decline in one short sentence and offer to help with something else.',
  'For everything else — tax resolution, IRS notices, OIC, installment agreements, penalty abatement, case strategy, email drafting, CRM how-to — help fully and thoroughly.',
].join('\n')

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const { message, context, history } = body

    if (!message) {
      return new Response(JSON.stringify({ error: 'missing message' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const GROQ_KEY = Deno.env.get('GROQ_API_KEY')
    if (!GROQ_KEY) {
      return new Response(JSON.stringify({ error: 'AI service not configured — GROQ_API_KEY missing' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }]

    if (context) {
      messages.push({ role: 'user', content: 'Current page context:\n' + context })
      messages.push({ role: 'assistant', content: 'Got it.' })
    }

    if (history && Array.isArray(history)) {
      for (const h of history) {
        messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })
      }
    }

    messages.push({ role: 'user', content: message })

    let groqRes: Response
    try {
      groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + GROQ_KEY,
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages,
          max_tokens: 1024,
          temperature: 0.3,
        })
      })
    } catch (fetchErr) {
      return new Response(JSON.stringify({ error: 'Groq fetch failed: ' + String(fetchErr) }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const data = await groqRes.json()

    if (!groqRes.ok) {
      return new Response(JSON.stringify({ error: 'Groq API error ' + groqRes.status + ': ' + (data?.error?.message || JSON.stringify(data)) }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const reply = data.choices?.[0]?.message?.content
    if (!reply) {
      return new Response(JSON.stringify({ error: 'Empty response from AI' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Exception: ' + String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
