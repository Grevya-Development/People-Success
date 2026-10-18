-- =====================================================================
-- Security foundation: tenant isolation (RLS), grants, integrity
-- triggers and constraints that Drizzle cannot express.
--
-- How tenant isolation works
--   The application connects as `postgres`, then for every request opens a
--   transaction and runs `set_config('role','authenticated')`,
--   `request.jwt.claims` (the verified Supabase user) and `app.tenant_id`.
--   Every tenant-owned table has RLS enabled with a policy that only matches
--   rows of app.current_tenant_id(), which re-checks that the signed-in user is
--   an active member of that tenant. A bug that sets the wrong tenant id
--   therefore still cannot read another tenant's rows.
--
--   The Data API (PostgREST) cannot set app.tenant_id, so even with a valid
--   user JWT it sees nothing. The anon role is granted nothing.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------

create or replace function app.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
  from public.memberships m
  where m.user_id = auth.uid()
    and m.status = 'active'
    and m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

-- Employee id of the signed-in user in the active tenant (set by the server).
create or replace function app.current_employee_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.employee_id', true), '')::uuid
$$;

-- Scope of a permission in the grants resolved server-side for this request.
-- app.perms is a comma-separated list like "employees.view:all,leave.approve:team".
-- Returns 'all' | 'team' | 'self' | null (widest scope wins).
create or replace function app.perm_scope(perm text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when position(',' || perm || ':all,' in ',' || coalesce(current_setting('app.perms', true), '') || ',') > 0 then 'all'
    when position(',' || perm || ':team,' in ',' || coalesce(current_setting('app.perms', true), '') || ',') > 0 then 'team'
    when position(',' || perm || ':self,' in ',' || coalesce(current_setting('app.perms', true), '') || ',') > 0 then 'self'
  end
$$;

-- True only for tenant-wide ("all") grants.
create or replace function app.has_perm(perm text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.perm_scope(perm) = 'all'
$$;

-- Whether the current user may access records about target_employee under perm,
-- honouring self / team (reporting subtree) / all scope.
create or replace function app.can_access_employee(perm text, target_employee uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s text := app.perm_scope(perm);
  me uuid := app.current_employee_id();
  found boolean;
begin
  if s is null then return false; end if;
  if s = 'all' then return true; end if;
  if me is null then return false; end if;
  if target_employee = me then return true; end if;
  if s = 'self' then return false; end if;
  -- team: walk up from the target; allowed if we are somewhere in its management chain.
  with recursive chain(id, depth) as (
    select e.manager_id, 1 from public.employees e
    where e.id = target_employee and e.tenant_id = (select app.current_tenant_id())
    union all
    select e.manager_id, c.depth + 1 from public.employees e join chain c on e.id = c.id
    where c.id is not null and c.depth < 50
  )
  select exists (select 1 from chain where id = me) into found;
  return found;
end;
$$;

-- Attach the standard tenant-isolation policy to a table.
create or replace function app.enable_tenant_rls(tbl regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('alter table %s force row level security', tbl);
  execute format('drop policy if exists tenant_isolation on %s', tbl);
  execute format(
    'create policy tenant_isolation on %s as permissive for all to authenticated
       using (tenant_id = (select app.current_tenant_id()))
       with check (tenant_id = (select app.current_tenant_id()))',
    tbl);
end;
$$;

grant execute on function app.current_tenant_id() to authenticated, service_role;
grant execute on function app.current_employee_id() to authenticated, service_role;
grant execute on function app.has_perm(text) to authenticated, service_role;
grant execute on function app.perm_scope(text) to authenticated, service_role;
grant execute on function app.can_access_employee(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Grants. anon gets nothing; authenticated gets DML, gated by RLS.
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------

-- Every table with a tenant_id column gets the standard policy, except the
-- ones handled explicitly below.
do $$
declare r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'tenant_id'
      and t.table_type = 'BASE TABLE'
      and c.table_name not in ('audit_logs', 'jobs', 'email_outbox', 'notifications')
  loop
    perform app.enable_tenant_rls(format('public.%I', r.table_name)::regclass);
  end loop;
end $$;

-- tenants: members see and update their own tenant only. Creation happens in
-- the trusted signup flow (system context).
alter table public.tenants enable row level security;
alter table public.tenants force row level security;
create policy tenant_self_read on public.tenants for select to authenticated
  using (id = (select app.current_tenant_id()));
create policy tenant_self_update on public.tenants for update to authenticated
  using (id = (select app.current_tenant_id()) and app.has_perm('settings.manage'))
  with check (id = (select app.current_tenant_id()));

-- users: own profile, plus profiles of members of the active tenant.
alter table public.users enable row level security;
alter table public.users force row level security;
create policy users_read on public.users for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.memberships m
      where m.user_id = users.id and m.tenant_id = (select app.current_tenant_id())
    )
  );
create policy users_update_self on public.users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- audit_logs: readable by auditors/admins of the tenant, insert-only.
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;
create policy audit_read on public.audit_logs for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.has_perm('audit.view'));
create policy audit_insert on public.audit_logs for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and actor_user_id = auth.uid());

-- jobs / email_outbox: tenant users may enqueue; only the worker (system) reads.
alter table public.jobs enable row level security;
alter table public.jobs force row level security;
create policy jobs_insert on public.jobs for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()));
create policy jobs_read on public.jobs for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.has_perm('workflows.manage'));

alter table public.email_outbox enable row level security;
alter table public.email_outbox force row level security;
create policy email_outbox_insert on public.email_outbox for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()));

-- notifications: a user sees only their own; anyone in the tenant may notify.
alter table public.notifications enable row level security;
alter table public.notifications force row level security;
create policy notifications_read on public.notifications for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and user_id = auth.uid())
  with check (tenant_id = (select app.current_tenant_id()) and user_id = auth.uid());
create policy notifications_insert on public.notifications for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()));

-- rate_limits: system only.
alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;

-- Sensitive employee data: restrictive policies layered on top of tenant
-- isolation. Employees always see (and may correct) their own row.
create policy sensitive_read on public.employee_sensitive as restrictive for select to authenticated
  using (app.has_perm('employees.sensitive.view') or employee_id = app.current_employee_id());
create policy sensitive_insert on public.employee_sensitive as restrictive for insert to authenticated
  with check (app.has_perm('employees.sensitive.edit') or employee_id = app.current_employee_id());
create policy sensitive_update on public.employee_sensitive as restrictive for update to authenticated
  using (app.has_perm('employees.sensitive.edit') or employee_id = app.current_employee_id());
create policy sensitive_delete on public.employee_sensitive as restrictive for delete to authenticated
  using (false);

create policy compensation_read on public.compensation_records as restrictive for select to authenticated
  using (app.can_access_employee('compensation.view', employee_id));
create policy compensation_insert on public.compensation_records as restrictive for insert to authenticated
  with check (app.has_perm('compensation.edit'));
create policy compensation_update on public.compensation_records as restrictive for update to authenticated
  using (app.has_perm('compensation.edit'));
create policy compensation_delete on public.compensation_records as restrictive for delete to authenticated
  using (false);

-- ---------------------------------------------------------------------
-- auth.users -> public.users profile sync
-- ---------------------------------------------------------------------

create or replace function app.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.users.full_name, excluded.full_name),
        updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute function app.handle_auth_user();

-- ---------------------------------------------------------------------
-- Integrity
-- ---------------------------------------------------------------------

-- Audit log is append-only for every role.
create or replace function app.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end;
$$;

create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function app.forbid_mutation();

-- Prevent reporting loops (A -> B -> A) in the solid-line hierarchy.
create or replace function app.check_manager_loop()
returns trigger
language plpgsql
set search_path = ''
as $$
declare found boolean;
begin
  if new.manager_id is null then
    return new;
  end if;
  if new.manager_id = new.id then
    raise exception 'An employee cannot report to themselves' using errcode = '23514';
  end if;
  with recursive chain(id, depth) as (
    select e.manager_id, 1 from public.employees e where e.id = new.manager_id
    union all
    select e.manager_id, c.depth + 1
    from public.employees e join chain c on e.id = c.id
    where c.id is not null and c.depth < 100
  )
  select exists (select 1 from chain where id = new.id) into found;
  if found then
    raise exception 'Reporting loop detected' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger employees_manager_loop
  before insert or update of manager_id on public.employees
  for each row execute function app.check_manager_loop();

create or replace function app.check_department_loop()
returns trigger
language plpgsql
set search_path = ''
as $$
declare found boolean;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'A department cannot be its own parent' using errcode = '23514';
  end if;
  with recursive chain(id, depth) as (
    select d.parent_id, 1 from public.departments d where d.id = new.parent_id
    union all
    select d.parent_id, c.depth + 1
    from public.departments d join chain c on d.id = c.id
    where c.id is not null and c.depth < 100
  )
  select exists (select 1 from chain where id = new.id) into found;
  if found then
    raise exception 'Department hierarchy loop detected' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger departments_parent_loop
  before insert or update of parent_id on public.departments
  for each row execute function app.check_department_loop();

-- Effective-dated histories must not overlap.
alter table public.employment_records
  add constraint employment_records_no_overlap
  exclude using gist (
    employee_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  );
alter table public.employment_records
  add constraint employment_records_range_valid
  check (effective_to is null or effective_to > effective_from);

alter table public.compensation_records
  add constraint compensation_records_no_overlap
  exclude using gist (
    employee_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  );
alter table public.compensation_records
  add constraint compensation_records_range_valid
  check (effective_to is null or effective_to > effective_from);
alter table public.compensation_records
  add constraint compensation_records_ctc_positive check (annual_ctc > 0);

alter table public.manager_relationships
  add constraint manager_relationships_range_valid
  check (effective_to is null or effective_to > effective_from);
alter table public.manager_relationships
  add constraint manager_relationships_not_self check (employee_id <> manager_id);

alter table public.employee_skills
  add constraint employee_skills_proficiency_range check (proficiency between 1 and 5);
alter table public.dependents
  add constraint dependents_nomination_range check (nomination_percent is null or nomination_percent between 0 and 100);
alter table public.employees
  add constraint employees_exit_after_join check (exit_date is null or exit_date >= joining_date);
alter table public.employees
  add constraint employees_notice_nonnegative check (notice_period_days >= 0);
alter table public.grades
  add constraint grades_band_valid check (min_annual_ctc is null or max_annual_ctc is null or max_annual_ctc >= min_annual_ctc);
alter table public.approval_delegations
  add constraint approval_delegations_range_valid check (ends_on >= starts_on);
alter table public.documents
  add constraint documents_size_positive check (size_bytes > 0);

-- Fast fuzzy search over the employee directory.
create index employees_search_trgm on public.employees
  using gin ((display_name || ' ' || employee_code || ' ' || coalesce(work_email, '')) extensions.gin_trgm_ops);
