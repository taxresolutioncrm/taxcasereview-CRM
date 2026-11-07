// Client-side Excel export for already-authorized report data.
// Spreadsheet formulas must never be evaluated from user-controlled names/notes.
const safeText = value => {
  const text = String(value ?? '')
  return /^[\s]*[=+@\-\t\r]/.test(text) ? "'" + text : text
}

export async function exportReportXlsx({ filename, sheetName, headers, rows, moneyColumns = [], decimalColumns = [] }) {
  const XLSX = await import('xlsx')
  const table = [headers.map(safeText), ...rows.map(row =>
    row.map((value, i) => typeof value === 'number' && Number.isFinite(value) ? value : safeText(value))
  )]
  const sheet = XLSX.utils.aoa_to_sheet(table)
  sheet['!cols'] = headers.map((heading, i) => ({
    wch: Math.min(45, Math.max(14, String(heading).length + 3, ...rows.slice(0, 150).map(row => Math.min(42, String(row[i] ?? '').length + 2))))
  }))
  if (sheet['!ref']) {
    const bounds = XLSX.utils.decode_range(sheet['!ref'])
    for (let r = 1; r <= bounds.e.r; r++) {
      for (const col of moneyColumns) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c: col })]
        if (cell?.t === 'n') cell.z = '#,##0.00;[Red](#,##0.00)'
      }
      for (const col of decimalColumns) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c: col })]
        if (cell?.t === 'n') cell.z = '0.00'
      }
    }
    sheet['!autofilter'] = { ref: sheet['!ref'] }
  }
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, sheetName.slice(0, 31))
  XLSX.writeFile(book, filename.endsWith('.xlsx') ? filename : filename + '.xlsx', { compression: true })
}
