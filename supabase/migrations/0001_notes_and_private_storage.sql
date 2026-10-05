-- Durable per-user notes and private uploads. Render and apply once per environment.
-- ops/render-migration.mjs resolves every placeholder, selects the topology-specific
-- blocks and emits the membership predicate for this topology.
--
-- R3-05: the rendered file pins its own schema three ways -- it sets the search_path
-- itself, it asserts the target schema exists, and every object is schema-qualified --
-- so a runner whose search_path points at another environment's schema fails loudly
-- instead of silently building the wrong schema.
-- Rendered target schema: {{APP_SCHEMA}}

set local search_path = {{APP_SCHEMA}}, public;

do $$
begin
  if to_regnamespace('{{APP_SCHEMA}}') is null then
    raise exception 'launch: target schema {{APP_SCHEMA}} does not exist; create it before applying the migration rendered for {{APP_SLUG}}/{{APP_ENV}}';
  end if;
  if current_schema() <> '{{APP_SCHEMA}}' then
    raise exception 'launch: this migration was rendered for schema {{APP_SCHEMA}} but the session resolves unqualified objects to %; refusing to apply', current_schema();
  end if;
end
$$;

{{#dedicated}}
-- A dedicated project has no control-plane registry schema, so it ships the same
-- membership surface locally (D-013): an application-owned membership table plus the
-- wrapper public.launch_is_member(slug, env). The wrapper takes no user id -- it reads
-- auth.uid() itself -- so a caller can only ever ask about itself, and the application
-- gate in src/lib/auth/session.ts calls exactly the same function name in both
-- topologies. Rows are written by the provisioning path (service role), never by users.
create table if not exists {{APP_SCHEMA}}.app_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  app_slug text not null check (app_slug ~ '^[a-z][a-z0-9_]{1,30}$'),
  env text not null check (env in ('dev', 'stg', 'prod')),
  role text not null default 'member',
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, app_slug, env)
);
alter table {{APP_SCHEMA}}.app_memberships enable row level security;
alter table {{APP_SCHEMA}}.app_memberships force row level security;
drop policy if exists app_memberships_select_own on {{APP_SCHEMA}}.app_memberships;
create policy app_memberships_select_own on {{APP_SCHEMA}}.app_memberships for select using (user_id = auth.uid());

create or replace function public.launch_is_member(slug text, env text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, {{APP_SCHEMA}}, auth
as $launch_is_member$
  select auth.uid() is not null and exists (
    select 1 from {{APP_SCHEMA}}.app_memberships m
    where m.user_id = auth.uid()
      and m.app_slug = launch_is_member.slug
      and m.env = launch_is_member.env
  )
$launch_is_member$;

-- Grants are role-guarded so the same file applies in a local fixture database that has
-- no Supabase roles; REVOKE from PUBLIC always runs.
revoke all on function public.launch_is_member(text, text) from public;
revoke all on table {{APP_SCHEMA}}.app_memberships from public;
do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.launch_is_member(text, text) from anon';
    execute 'revoke all on table {{APP_SCHEMA}}.app_memberships from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.launch_is_member(text, text) to authenticated';
    execute 'grant select on table {{APP_SCHEMA}}.app_memberships to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.launch_is_member(text, text) to service_role';
    execute 'grant select, insert, update, delete on table {{APP_SCHEMA}}.app_memberships to service_role';
  end if;
end
$grants$;
{{/dedicated}}

create table if not exists {{APP_SCHEMA}}.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists notes_owner_updated_idx on {{APP_SCHEMA}}.notes(owner_id, updated_at desc);
alter table {{APP_SCHEMA}}.notes enable row level security;
alter table {{APP_SCHEMA}}.notes force row level security;
drop policy if exists notes_select_own on {{APP_SCHEMA}}.notes;
drop policy if exists notes_insert_own on {{APP_SCHEMA}}.notes;
drop policy if exists notes_update_own on {{APP_SCHEMA}}.notes;
drop policy if exists notes_delete_own on {{APP_SCHEMA}}.notes;
create policy notes_select_own on {{APP_SCHEMA}}.notes for select using (owner_id = auth.uid() and {{MEMBERSHIP_PREDICATE}});
create policy notes_insert_own on {{APP_SCHEMA}}.notes for insert with check (owner_id = auth.uid() and {{MEMBERSHIP_PREDICATE}});
create policy notes_update_own on {{APP_SCHEMA}}.notes for update using (owner_id = auth.uid() and {{MEMBERSHIP_PREDICATE}}) with check (owner_id = auth.uid() and {{MEMBERSHIP_PREDICATE}});
create policy notes_delete_own on {{APP_SCHEMA}}.notes for delete using (owner_id = auth.uid() and {{MEMBERSHIP_PREDICATE}});

-- The bucket is private. Storage paths must begin with the authenticated user's UUID.
insert into storage.buckets (id, name, public) values ('{{APP_BUCKET}}', '{{APP_BUCKET}}', false) on conflict (id) do update set public = false;
drop policy if exists private_uploads_{{APP_SLUG}}_{{APP_ENV}}_select_own on storage.objects;
drop policy if exists private_uploads_{{APP_SLUG}}_{{APP_ENV}}_insert_own on storage.objects;
drop policy if exists private_uploads_{{APP_SLUG}}_{{APP_ENV}}_update_own on storage.objects;
drop policy if exists private_uploads_{{APP_SLUG}}_{{APP_ENV}}_delete_own on storage.objects;
create policy private_uploads_{{APP_SLUG}}_{{APP_ENV}}_select_own on storage.objects for select using (bucket_id = '{{APP_BUCKET}}' and (storage.foldername(name))[1] = (select auth.uid()::text) and {{MEMBERSHIP_PREDICATE}});
create policy private_uploads_{{APP_SLUG}}_{{APP_ENV}}_insert_own on storage.objects for insert with check (bucket_id = '{{APP_BUCKET}}' and (storage.foldername(name))[1] = (select auth.uid()::text) and {{MEMBERSHIP_PREDICATE}});
create policy private_uploads_{{APP_SLUG}}_{{APP_ENV}}_update_own on storage.objects for update using (bucket_id = '{{APP_BUCKET}}' and (storage.foldername(name))[1] = (select auth.uid()::text) and {{MEMBERSHIP_PREDICATE}}) with check (bucket_id = '{{APP_BUCKET}}' and (storage.foldername(name))[1] = (select auth.uid()::text) and {{MEMBERSHIP_PREDICATE}});
create policy private_uploads_{{APP_SLUG}}_{{APP_ENV}}_delete_own on storage.objects for delete using (bucket_id = '{{APP_BUCKET}}' and (storage.foldername(name))[1] = (select auth.uid()::text) and {{MEMBERSHIP_PREDICATE}});
