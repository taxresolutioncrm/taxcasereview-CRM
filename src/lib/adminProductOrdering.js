// Final presentation-only ordering for RomyLabs Admin Portal Products.
// Preserve lifecycle sorting and all existing filters. The three Building
// products stay together even after connection-health rearrangement.
export function placeBuildingCRMsAfterHealth(items = []) {
  const list = [...items]
  const index = list.findIndex(p => p.key === 'health_insurance' && p.lifecycleStage === 'building' && !p.isTenant)
  if (index < 0) return list
  const wanted = ['settlelift', 'barbers_salons']
  const neighbors = wanted.map(key => list.find(p => p.key === key && p.lifecycleStage === 'building' && !p.isTenant)).filter(Boolean)
  if (!neighbors.length) return list
  const moving = new Set(neighbors.map(p => p.key))
  const remaining = list.filter(p => !moving.has(p.key))
  const target = remaining.findIndex(p => p.key === 'health_insurance' && p.lifecycleStage === 'building')
  remaining.splice(target + 1, 0, ...neighbors)
  return remaining
}
