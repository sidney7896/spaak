-- W7: expand existing appointments without changing the applied initial migration.
alter table {{APP_SCHEMA}}.spaak_afspraken
  add column if not exists ophaal_postcode text,
  add column if not exists ophaal_adres text,
  add column if not exists toeslag_cent integer not null default 0;

do $ophalen_constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = '{{APP_SCHEMA}}.spaak_afspraken'::regclass
      and conname = 'spaak_afspraken_ophalen_check'
  ) then
    alter table {{APP_SCHEMA}}.spaak_afspraken
      add constraint spaak_afspraken_ophalen_check check (
        (ophaal_postcode is null and ophaal_adres is null and toeslag_cent = 0)
        or (ophaal_postcode is not null and ophaal_adres is not null
          and ophaal_postcode ~ '^35[0-9]{2} [A-Z]{2}$'
          and char_length(btrim(ophaal_adres)) between 1 and 120
          and toeslag_cent = 1000)
      );
  end if;
end
$ophalen_constraint$;

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
  v_ophalen jsonb := p->'ophalen';
  v_postcode text;
  v_adres text;
  v_toeslag integer := 0;
  v_fields jsonb := '{}'::jsonb;
  -- Match the whitespace removed by JavaScript \s and String.trim().
  v_whitespace text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if not exists (select 1 from {{APP_SCHEMA}}.spaak_reparaties r where r.id = p->>'repairTypeId') then
    return jsonb_build_object('ok', false, 'reason', 'ongeldig',
      'fields', jsonb_build_object('repairTypeId', 'Kies een geldig reparatietype.'));
  end if;
  -- Key first, then day, then slot: retries on different slots also serialize.
  perform pg_advisory_xact_lock(hashtextextended('{{APP_SCHEMA}}:sleutel:' || (p->>'sleutel'), 0));
  select * into v_afspraak from {{APP_SCHEMA}}.spaak_afspraken a where a.sleutel = p->>'sleutel';
  if found then return jsonb_build_object('ok', true, 'booking', to_jsonb(v_afspraak)); end if;
  if v_ophalen is not null and v_ophalen <> 'null'::jsonb then
    if jsonb_typeof(v_ophalen) <> 'object' then
      return jsonb_build_object('ok', false, 'reason', 'ongeldig',
        'fields', jsonb_build_object('ophalen', 'Vul postcode en adres in als tekst.'));
    end if;
    if (select count(*) from jsonb_object_keys(v_ophalen)) <> 2
      or not (v_ophalen ? 'postcode' and v_ophalen ? 'adres')
      or jsonb_typeof(v_ophalen->'postcode') is distinct from 'string'
      or jsonb_typeof(v_ophalen->'adres') is distinct from 'string' then
      return jsonb_build_object('ok', false, 'reason', 'ongeldig',
        'fields', jsonb_build_object('ophalen', 'Vul postcode en adres in als tekst.'));
    end if;
    v_postcode := upper(translate(v_ophalen->>'postcode', v_whitespace, ''));
    v_adres := btrim(v_ophalen->>'adres', v_whitespace);
    if v_postcode !~ '^[1-9][0-9]{3}[A-Z]{2}$' then
      v_fields := v_fields || jsonb_build_object('postcode', 'Vul een postcode in zoals 3512 AB.');
    elsif substr(v_postcode, 1, 4)::integer not between 3500 and 3599 then
      v_fields := v_fields || jsonb_build_object('postcode', 'We halen alleen op binnen de ring: postcodes 3500 tot en met 3599');
    end if;
    if char_length(v_adres) not between 1 and 120 then
      v_fields := v_fields || jsonb_build_object('adres', 'Vul een straat en huisnummer in.');
    end if;
    if v_fields <> '{}'::jsonb then
      return jsonb_build_object('ok', false, 'reason', 'ongeldig', 'fields', v_fields);
    end if;
    v_postcode := substr(v_postcode, 1, 4) || ' ' || substr(v_postcode, 5, 2);
    v_toeslag := 1000;
  end if;
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
        (code, sleutel, reparatie_id, datum, start, eind, start_tijdstip, naam, telefoon, email, fiets, status, aangemaakt, bijgewerkt, ophaal_postcode, ophaal_adres, toeslag_cent)
        values (v_code, p->>'sleutel', p->>'repairTypeId', v_datum, v_start, (p->>'end')::time, v_tijdstip,
          p->>'naam', p->>'telefoon', p->>'email', p->>'fiets', 'gepland', v_nu, v_nu, v_postcode, v_adres, v_toeslag)
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

