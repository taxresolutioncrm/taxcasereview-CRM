import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { FIRM } from './firmBranding'

const COLORS = {
  dark:    rgb(0.10, 0.12, 0.18),
  blue:    rgb(0.11, 0.38, 0.85),
  green:   rgb(0.08, 0.60, 0.35),
  red:     rgb(0.85, 0.15, 0.15),
  gray:    rgb(0.45, 0.50, 0.58),
  light:   rgb(0.94, 0.96, 0.99),
  white:   rgb(1, 1, 1),
  divider: rgb(0.85, 0.87, 0.92),
}

function n(val) { return parseFloat(val || 0) }
function fmt(val) {
  const v = parseFloat(val || 0)
  return v < 0
    ? `(${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
    : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export async function generateTaxReturnPdf(form, totals, preparer = {}) {
  const pdfDoc = await PDFDocument.create()
  const boldFont   = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica)
  let firmLogo = null, firmLogoW = 0, firmLogoH = 0
  if (FIRM.logoUrl) {
    try {
      const res = await fetch(FIRM.logoUrl)
      const bytes = await res.arrayBuffer()
      try { firmLogo = await pdfDoc.embedPng(bytes) } catch { firmLogo = await pdfDoc.embedJpg(bytes) }
      firmLogoH = 30
      firmLogoW = Math.min(110, (firmLogo.width / firmLogo.height) * firmLogoH)
    } catch (_) {}
  }

  const W = 612, H = 792
  const ML = 48, MR = 564, MT = 750

  let page = pdfDoc.addPage([W, H])
  let y = MT

  function newPage() {
    page = pdfDoc.addPage([W, H])
    y = MT
    drawHeader()
  }

  function checkY(needed = 20) {
    if (y < 60 + needed) newPage()
  }

  function drawHeader() {
    // Top bar
    page.drawRectangle({ x: 0, y: H - 52, width: W, height: 52, color: COLORS.blue })
    let headerX = ML
    if (firmLogo) {
      page.drawImage(firmLogo, { x:ML, y:H-43, width:firmLogoW, height:firmLogoH })
      headerX = ML + firmLogoW + 12
    }
    page.drawText((FIRM.name || 'Firm').toUpperCase(), { x: headerX, y: H - 28, size: 14, font: boldFont, color: COLORS.white })
    page.drawText([FIRM.phone, FIRM.fax && ('Fax: '+FIRM.fax)].filter(Boolean).join('  |  '), { x: headerX, y: H - 43, size: 8, font: regularFont, color: rgb(0.7, 0.8, 1) })

    const returnLabel = form.returnType || 'Tax Return'
    const labelW = boldFont.widthOfTextAtSize(returnLabel, 10)
    page.drawText(returnLabel, { x: MR - labelW, y: H - 28, size: 10, font: boldFont, color: COLORS.white })
    page.drawText(`Tax Year ${form.taxYear || ''}`, { x: MR - boldFont.widthOfTextAtSize(`Tax Year ${form.taxYear || ''}`, 8), y: H - 43, size: 8, font: regularFont, color: rgb(0.7, 0.8, 1) })

    y = H - 70
  }

  function drawSection(title) {
    checkY(30)
    y -= 8
    page.drawRectangle({ x: ML, y: y - 4, width: MR - ML, height: 18, color: COLORS.light })
    page.drawRectangle({ x: ML, y: y - 4, width: 4, height: 18, color: COLORS.blue })
    page.drawText(title.toUpperCase(), { x: ML + 10, y: y + 2, size: 8, font: boldFont, color: COLORS.blue })
    y -= 22
  }

  function drawLine(label, value, { bold = false, color = COLORS.dark, indent = 0, isTotal = false } = {}) {
    checkY(18)
    if (isTotal) {
      page.drawLine({ start: { x: ML + indent, y: y - 1 }, end: { x: MR, y: y - 1 }, thickness: 0.5, color: COLORS.divider })
    }
    const font = bold || isTotal ? boldFont : regularFont
    const size = isTotal ? 10 : 9
    page.drawText(label, { x: ML + indent + 8, y, size, font, color: bold ? COLORS.dark : COLORS.gray })
    const valStr = typeof value === 'string' ? value : fmt(value)
    const valW = font.widthOfTextAtSize(valStr, size)
    const valColor = isTotal
      ? (n(value) < 0 ? COLORS.red : COLORS.green)
      : color
    page.drawText(valStr, { x: MR - valW - 8, y, size, font, color: valColor })
    y -= size + 6
  }

  function drawDivider() {
    checkY(8)
    page.drawLine({ start: { x: ML, y }, end: { x: MR, y }, thickness: 0.3, color: COLORS.divider })
    y -= 8
  }

  function drawSpacer(h = 8) { y -= h }

  function drawTwoCol(items) {
    // items: [{label, value}]
    const colW = (MR - ML - 16) / 2
    let col = 0
    let rowY = y
    items.forEach(({ label, value }) => {
      checkY(28)
      const x = ML + col * (colW + 16)
      page.drawRectangle({ x, y: rowY - 14, width: colW, height: 28, color: COLORS.light })
      page.drawText(label, { x: x + 8, y: rowY + 8, size: 7, font: regularFont, color: COLORS.gray })
      page.drawText(String(value || '—'), { x: x + 8, y: rowY - 6, size: 9, font: boldFont, color: COLORS.dark })
      col++
      if (col === 2) { col = 0; rowY -= 36; y = rowY }
    })
    if (col === 1) { y = rowY - 36 }
    y -= 8
  }

  // ── PAGE 1: HEADER + CLIENT INFO ──
  drawHeader()

  // Client info box
  page.drawRectangle({ x: ML, y: y - 56, width: MR - ML, height: 64, color: COLORS.light, borderColor: COLORS.divider, borderWidth: 0.5 })
  page.drawText('CLIENT INFORMATION', { x: ML + 10, y: y - 6, size: 7, font: boldFont, color: COLORS.blue })
  page.drawText(form.clientName || '—', { x: ML + 10, y: y - 20, size: 13, font: boldFont, color: COLORS.dark })
  page.drawText(`Filing Status: ${form.filingStatus || '—'}`, { x: ML + 10, y: y - 36, size: 9, font: regularFont, color: COLORS.gray })
  page.drawText(`Return Type: ${form.returnType || '—'}`, { x: ML + 10, y: y - 48, size: 9, font: regularFont, color: COLORS.gray })

  const prepName = preparer.name || FIRM.name || 'Firm'
  const prepStr = `Prepared by: ${prepName}  |  PTIN: ${preparer.ptin || '—'}  |  Date: ${new Date().toLocaleDateString()}`
  page.drawText(prepStr, { x: MR - regularFont.widthOfTextAtSize(prepStr, 8) - 10, y: y - 20, size: 8, font: regularFont, color: COLORS.gray })
  page.drawText(`Return #: ${form.returnNum || 'DRAFT'}`, { x: MR - regularFont.widthOfTextAtSize(`Return #: ${form.returnNum || 'DRAFT'}`, 8) - 10, y: y - 36, size: 8, font: regularFont, color: COLORS.gray })

  y -= 76

  // ── INCOME SECTION ──
  const is1120S   = form.returnType === '1120S S-Corp'
  const is1065    = form.returnType === '1065 Partnership'
  const isBusiness = is1120S || is1065

  if (isBusiness) {
    drawSection('Revenue')
    drawLine('Gross Receipts / Sales',   n('biz_grossReceipts'))
    drawLine('Less: Returns & Allowances', -n(form.biz_returns), { indent: 10 })
    drawLine('Less: Cost of Goods Sold',  -n(form.biz_cogs), { indent: 10 })
    drawLine('Other Income',              n(form.biz_otherIncome))
    drawDivider()
    const grossInc = n(form.biz_grossReceipts) - n(form.biz_returns) - n(form.biz_cogs) + n(form.biz_otherIncome)
    drawLine('Gross Income', grossInc, { bold: true, isTotal: true })

    drawSection('Deductions')
    const expFields = [
      ['Compensation of Officers', form.biz_officerComp],
      ['Salaries & Wages', form.biz_wages],
      ['Repairs & Maintenance', form.biz_repairs],
      ['Bad Debts', form.biz_badDebts],
      ['Rents', form.biz_rents],
      ['Taxes & Licenses', form.biz_taxes],
      ['Interest', form.biz_interest],
      ['Depreciation', form.biz_depreciation],
      ['Advertising', form.biz_advertising],
      ['Pension & Profit Sharing', form.biz_pension],
      ['Employee Benefits', form.biz_empBenefits],
      ['Other Deductions', form.biz_otherDed],
    ].filter(([, v]) => n(v) !== 0)
    expFields.forEach(([l, v]) => drawLine(l, n(v), { indent: 10 }))
    const totalDed = expFields.reduce((s, [, v]) => s + n(v), 0)
    drawDivider()
    drawLine('Total Deductions', totalDed, { bold: true, isTotal: true })
    const netInc = grossInc - totalDed
    drawLine('Net Income / Loss', netInc, { bold: true, isTotal: true, color: netInc >= 0 ? COLORS.green : COLORS.red })

    if (is1120S) {
      drawSection('Officers & Shareholders')
      ;[
        ['Officer Compensation', form.biz_officerComp],
        ['Shareholder Distributions', form.biz_distributions],
        ['Retained Earnings', form.biz_retainedEarnings],
      ].filter(([, v]) => n(v) !== 0).forEach(([l, v]) => drawLine(l, n(v)))

      drawSection('K-1 Pass-Through Summary')
      ;[
        ['Ordinary Business Income (Box 1)', form.k1_ordinaryIncome],
        ['Rental Income (Box 2)', form.k1_rentalIncome],
        ['Interest Income (Box 5)', form.k1_interest],
        ['Dividends (Box 6)', form.k1_dividends],
        ['Capital Gains (Box 9)', form.k1_capitalGain],
        ['Section 179 (Box 11)', form.k1_sec179],
      ].filter(([, v]) => n(v) !== 0).forEach(([l, v]) => drawLine(l, n(v)))
    }

    if (is1065) {
      drawSection('Partnership Allocations')
      ;[
        ['Guaranteed Payments', form.biz_guaranteedPayments],
        ['Net Income / Loss', form.biz_netIncome],
      ].filter(([, v]) => n(v) !== 0).forEach(([l, v]) => drawLine(l, n(v)))

      if (form.partner1_name || form.partner2_name) {
        drawSection('Partners')
        if (form.partner1_name) drawLine(form.partner1_name, `${form.partner1_pct || '—'}%`)
        if (form.partner2_name) drawLine(form.partner2_name, `${form.partner2_pct || '—'}%`)
      }

      drawSection('K-1 Allocations')
      ;[
        ['Ordinary Business Income (Box 1)', form.k1_ordinaryIncome],
        ['Rental Income (Box 2)', form.k1_rentalIncome],
        ['Guaranteed Payments (Box 4)', form.k1_guaranteedPayments],
        ['Interest Income (Box 5)', form.k1_interest],
        ['Capital Gains (Box 9)', form.k1_capitalGain],
        ['Self-Employment Income (Box 14)', form.k1_selfEmpIncome],
      ].filter(([, v]) => n(v) !== 0).forEach(([l, v]) => drawLine(l, n(v)))
    }

  } else {
    // 1040 Personal
    drawSection('Income')
    const incomeLines = [
      ['Wages, Salaries, Tips (W-2 Box 1)',       form.wages],
      ['Taxable Interest (1099-INT)',               form.interest],
      ['Ordinary Dividends (1099-DIV)',             form.dividends],
      ['Capital Gains / Losses (Schedule D)',       form.capitalGains],
      ['Business Income (Schedule C)',              form.businessIncome],
      ['Rental / Royalty Income (Schedule E)',      form.rentalIncome],
      ['Retirement / Pension (1099-R)',             form.retirementIncome],
      ['Social Security Benefits',                  form.socialSecurity],
      ['Other Income',                              form.otherIncome],
    ].filter(([, v]) => n(v) !== 0)
    incomeLines.forEach(([l, v]) => drawLine(l, n(v), { indent: 10 }))
    drawDivider()
    drawLine('Gross Income', totals.grossIncome, { bold: true, isTotal: true })

    // Schedule C
    if (n(form.schedC_grossReceipts) > 0 || n(form.businessIncome) > 0) {
      drawSection('Schedule C — Business Income / Loss')
      if (form.schedC_businessName) drawLine('Business Name', form.schedC_businessName)
      ;[
        ['Gross Receipts', form.schedC_grossReceipts],
        ['Less: Returns & Allowances', -n(form.schedC_returns)],
        ['Less: Cost of Goods Sold', -n(form.schedC_cogs)],
      ].filter(([, v]) => n(v) !== 0).forEach(([l, v]) => drawLine(l, n(v), { indent: 10 }))
      const expLines = [
        ['Advertising', form.schedC_advertising], ['Car & Truck', form.schedC_carTruck],
        ['Contract Labor', form.schedC_contractLabor], ['Depreciation', form.schedC_depreciation],
        ['Insurance', form.schedC_insurance], ['Legal & Professional', form.schedC_legal],
        ['Office Expenses', form.schedC_office], ['Rent (Vehicles)', form.schedC_rentVehicles],
        ['Rent (Other)', form.schedC_rentOther], ['Repairs', form.schedC_repairs],
        ['Supplies', form.schedC_supplies], ['Taxes & Licenses', form.schedC_taxes],
        ['Travel', form.schedC_travel], ['Meals (50%)', form.schedC_meals],
        ['Utilities', form.schedC_utilities], ['Wages', form.schedC_wages],
        ['Other Expenses', form.schedC_otherExp],
      ].filter(([, v]) => n(v) !== 0)
      if (expLines.length) {
        drawSpacer(4)
        page.drawText('EXPENSES', { x: ML + 16, y, size: 7, font: boldFont, color: COLORS.gray })
        y -= 12
        expLines.forEach(([l, v]) => drawLine(l, n(v), { indent: 20 }))
      }
      const gross = n(form.schedC_grossReceipts) - n(form.schedC_returns) - n(form.schedC_cogs)
      const totalExp = expLines.reduce((s, [, v]) => s + Math.abs(n(v)), 0)
      const net = gross - totalExp
      drawDivider()
      drawLine('Schedule C Net Profit / Loss', net, { bold: true, isTotal: true, color: net >= 0 ? COLORS.green : COLORS.red })
    }

    drawSection('Adjustments to Income')
    const adjLines = [
      ['Student Loan Interest Deduction',       form.studentLoanInterest],
      ['IRA Deduction',                          form.iraDeduction],
      ['Self-Employed Health Insurance',         form.selfEmployedHealth],
      ['Deductible Self-Employment Tax',         form.selfEmployedTax],
      ['Alimony Paid',                           form.alimonyPaid],
      ['Other Adjustments',                      form.otherAdjustments],
    ].filter(([, v]) => n(v) !== 0)
    if (adjLines.length === 0) {
      drawLine('No adjustments', '—')
    } else {
      adjLines.forEach(([l, v]) => drawLine(l, n(v), { indent: 10 }))
      drawDivider()
      drawLine('Total Adjustments', totals.adjustments, { bold: true, isTotal: true })
    }
    drawLine('Adjusted Gross Income (AGI)', totals.agi, { bold: true, color: COLORS.blue })

    drawSection('Deductions')
    if (form.deductionType === 'Standard') {
      const stdAmts = { 'Single': 14600, 'Married Filing Jointly': 29200, 'Married Filing Separately': 14600, 'Head of Household': 21900, 'Qualifying Surviving Spouse': 29200 }
      drawLine(`Standard Deduction (${form.filingStatus})`, stdAmts[form.filingStatus] || 14600, { indent: 10 })
    } else {
      ;[
        ['State & Local Taxes (SALT)',    form.stateLocalTax],
        ['Mortgage Interest',             form.mortgageInterest],
        ['Charitable Contributions',      form.charitableContrib],
        ['Medical Expenses',              form.medicalExpenses],
        ['Other Itemized',               form.itemizedDeductions],
      ].filter(([, v]) => n(v) !== 0).forEach(([l, v]) => drawLine(l, n(v), { indent: 10 }))
    }
    drawDivider()
    drawLine('Total Deductions', totals.deductions, { bold: true, isTotal: true })
    drawLine('Taxable Income', totals.taxableIncome, { bold: true, color: COLORS.blue })

    drawSection('Tax Credits')
    const creditLines = [
      ['Child Tax Credit',                  form.childTaxCredit],
      ['Earned Income Tax Credit (EITC)',   form.earnedIncomeCredit],
      ['Child & Dependent Care Credit',     form.childCareCredit],
      ['Education Credit',                  form.educationCredit],
      ['Other Credits',                     form.otherCredits],
    ].filter(([, v]) => n(v) !== 0)
    if (creditLines.length === 0) {
      drawLine('No credits applied', '—')
    } else {
      creditLines.forEach(([l, v]) => drawLine(l, n(v), { indent: 10 }))
    }

    drawSection('Payments & Withholding')
    ;[
      ['Federal Tax Withheld (W-2 Box 2)', form.withholding],
      ['Estimated Tax Payments (1040-ES)', form.estimatedPayments],
      ['Refundable Credits',              form.refundable],
    ].filter(([, v]) => n(v) !== 0).forEach(([l, v]) => drawLine(l, n(v), { indent: 10 }))
    drawDivider()
    drawLine('Total Payments', totals.payments, { bold: true, isTotal: true })
  }

  // ── FINAL SUMMARY BOX ──
  checkY(100)
  drawSpacer(12)

  const refund = isBusiness
    ? (n(form.biz_grossReceipts) - n(form.biz_returns) - n(form.biz_cogs) + n(form.biz_otherIncome))
    : totals.refundOrOwed

  const summaryItems = isBusiness
    ? [
        ['Gross Income', n(form.biz_grossReceipts) - n(form.biz_returns) - n(form.biz_cogs) + n(form.biz_otherIncome)],
        ['Total Deductions', ['officerComp','wages','repairs','badDebts','rents','taxes','interest','depreciation','advertising','pension','empBenefits','otherDed'].reduce((s,k)=>s+n(form['biz_'+k]),0)],
        ['Net Income / Loss', refund],
      ]
    : [
        ['Gross Income',         totals.grossIncome],
        ['Adjusted Gross Income', totals.agi],
        ['Taxable Income',        totals.taxableIncome],
        ['Est. Tax',              totals.tax],
        ['Total Credits',         totals.credits],
        ['Total Payments',        totals.payments],
        [totals.refundOrOwed >= 0 ? 'REFUND' : 'AMOUNT OWED', totals.refundOrOwed],
      ]

  const boxH = 28 + summaryItems.length * 22 + 40
  page.drawRectangle({ x: ML, y: y - boxH, width: MR - ML, height: boxH, color: COLORS.light, borderColor: COLORS.blue, borderWidth: 1.5 })
  page.drawRectangle({ x: ML, y: y - 22, width: MR - ML, height: 22, color: COLORS.blue })
  page.drawText('RETURN SUMMARY', { x: ML + 12, y: y - 16, size: 9, font: boldFont, color: COLORS.white })

  y -= 30
  summaryItems.forEach(([label, val], i) => {
    const isLast = i === summaryItems.length - 1
    if (isLast) {
      page.drawRectangle({ x: ML + 8, y: y - 14, width: MR - ML - 16, height: 22, color: val >= 0 ? rgb(0.08, 0.55, 0.3) : rgb(0.75, 0.1, 0.1) })
      page.drawText(label, { x: ML + 16, y: y - 6, size: 10, font: boldFont, color: COLORS.white })
      const valStr = `$${fmt(Math.abs(val))}`
      page.drawText(valStr, { x: MR - boldFont.widthOfTextAtSize(valStr, 12) - 16, y: y - 7, size: 12, font: boldFont, color: COLORS.white })
      y -= 26
    } else {
      page.drawText(label, { x: ML + 16, y, size: 9, font: regularFont, color: COLORS.gray })
      const valStr = fmt(val)
      page.drawText(valStr, { x: MR - regularFont.widthOfTextAtSize(valStr, 9) - 16, y, size: 9, font: boldFont, color: val < 0 ? COLORS.red : COLORS.dark })
      y -= 20
    }
  })

  // ── PREPARER NOTES ──
  if (form.notes) {
    checkY(50)
    drawSection('Preparer Notes')
    const words = form.notes.split(' ')
    let line = ''
    words.forEach(word => {
      const test = line ? line + ' ' + word : word
      if (regularFont.widthOfTextAtSize(test, 8) > MR - ML - 20) {
        checkY(14)
        page.drawText(line, { x: ML + 10, y, size: 8, font: regularFont, color: COLORS.gray })
        y -= 12
        line = word
      } else { line = test }
    })
    if (line) { page.drawText(line, { x: ML + 10, y, size: 8, font: regularFont, color: COLORS.gray }); y -= 12 }
  }

  // ── FOOTER on every page ──
  const pages = pdfDoc.getPages()
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: ML, y: 36 }, end: { x: MR, y: 36 }, thickness: 0.5, color: COLORS.divider })
    p.drawText([(FIRM.name||'').toUpperCase(), FIRM.phone, FIRM.fax && ('Fax: '+FIRM.fax)].filter(Boolean).join('  |  '), { x: ML, y: 24, size: 7, font: regularFont, color: COLORS.gray })
    p.drawText(`CONFIDENTIAL — PREPARER WORKSHEET  |  Page ${i + 1} of ${pages.length}`, { x: MR - regularFont.widthOfTextAtSize(`CONFIDENTIAL — PREPARER WORKSHEET  |  Page ${i + 1} of ${pages.length}`, 7) , y: 24, size: 7, font: regularFont, color: COLORS.gray })
  })

  const pdfBytes = await pdfDoc.save()
  return pdfBytes
}

export function downloadTaxReturnPdf(pdfBytes, form) {
  const blob = new Blob([pdfBytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `TaxReturn_${(form.clientName || 'Client').replace(/\s+/g, '_')}_${form.taxYear || ''}_${form.returnType?.replace(/\s+/g, '_') || ''}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
