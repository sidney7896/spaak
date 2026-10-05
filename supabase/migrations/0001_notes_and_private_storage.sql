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

-- Spaak W1b: server-only RPC store. No customer or staff role has table access.
-- Schedule defaults and Amsterdam instants are supplied by the TypeScript domain.
create table if not exists {{APP_SCHEMA}}.spaak_reparaties (
  id text primary key check (char_length(id) between 1 and 200),
  naam text not null check (char_length(btrim(naam)) >= 1),
  duur_minuten bigint not null check (duur_minuten between 1 and 9007199254740991),
  prijs_cent bigint check (prijs_cent between 0 and 9007199254740991),
  volgorde bigint not null unique check (volgorde >= 0)
);
create table if not exists {{APP_SCHEMA}}.spaak_capaciteit (
  datum date not null,
  start time not null,
  capaciteit integer not null check (capaciteit between 0 and 50),
  primary key (datum, start)
);
create table if not exists {{APP_SCHEMA}}.spaak_gesloten (
  datum date primary key
);
create table if not exists {{APP_SCHEMA}}.spaak_afspraken (
  code text primary key check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  sleutel text unique not null check (char_length(sleutel) between 8 and 200),
  reparatie_id text not null references {{APP_SCHEMA}}.spaak_reparaties(id),
  datum date not null,
  start time not null,
  eind time not null check (eind > start),
  start_tijdstip timestamptz not null,
  naam text not null check (char_length(btrim(naam)) between 1 and 80),
  telefoon text not null check (telefoon !~ '[^0-9 +()-]' and char_length(regexp_replace(telefoon, '[^0-9]', '', 'g')) between 10 and 15),
  email text not null check (email !~ '[[:space:]]' and email ~ '^[^[:space:]@]+@[^[:space:]@.]+(\.[^[:space:]@.]+)+$'),
  fiets text not null check (char_length(btrim(fiets)) >= 1 and char_length(fiets) <= 500),
  status text not null default 'gepland' check (status in ('gepland', 'ontvangen', 'bezig', 'klaar', 'opgehaald', 'geannuleerd')),
  aangemaakt timestamptz not null,
  bijgewerkt timestamptz not null
);
create index if not exists spaak_afspraken_dag_slot_idx on {{APP_SCHEMA}}.spaak_afspraken(datum, start);

insert into {{APP_SCHEMA}}.spaak_reparaties (id, naam, duur_minuten, prijs_cent, volgorde) values
  ('onderhoud', 'Onderhoudsbeurt', 60, 6900, 0),
  ('remmen', 'Remmen afstellen', 30, 2500, 1),
  ('band', 'Band plakken', 20, 1500, 2),
  ('overig', 'Overig', 60, null, 3)
on conflict do nothing;

alter table {{APP_SCHEMA}}.spaak_reparaties enable row level security;
alter table {{APP_SCHEMA}}.spaak_reparaties force row level security;
alter table {{APP_SCHEMA}}.spaak_capaciteit enable row level security;
alter table {{APP_SCHEMA}}.spaak_capaciteit force row level security;
alter table {{APP_SCHEMA}}.spaak_gesloten enable row level security;
alter table {{APP_SCHEMA}}.spaak_gesloten force row level security;
alter table {{APP_SCHEMA}}.spaak_afspraken enable row level security;
alter table {{APP_SCHEMA}}.spaak_afspraken force row level security;

-- These are security-invoker functions. Supabase's service_role bypasses RLS;
-- the default PUBLIC execute privilege is explicitly removed below.
create or replace function {{APP_SCHEMA}}.spaak_reparaties(p jsonb) returns jsonb
language plpgsql
set search_path = pg_catalog, {{APP_SCHEMA}}
as $spaak_reparaties$
begin
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.volgorde) from {{APP_SCHEMA}}.spaak_reparaties r), '[]'::jsonb);
end
$spaak_reparaties$;

create or replace function {{APP_SCHEMA}}.spaak_reparatie_toevoegen(p jsonb) returns jsonb
language plpgsql
set search_path = pg_catalog, {{APP_SCHEMA}}
as $spaak_reparatie_toevoegen$
declare
  v_volgorde bigint;
  v_reparatie {{APP_SCHEMA}}.spaak_reparaties%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('{{APP_SCHEMA}}:reparaties', 0));
  select coalesce(max(r.volgorde), 3) + 1 into v_volgorde from {{APP_SCHEMA}}.spaak_reparaties r;
  insert into {{APP_SCHEMA}}.spaak_reparaties (id, naam, duur_minuten, prijs_cent, volgorde)
    values ('reparatie-' || (v_volgorde - 3)::text, btrim(p->>'naam'), (p->>'duurMinuten')::bigint, (p->>'prijsCent')::bigint, v_volgorde)
    returning * into v_reparatie;
  return to_jsonb(v_reparatie);
end
$spaak_reparatie_toevoegen$;

create or replace function {{APP_SCHEMA}}.spaak_dag(p jsonb) returns jsonb
language plpgsql
set search_path = pg_catalog, {{APP_SCHEMA}}
as $spaak_dag$
declare
  v_datum date := (p->>'datum')::date;
  v_slot jsonb;
  v_capaciteit integer;
  v_geboekt integer;
  v_slots jsonb := '[]'::jsonb;
begin
  if jsonb_array_length(p->'slots') = 0 or exists (select 1 from {{APP_SCHEMA}}.spaak_gesloten g where g.datum = v_datum) then
    return jsonb_build_object('closed', true, 'slots', v_slots);
  end if;
  for v_slot in select value from jsonb_array_elements(p->'slots') loop
    select coalesce((select c.capaciteit from {{APP_SCHEMA}}.spaak_capaciteit c
      where c.datum = v_datum and c.start = (v_slot->>'start')::time), (v_slot->>'capacity')::integer) into v_capaciteit;
    select count(*)::integer into v_geboekt from {{APP_SCHEMA}}.spaak_afspraken a
      where a.datum = v_datum and a.start = (v_slot->>'start')::time and a.status <> 'geannuleerd';
    v_slots := v_slots || jsonb_build_array(jsonb_build_object(
      'start', v_slot->>'start', 'end', v_slot->>'end', 'capacity', v_capaciteit,
      'booked', v_geboekt, 'free', greatest(0, v_capaciteit - v_geboekt)));
  end loop;
  return jsonb_build_object('closed', false, 'slots', v_slots);
end
$spaak_dag$;

create or replace function {{APP_SCHEMA}}.spaak_volgende_vrije_dag(p jsonb) returns jsonb
language plpgsql
set search_path = pg_catalog, {{APP_SCHEMA}}
as $spaak_volgende_vrije_dag$
declare
  v_dag jsonb;
  v_beschikbaar jsonb;
begin
  -- The TS caller omits past slots using one snapshot of its own clock.
  for v_dag in select value from jsonb_array_elements(p->'dagen') loop
    v_beschikbaar := {{APP_SCHEMA}}.spaak_dag(v_dag);
    if exists (select 1 from jsonb_array_elements(v_beschikbaar->'slots') s where (s.value->>'free')::integer > 0) then
      return to_jsonb(v_dag->>'datum');
    end if;
  end loop;
  return 'null'::jsonb;
end
$spaak_volgende_vrije_dag$;

create or replace function {{APP_SCHEMA}}.spaak_boek(p jsonb) returns jsonb
language plpgsql
set search_path = pg_catalog, {{APP_SCHEMA}}
as $spaak_boek$
declare
  v_datum date := (p->>'date')::date;
  v_start time := (p->>'start')::time;
  v_nu timestamptz := (p->>'nu')::timestamptz;
  v_tijdstip timestamptz := (p->>'start_tijdstip')::timestamptz;
  v_capaciteit integer;
  v_geboekt integer;
  v_afspraak {{APP_SCHEMA}}.spaak_afspraken%rowtype;
  v_bytes bytea;
  v_code text;
  v_poging integer;
  v_index integer;
begin
  if not exists (select 1 from {{APP_SCHEMA}}.spaak_reparaties r where r.id = p->>'repairTypeId') then
    return jsonb_build_object('ok', false, 'reason', 'ongeldig',
      'fields', jsonb_build_object('repairTypeId', 'Kies een geldig reparatietype.'));
  end if;
  -- Key first, then day, then slot: retries on different slots also serialize.
  perform pg_advisory_xact_lock(hashtextextended('{{APP_SCHEMA}}:sleutel:' || (p->>'sleutel'), 0));
  select * into v_afspraak from {{APP_SCHEMA}}.spaak_afspraken a where a.sleutel = p->>'sleutel';
  if found then return jsonb_build_object('ok', true, 'booking', to_jsonb(v_afspraak)); end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('{{APP_SCHEMA}}:dag:' || v_datum::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('{{APP_SCHEMA}}:slot:' || v_datum::text || ':' || v_start::text, 0));
  if exists (select 1 from {{APP_SCHEMA}}.spaak_gesloten g where g.datum = v_datum) then
    return jsonb_build_object('ok', false, 'reason', 'gesloten');
  end if;
  if v_tijdstip <= v_nu then return jsonb_build_object('ok', false, 'reason', 'verleden'); end if;
  select coalesce((select c.capaciteit from {{APP_SCHEMA}}.spaak_capaciteit c where c.datum = v_datum and c.start = v_start),
    (p->>'capacity')::integer) into v_capaciteit;
  select count(*)::integer into v_geboekt from {{APP_SCHEMA}}.spaak_afspraken a
    where a.datum = v_datum and a.start = v_start and a.status <> 'geannuleerd';
  if v_geboekt >= v_capaciteit then return jsonb_build_object('ok', false, 'reason', 'vol'); end if;
  for v_poging in 1..8 loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    -- Use six random bytes, avoiding the UUID version/variant bytes. 32 divides 256.
    for v_index in 0..5 loop
      v_code := v_code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(v_bytes, v_index) % 32) + 1, 1);
    end loop;
    begin
      insert into {{APP_SCHEMA}}.spaak_afspraken
        (code, sleutel, reparatie_id, datum, start, eind, start_tijdstip, naam, telefoon, email, fiets, status, aangemaakt, bijgewerkt)
        values (v_code, p->>'sleutel', p->>'repairTypeId', v_datum, v_start, (p->>'end')::time, v_tijdstip,
          p->>'naam', p->>'telefoon', p->>'email', p->>'fiets', 'gepland', v_nu, v_nu)
        returning * into v_afspraak;
      return jsonb_build_object('ok', true, 'booking', to_jsonb(v_afspraak));
    exception when unique_violation then
      -- Keep cancelled codes reserved too; never recycle an old customer's code.
      select * into v_afspraak from {{APP_SCHEMA}}.spaak_afspraken a where a.sleutel = p->>'sleutel';
      if found then return jsonb_build_object('ok', true, 'booking', to_jsonb(v_afspraak)); end if;
    end;
  end loop;
  raise exception 'Spaak: could not allocate a unique booking code after 8 attempts';
end
$spaak_boek$;

create or replace function {{APP_SCHEMA}}.spaak_zoek(p jsonb) returns jsonb
language plpgsql
set search_path = pg_catalog, {{APP_SCHEMA}}
as $spaak_zoek$
declare
  v_afspraak {{APP_SCHEMA}}.spaak_afspraken%rowtype;
begin
  select * into v_afspraak from {{APP_SCHEMA}}.spaak_afspraken a where a.code = upper(btrim(p->>'code'));
  if not found then return 'null'::jsonb; end if;
  return to_jsonb(v_afspraak);
end
$spaak_zoek$;

create or replace function {{APP_SCHEMA}}.spaak_annuleer(p jsonb) returns jsonb
language plpgsql
set search_path = pg_catalog, {{APP_SCHEMA}}
as $spaak_annuleer$
declare
  v_afspraak {{APP_SCHEMA}}.spaak_afspraken%rowtype;
  v_nu timestamptz := (p->>'nu')::timestamptz;
begin
  select * into v_afspraak from {{APP_SCHEMA}}.spaak_afspraken a where a.code = upper(btrim(p->>'code')) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'onbekend'); end if;
  if v_afspraak.status <> 'gepland' then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
  if v_afspraak.start_tijdstip - v_nu < interval '24 hours' then return jsonb_build_object('ok', false, 'reason', 'te-laat'); end if;
  update {{APP_SCHEMA}}.spaak_afspraken set status = 'geannuleerd', bijgewerkt = v_nu where code = v_afspraak.code;
  return jsonb_build_object('ok', true);
end
$spaak_annuleer$;

create or replace function {{APP_SCHEMA}}.spaak_dagoverzicht(p jsonb) returns jsonb
language plpgsql
set search_path = pg_catalog, {{APP_SCHEMA}}
as $spaak_dagoverzicht$
declare
  v_datum date := (p->>'datum')::date;
  v_slot jsonb;
  v_capaciteit integer;
  v_afspraken jsonb;
  v_groepen jsonb := '[]'::jsonb;
begin
  -- Closing a day does not hide the repairs that are already booked.
  for v_slot in select value from jsonb_array_elements(p->'slots') order by value->>'start' loop
    select coalesce(jsonb_agg(to_jsonb(a) order by a.aangemaakt, a.code), '[]'::jsonb) into v_afspraken
      from {{APP_SCHEMA}}.spaak_afspraken a
      where a.datum = v_datum and a.start = (v_slot->>'start')::time and a.status <> 'geannuleerd';
    if jsonb_array_length(v_afspraken) > 0 then
      select coalesce((select c.capaciteit from {{APP_SCHEMA}}.spaak_capaciteit c
        where c.datum = v_datum and c.start = (v_slot->>'start')::time), (v_slot->>'capacity')::integer) into v_capaciteit;
      v_groepen := v_groepen || jsonb_build_array(jsonb_build_object(
        'slot', jsonb_build_object('start', v_slot->>'start', 'end', v_slot->>'end', 'capacity', v_capaciteit),
        'bookings', v_afspraken));
    end if;
  end loop;
  return v_groepen;
end
$spaak_dagoverzicht$;

create or replace function {{APP_SCHEMA}}.spaak_status(p jsonb) returns jsonb
language plpgsql
set search_path = pg_catalog, {{APP_SCHEMA}}
as $spaak_status$
declare
  v_afspraak {{APP_SCHEMA}}.spaak_afspraken%rowtype;
  v_volgende text;
begin
  select * into v_afspraak from {{APP_SCHEMA}}.spaak_afspraken a where a.code = upper(btrim(p->>'code')) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'onbekend'); end if;
  v_volgende := case v_afspraak.status when 'gepland' then 'ontvangen' when 'ontvangen' then 'bezig'
    when 'bezig' then 'klaar' when 'klaar' then 'opgehaald' else null end;
  if v_volgende is null or (p->>'status') is distinct from v_volgende then
    return jsonb_build_object('ok', false, 'reason', 'overgang');
  end if;
  update {{APP_SCHEMA}}.spaak_afspraken set status = v_volgende, bijgewerkt = (p->>'nu')::timestamptz where code = v_afspraak.code;
  return jsonb_build_object('ok', true);
end
$spaak_status$;

create or replace function {{APP_SCHEMA}}.spaak_capaciteit_zet(p jsonb) returns jsonb
language plpgsql
set search_path = pg_catalog, {{APP_SCHEMA}}
as $spaak_capaciteit_zet$
declare
  v_datum date := (p->>'datum')::date;
  v_start time := (p->>'start')::time;
begin
  perform pg_advisory_xact_lock(hashtextextended('{{APP_SCHEMA}}:slot:' || v_datum::text || ':' || v_start::text, 0));
  insert into {{APP_SCHEMA}}.spaak_capaciteit (datum, start, capaciteit) values (v_datum, v_start, (p->>'capaciteit')::integer)
    on conflict (datum, start) do update set capaciteit = excluded.capaciteit;
  return jsonb_build_object('ok', true);
end
$spaak_capaciteit_zet$;

create or replace function {{APP_SCHEMA}}.spaak_gesloten_zet(p jsonb) returns jsonb
language plpgsql
set search_path = pg_catalog, {{APP_SCHEMA}}
as $spaak_gesloten_zet$
declare
  v_datum date := (p->>'datum')::date;
begin
  perform pg_advisory_xact_lock(hashtextextended('{{APP_SCHEMA}}:dag:' || v_datum::text, 0));
  if (p->>'gesloten')::boolean then
    insert into {{APP_SCHEMA}}.spaak_gesloten (datum) values (v_datum) on conflict do nothing;
  else
    delete from {{APP_SCHEMA}}.spaak_gesloten where datum = v_datum;
  end if;
  return jsonb_build_object('ok', true);
end
$spaak_gesloten_zet$;

revoke all on table {{APP_SCHEMA}}.spaak_reparaties from public;
revoke all on table {{APP_SCHEMA}}.spaak_capaciteit from public;
revoke all on table {{APP_SCHEMA}}.spaak_gesloten from public;
revoke all on table {{APP_SCHEMA}}.spaak_afspraken from public;
revoke all on function {{APP_SCHEMA}}.spaak_reparaties(jsonb) from public;
revoke all on function {{APP_SCHEMA}}.spaak_reparatie_toevoegen(jsonb) from public;
revoke all on function {{APP_SCHEMA}}.spaak_dag(jsonb) from public;
revoke all on function {{APP_SCHEMA}}.spaak_volgende_vrije_dag(jsonb) from public;
revoke all on function {{APP_SCHEMA}}.spaak_boek(jsonb) from public;
revoke all on function {{APP_SCHEMA}}.spaak_zoek(jsonb) from public;
revoke all on function {{APP_SCHEMA}}.spaak_annuleer(jsonb) from public;
revoke all on function {{APP_SCHEMA}}.spaak_dagoverzicht(jsonb) from public;
revoke all on function {{APP_SCHEMA}}.spaak_status(jsonb) from public;
revoke all on function {{APP_SCHEMA}}.spaak_capaciteit_zet(jsonb) from public;
revoke all on function {{APP_SCHEMA}}.spaak_gesloten_zet(jsonb) from public;

do $spaak_grants$
declare
  v_role text;
  v_table text;
  v_function text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      foreach v_table in array array['spaak_reparaties', 'spaak_capaciteit', 'spaak_gesloten', 'spaak_afspraken'] loop
        execute format('revoke all on table {{APP_SCHEMA}}.%I from %I', v_table, v_role);
        if v_role = 'service_role' then
          execute format('grant select, insert, update, delete on table {{APP_SCHEMA}}.%I to service_role', v_table);
        end if;
      end loop;
      foreach v_function in array array['spaak_reparaties', 'spaak_reparatie_toevoegen', 'spaak_dag', 'spaak_volgende_vrije_dag',
        'spaak_boek', 'spaak_zoek', 'spaak_annuleer', 'spaak_dagoverzicht', 'spaak_status', 'spaak_capaciteit_zet', 'spaak_gesloten_zet'] loop
        execute format('revoke all on function {{APP_SCHEMA}}.%I(jsonb) from %I', v_function, v_role);
        if v_role = 'service_role' then
          execute format('grant execute on function {{APP_SCHEMA}}.%I(jsonb) to service_role', v_function);
        end if;
      end loop;
      if v_role = 'service_role' then
        execute 'grant usage on schema {{APP_SCHEMA}} to service_role';
      end if;
    end if;
  end loop;
end
$spaak_grants$;
