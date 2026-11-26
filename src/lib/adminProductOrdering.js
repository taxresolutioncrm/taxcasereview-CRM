// Final presentation-only ordering for the RomyLabs Admin Portal.
// Keep SettleLift immediately below PoolVerge whenever both appear in the
// current filter. Preserve the Health Insurance -> ChairStyle grouping.
export function placeBuildingCRMsAfterHealth(items = []) {
  const list = [...items]
  const pool = list.findIndex(p => p.key === 'pool_crm' && !p.isTenant)
  const settle = list.findIndex(p => p.key === 'settlelift' && !p.isTenant)
  if (pool >= 0 && settle >= 0) {
    const [item] = list.splice(settle, 1)
    list.splice(list.findIndex(p => p.key === 'pool_crm' && !p.isTenant) + 1, 0, item)
  }
  const health = list.findIndex(p => p.key === 'health_insurance' && p.lifecycleStage === 'building' && !p.isTenant)
  const chair = list.findIndex(p => p.key === 'barbers_salons' && p.lifecycleStage === 'building' && !p.isTenant)
  if (health >= 0 && chair >= 0) {
    const [item] = list.splice(chair, 1)
    list.splice(list.findIndex(p => p.key === 'health_insurance' && !p.isTenant) + 1, 0, item)
  }
  return list
}
