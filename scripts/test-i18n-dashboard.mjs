import assert from 'node:assert/strict'
import { translateText } from '../src/lib/i18n.js'

const cases = [
  ['IRS Reference', 'Referencia del IRS'],
  ['IRS & State Reference', 'Referencia del IRS y estatal'],
  ['IRS Phone Numbers', 'Números de teléfono del IRS'],
  ['Tax Practitioner Line', 'Línea para profesionales de impuestos'],
  ['ACS (Automated Collection)', 'ACS (Cobro automatizado)'],
  ['Exempt Organizations', 'Organizaciones exentas'],
  ['Examination Department', 'Departamento de Fiscalización'],
  ['Bankruptcy (BK) Department', 'Departamento de Bancarrota (BK)'],
  ['Taxpayer Advocate Line', 'Línea del Defensor del Contribuyente'],
  ['Taxpayer Protection Program', 'Programa de Protección del Contribuyente'],
  ['Option 2 for personal tax practitioner, option 3 for business tax practitioner', 'Opción 2 para profesional de impuestos personales; opción 3 para profesional de impuestos comerciales'],

  ['Dashboard', 'Panel'],
  ['Active Cases', 'Casos activos'],
  ['Open Leads', 'Prospectos abiertos'],
  ['MTD 1st Trades', '1ros cobros del mes'],
  ['MTD 2nd Trades', '2dos cobros del mes'],
  ['AR Outstanding', 'Cuentas por cobrar pendientes'],
  ['Unpaid Invoices', 'Facturas sin pagar'],
  ['Open Tasks', 'Tareas abiertas'],
  ['Upcoming DL', 'Próximos vencimientos'],
  ['Recent Cases', 'Casos recientes'],
  ['Recent Leads', 'Prospectos recientes'],
  ['Quick Add', 'Agregar rápido'],
  ['Upcoming Deadlines', 'Próximos vencimientos'],
  ['Taxpayer Advocate Service', 'Servicio del Defensor del Contribuyente'],
  ['Latest updates from TAS', 'Últimas actualizaciones de TAS'],
  ['News & updates', 'Noticias y actualizaciones'],
  ['Good morning, Rommel', 'Buenos días, Rommel'],
  ['0 total', '0 en total'],
  ['0 overdue', '0 vencidas'],
  ['0 unpaid', '0 sin pagar'],
  ['Financial Resolution Questionnaire', 'Cuestionario de resolución financiera'],
  ['Make IRS and State POA', 'Preparar los poderes del IRS y del estado'],
  ['Tax return history', 'Historial de declaraciones de impuestos'],
  ['PENALTY ABATEMENT TIMELINE', 'CRONOGRAMA DE REDUCCIÓN DE MULTAS'],
  ['Obtain Wet Signature from Client', 'Obtener la firma manuscrita del cliente'],
]

for (const [english, spanish] of cases) {
  assert.equal(translateText(english, 'es'), spanish, `${english} should translate to ${spanish}`)
}

console.log(`dashboard Spanish contract PASS (${cases.length} assertions)`)
