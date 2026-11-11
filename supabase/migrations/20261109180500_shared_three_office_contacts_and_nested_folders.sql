-- SANDBOX-STAGED ONLY: apply to shared TaxResolution-CRM project after review.
-- No migration is applied to Nashville or production by this commit.
-- Existing documents and client assignments remain intact.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS "revenueOfficerContact" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "taxpayerAdvocateContact" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.client_document_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  client_id text NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  parent_folder_id uuid REFERENCES public.client_document_folders(id) ON DELETE RESTRICT,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CHECK (name !~ '[[:cntrl:]]'),
  CHECK (tenant_id <> '489ace07-1a6b-4864-833a-4f8420568b40'::uuid)
);

CREATE UNIQUE INDEX IF NOT EXISTS shared_client_document_folder_root_name
  ON public.client_document_folders (tenant_id,client_id,lower(name))
  WHERE parent_folder_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shared_client_document_folder_child_name
  ON public.client_document_folders (tenant_id,client_id,parent_folder_id,lower(name))
  WHERE parent_folder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS shared_client_document_folder_client_idx
  ON public.client_document_folders(tenant_id,client_id,parent_folder_id);

CREATE OR REPLACE FUNCTION public.validate_shared_client_folder()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_parent_tenant uuid; v_parent_client text; v_client_tenant uuid;
BEGIN
  IF TG_OP='UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
    NEW.client_id IS DISTINCT FROM OLD.client_id
  ) THEN RAISE EXCEPTION 'Folder owner and identity cannot be reassigned'; END IF;
  SELECT tenant_id INTO v_client_tenant FROM public.clients WHERE id=NEW.client_id;
  IF v_client_tenant IS NULL OR v_client_tenant IS DISTINCT FROM NEW.tenant_id
    THEN RAISE EXCEPTION 'Folder must belong to the client tenant'; END IF;
  IF NEW.parent_folder_id IS NOT NULL THEN
    IF NEW.parent_folder_id=NEW.id THEN RAISE EXCEPTION 'Folder cannot contain itself'; END IF;
    SELECT tenant_id,client_id INTO v_parent_tenant,v_parent_client
      FROM public.client_document_folders WHERE id=NEW.parent_folder_id;
    IF NOT FOUND OR v_parent_tenant IS DISTINCT FROM NEW.tenant_id OR v_parent_client IS DISTINCT FROM NEW.client_id
      THEN RAISE EXCEPTION 'Parent folder must belong to same client and tenant'; END IF;
    IF TG_OP='UPDATE' AND EXISTS (
      WITH RECURSIVE ancestors(id,parent_folder_id) AS (
        SELECT id,parent_folder_id FROM public.client_document_folders WHERE id=NEW.parent_folder_id
        UNION
        SELECT f.id,f.parent_folder_id FROM public.client_document_folders f
          JOIN ancestors a ON a.parent_folder_id=f.id
      ) SELECT 1 FROM ancestors WHERE id=NEW.id
    ) THEN RAISE EXCEPTION 'Folder hierarchy cannot contain cycles'; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS shared_client_folder_guard ON public.client_document_folders;
CREATE TRIGGER shared_client_folder_guard
  BEFORE INSERT OR UPDATE ON public.client_document_folders
  FOR EACH ROW EXECUTE FUNCTION public.validate_shared_client_folder();

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS client_document_folder_id uuid
  REFERENCES public.client_document_folders(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS shared_document_folder_ref_idx ON public.documents(client_document_folder_id)
  WHERE client_document_folder_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_shared_document_folder()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_folder_tenant uuid; v_folder_client text;
BEGIN
  IF NEW.client_document_folder_id IS NULL THEN RETURN NEW; END IF;
  SELECT tenant_id,client_id INTO v_folder_tenant,v_folder_client
    FROM public.client_document_folders WHERE id=NEW.client_document_folder_id;
  IF NOT FOUND OR NEW.tenant_id IS DISTINCT FROM v_folder_tenant OR NEW.client_id IS DISTINCT FROM v_folder_client
    THEN RAISE EXCEPTION 'Document folder must belong to the same client and tenant'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS shared_document_folder_guard ON public.documents;
CREATE TRIGGER shared_document_folder_guard
  BEFORE INSERT OR UPDATE OF client_document_folder_id,tenant_id,client_id ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.validate_shared_document_folder();

CREATE OR REPLACE FUNCTION public.reject_nonempty_shared_folder_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.client_document_folders WHERE parent_folder_id=OLD.id)
    THEN RAISE EXCEPTION 'Remove nested subfolders before deleting this folder'; END IF;
  IF EXISTS (SELECT 1 FROM public.documents WHERE client_document_folder_id=OLD.id)
    THEN RAISE EXCEPTION 'Move documents out of this folder before deleting'; END IF;
  -- Refuse removal if an unassigned legacy file uses the same folder label.
  -- Name-only legacy rows are ambiguous and must never be silently orphaned.
  IF OLD.parent_folder_id IS NULL AND EXISTS (
    SELECT 1 FROM public.documents d JOIN public.clients c ON c.id=OLD.client_id
    WHERE d.tenant_id=OLD.tenant_id AND d.client_document_folder_id IS NULL
      AND lower(coalesce(d."docType",''))=lower(OLD.name)
      AND (d.client_id=OLD.client_id OR
          (d.client_id IS NULL AND (d.client=c.name OR d.clientname=c.name)))
  ) THEN RAISE EXCEPTION 'Folder has legacy documents; reconcile them before deleting'; END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS shared_nonempty_folder_delete_guard ON public.client_document_folders;
CREATE TRIGGER shared_nonempty_folder_delete_guard
  BEFORE DELETE ON public.client_document_folders
  FOR EACH ROW EXECUTE FUNCTION public.reject_nonempty_shared_folder_delete();

ALTER TABLE public.client_document_folders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shared_folders_read ON public.client_document_folders;
DROP POLICY IF EXISTS shared_folders_insert ON public.client_document_folders;
DROP POLICY IF EXISTS shared_folders_update ON public.client_document_folders;
DROP POLICY IF EXISTS shared_folders_delete ON public.client_document_folders;
CREATE POLICY shared_folders_read ON public.client_document_folders
  FOR SELECT TO authenticated
  USING (tenant_id=(SELECT public.current_tenant_id())
    AND (SELECT public.current_employee_permission('perm_documents'))>=1
    AND EXISTS (SELECT 1 FROM public.clients c
      WHERE c.id=client_id AND c.tenant_id=tenant_id));
CREATE POLICY shared_folders_insert ON public.client_document_folders
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id=(SELECT public.current_tenant_id())
    AND (SELECT public.current_employee_permission('perm_documents'))>=2
    AND EXISTS (SELECT 1 FROM public.clients c
      WHERE c.id=client_id AND c.tenant_id=tenant_id));
CREATE POLICY shared_folders_update ON public.client_document_folders
  FOR UPDATE TO authenticated
  USING (tenant_id=(SELECT public.current_tenant_id())
    AND (SELECT public.current_employee_permission('perm_documents'))>=2)
  WITH CHECK (tenant_id=(SELECT public.current_tenant_id())
    AND (SELECT public.current_employee_permission('perm_documents'))>=2);
CREATE POLICY shared_folders_delete ON public.client_document_folders
  FOR DELETE TO authenticated
  USING (tenant_id=(SELECT public.current_tenant_id())
    AND (SELECT public.current_employee_permission('perm_documents'))>=2);
REVOKE ALL ON public.client_document_folders FROM anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.client_document_folders TO authenticated;

-- Tax Preparer may only access assigned client records and their documents.
-- This is additive: other roles' existing granular permissions are unchanged.
-- SECURITY INVOKER is intentional; do not bypass the office's existing RLS.
CREATE OR REPLACE FUNCTION public.shared_preparer_may_access_client(
  p_tenant uuid, p_assigned_to text, p_tax_associate text, p_client_admin text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.tenant_id=public.current_tenant_id()
      AND lower(e.email)=lower(coalesce(auth.jwt()->>'email',''))
      AND lower(coalesce(e.status,'Active'))='active'
      AND e.access='Tax Preparer'
  ) OR EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.tenant_id=p_tenant
      AND e.tenant_id=public.current_tenant_id()
      AND lower(e.email)=lower(coalesce(auth.jwt()->>'email',''))
      AND lower(coalesce(e.status,'Active'))='active'
      AND e.access='Tax Preparer'
      AND (
        lower(btrim(coalesce(p_assigned_to,'')))=lower(btrim(e.name))
        OR lower(btrim(coalesce(p_tax_associate,'')))=lower(btrim(e.name))
        OR lower(btrim(coalesce(p_client_admin,'')))=lower(btrim(e.name))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.shared_preparer_may_access_client(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shared_preparer_may_access_client(uuid,text,text,text) TO authenticated;

-- Restrictive policies combine with the current tenant-scoped permission
-- policies using AND, preventing a permissive legacy policy from bypassing them.
DROP POLICY IF EXISTS shared_preparer_client_select_restrict ON public.clients;
DROP POLICY IF EXISTS shared_preparer_client_update_restrict ON public.clients;
CREATE POLICY shared_preparer_client_select_restrict ON public.clients AS RESTRICTIVE
  FOR SELECT TO authenticated USING (
    public.shared_preparer_may_access_client(tenant_id,"assignedTo","taxAssociate","clientAdmin")
  );
CREATE POLICY shared_preparer_client_update_restrict ON public.clients AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (
    public.shared_preparer_may_access_client(tenant_id,"assignedTo","taxAssociate","clientAdmin")
  ) WITH CHECK (
    public.shared_preparer_may_access_client(tenant_id,"assignedTo","taxAssociate","clientAdmin")
  );

DROP POLICY IF EXISTS shared_preparer_document_select_restrict ON public.documents;
DROP POLICY IF EXISTS shared_preparer_document_update_restrict ON public.documents;
DROP POLICY IF EXISTS shared_preparer_document_insert_restrict ON public.documents;
CREATE POLICY shared_preparer_document_select_restrict ON public.documents AS RESTRICTIVE
  FOR SELECT TO authenticated USING (
    NOT EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.tenant_id=public.current_tenant_id()
        AND lower(e.email)=lower(coalesce(auth.jwt()->>'email',''))
        AND e.access='Tax Preparer' AND lower(coalesce(e.status,'Active'))='active'
    ) OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.tenant_id=documents.tenant_id AND c.id=documents.client_id
    )
  );
CREATE POLICY shared_preparer_document_update_restrict ON public.documents AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (
    NOT EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.tenant_id=public.current_tenant_id()
        AND lower(e.email)=lower(coalesce(auth.jwt()->>'email',''))
        AND e.access='Tax Preparer' AND lower(coalesce(e.status,'Active'))='active'
    ) OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.tenant_id=documents.tenant_id AND c.id=documents.client_id
    )
  ) WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.tenant_id=public.current_tenant_id()
        AND lower(e.email)=lower(coalesce(auth.jwt()->>'email',''))
        AND e.access='Tax Preparer' AND lower(coalesce(e.status,'Active'))='active'
    ) OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.tenant_id=documents.tenant_id AND c.id=documents.client_id
    )
  );
CREATE POLICY shared_preparer_document_insert_restrict ON public.documents AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.tenant_id=public.current_tenant_id()
        AND lower(e.email)=lower(coalesce(auth.jwt()->>'email',''))
        AND e.access='Tax Preparer' AND lower(coalesce(e.status,'Active'))='active'
    ) OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.tenant_id=documents.tenant_id AND c.id=documents.client_id
    )
  );

-- Verify after sandbox migration: zero null/mismatched tenant-client folder pairs,
-- every parent shares its child's tenant/client, every assigned document matches,
-- no folder cycles, and historical document counts remain unchanged.


-- Archive both document references atomically using the caller's RLS identity.
-- Any failure rolls back both INSERTs. Storage is uploaded first by the client;
-- on RPC failure, the client removes only that unindexed new storage object.
-- SECURITY INVOKER is essential: this is NOT a privileged service-role bypass.
CREATE UNIQUE INDEX IF NOT EXISTS shared_sunbiz_document_hash_unique
  ON public.documents(tenant_id,client_id,file_hash)
  WHERE file_hash IS NOT NULL AND source='FormaCorp Sunbiz';

CREATE OR REPLACE FUNCTION public.archive_shared_sunbiz_document(
  p_case_id uuid, p_client_id text, p_folder_id uuid,
  p_file_name text, p_original_file_name text, p_storage_path text,
  p_file_hash text, p_file_size bigint, p_kind text
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_name text;
  v_company text;
  v_document_id text;
BEGIN
  IF v_tenant IS NULL OR
     public.current_employee_permission('perm_documents') < 2 THEN
    RAISE EXCEPTION 'Document edit permission required';
  END IF;
  IF p_kind NOT IN ('Filed Articles','Payment Receipt','Certificate of Status','Certified Copy')
    OR p_file_name IS NULL OR p_storage_path IS NULL
    OR p_file_hash !~ '^[a-f0-9]{64}$' OR p_file_size IS NULL
    OR p_file_size < 1 OR p_file_size > 12582912 THEN
    RAISE EXCEPTION 'Invalid official Sunbiz PDF metadata';
  END IF;
  SELECT name INTO v_name FROM public.clients
    WHERE id=p_client_id AND tenant_id=v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client unavailable in active office'; END IF;
  SELECT entity_name INTO v_company FROM public.formacorp
    WHERE id=p_case_id AND tenant_id=v_tenant AND client_id=p_client_id AND state='FL';
  IF NOT FOUND THEN RAISE EXCEPTION 'Florida formation unavailable for this client'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.client_document_folders f
    JOIN public.client_document_folders company ON company.id=f.parent_folder_id
    JOIN public.client_document_folders root ON root.id=company.parent_folder_id
    WHERE f.id=p_folder_id AND f.tenant_id=v_tenant AND f.client_id=p_client_id
      AND f.name='Formation Documents'
      AND company.name=v_company AND company.tenant_id=v_tenant
      AND company.client_id=p_client_id AND root.name='Business'
      AND root.parent_folder_id IS NULL AND root.tenant_id=v_tenant
      AND root.client_id=p_client_id
  ) THEN
    RAISE EXCEPTION 'Formation Documents folder does not match this client and business';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.documents
    WHERE tenant_id=v_tenant AND client_id=p_client_id AND file_hash=p_file_hash
  ) THEN
    RAISE EXCEPTION 'This PDF already exists in the selected client document file';
  END IF;
  INSERT INTO public.documents(
    tenant_id,client_id,client,clientname,name,"docType",
    client_document_folder_id,file_name,original_file_name,file_url,
    storage_path,file_size,file_hash,source,notes
  ) VALUES (
    v_tenant,p_client_id,v_name,v_name,p_kind||' — '||v_company,'Formation Documents',
    p_folder_id,p_file_name,p_original_file_name,
    'storage://documents/'||p_storage_path,p_storage_path,p_file_size,p_file_hash,
    'FormaCorp Sunbiz','Staff-imported Sunbiz PDF; approval and state payment are independently verified'
  ) RETURNING id INTO v_document_id;
  INSERT INTO public.formacorp_documents(
    tenant_id,case_id,document_type,file_name,storage_path,source
  ) VALUES (
    v_tenant,p_case_id,'Florida Sunbiz — '||p_kind,p_file_name,p_storage_path,'Sunbiz PDF import'
  );
  RETURN v_document_id;
END $$;
REVOKE ALL ON FUNCTION public.archive_shared_sunbiz_document(
  uuid,text,uuid,text,text,text,text,bigint,text
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.archive_shared_sunbiz_document(
  uuid,text,uuid,text,text,text,text,bigint,text
) TO authenticated;
