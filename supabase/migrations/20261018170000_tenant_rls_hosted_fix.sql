-- =====================================================================
-- Hosted Supabase projects run an `ensure_rls` event trigger that enables
-- RLS on every new public table. The module security migration selected
-- tables with `not relrowsecurity`, so on hosted projects it skipped every
-- module table: RLS was on (deny-all, nothing leaked) but the standard
-- tenant policy and FORCE were missing, so the app could not use them.
--
-- Apply the standard tenant policy to every tenant table still missing it.
-- The explicit exclusions match the foundation migration (those tables
-- have their own policies). Locally this selects nothing.
-- =====================================================================
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      )
      and c.relname not in ('audit_logs', 'jobs', 'email_outbox', 'notifications')
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'tenant_isolation'
      )
  loop
    perform app.enable_tenant_rls(format('public.%I', r.relname)::regclass);
  end loop;
end $$;
