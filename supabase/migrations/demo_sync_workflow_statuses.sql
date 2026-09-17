-- Demo tenant sync: workflow status categories + statuses
-- Run after any demo reset to restore full TCR parity.
-- Canonical showcase tenant only. Never point this at Nashville or production.

DO $$
DECLARE
  v_demo uuid := 'a0000000-0000-0000-0000-000000000001';
  v_tcr  uuid := '61a89aef-0e7e-4ea2-b222-44ab2024655a';
  v_nash uuid := '489ace07-1a6b-4864-833a-4f8420568b40';
BEGIN
  IF v_demo = v_tcr OR v_demo = v_nash OR v_demo::text <> 'a0000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'ABORT: canonical Demo tenant guard failed: %', v_demo;
  END IF;

  INSERT INTO workflow_status_categories (id, name, sort_order, tenant_id) VALUES
    (gen_random_uuid(), 'Planned',        0, v_demo),
    (gen_random_uuid(), 'Ready to Start', 1, v_demo),
    (gen_random_uuid(), 'In Progress',    2, v_demo),
    (gen_random_uuid(), 'Waiting',        3, v_demo),
    (gen_random_uuid(), 'Completed',      4, v_demo)
  ON CONFLICT (name, tenant_id) DO NOTHING;

  INSERT INTO workflow_statuses (id, label, sort_order, category_id, tenant_id)
  SELECT gen_random_uuid(), s.label, s.sort_order, c.id, v_demo
  FROM (VALUES
    ('Billed',                   0, 'Completed'),
    ('Kick-off / Setup',         0, 'In Progress'),
    ('Send client requests',     0, 'Ready to Start'),
    ('Waiting for client',       0, 'Waiting'),
    ('Prep',                     1, 'In Progress'),
    ('Closed won',               1, 'Completed'),
    ('Waiting for IRS',          1, 'Waiting'),
    ('Ready for tax',            1, 'Ready to Start'),
    ('Cancelled',                2, 'Completed'),
    ('Confirm payment received', 2, 'Ready to Start'),
    ('Review',                   2, 'In Progress'),
    ('Waiting for signature',    2, 'Waiting'),
    ('File',                     3, 'In Progress')
  ) AS s(label, sort_order, cat_name)
  JOIN workflow_status_categories c ON c.name = s.cat_name AND c.tenant_id = v_demo
  ON CONFLICT (label, category_id) DO NOTHING;
END $$;
