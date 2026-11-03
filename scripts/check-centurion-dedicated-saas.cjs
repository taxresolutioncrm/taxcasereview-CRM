const fs=require('node:fs')
const assert=require('node:assert/strict')
const read=p=>fs.readFileSync(p,'utf8')
const root='centurion-dedicated/sandbox/'
const member=read(root+'001_memberships.sql')
const provision=read(root+'002_server_office_provision.sql')
const uniqueness=read(root+'005_employee_email_tenant_uniqueness.sql')
const users=read(root+'004_users_directory_rls.sql')
const edge=read(root+'provision-office/index.ts')
const invite=read(root+'invite-employee/index.ts')
const app=read('src/App.jsx')
const page=read('src/pages/CenturionOffices.jsx')
const nav=read('src/components/layout/Sidebar.jsx')
const check=(name,condition)=>{assert.ok(condition,name);process.stdout.write('PASS '+name+'\n')}
const dollar=String.fromCharCode(36)
check('Centurion migration SQL delimiters are not malformed',
  !member.split('\n').some(line=>line==='DO '+dollar||line==='END '+dollar+';'))
check('membership keys include both identity and tenant',
  member.includes('PRIMARY KEY (user_id, tenant_id)')&&member.includes('centurion_active_offices'))
check('legacy logins explicitly backfilled and checked before resolver swap',
  member.includes('FROM auth.users au JOIN public.employees e')&&member.includes('n_missing'))
check('hardcoded tenant resolver removed from staged database migration',
  member.includes('CREATE OR REPLACE FUNCTION public.current_tenant_id()')&&
  member.includes('centurion_office_memberships m')&&member.includes('auth.uid()'))
check('office switching verifies membership',
  member.includes('FUNCTION public.centurion_select_office')&&member.includes('m.active')&&member.includes('p_tenant_id'))
check('office creation only executable by service role',
  provision.includes("IS DISTINCT FROM 'service_role'")&&provision.includes('TO service_role'))
check('office provisioner creates settings and employee rows',
  provision.includes('INSERT INTO public.settings')&&
  (provision.match(/INSERT INTO public.employees/g)||[]).length>=2)
check('office provisioner retains verified platform owner',
  provision.includes('p_owner_user')&&provision.includes("role='owner'"))
check('employee email uniqueness is tenant-scoped',
  uniqueness.includes('employees_tenant_email_ci_unique')&&
  uniqueness.includes('ON public.employees(tenant_id,lower(trim(email)))'))
check('unscoped users RLS is removed',
  users.includes('DROP POLICY IF EXISTS centurion_users_authenticated')&&
  users.includes("auth.jwt() ->> 'email'"))
check('new-office handler checks real Auth identity and owner membership',
  edge.includes('auth.getUser(token)')&&edge.includes("membership.role!=='owner'")&&
  edge.includes('verifiedAdminId')&&edge.includes('p_owner_user:user.id')&&edge.includes("action==='invite_admin'"))
check('invitations use active selected office and preserve existing permissions',
  invite.includes('current_tenant_id')&&invite.includes('centurion_office_memberships')&&
  invite.includes('ignoreDuplicates:true'))
for(const method of ['send-email','send-sms','send-fax']){
 const s=read(root+method+'/index.ts')
 check(method+' resolves verified selected tenant',s.includes("authClient.rpc('current_tenant_id')")&&
   s.includes('selectedTenant')&&s.includes('LEGACY_CENTURION_OFFICE'))
 check(method+' blocks unconfigured office sender',method==='send-email'
   ?s.includes('Office email sender not configured')
   :method==='send-sms'?s.includes('officePhone.signalwire_phone_number')
   :s.includes('officeFax?.firm_fax_number'))
}
check('Centurion-only native Add Office route',
  app.includes('rkniemzmivnuhpdwkduc.supabase.co')&&
  app.includes('<CenturionOffices /> : <NewOffice />')&&
  page.includes("centurion-provision-office")&&page.includes('centurion_select_office')&&page.includes("Invite Administrator"))
check('navigation is not exposed on TCR app',
  nav.includes('centurionOnly: true')&&nav.includes('!SUPABASE_URL.includes'))
console.log('Centurion multi-tenant source-contract checks PASS. Signed-in RLS tests still required.')
