-- Extensions used across the schema. Supabase installs extensions into the
-- "extensions" schema, which is on the search_path for the API roles.
create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;

-- Private schema for security-definer helpers. Never exposed through the API.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;
