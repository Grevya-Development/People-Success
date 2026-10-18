-- =====================================================================
-- Module security: RLS for recruitment, lifecycle, time, payroll,
-- expenses, talent, service and automation tables, plus integrity
-- constraints and triggers.
-- =====================================================================

-- Grants for tables created after the foundation migration (default
-- privileges cover them, this is belt and braces).
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Standard tenant isolation for every tenant table that has no policy yet.
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join information_schema.columns col
      on col.table_schema = n.nspname and col.table_name = c.relname and col.column_name = 'tenant_id'
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    perform app.enable_tenant_rls(format('public.%I', r.relname)::regclass);
  end loop;
end $$;

-- Helper: is the run published (payslips visible to employees)?
create or replace function app.run_is_published(run uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.payroll_runs r where r.id = run and r.status = 'published')
$$;
grant execute on function app.run_is_published(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Payroll: payroll staff see everything; employees see only their own
-- published results. Configuration is payroll-only.
-- ---------------------------------------------------------------------

create policy payroll_runs_read on public.payroll_runs as restrictive for select to authenticated
  using (app.has_perm('payroll.view') or app.has_perm('payroll.run') or app.has_perm('payroll.approve') or status = 'published');
create policy payroll_runs_write on public.payroll_runs as restrictive for insert to authenticated
  with check (app.has_perm('payroll.run'));
create policy payroll_runs_update on public.payroll_runs as restrictive for update to authenticated
  using (app.has_perm('payroll.run') or app.has_perm('payroll.approve'));
create policy payroll_runs_delete on public.payroll_runs as restrictive for delete to authenticated using (false);

create policy pre_read on public.payroll_run_employees as restrictive for select to authenticated
  using (
    app.has_perm('payroll.view') or app.has_perm('payroll.run') or app.has_perm('payroll.approve')
    or (app.can_access_employee('payslips.view', employee_id) and app.run_is_published(run_id))
  );
create policy pre_write on public.payroll_run_employees as restrictive for insert to authenticated
  with check (app.has_perm('payroll.run'));
create policy pre_update on public.payroll_run_employees as restrictive for update to authenticated
  using (app.has_perm('payroll.run'));
create policy pre_delete on public.payroll_run_employees as restrictive for delete to authenticated
  using (app.has_perm('payroll.run'));

create policy pli_read on public.payroll_line_items as restrictive for select to authenticated
  using (
    app.has_perm('payroll.view') or app.has_perm('payroll.run') or app.has_perm('payroll.approve')
    or exists (
      select 1 from public.payroll_run_employees e
      where e.id = run_employee_id
        and app.can_access_employee('payslips.view', e.employee_id)
        and app.run_is_published(e.run_id)
    )
  );
create policy pli_write on public.payroll_line_items as restrictive for insert to authenticated
  with check (app.has_perm('payroll.run'));
create policy pli_update on public.payroll_line_items as restrictive for update to authenticated
  using (app.has_perm('payroll.run'));
create policy pli_delete on public.payroll_line_items as restrictive for delete to authenticated
  using (app.has_perm('payroll.run'));

create policy payslips_read on public.payslips as restrictive for select to authenticated
  using (app.has_perm('payroll.view') or (app.can_access_employee('payslips.view', employee_id) and published_at is not null));
create policy payslips_write on public.payslips as restrictive for insert to authenticated
  with check (app.has_perm('payroll.run') or app.has_perm('payroll.approve'));
create policy payslips_update on public.payslips as restrictive for update to authenticated
  using (app.has_perm('payroll.run') or app.has_perm('payroll.approve'));

-- Payroll-only tables.
do $$
declare t text;
begin
  foreach t in array array['payroll_inputs','payroll_periods','disbursements','disbursement_batches','loan_repayments','statutory_rule_sets','salary_structures','pay_components']
  loop
    execute format(
      'create policy payroll_only on public.%I as restrictive for all to authenticated
         using (app.has_perm(''payroll.view'') or app.has_perm(''payroll.run'') or app.has_perm(''payroll.approve'') or app.has_perm(''payroll.config''))
         with check (app.has_perm(''payroll.run'') or app.has_perm(''payroll.config'') or app.has_perm(''payroll.approve''))', t);
  end loop;
end $$;

-- Employees may read their own loans and tax declarations, and edit their own declaration drafts.
create policy loans_read on public.employee_loans as restrictive for select to authenticated
  using (app.has_perm('payroll.view') or app.has_perm('payroll.run') or employee_id = app.current_employee_id());
create policy loans_write on public.employee_loans as restrictive for insert to authenticated
  with check (app.has_perm('payroll.run'));
create policy loans_update on public.employee_loans as restrictive for update to authenticated
  using (app.has_perm('payroll.run'));

create policy tax_decl_access on public.tax_declarations as restrictive for all to authenticated
  using (app.has_perm('payroll.view') or app.has_perm('payroll.run') or employee_id = app.current_employee_id())
  with check (app.has_perm('payroll.run') or employee_id = app.current_employee_id());

-- Approved, locked and published runs are immutable; corrections use adjustment runs.
create or replace function app.guard_locked_payroll()
returns trigger
language plpgsql
set search_path = ''
as $$
declare st text;
begin
  if tg_table_name = 'payroll_runs' then
    if old.status in ('locked','disbursed','published') and (
      new.status not in ('locked','disbursed','published') or new.snapshot_hash is distinct from old.snapshot_hash
      or new.totals is distinct from old.totals or new.calculation_basis is distinct from old.calculation_basis
    ) then
      raise exception 'Payroll run is locked; create an adjustment run instead' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if tg_table_name = 'payroll_run_employees' then
    select status into st from public.payroll_runs where id = coalesce(new.run_id, old.run_id);
  else
    select r.status into st from public.payroll_runs r
      join public.payroll_run_employees e on e.run_id = r.id
      where e.id = coalesce(new.run_employee_id, old.run_employee_id);
  end if;
  if st in ('approved','locked','disbursed','published') then
    raise exception 'Payroll results are frozen once the run is approved' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger payroll_runs_guard before update on public.payroll_runs
  for each row execute function app.guard_locked_payroll();
create trigger payroll_run_employees_guard before insert or update or delete on public.payroll_run_employees
  for each row execute function app.guard_locked_payroll();
create trigger payroll_line_items_guard before insert or update or delete on public.payroll_line_items
  for each row execute function app.guard_locked_payroll();

-- ---------------------------------------------------------------------
-- Recruitment: offers carry compensation; feedback is limited to people
-- with recruiting rights or the interviewer who wrote it.
-- ---------------------------------------------------------------------

create policy offers_access on public.offers as restrictive for all to authenticated
  using (app.has_perm('offers.manage') or app.has_perm('offers.approve') or app.has_perm('recruitment.manage'))
  with check (app.has_perm('offers.manage') or app.has_perm('offers.approve') or app.has_perm('recruitment.manage'));

create policy feedback_read on public.interview_feedback as restrictive for select to authenticated
  using (app.has_perm('recruitment.manage') or app.has_perm('offers.approve') or interviewer_user_id = auth.uid());
create policy feedback_write on public.interview_feedback as restrictive for insert to authenticated
  with check (interviewer_user_id = auth.uid());
create policy feedback_update on public.interview_feedback as restrictive for update to authenticated
  using (interviewer_user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Performance: reviews are private to participants, the reporting line and HR.
-- ---------------------------------------------------------------------

create policy reviews_access on public.reviews as restrictive for select to authenticated
  using (
    app.has_perm('performance.manage')
    or reviewer_employee_id = app.current_employee_id()
    or (employee_id = app.current_employee_id() and kind = 'self')
    or (employee_id = app.current_employee_id() and status in ('shared','acknowledged') and kind = 'manager')
    or (kind in ('self','manager') and employee_id <> app.current_employee_id() and app.can_access_employee('performance.view', employee_id))
  );
create policy reviews_write on public.reviews as restrictive for update to authenticated
  using (app.has_perm('performance.manage') or reviewer_employee_id = app.current_employee_id() or employee_id = app.current_employee_id());

create policy one_on_ones_access on public.one_on_ones as restrictive for all to authenticated
  using (manager_employee_id = app.current_employee_id() or employee_id = app.current_employee_id())
  with check (manager_employee_id = app.current_employee_id() or employee_id = app.current_employee_id());

create policy pip_access on public.improvement_plans as restrictive for all to authenticated
  using (app.has_perm('performance.manage') or manager_employee_id = app.current_employee_id() or employee_id = app.current_employee_id())
  with check (app.has_perm('performance.manage') or manager_employee_id = app.current_employee_id());

create policy promo_access on public.promotion_recommendations as restrictive for all to authenticated
  using (app.has_perm('performance.manage') or app.has_perm('compensation.edit') or app.can_access_employee('performance.review', employee_id))
  with check (app.has_perm('performance.manage') or app.can_access_employee('performance.review', employee_id));

create policy succession_access on public.succession_plans as restrictive for all to authenticated
  using (app.has_perm('succession.manage')) with check (app.has_perm('succession.manage'));

-- ---------------------------------------------------------------------
-- Engagement: raw responses only for aggregation by authorized roles; the
-- service layer enforces minimum group sizes.
-- ---------------------------------------------------------------------

create policy responses_read on public.survey_responses as restrictive for select to authenticated
  using (app.has_perm('engagement.results'));

create policy career_access on public.career_plans as restrictive for all to authenticated
  using (employee_id = app.current_employee_id() or app.can_access_employee('performance.view', employee_id) or app.has_perm('performance.manage'))
  with check (employee_id = app.current_employee_id() or app.can_access_employee('performance.review', employee_id) or app.has_perm('performance.manage'));

-- ---------------------------------------------------------------------
-- Helpdesk: requesters see their own tickets (without internal notes);
-- agents see queues; sensitive categories only for helpdesk.manage.
-- ---------------------------------------------------------------------

create or replace function app.ticket_is_sensitive(category uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.is_sensitive from public.ticket_categories c where c.id = category), false)
$$;
grant execute on function app.ticket_is_sensitive(uuid) to authenticated, service_role;

create policy tickets_access on public.tickets as restrictive for select to authenticated
  using (
    requester_user_id = auth.uid()
    or assignee_user_id = auth.uid()
    or app.has_perm('helpdesk.manage')
    or (app.has_perm('helpdesk.agent') and not app.ticket_is_sensitive(category_id))
  );
create policy tickets_update on public.tickets as restrictive for update to authenticated
  using (requester_user_id = auth.uid() or assignee_user_id = auth.uid() or app.has_perm('helpdesk.manage')
         or (app.has_perm('helpdesk.agent') and not app.ticket_is_sensitive(category_id)));

create policy ticket_messages_access on public.ticket_messages as restrictive for select to authenticated
  using (
    exists (select 1 from public.tickets t where t.id = ticket_id)
    and (not is_internal or app.has_perm('helpdesk.agent') or app.has_perm('helpdesk.manage'))
  );

-- ---------------------------------------------------------------------
-- Automation and AI
-- ---------------------------------------------------------------------

create policy integrations_admin on public.integration_connections as restrictive for all to authenticated
  using (app.has_perm('integrations.manage')) with check (app.has_perm('integrations.manage'));
create policy integration_events_admin on public.integration_events as restrictive for select to authenticated
  using (app.has_perm('integrations.manage'));

create policy ai_conversations_own on public.ai_conversations as restrictive for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ai_messages_own on public.ai_messages as restrictive for all to authenticated
  using (exists (select 1 from public.ai_conversations c where c.id = conversation_id))
  with check (exists (select 1 from public.ai_conversations c where c.id = conversation_id));
create policy ai_executions_read on public.ai_executions as restrictive for select to authenticated
  using (user_id = auth.uid() or app.has_perm('ai.manage'));

create policy workflow_defs_admin on public.workflow_definitions as restrictive for all to authenticated
  using (app.has_perm('workflows.manage')) with check (app.has_perm('workflows.manage'));

-- ---------------------------------------------------------------------
-- Integrity
-- ---------------------------------------------------------------------

-- Leave ledger is append-only: corrections are reversal postings.
create trigger leave_transactions_append_only
  before update or delete on public.leave_transactions
  for each row execute function app.forbid_mutation();

alter table public.shift_assignments
  add constraint shift_assignments_no_overlap
  exclude using gist (employee_id with =, daterange(effective_from, effective_to, '[)') with &&);
alter table public.shift_assignments
  add constraint shift_assignments_range_valid check (effective_to is null or effective_to > effective_from);

alter table public.leave_requests add constraint leave_requests_dates_valid check (end_date >= start_date);
alter table public.leave_requests add constraint leave_requests_days_positive check (days > 0);
alter table public.leave_requests add constraint leave_requests_sessions_valid
  check (start_session in ('full','first_half','second_half') and end_session in ('full','first_half','second_half'));
alter table public.leave_transactions add constraint leave_transactions_nonzero check (days <> 0);

alter table public.interviews add constraint interviews_time_valid check (scheduled_end > scheduled_start);
alter table public.interview_feedback add constraint interview_feedback_rating check (overall_rating between 1 and 5);
alter table public.job_requisitions add constraint requisitions_headcount_positive check (headcount > 0);
alter table public.job_requisitions add constraint requisitions_budget_valid
  check (budget_min_annual is null or budget_max_annual is null or budget_max_annual >= budget_min_annual);
alter table public.offers add constraint offers_ctc_positive check (annual_ctc > 0);
alter table public.timesheet_entries add constraint timesheet_entries_minutes check (minutes > 0 and minutes <= 1440);
alter table public.expense_items add constraint expense_items_amount_positive check (amount > 0);
alter table public.payroll_periods add constraint payroll_periods_month check (month between 1 and 12);
alter table public.payroll_periods add constraint payroll_periods_range check (end_date >= start_date);
alter table public.disbursements add constraint disbursements_amount_nonnegative check (amount >= 0);
alter table public.employee_loans add constraint loans_amounts check (principal > 0 and monthly_installment > 0 and outstanding >= 0);
alter table public.goals add constraint goals_progress check (progress_percent between 0 and 100);
alter table public.learning_enrollments add constraint learning_progress check (progress_percent between 0 and 100);
alter table public.surveys add constraint surveys_min_group check (min_group_size >= 3);
alter table public.tickets add constraint tickets_satisfaction check (satisfaction is null or satisfaction between 1 and 5);

-- Fast candidate search and dedupe.
create index candidates_search_trgm on public.candidates
  using gin ((first_name || ' ' || coalesce(last_name, '') || ' ' || email) extensions.gin_trgm_ops);
