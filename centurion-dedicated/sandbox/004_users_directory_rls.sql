-- Dedicated Centurion project ONLY.
-- The legacy users directory has no tenant_id and currently allows ALL
-- authenticated users to read/write every row. It is empty at audit time.
-- Preserve existing staff directory features via tenant-scoped employees.
DROP POLICY IF EXISTS centurion_users_authenticated ON public.users;
CREATE POLICY centurion_users_self_read ON public.users FOR SELECT TO authenticated
 USING (lower(email) = lower((auth.jwt() ->> 'email')));
CREATE POLICY centurion_users_self_update ON public.users FOR UPDATE TO authenticated
 USING (lower(email) = lower((auth.jwt() ->> 'email')))
 WITH CHECK (lower(email) = lower((auth.jwt() ->> 'email')));
-- No broad authenticated INSERT or DELETE policy.
