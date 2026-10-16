export const AI_GOVERNMENT_CALL_PURPOSES = [
  {
    key: 'irs-investigation',
    label: 'Tax Investigation Call',
    shortLabel: 'Investigation',
    icon: '🔎',
    agency: 'IRS',
    phone: '8668604259',
    objective: 'Reach the IRS tax-practitioner account line to investigate the taxpayer account, balances, filing status, compliance issues, notices, and next resolution steps.',
    routeHints: [
      { intent: 'English', digit: '1' },
      { intent: 'Tax practitioner / tax professional line', digit: '2' },
    ],
  },
  {
    key: 'irs-acs',
    label: 'ACS / Collections Call',
    shortLabel: 'ACS',
    icon: '🏛️',
    agency: 'IRS',
    phone: '8668604259',
    objective: 'Reach an IRS ACS / collections representative.',
    routeHints: [
      { intent: 'English', digit: '1' },
      { intent: 'Tax practitioner / tax professional line', digit: '2' },
      { intent: 'ACS / collections', digit: '3' },
    ],
  },
  {
    key: 'irs-payment-plan',
    label: 'Payment Plan Call',
    shortLabel: 'Payment Plan',
    icon: '💳',
    agency: 'IRS',
    phone: '8668604259',
    objective: 'Reach the correct IRS practitioner representative to establish, modify, or discuss an installment agreement or payment arrangement. If the account is assigned to ACS, route toward ACS/collections.',
    routeHints: [
      { intent: 'English', digit: '1' },
      { intent: 'Tax practitioner / tax professional line', digit: '2' },
    ],
  },
  {
    key: 'irs-business',
    label: 'Business Call',
    shortLabel: 'Business',
    icon: '🏢',
    agency: 'IRS',
    phone: '8668604259',
    objective: 'Reach the IRS business taxpayer practitioner line for business account matters.',
    routeHints: [
      { intent: 'English', digit: '1' },
      { intent: 'Tax practitioner / tax professional line', digit: '2' },
      { intent: 'Business taxpayer / business account', digit: '4' },
    ],
  },
  {
    key: 'state-custom',
    label: 'State Tax Call',
    shortLabel: 'State',
    icon: '🗺️',
    agency: 'STATE',
    phone: '',
    objective: 'Reach the correct state tax agency representative for the selected case objective.',
    routeHints: [],
  },
  {
    key: 'custom',
    label: 'Custom Government Call',
    shortLabel: 'Custom',
    icon: '☎️',
    agency: 'CUSTOM',
    phone: '',
    objective: 'Navigate the government agency phone tree to the live department that can handle the stated call objective.',
    routeHints: [],
  },
]

export function getGovernmentCallPurpose(key) {
  return AI_GOVERNMENT_CALL_PURPOSES.find(x => x.key === key) || AI_GOVERNMENT_CALL_PURPOSES[0]
}

export function formatGovernmentNumber(value='') {
  const d=String(value).replace(/\D/g,'')
  if(d.length===10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  if(d.length===11&&d.startsWith('1')) return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  return value
}
