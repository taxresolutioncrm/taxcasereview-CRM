// TaxRes transcript AI ingestion layer
// Runs AFTER a transcript reaches the CRM — never replaces or redesigns TDS/SOR/session-isolation.
//
// Routing priority (must not be altered):
//   1. Original client_id / request binding (from irsBindingsRef / requestIds)
//   2. Taxpayer identifiers — masked SSN/EIN last-4, name
//   3. Tax year + transcript type
//   4. AI classification — additional validation only; never overrides a binding conflict
//
// Reuses the existing RomyLabs parse-tax-doc edge function (Groq/llama-3.3-70b) as the
// standard ingestion pipeline for IRS transcripts, and is designed to accept W-2s, 1099s,
// IRS notices, state notices, returns, POAs, and other document types in the future.
//
// SECURITY: Never touches IRS/ID.me credentials, cookies, tokens, or the window.opener chain.
// No new database tables. Sandbox only — do not deploy until Romy says "deploy".

import { supabase } from './supabase'
import { extractPdfText, extractHtmlText } from './irsTranscriptParser'

// ── Document type registry ──────────────────────────────────────────────────
// Each entry describes one document class the AI pipeline can handle.
// To add W-2s, 1099s, notices, etc. in the future: add a new entry here.
export const DOC_TYPE_REGISTRY = {
  irs_transcript: {
    label: 'IRS Transcript',
    docTypeName: 'IRS Transcript',
    // Fields the AI should extract — supplements pattern parsing, doesn't replace it
    fieldList: [
      'transcript_type', 'tax_year', 'taxpayer_name', 'tin_last4',
      'account_balance', 'accrued_penalty', 'accrued_interest',
      'assessment_date', 'csed_estimate', 'return_filed_date',
      'filing_status', 'adjusted_gross_income', 'taxable_income',
      'unfiled_return', 'balance_due', 'installment_agreement',
      'currently_not_collectible', 'lien_filed', 'levy_issued',
    ].join(', '),
    // Normalize transcript_type strings the AI may produce
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
  // Future: w2, f1099, irs_notice, state_notice, poa, return — add entries here
}

// ── Core: invoke the parse-tax-doc edge function ────────────────────────────
// Thin wrapper around the RomyLabs document-AI framework.
// Returns { parsed: object } or throws. Never throws on Groq/LLM errors — returns empty parsed.
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

// ── AI validation: cross-check pattern output against AI output ─────────────
// patternResult: output of parseIrsTranscript (ground truth for pattern-matched fields)
// aiResult: output of invokeParsetaxdoc
// Returns { consistent: boolean, conflicts: string[], aiExtras: object }
export function aiValidateTranscript(patternResult, aiResult) {
  const p = patternResult || {}
  const a = aiResult?.parsed || {}
  const conflicts = []

  // Cross-check tax year
  if (p.tax_year && a.tax_year) {
    const pYear = String(p.tax_year).trim()
    const aYear = String(a.tax_year).trim().replace(/[^0-9]/g, '').slice(0, 4)
    if (pYear && aYear && pYear !== aYear) {
      conflicts.push(`Tax year mismatch: pattern=${pYear}, AI=${aYear}`)
    }
  }

  // Cross-check TIN last 4
  if (a.tin_last4) {
    const aLast4 = String(a.tin_last4).replace(/\D/g, '').slice(-4)
    if (p.tinLast4 && aLast4 && aLast4 !== p.tinLast4) {
      conflicts.push(`TIN last-4 mismatch: pattern=${p.tinLast4}, AI=${aLast4}`)
    }
  }

  // Cross-check transcript type (lenient — just warn, AI type phrasing varies)
  const docEntry = DOC_TYPE_REGISTRY.irs_transcript
  const aiType = docEntry.normalizeType(a.transcript_type)
  if (p.transcript_type && aiType && aiType !== 'Other' && p.transcript_type !== 'Other') {
    if (aiType !== p.transcript_type) {
      conflicts.push(`Transcript type mismatch: pattern=${p.transcript_type}, AI=${aiType}`)
    }
  }

  // Collect fields the AI found that patterns did not (enrichment)
  const aiExtras = {}
  const fieldsToCopy = [
    'taxpayer_name', 'filing_status', 'adjusted_gross_income', 'taxable_income',
    'return_filed_date', 'assessment_date', 'account_balance',
    'accrued_penalty', 'accrued_interest', 'csed_estimate',
    'unfiled_return', 'balance_due', 'installment_agreement',
    'currently_not_collectible', 'lien_filed', 'levy_issued',
  ]
  for (const f of fieldsToCopy) {
    if (a[f] !== null && a[f] !== undefined && a[f] !== '') {
      aiExtras[f] = a[f]
    }
  }

  return { consistent: conflicts.length === 0, conflicts, aiExtras }
}

// ── Mismatch detection ──────────────────────────────────────────────────────
// Returns a reason string if the AI says this transcript does NOT belong to the bound client,
// or null if AI agrees with the binding.
// AI never overrides a confirmed binding — it only flags for human review.
export function aiBindingConflict(binding, patternResult, aiValidation) {
  if (!binding) return null  // no binding — nothing to conflict with
  const { conflicts } = aiValidation
  if (!conflicts.length) return null

  // Only TIN/name conflicts are actionable mismatches for "Needs Review"
  const tinConflict = conflicts.find(c => c.startsWith('TIN last-4 mismatch'))
  if (tinConflict) {
    return `AI flagged a TIN mismatch — ${tinConflict}. Document filed to "Needs Review" for manual confirmation.`
  }

  // Year/type conflicts are non-blocking warnings (AI phrasing varies; patterns are ground truth)
  return null
}

// ── Text extraction ─────────────────────────────────────────────────────────
export async function extractDocText(file) {
  const isHtml = /\.html?$/i.test(file.name) || file.type === 'text/html'
  return isHtml ? extractHtmlText(file) : extractPdfText(file)
}

// ── Main entry point: AI ingestion for a single document ────────────────────
//
// file: File object (PDF or HTML)
// opts.patternResult: output of parseIrsTranscript (already computed upstream, don't repeat)
// opts.tinLast4FromPattern: TIN last-4 extracted by pattern parser
// opts.binding: { clientId, requestIds, agentName, tenantId, nonce } — from irsBindingsRef
// opts.docTypeKey: key into DOC_TYPE_REGISTRY (default: 'irs_transcript')
// opts.text: pre-extracted text (optional — saves a second extraction)
//
// Returns one of:
//   { status: 'ai-validated',   aiValidation, mergedAnalysis }  — AI agrees, ready to store
//   { status: 'ai-conflict',    reason, conflicts, aiValidation } — TIN/name mismatch → "Needs Review"
//   { status: 'ai-unavailable', reason }                         — Groq down/empty; caller falls back to pattern-only
//
// IMPORTANT: This function never calls storeTranscriptAnalysis. The caller decides whether to
// store based on the returned status. This keeps the storage path in fileBrowserTranscriptsNow
// where the existing dedup/queue/rollback logic already lives.
export async function aiIngestDocument(file, opts = {}) {
  const {
    patternResult = {},
    tinLast4FromPattern = null,
    binding = null,
    docTypeKey = 'irs_transcript',
    text: preExtractedText = null,
  } = opts

  const docEntry = DOC_TYPE_REGISTRY[docTypeKey]
  if (!docEntry) {
    return { status: 'ai-unavailable', reason: `Unknown document type key: ${docTypeKey}` }
  }

  // Extract text if not already provided
  let text = preExtractedText
  if (!text) {
    try {
      text = await extractDocText(file)
    } catch (e) {
      return { status: 'ai-unavailable', reason: `Text extraction failed: ${e?.message}` }
    }
  }

  if (!text || text.trim().length < 40) {
    return { status: 'ai-unavailable', reason: 'Insufficient text for AI analysis' }
  }

  // Run AI
  const { parsed: aiParsed } = await invokeParsetaxdoc(text, docEntry.docTypeName)

  // If AI returned nothing useful, fall back gracefully
  const hasAiContent = aiParsed && Object.keys(aiParsed).some(k => aiParsed[k] !== null && aiParsed[k] !== undefined && aiParsed[k] !== '')
  if (!hasAiContent) {
    return { status: 'ai-unavailable', reason: 'AI returned no extractable fields — using pattern results only' }
  }

  // Validate AI output against pattern output
  const patternForValidation = {
    ...patternResult,
    tinLast4: tinLast4FromPattern,
  }
  const aiValidation = aiValidateTranscript(patternForValidation, { parsed: aiParsed })

  // Check for mismatch against binding
  const conflictReason = aiBindingConflict(binding, patternForValidation, aiValidation)
  if (conflictReason) {
    return {
      status: 'ai-conflict',
      reason: conflictReason,
      conflicts: aiValidation.conflicts,
      aiValidation,
    }
  }

  // Merge: pattern result is ground truth for all fields it found; AI fills gaps
  const mergedAnalysis = {
    ...aiValidation.aiExtras,   // AI extras first (lower priority)
    ...patternResult,           // Pattern result wins on overlap
    // Normalize AI transcript type if pattern didn't find one
    transcript_type: patternResult.transcript_type ||
      (docEntry.normalizeType?.(aiParsed.transcript_type) ?? patternResult.transcript_type),
    // Preserve AI-extracted taxpayer name if pattern didn't extract it
    taxpayer_name: patternResult.taxpayer_name || aiParsed.taxpayer_name || null,
    // AI validation results for audit trail
    ai_validated: true,
    ai_conflicts: aiValidation.conflicts,
    ai_model: 'llama-3.3-70b-versatile',
  }

  return { status: 'ai-validated', aiValidation, mergedAnalysis }
}

// ── "Needs Review — Client Mismatch" queue entry ────────────────────────────
// Returns a structured entry suitable for the needsReviewMismatch state in TranscriptPull.jsx
export function makeMismatchEntry(key, file, analysis, conflictReason, conflicts, binding = null) {
  return {
    key,
    fileName: file.name,
    file,
    analysis,
    conflictReason,
    conflicts: conflicts || [],
    boundClientId: binding?.clientId || null,
    boundClientName: binding?.agentName || null,
    assignTo: '',
    queuedAt: Date.now(),
  }
}
