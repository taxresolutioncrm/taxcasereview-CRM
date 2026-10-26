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
  expect(docs).toContain('minWidth:650')
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
  expect(docs).toContain("minWidth:470")
  expect(docs).toContain("gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))'")
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
