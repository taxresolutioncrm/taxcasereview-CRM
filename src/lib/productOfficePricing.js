// Office provisioning and product pricing are independent concerns.
// Published product rates below are USD per billing unit per month.
// A null price means quote-only; never substitute TaxRes rates.
// Canonical control-plane plan tiers remain starter/professional/enterprise.
export const OFFICE_PRODUCTS = Object.freeze([
  {key:'taxres_crm',label:'TaxRes / TCR / Centurion',billingUnit:'seat',provisioning:'taxres',tierNames:['Starter','Professional','Enterprise']},
  {key:'restore_relay',label:'Restore Relay',billingUnit:'office',provisioning:null,tierNames:['Starter','Professional','Scale'],limits:['Up to 3 users','Up to 10 users','Up to 25 users']},
  {key:'arcvena',label:'Arcvena',billingUnit:'firm',provisioning:null,tierNames:['Starter','Professional','Enterprise'],limits:['Custom quote','Custom quote','Custom quote']},
  {key:'camvella',label:'Camvella',billingUnit:'office',provisioning:null,tierNames:['Starter','Professional','Portfolio'],limits:['Up to 5 communities','Up to 20 communities','20+ communities · custom quote']},
  {key:'pool_crm',label:'PoolVerge',billingUnit:'office',provisioning:null,tierNames:['Starter','Professional','Enterprise']},
  {key:'bocasync',label:'BocaSync',billingUnit:'location',provisioning:null,tierNames:['Essentials','Growth','Complete']},
  {key:'barbers_salons',label:'ChairStyle',billingUnit:'office',provisioning:null,tierNames:['Starter','Professional','Enterprise']},
  {key:'settlelift',label:'SettleLift',billingUnit:'office',provisioning:null,tierNames:['Starter','Professional','Enterprise']},
])
export const VERIFIED_PRODUCT_RATES = Object.freeze({
  taxres_crm:Object.freeze({starter:79,professional:99,enterprise:129}),
  restore_relay:Object.freeze({starter:149,professional:299,enterprise:499}),
  camvella:Object.freeze({starter:149,professional:349,enterprise:null}),
  bocasync:Object.freeze({starter:299,professional:499,enterprise:699}),
})
export function officePrice(product,plan){
  return VERIFIED_PRODUCT_RATES[product]?.[plan] ?? null
}
export function officePlanName(product,plan){
  const index=['starter','professional','enterprise'].indexOf(plan)
  return OFFICE_PRODUCTS.find(p=>p.key===product)?.tierNames[index] || plan
}
export function officePlanLimit(product,plan){
  const index=['starter','professional','enterprise'].indexOf(plan)
  return OFFICE_PRODUCTS.find(p=>p.key===product)?.limits?.[index] || ''
}
