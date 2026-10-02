// TaxRes transcript AI ingestion layer
// Runs AFTER a transcript reaches the CRM — never replaces or redesigns TDS/SOR/session-isolation.
//
// Routing priority (must not be altered):
//   1. Original client_id / request binding
//   2. Taxpayer identifiers — masked SSN/EIN last-4, name
//   3. Tax year + transcript type
//   4. AI classification — additional validation only; never overrides a binding conflict
//
// Reuses the existing RomyLabs parse-tax-doc edge function as the document-AI validation layer.
// SECURITY: Never touches IRS/ID.me credentials, cookies, tokens, or the browser session channel.

import { supabase } from './supabase'
import { extractPdfText, extractHtmlText } from './irsTranscriptParser'

export const DOC_TYPE_REGISTRY = {
  irs_transcript: {
    label: 'IRS Transcript',
    docTypeName: 'IRS Transcript',
    fieldList: [
      'transcript_type', 'tax_year', 'taxpayer_name', 'tin_last4',
      'account_balance', 'accrued_penalty', 'accrued_interest',
      'assessment_date', 'csed_estimate', 'return_filed_date',
      'filing_status', 'adjusted_gross_income', 'taxable_income',
      'unfiled_return', 'balance_due', 'installment_agreement',
      'currently_not_collectible', 'lien_filed', 'levy_issued',
    ].join(', '),
    normalizeType(raw) {
      if (!raw) return null
      const s = String(raw).trim()
      const map = [
        [/account/i, 'Account Transcript'],
        [/wage.*(income|w.?2)/i, 'Wage and Income'],
        [/record.*(of.)?account/i, 'Record of Account'],
        [/return/i, 'Return Transcript'],
        [/non.?fil/i, 'Verification of Non-Filing'],
      ]
      for (const [re, canonical] of map) if (re.test(s)) return canonical
      return s
    },
  },
}

export async function invokeParsetaxdoc(text, docType = 'IRS Transcript') {
  const entry = Object.values(DOC_TYPE_REGISTRY).find(e => e.docTypeName === docType)
  const fieldList = entry?.fieldList || 'transcript_type, tax_year, taxpayer_name, tin_last4, account_balance'
  try {
    const { data, error } = await supabase.functions.invoke('parse-tax-doc', {
      body: { pdfText: String(text || '').slice(0, 12000), docType, fieldList },
    })
    if (error) {
      console.warn('[transcriptAI] parse-tax-doc edge function error:', error.message || error)
      return { parsed: {} }
    }
    return { parsed: data?.parsed || {} }
  } catch (e) {
    console.warn('[transcriptAI] parse-tax-doc invocation failed:', e?.message)
    return { parsed: {} }
  }
}

export function aiValidateTranscript(patternResult, aiResult) {
  const p = patternResult || {}
  const a = aiResult?.parsed || {}
  const conflicts = []

  if (p.tax_year && a.tax_year) {
    const pYear = String(p.tax_year).trim()
    const aYear = String(a.tax_year).trim().replace(/[^0-9]/g, '').slice(0, 4)
    if (pYear && aYear && pYear !== aYear) conflicts.push(`Tax year mismatch: pattern=${pYear}, AI=${aYear}`)
  }

  if (a.tin_last4) {
    const aLast4 = String(a.tin_last4).replace(/\D/g, '').slice(-4)
    if (p.tinLast4 && aLast4 && aLast4 !== p.tinLast4) conflicts.push(`TIN last-4 mismatch: pattern=${p.tinLast4}, AI=${aLast4}`)
  }

  const docEntry = DOC_TYPE_REGISTRY.irs_transcript
  const aiType = docEntry.normalizeType(a.transcript_type)
  if (p.transcript_type && aiType && aiType !== 'Other' && p.transcript_type !== 'Other' && aiType !== p.transcript_type) {
    conflicts.push(`Transcript type mismatch: pattern=${p.transcript_type}, AI=${aiType}`)
  }

  const aiExtras = {}
  const fieldsToCopy = [
    'taxpayer_name', 'filing_status', 'adjusted_gross_income', 'taxable_income',
    'return_filed_date', 'assessment_date', 'account_balance',
    'accrued_penalty', 'accrued_interest', 'csed_estimate',
    'unfiled_return', 'balance_due', 'installment_agreement',
    'currently_not_collectible', 'lien_filed', 'levy_issued',
  ]
  for (const f of fieldsToCopy) {
    if (a[f] !== null && a[f] !== undefined && a[f] !== '') aiExtras[f] = a[f]
  }

  return { consistent: conflicts.length === 0, conflicts, aiExtras }
}

export function aiBindingConflict(binding, _patternResult, aiValidation) {
  if (!binding) return null
  const conflicts = aiValidation?.conflicts || []
  const tinConflict = conflicts.find(c => c.startsWith('TIN last-4 mismatch'))
  if (tinConflict) return `AI flagged a TIN mismatch — ${tinConflict}. Hold for manual confirmation.`
  return null
}

export async function extractDocText(file) {
  const isHtml = /\.html?$/i.test(file.name) || file.type === 'text/html'
  return isHtml ? extractHtmlText(file) : extractPdfText(file)
}

export async function aiIngestDocument(file, opts = {}) {
  const {
    patternResult = {},
    tinLast4FromPattern = null,
    binding = null,
    docTypeKey = 'irs_transcript',
    text: preExtractedText = null,
  } = opts

  const docEntry = DOC_TYPE_REGISTRY[docTypeKey]
  if (!docEntry) return { status: 'ai-unavailable', reason: `Unknown document type key: ${docTypeKey}` }

  let text = preExtractedText
  if (!text) {
    try { text = await extractDocText(file) }
    catch (e) { return { status: 'ai-unavailable', reason: `Text extraction failed: ${e?.message}` } }
  }
  if (!text || text.trim().length < 40) return { status: 'ai-unavailable', reason: 'Insufficient text for AI analysis' }

  const { parsed: aiParsed } = await invokeParsetaxdoc(text, docEntry.docTypeName)
  const hasAiContent = aiParsed && Object.keys(aiParsed).some(k => aiParsed[k] !== null && aiParsed[k] !== undefined && aiParsed[k] !== '')
  if (!hasAiContent) return { status: 'ai-unavailable', reason: 'AI returned no extractable fields — using pattern results only' }

  const patternForValidation = { ...patternResult, tinLast4: tinLast4FromPattern }
  const aiValidation = aiValidateTranscript(patternForValidation, { parsed: aiParsed })
  const conflictReason = aiBindingConflict(binding, patternForValidation, aiValidation)
  if (conflictReason) {
    return { status: 'ai-conflict', reason: conflictReason, conflicts: aiValidation.conflicts, aiValidation }
  }

  const mergedAnalysis = {
    ...aiValidation.aiExtras,
    ...patternResult,
    transcript_type: patternResult.transcript_type || (docEntry.normalizeType?.(aiParsed.transcript_type) ?? patternResult.transcript_type),
    taxpayer_name: patternResult.taxpayer_name || aiParsed.taxpayer_name || null,
    ai_validated: true,
    ai_conflicts: aiValidation.conflicts,
    ai_model: 'llama-3.3-70b-versatile',
  }

  return { status: 'ai-validated', aiValidation, mergedAnalysis }
}
