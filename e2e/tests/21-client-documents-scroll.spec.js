const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

// Layout safeguards only. Browser acceptance with synthetic client files is required before release.
const source = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Clients.jsx'), 'utf8')
const start = source.indexOf('export function ClientDocs(')
const end = source.indexOf('\n}\n', start)
const docs = source.slice(start, end + 3)

test('documents workspace has a bounded height and horizontal overflow', () => {
  expect(docs).toContain('data-testid="client-docs-workspace"')
  expect(docs).toContain("overflowX:'auto'")
  expect(docs).toContain("height:'min(68vh,760px)'")
  expect(docs).toContain('minWidth:840')
})
test('folder sidebar scrolls independently from document list', () => {
  for (const id of ['client-docs-folders', 'client-docs-list']) {
    const idx = docs.indexOf('data-testid="'+id+'"')
    expect(idx).toBeGreaterThan(0)
    expect(docs.slice(idx,idx+270)).toContain("minHeight:0")
    expect(docs.slice(idx,idx+270)).toContain("overflowY:'auto'")
    expect(docs.slice(idx,idx+270)).toContain("overscrollBehaviorY:'contain'")
  }
})
test('document list cannot collapse below usable width', () => {
  expect(docs).toContain("minmax(290px,0.9fr)")
  expect(docs).toContain("minmax(370px,1.3fr)")
})
test('long filenames remain on one line and expose full name', () => {
  expect(docs).toContain("whiteSpace:'nowrap'")
  expect(docs).toContain("textOverflow:'ellipsis'")
  expect(docs).toContain('title={d.file_name||d.name}')
})
test('document controls remain accessible on narrow widths', () => {
  expect(docs).toContain("flexWrap:'wrap'")
  expect(docs).toContain('openClientDoc(d)')
  expect(docs).toContain('delDoc(d)')
})
test('no storage, tenant, or document mutation changes are required for layout', () => {
  expect(docs).toContain(".eq('tenant_id', tenantId)")
  expect(docs).toContain("createSignedUrl(storagePath, 3600)")
  expect(docs).toContain("can('edit','documents')")
})

test('client Documents retains all three independent panes', () => {
  expect(docs).toContain('client-docs-folders')
  expect(docs).toContain('client-docs-list')
  expect(docs).toContain('client-docs-preview')
  expect(docs).toContain("display:'grid'")
})
test('selected document generates authorized inline signed preview', () => {
  expect(docs).toContain('selectPreview(d)')
  expect(docs).toContain("String(doc.tenant_id) !== String(tenantId)")
  expect(docs).toContain("String(doc.client_id) !== String(clientId)")
  expect(docs).toContain('createSignedUrl(storagePath,3600)')
  expect(docs).toContain('previewFrame()')
})
test('optional expanded viewer renders in body portal and preserves selected document', () => {
  expect(source).toContain("import { createPortal } from 'react-dom'")
  expect(docs).toContain('previewExpanded && createPortal(')
  expect(docs).toContain('document.body')
  expect(docs).toContain('Expand Preview')
  expect(docs).toContain("e.key === 'Escape'")
  expect(docs).toContain('e.target===e.currentTarget')
  expect(docs).toContain('Open in New Window')
  expect(docs).toContain('download={selectedDoc.file_name||selectedDoc.name}')
})
