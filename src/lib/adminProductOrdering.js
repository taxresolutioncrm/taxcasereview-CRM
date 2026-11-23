// RomyLabs Admin Portal Products: presentation-only order.
// The owner-directed sequence places SettleLift immediately below PoolVerge,
// regardless of backend lifecycle labels, without changing registry records.
// Keep other Building products together after Health Insurance and preserve filters.
export function placeBuildingCRMsAfterHealth(items = []) {
  const list = [...items]

  // Only relocate SettleLift if both products are already present in the
  // same filtered set. Never introduce a product excluded by an active filter.
  const settle = list.find(p => p.key === 'settlelift' && !p.isTenant)
  const poolIndex = list.findIndex(p => p.key === 'pool_crm' && !p.isTenant)
  if (settle && poolIndex >= 0) {
    const oldIndex = list.indexOf(settle)
    list.splice(oldIndex, 1)
    const newPoolIndex = list.findIndex(p => p.key === 'pool_crm' && !p.isTenant)
    list.splice(newPoolIndex + 1, 0, settle)
  }

  // Preserve ChairStyle immediately after the Building Health Insurance row
  // when both are present. This must not dislodge the PoolVerge/SettleLift pair.
  const healthIndex = list.findIndex(p => p.key === 'health_insurance' && p.lifecycleStage === 'building' && !p.isTenant)
  const chair = list.find(p => p.key === 'barbers_salons' && p.lifecycleStage === 'building' && !p.isTenant)
  if (healthIndex >= 0 && chair) {
    list.splice(list.indexOf(chair), 1)
    const target = list.findIndex(p => p.key === 'health_insurance' && p.lifecycleStage === 'building' && !p.isTenant)
    list.splice(target + 1, 0, chair)
  }

  return list
}
