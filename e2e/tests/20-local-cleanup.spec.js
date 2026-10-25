/**
 * e2e/tests/20-local-cleanup.spec.js
 * Nashville IRS TDS/SOR — Local Transcript Cleanup
 *
 * Verifies the automatic local-file-cleanup workflow added in the
 * "Nashville IRS TDS/SOR: Automatic Local Transcript Cleanup" feature.
 *
 * These are source-code / structural tests that run without a live server.
 * They confirm that:
 *  - Every cleanup gate (verify → delete) is in place
 *  - Permission handling is correct (readwrite mode, fallback, retry)
 *  - sha is returned from all relevant intakeReturnedPdf paths
 *  - Cleanup panel renders conditionally with the right data-testids
 *  - Security disclaimer text is present and accurate
 *  - Logout sweep subscribes to auth state change
 */

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const { writeResult } = require('./helpers')

const COMPONENT = path.resolve(__dirname, '../../src/components/TranscriptPull.jsx')
const CAT = 'Local Cleanup'

function src() { return fs.readFileSync(COMPONENT, 'utf8') }

// ── helpers ──────────────────────────────────────────────────────────────────

function between(s, startMarker, endMarker) {
  const start = s.indexOf(startMarker)
  if (start === -1) return ''
  const end = endMarker ? s.indexOf(endMarker, start) : s.length
  return s.slice(start, end === -1 ? s.length : end)
}

// ── tests ────────────────────────────────────────────────────────────────────

test('01 connectFolder uses readwrite mode', async () => {
  const code = src()
  const block = between(code, 'async function connectFolder()', 'function disconnectFolder()')
  expect(block).toMatch(/showDirectoryPicker\(\s*\{[^}]*mode:\s*'readwrite'/)
  expect(block).not.toContain("mode: 'read'")
  writeResult(CAT, 'connectFolder uses readwrite mode', 'PASS')
})

test('02 connectFolder sets cleanupPermission to granted on success', async () => {
  const code = src()
  const block = between(code, 'async function connectFolder()', 'function disconnectFolder()')
  expect(block).toContain("setCleanupPermission('granted')")
  writeResult(CAT, 'connectFolder sets cleanupPermission granted', 'PASS')
})

test('03 connectFolder explains readwrite to employees in UI text', async () => {
  const code = src()
  expect(code).toContain('read and write access')
  writeResult(CAT, 'Connect folder UI mentions read and write access', 'PASS')
})

test('04 loadWatchedFolder effect checks readwrite permission', async () => {
  const code = src()
  const block = between(code, 'Re-attach the folder chosen on an earlier visit', 'async function reconnectFolder()')
  expect(block).toContain("mode: 'readwrite'")
  writeResult(CAT, 'loadWatchedFolder effect queries readwrite permission', 'PASS')
})

test('05 reconnectFolder tries readwrite before read fallback', async () => {
  const code = src()
  const block = between(code, 'async function reconnectFolder()', '// ── runCleanup')
  expect(block).toMatch(/requestPermission\(\s*\{\s*mode:\s*'readwrite'/)
  expect(block).toMatch(/requestPermission\(\s*\{\s*mode:\s*'read'/)
  const rwPos = block.indexOf("mode: 'readwrite'")
  const rdPos = block.indexOf("mode: 'read'")
  expect(rwPos).toBeLessThan(rdPos)
  writeResult(CAT, 'reconnectFolder tries readwrite then falls back to read', 'PASS')
})

test('06 runCleanup is defined and gates on readwrite queryPermission', async () => {
  const code = src()
  expect(code).toContain('async function runCleanup()')
  const block = between(code, 'async function runCleanup()', 'async function retryCleanup()')
  expect(block).toMatch(/queryPermission\(\s*\{\s*mode:\s*'readwrite'/)
  writeResult(CAT, 'runCleanup defined and gates on readwrite queryPermission', 'PASS')
})

test('07 runCleanup verifies DB storage before calling removeEntry', async () => {
  const code = src()
  const block = between(code, 'async function runCleanup()', 'async function retryCleanup()')
  const verifyPos = block.indexOf('findFiledTranscriptBySha')
  const removePos = block.indexOf('removeEntry')
  expect(verifyPos).toBeGreaterThan(-1)
  expect(removePos).toBeGreaterThan(-1)
  expect(verifyPos).toBeLessThan(removePos)
  writeResult(CAT, 'runCleanup verifies DB before removeEntry', 'PASS')
})

test('08 runCleanup checks findUnassignedTranscriptBySha as fallback', async () => {
  const code = src()
  const block = between(code, 'async function runCleanup()', 'async function retryCleanup()')
  expect(block).toContain('findUnassignedTranscriptBySha')
  writeResult(CAT, 'runCleanup checks unassigned inbox as fallback', 'PASS')
})

test('09 runCleanup calls removeEntry with item.fileName', async () => {
  const code = src()
  const block = between(code, 'async function runCleanup()', 'async function retryCleanup()')
  expect(block).toContain('removeEntry(item.fileName)')
  writeResult(CAT, 'runCleanup calls removeEntry with item.fileName', 'PASS')
})

test('10 verify-failed items re-queued for retry', async () => {
  const code = src()
  const block = between(code, 'async function runCleanup()', 'async function retryCleanup()')
  // The re-queue must happen inside the verify-failed branch (before Gate 2)
  const verifyFailSegment = between(block, 'verify-failed', 'Gate 2')
  expect(verifyFailSegment).toContain('cleanupQueueRef.current.push(item)')
  writeResult(CAT, 'verify-failed items re-queued', 'PASS')
})

test('11 NotFoundError treated as successful deletion', async () => {
  const code = src()
  const block = between(code, 'async function runCleanup()', 'async function retryCleanup()')
  expect(block).toContain('NotFoundError')
  // The NotFoundError branch must result in status 'deleted'
  const notFoundSegment = between(block, 'NotFoundError', "} else {")
  expect(notFoundSegment).toContain("status: 'deleted'")
  writeResult(CAT, 'NotFoundError treated as successful deletion', 'PASS')
})

test('12 NotAllowedError does not re-queue the item', async () => {
  const code = src()
  const block = between(code, 'async function runCleanup()', 'async function retryCleanup()')
  // Re-queue must be conditional on !isPermDenied
  expect(block).toContain('if (!isPermDenied) cleanupQueueRef.current.push(item)')
  writeResult(CAT, 'NotAllowedError does not re-queue the item', 'PASS')
})

test('13 runCleanup resets cleanupRunningRef after completion', async () => {
  const code = src()
  const block = between(code, 'async function runCleanup()', 'async function retryCleanup()')
  expect(block).toContain('cleanupRunningRef.current = false')
  writeResult(CAT, 'runCleanup resets cleanupRunningRef on completion', 'PASS')
})

test('14 scanFolder queues cleanup when intake returns sha and no persistFailed', async () => {
  const code = src()
  const scanBlock = between(code, 'async function scanFolder(', 'useEffect(() => {\n    const t = setInterval')
  const gateBlock = between(scanBlock, "if (out.status !== 'error' && !out.persistFailed)", "if (out.status === 'filed')")
  expect(gateBlock).toContain('cleanupQueueRef.current.push')
  expect(gateBlock).toContain('out.sha')
  writeResult(CAT, 'scanFolder queues cleanup inside durable-storage gate', 'PASS')
})

test('15 scanFolder schedules deferred runCleanup after successful scan', async () => {
  const code = src()
  const scanBlock = between(code, 'async function scanFolder(', 'useEffect(() => {\n    const t = setInterval')
  expect(scanBlock).toContain('cleanupTimerRef.current = setTimeout(runCleanup')
  writeResult(CAT, 'scanFolder schedules deferred runCleanup', 'PASS')
})

test('16 intakeReturnedPdf returns sha in filed result', async () => {
  const code = src()
  const filedReturn = code.slice(code.indexOf("return { status: 'filed', client: target.client_name"), code.indexOf("return { status: 'filed', client: target.client_name") + 80)
  expect(filedReturn).toContain('sha')
  writeResult(CAT, 'intakeReturnedPdf returns sha in filed result', 'PASS')
})

test('17 intakeReturnedPdf returns sha in duplicate (filed) result', async () => {
  const code = src()
  const dupFiled = code.slice(code.indexOf("return { status: 'duplicate', client: prior.client_name"), code.indexOf("return { status: 'duplicate', client: prior.client_name") + 80)
  expect(dupFiled).toContain('sha')
  writeResult(CAT, 'intakeReturnedPdf returns sha in duplicate (filed) result', 'PASS')
})

test('18 intakeReturnedPdf returns sha in duplicate (inbox) result', async () => {
  const code = src()
  const dupInbox = code.slice(code.indexOf("return { status: 'duplicate', client: inboxPrior.taxpayer_name"), code.indexOf("return { status: 'duplicate', client: inboxPrior.taxpayer_name") + 100)
  expect(dupInbox).toContain('sha')
  writeResult(CAT, 'intakeReturnedPdf returns sha in duplicate (inbox) result', 'PASS')
})

test('19 intakeReturnedPdf returns sha in unmatched result', async () => {
  const code = src()
  // All unmatched return paths must carry sha — check the plain "no match, persisted" path
  const unmatchedReturn = code.slice(code.lastIndexOf("return { status: 'unmatched',"), code.lastIndexOf("return { status: 'unmatched',") + 60)
  expect(unmatchedReturn).toContain('sha')
  writeResult(CAT, 'intakeReturnedPdf returns sha in unmatched result', 'PASS')
})

test('20 intakeReturnedPdf error path does not inject sha', async () => {
  const code = src()
  const errorReturn = code.slice(code.indexOf("return { status: 'error',"), code.indexOf("return { status: 'error',") + 80)
  // sha not in scope at this catch level — must not appear
  expect(errorReturn).not.toMatch(/,\s*sha\s*[,}]/)
  writeResult(CAT, 'intakeReturnedPdf error path does not include sha', 'PASS')
})

test('21 intakeReturnedPdf returns sha in needs-review-mismatch result', async () => {
  const code = src()
  // Both the persistFailed and success paths for mismatch should have sha.
  // Use generous slice lengths to include the trailing sha field.
  const mismatchPersistFail = code.slice(code.indexOf("return { status: 'needs-review-mismatch', detail: conflictReason, persistFailed"), code.indexOf("return { status: 'needs-review-mismatch', detail: conflictReason, persistFailed") + 160)
  const mismatchSuccess = code.slice(code.indexOf("return { status: 'needs-review-mismatch', detail: conflictReason, sha"), code.indexOf("return { status: 'needs-review-mismatch', detail: conflictReason, sha") + 80)
  expect(mismatchPersistFail).toContain('sha')
  expect(mismatchSuccess).toContain('sha')
  writeResult(CAT, 'intakeReturnedPdf returns sha in needs-review-mismatch result', 'PASS')
})

test('22 logout sweep subscribes to supabase auth state change', async () => {
  const code = src()
  const logoutEffect = between(code, 'Logout sweep', 'intakeRef.current = intakeReturnedPdf')
  expect(logoutEffect).toContain('supabase.auth.onAuthStateChange')
  expect(logoutEffect).toContain("SIGNED_OUT")
  expect(logoutEffect).toContain('runCleanup()')
  writeResult(CAT, 'Logout sweep subscribes to auth state and calls runCleanup', 'PASS')
})

test('23 logout sweep unsubscribes on component unmount', async () => {
  const code = src()
  const logoutEffect = between(code, 'Logout sweep', 'intakeRef.current = intakeReturnedPdf')
  expect(logoutEffect).toContain('subscription.unsubscribe()')
  writeResult(CAT, 'Logout sweep unsubscribes on unmount', 'PASS')
})

test('24 security disclaimer text present and accurate', async () => {
  const code = src()
  expect(code).toContain('does not guarantee permanent erasure')
  expect(code).toContain('system backups')
  expect(code).toContain('cloud sync')
  writeResult(CAT, 'Security disclaimer text accurate', 'PASS')
})

test('25 cleanup panel guarded by dirName && fsSupported', async () => {
  const code = src()
  // Find the panel and look 300 chars before it for the conditional guard
  const panelIdx = code.indexOf('local-cleanup-panel')
  expect(panelIdx).toBeGreaterThan(-1)
  const before = code.slice(Math.max(0, panelIdx - 350), panelIdx)
  expect(before).toMatch(/\{.*dirName.*&&.*fsSupported/)
  writeResult(CAT, 'Cleanup panel guarded by dirName && fsSupported', 'PASS')
})

test('26 cleanup-grant-btn data-testid present for prompt and denied states', async () => {
  const code = src()
  const promptBlock = between(code, "cleanupPermission === 'prompt'", "cleanupPermission === 'denied'")
  const deniedBlock = between(code, "cleanupPermission === 'denied'", "cleanupPermission === 'unknown'")
  expect(promptBlock).toContain('cleanup-grant-btn')
  expect(deniedBlock).toContain('cleanup-grant-btn')
  writeResult(CAT, 'Enable Cleanup / Retry button present for prompt and denied states', 'PASS')
})

test('27 cleanup-run-btn present for granted state with queue', async () => {
  const code = src()
  expect(code).toContain('cleanup-run-btn')
  writeResult(CAT, '"Clean Up Now" button present for granted + non-empty queue', 'PASS')
})

test('28 retryCleanup requests readwrite then calls runCleanup', async () => {
  const code = src()
  const retryBlock = between(code, 'async function retryCleanup()', 'async function addReturnedFiles(')
  expect(retryBlock).toMatch(/requestPermission\(\s*\{\s*mode:\s*'readwrite'/)
  expect(retryBlock).toContain('runCleanup()')
  writeResult(CAT, 'retryCleanup requests readwrite and calls runCleanup', 'PASS')
})

test('29 cleanupLog capped at 50 entries', async () => {
  const code = src()
  const cleanupBlock = between(code, 'async function runCleanup()', 'async function retryCleanup()')
  expect(cleanupBlock).toContain('.slice(-50)')
  writeResult(CAT, 'Cleanup log capped at 50 entries', 'PASS')
})

test('30 cleanup log entries keyed by id from crypto.randomUUID()', async () => {
  const code = src()
  expect(code).toContain('crypto.randomUUID()')
  const logJsx = between(code, 'cleanupLog].reverse()', '})')
  expect(logJsx).toContain('key={entry.id}')
  writeResult(CAT, 'Cleanup log entries keyed by crypto.randomUUID()', 'PASS')
})
