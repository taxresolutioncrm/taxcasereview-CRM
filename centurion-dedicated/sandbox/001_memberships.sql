-- Dedicated Centurion sandbox only
CREATE TABLE IF NOT EXISTS public.centurion_office_memberships (
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, tenant_id)
);
ALTER TABLE public.centurion_office_memberships ENABLE ROW LEVEL SECURITY;
