alter table public.formacorp
  add column if not exists fl_authorized_shares text,
  add column if not exists fl_officers_directors text,
  add column if not exists fl_director_election_method text,
  add column if not exists fl_incorporator text,
  add column if not exists fl_incorporator_signature text;

update public.formacorp
set fl_authorized_shares = coalesce(nullif(fl_authorized_shares, ''), '1000')
where state = 'FL'
  and entity_type = 'C-Corp';

update public.formacorp
set fl_director_election_method = coalesce(nullif(fl_director_election_method, ''), 'As stated by the bylaws.')
where state = 'FL'
  and entity_type = 'Non-Profit 501(c)(3)';

comment on column public.formacorp.fl_authorized_shares is
  'Authorized share count used for Florida profit corporation Articles of Incorporation.';
comment on column public.formacorp.fl_officers_directors is
  'Optional officer/director listing for Florida corporation formation.';
comment on column public.formacorp.fl_director_election_method is
  'Director election or appointment method used for Florida not-for-profit corporation formation.';
comment on column public.formacorp.fl_incorporator is
  'Incorporator name used for Florida corporation formation.';
comment on column public.formacorp.fl_incorporator_signature is
  'Typed incorporator signature captured with filing authorization.';
