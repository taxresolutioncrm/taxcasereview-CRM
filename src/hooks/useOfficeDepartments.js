import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  ALL_HR_FEATURES, defaultDepartments, normalizeDepartments, normalizeHrFeatures,
} from '../lib/departmentWorkspaces'

// Office display preferences only. Supabase RLS and employee permissions
// remain the independent authorization boundaries.
export function useOfficeWorkspace(tenantId) {
  const scope = tenantId || ''
  const [state,setState] = useState(() => ({
    tenantId:scope, departments:defaultDepartments(scope), hrFeatures:[...ALL_HR_FEATURES],
  }))
  useEffect(() => {
    let cancelled=false
    setState({tenantId:scope,departments:defaultDepartments(scope),hrFeatures:[...ALL_HR_FEATURES]})
    if (!scope) return () => {cancelled=true}
    supabase.from('tenant_department_config').select('departments,hr_features')
      .eq('tenant_id',scope).maybeSingle().then(({data,error}) => {
        if(cancelled || error || !data) return
        setState({
          tenantId:scope,
          departments:normalizeDepartments(data.departments,defaultDepartments(scope)),
          hrFeatures:normalizeHrFeatures(data.hr_features),
        })
      })
    return ()=>{cancelled=true}
  },[scope])
  return state.tenantId===scope
    ? {departments:state.departments,hrFeatures:state.hrFeatures}
    : {departments:defaultDepartments(scope),hrFeatures:[...ALL_HR_FEATURES]}
}
export function useOfficeDepartments(tenantId) {
  return useOfficeWorkspace(tenantId).departments
}
