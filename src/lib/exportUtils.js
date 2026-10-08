import { FIRM } from './firmBranding'
// ── Shared export utilities ────────────────────────────────────────────────

export function exportCSV(rows, filename) {
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv'
  a.click()
}

export function exportPDF(title, sections) {
  // sections: [{ heading, rows: [[col1, col2, ...]], headers: [...] }]
  const w = window.open('', '_blank')
  const now = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  w.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; padding: 32px; color: #1e293b; }
    h1 { font-size: 20px; font-weight: 800; color: #1e3a8a; margin-bottom: 4px; }
    .meta { font-size: 12px; color: #64748b; margin-bottom: 24px; }
    h2 { font-size: 14px; font-weight: 700; margin: 24px 0 8px; color: #1e3a8a; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 12px; }
    th { background: #f1f5f9; padding: 8px 10px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; border: 1px solid #e2e8f0; }
    td { padding: 7px 10px; border: 1px solid #e2e8f0; }
    tr:nth-child(even) td { background: #f8fafc; }
    .footer { margin-top: 32px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
    @media print { body { padding: 16px; } }
  </style></head><body>
  <h1>${title}</h1>
  <div class="meta">${FIRM.name || 'Firm'} · Generated ${now}</div>
  ${sections.map(s => `
    <h2>${s.heading}</h2>
    <table>
      ${s.headers ? `<thead><tr>${s.headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>` : ''}
      <tbody>${s.rows.map(r => `<tr>${r.map(c => `<td>${c ?? '—'}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  `).join('')}
  <div class="footer">${[FIRM.name,FIRM.address,FIRM.phone,FIRM.email].filter(Boolean).join(' · ')}</div>
  </body></html>`)
  w.document.close()
  setTimeout(() => w.print(), 400)
}

export function exportExcel(rows, filename) {
  // Simple HTML table that Excel opens natively — no library needed
  const html = `<table>${rows.map((r, i) =>
    `<tr>${r.map(c => i === 0 ? `<th><b>${c}</b></th>` : `<td>${c ?? ''}</td>`).join('')}</tr>`
  ).join('')}</table>`
  const blob = new Blob([`<html><head><meta charset="UTF-8"></head><body>${html}</body></html>`],
    { type: 'application/vnd.ms-excel' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
  a.download = filename.endsWith('.xls') ? filename : filename + '.xls'
  a.click()
}
