import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { pdfText, docType, fieldList } = await req.json()

    const GROQ_KEY = Deno.env.get('GROQ_API_KEY')
    if (!GROQ_KEY) throw new Error('GROQ_API_KEY not set')

    if (!pdfText || pdfText.trim().length < 5) {
      return new Response(JSON.stringify({ parsed: {}, error: 'No text extracted from PDF' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        max_tokens: 2000,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a professional tax document parser. Extract values from tax document text and return ONLY valid JSON. No explanation, no markdown, no backticks — just the raw JSON object.'
          },
          {
            role: 'user',
            content: `Parse this ${docType} tax document text and extract all values.

RULES:
- If multiple W-2s from DIFFERENT employers exist, ADD wages together and ADD withholding together
- For employer name/EIN: use the FIRST employer
- For employee name/SSN: use the employee info
- Dollar amounts: numbers only, no $ or commas (e.g. 55500.14)
- EINs: format XX-XXXXXXX
- SSNs: format XXX-XX-XXXX
- Use null for missing fields
- Return ONLY a JSON object with these exact keys: {${fieldList}}

Document text:
${pdfText.substring(0, 12000)}`
          }
        ]
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Groq error:', response.status, errText)
      return new Response(JSON.stringify({
        error: `Tax document parser provider error (${response.status})`,
        detail: errText.substring(0, 300),
        parsed: {}
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content || '{}'
    console.log('Groq response:', text.substring(0, 300))

    let parsed = {}
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
    } catch {
      const match = text.match(/\{[\s\S]*\}/)
      if (match) { try { parsed = JSON.parse(match[0]) } catch { parsed = {} } }
    }

    return new Response(JSON.stringify({ parsed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (e) {
    console.error('parse-tax-doc error:', e)
    return new Response(JSON.stringify({ error: (e as Error).message, parsed: {} }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
