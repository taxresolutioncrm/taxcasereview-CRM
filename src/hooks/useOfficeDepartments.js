import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { defaultDepartments, normalizeDepartments } from '../lib/departmentWorkspaces'

// No cross-office fallback: tenant changes immediately reset the displayed
// workspace. Configuration is optional until the additive migration is applied.
export function useOfficeDepartments(tenantId) {
  const [state, setState] = useState(() => ({
    tenantId: tenantId || '', departments:defaultDepartments(tenantId),
  }))
  const scope = tenantId || ''
  const departments = state.tenantId === scope ? state.departments : defaultDepartments(scope)
  useEffect(() => {
    let cancelled=false
    setState({ tenantId:scope, departments:defaultDepartments(scope) })
    if (!scope) return () => { cancelled=true }
    supabase.from('tenant_department_config').select('departments')
      .eq('tenant_id',scope).maybeSingle().then(({data,error}) => {
        // A missing table or row during rollout must not change other tenants'
        // existing feature access. Centurion remains resolution-only by default.
        if (cancelled || error || !data) return
        setState({tenantId:scope,departments:normalizeDepartments(data.departments,defaultDepartments(scope))})
      })
    return () => { cancelled=true }
  },[scope])
  return departments
}
