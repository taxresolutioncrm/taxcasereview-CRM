// Product identity is distinct from the pricing tier and the office tenant.
// Only TaxRes has an in-repository, verified rate card and provisioning backend.
// Other products must load approved rates from their own catalog before activation.
export const OFFICE_PRODUCTS = Object.freeze([
  {key:'taxres_crm',label:'TaxRes / TCR / Centurion',provisioning:'taxres'},
  {key:'restore_relay',label:'Restore Relay',provisioning:null},
  {key:'arcvena',label:'Arcvena',provisioning:null},
  {key:'camvella',label:'Camvella',provisioning:null},
  {key:'pool_crm',label:'PoolVerge',provisioning:null},
  {key:'bocasync',label:'BocaSync',provisioning:null},
  {key:'barbers_salons',label:'ChairStyle',provisioning:null},
  {key:'settlelift',label:'SettleLift',provisioning:null},
])
export const VERIFIED_PRODUCT_RATES = Object.freeze({
  taxres_crm:Object.freeze({starter:79,professional:99,enterprise:129}),
})
export function officePrice(product,plan){
  return VERIFIED_PRODUCT_RATES[product]?.[plan] ?? null
}
