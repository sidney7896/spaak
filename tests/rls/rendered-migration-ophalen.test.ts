import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

/**
 * W7: the actual product renderer and migration files, never a hand-rendered replacement.
 * Fixtures copy the renderer and SQL into a disposable product tree; the real repository is never mutated.
 * PGlite proves local SQL behaviour, not permissions or rebuilds of a live Supabase project.
 */
const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const FIRST = "0001_notes_and_private_storage.sql";
const SECOND = "0002_ophalen.sql";
const roots: string[] = [];
const DEDICATED = ["--slug", "spaak", "--environment", "dev", "--schema", "public",
  "--bucket", "spaak-dev-private", "--topology", "dedicated"];
const SHARED = ["--slug", "spaak", "--environment", "dev", "--schema", "app_spaak_dev",
  "--bucket", "spaak-dev-private", "--topology", "shared"];
const PRELUDE = `
  create schema if not exists auth; create table if not exists auth.users(id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
  create schema if not exists storage;
  create table if not exists storage.buckets(id text primary key, name text, public boolean);
  create table if not exists storage.objects(id uuid primary key, bucket_id text not null, name text not null);
  create function storage.foldername(path text) returns text[] language sql immutable as $fn$ select case when position('/' in path) = 0 then ARRAY[]::text[] else regexp_split_to_array(regexp_replace(path, '/[^/]*$', ''), '/') end $fn$;
`;
const REGISTRY_PARSE_FIXTURE = `
  create schema if not exists registry;
  create function registry.is_member(uid uuid, slug text, env text) returns boolean language sql stable as $fn$ select false $fn$;
`;

function invoke(root = projectRoot, args = DEDICATED) {
  return spawnSync(process.execPath, [join(root, "ops/render-migration.mjs"), ...args], { encoding: "utf8" });
}

function render(root = projectRoot, args = DEDICATED): string {
  const result = invoke(root, args);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).not.toContain("{{");
  return result.stdout;
}

function fixture(files = [FIRST, SECOND]): string {
  const root = mkdtempSync(join(tmpdir(), "spaak-ophalen-"));
  roots.push(root);
  mkdirSync(join(root, "ops"), { recursive: true });
  mkdirSync(join(root, "supabase/migrations"), { recursive: true });
  copyFileSync(join(projectRoot, "ops/render-migration.mjs"), join(root, "ops/render-migration.mjs"));
  writeFileSync(join(root, "project.profile.json"), JSON.stringify({ slug: "spaak", topology: "shared" }));
  for (const name of files) copyFileSync(join(projectRoot, "supabase/migrations", name), join(root, "supabase/migrations", name));
  return root;
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function rpcInput(ophalen?: unknown) {
  return { repairTypeId: "onderhoud", date: "2026-10-09", start: "10:00", end: "11:00", naam: "Femke de Wit",
    telefoon: "06 1234 5678", email: "femke@example.nl", fiets: "Gazelle, ketting piept", sleutel: "direct-sql-key",
    capacity: 2, start_tijdstip: "2026-10-09T08:00:00.000Z", nu: "2026-10-08T08:15:00.000Z",
    ...(ophalen === undefined ? {} : { ophalen }) };
}

describe("W7: renderer discovers the complete migration set", () => {
  // Checks 0001 is an unchanged prefix and 0002 is appended in filename order with the required separator.
  // Catches: rendering only 0001, reversing the order, or rewriting 0001 while composing the result.
  it("renders 0001 then the actual 0002 with one joining newline", () => {
    const root = fixture([FIRST]);
    const baseline = render(root);
    copyFileSync(join(projectRoot, "supabase/migrations", SECOND), join(root, "supabase/migrations", SECOND));
    const full = render(root);
    expect(full.startsWith(baseline + "\n")).toBe(true);
    expect(full.slice(baseline.length + 1)).toMatch(/ophaal_postcode/);
    expect(full.slice(baseline.length + 1)).toMatch(/spaak_afspraken_ophalen_check/);
    expect(full).toBe(render());
  });

  // Checks the renderer discovers any correctly named migration, applies topology and substitutes placeholders.
  // Catches: hard-coding 0001+0002, filesystem order, or applying placeholders only to the first file.
  it("renders every matching file in name order with the same topology rules", () => {
    const root = fixture();
    writeFileSync(join(root, "supabase/migrations/0010_later.sql"), "select '{{APP_SCHEMA}}', '{{APP_BUCKET}}', '{{APP_SLUG}}', '{{APP_ENV}}', 'later';\n");
    writeFileSync(join(root, "supabase/migrations/0003_earlier.sql"), "{{#shared}}\nselect 'shared-marker';\n{{/shared}}\n{{#dedicated}}\nselect 'dedicated-marker';\n{{/dedicated}}\nselect '{{APP_SCHEMA}}', 'earlier';\n");
    const dedicated = render(root);
    expect(dedicated).toContain("select 'public', 'spaak-dev-private', 'spaak', 'dev', 'later';");
    expect(dedicated).toContain("select 'dedicated-marker';");
    expect(dedicated).not.toContain("shared-marker");
    expect(dedicated.indexOf("ophaal_postcode")).toBeLessThan(dedicated.indexOf("'earlier'"));
    expect(dedicated.indexOf("'earlier'")).toBeLessThan(dedicated.indexOf("'later'"));
    const shared = render(root, SHARED);
    expect(shared).toContain("select 'app_spaak_dev', 'earlier';");
    expect(shared).toContain("select 'shared-marker';");
    expect(shared).not.toContain("dedicated-marker");
  });

  // Checks unrelated files and almost-valid names are refused rather than silently skipped.
  // Catches: filtering out stray files without rejecting an incomplete or ambiguous migration folder.
  it("refuses stray files and invalid migration names", () => {
    for (const name of ["README.md", ".DS_Store", "2_ophalen.sql", "0003_bad-name.sql", "0003_UPPER.sql", "0003_more.SQL"]) {
      const root = fixture();
      writeFileSync(join(root, "supabase/migrations", name), "select 1;\n");
      const result = invoke(root);
      expect(result.status, name).not.toBe(0);
    }
  });

  // Checks 0002 cannot replace the required initial migration or its R3-05 pins.
  // Catches: accepting an expansion alone or dropping the schema assertions when rendering multiple files.
  it("refuses a missing 0001 and either missing R3-05 pin", () => {
    expect(invoke(fixture([SECOND])).status).not.toBe(0);
    const alternate = fixture([SECOND]);
    copyFileSync(join(projectRoot, "supabase/migrations", FIRST), join(alternate, "supabase/migrations/0000_alternate.sql"));
    const missing = invoke(alternate);
    expect(missing.status).not.toBe(0);
    for (const pattern of [/^set local search_path[^\n]*\n/m, /^\s*raise exception 'launch: this migration was rendered for schema[^\n]*\n/m]) {
      const root = fixture();
      const path = join(root, "supabase/migrations", FIRST);
      const original = readFileSync(path, "utf8");
      expect(pattern.test(original)).toBe(true);
      writeFileSync(path, original.replace(pattern, ""));
      expect(invoke(root).status).not.toBe(0);
    }
  });

  // Checks --check sees 0002 as well as 0001 using profile-owned identity.
  // Catches: migration:check validating only the old file while render/apply uses a different set.
  it("checks the full set and refuses unresolved placeholders in 0002", () => {
    const root = fixture();
    const args = ["--check", "--environment", "dev", "--schema", "app_spaak_dev"];
    const result = invoke(root, args);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("migration:check ok");
    const path = join(root, "supabase/migrations", SECOND);
    writeFileSync(path, readFileSync(path, "utf8") + "\nselect '{{UNRESOLVED_W7}}';\n");
    expect(invoke(root, args).status).not.toBe(0);
  });

  // Checks the expansion is the only new migration and cannot target control-plane or storage schemas.
  // Catches: destructive replacement migrations or requiring privileges outside the application schema.
  it("adds only expand-only 0002 with guarded columns and a guarded constraint", () => {
    expect(readdirSync(join(projectRoot, "supabase/migrations")).sort()).toEqual([FIRST, SECOND]);
    const sql = readFileSync(join(projectRoot, "supabase/migrations", SECOND), "utf8");
    const statements = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
    expect(statements).not.toMatch(/\b(?:auth|public|storage|registry)\s*\./i);
    expect(statements).not.toMatch(/\b(?:drop|truncate|delete)\b/i);
    expect(statements).toMatch(/add\s+column\s+if\s+not\s+exists\s+ophaal_postcode\s+text/i);
    expect(statements).toMatch(/add\s+column\s+if\s+not\s+exists\s+ophaal_adres\s+text/i);
    expect(statements).toMatch(/add\s+column\s+if\s+not\s+exists\s+toeslag_cent\s+integer\s+not\s+null\s+default\s+0/i);
    expect(statements).toMatch(/do\s+\$[a-z0-9_]*\$[\s\S]*?if\s+not\s+exists[\s\S]*?spaak_afspraken_ophalen_check[\s\S]*?add\s+constraint\s+spaak_afspraken_ophalen_check/i);
    expect(statements).toMatch(/create\s+or\s+replace\s+function\s+\{\{APP_SCHEMA\}\}\.spaak_boek\s*\(p\s+jsonb\)/i);
  });
});

describe("W7: full rendered migration in PGlite", () => {
  // Checks the full renderer output creates all three columns with the required database types and default.
  // Catches: testing a hand-made schema while the product renderer still omits 0002.
  it("applies the full set and creates the new columns and named constraint", async () => {
    const db = new PGlite();
    try {
      await db.exec(PRELUDE);
      await db.exec(`set search_path to public;\n${render()}`);
      const columns = (await db.query("select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'spaak_afspraken' and column_name in ('ophaal_postcode', 'ophaal_adres', 'toeslag_cent') order by column_name")).rows;
      expect(columns).toEqual([
        { column_name: "ophaal_adres", data_type: "text", is_nullable: "YES", column_default: null },
        { column_name: "ophaal_postcode", data_type: "text", is_nullable: "YES", column_default: null },
        { column_name: "toeslag_cent", data_type: "integer", is_nullable: "NO", column_default: "0" },
      ]);
      expect((await db.query("select conname from pg_constraint where conrelid = 'public.spaak_afspraken'::regclass and conname = 'spaak_afspraken_ophalen_check'")).rows)
        .toEqual([{ conname: "spaak_afspraken_ophalen_check" }]);
    } finally { await db.close(); }
  });

  // Checks SQL validation directly without MemoryStore, SupabaseStore or domain validation.
  // Catches: client-only validation, wrong S19 punctuation, or insert-before-validation.
  it("rejects invalid pick-up server-side with the same exact field errors and no rows", async () => {
    const db = new PGlite();
    try {
      await db.exec(PRELUDE);
      await db.exec(`set search_path to public;\n${render()}`);
      const cases = [
        { ophalen: { postcode: "3600 AA", adres: "Oudegracht 1" }, fields: { postcode: "We halen alleen op binnen de ring: postcodes 3500 tot en met 3599" } },
        { ophalen: { postcode: "3499 AA", adres: "Oudegracht 1" }, fields: { postcode: "We halen alleen op binnen de ring: postcodes 3500 tot en met 3599" } },
        { ophalen: { postcode: "3512-AB", adres: "Oudegracht 1" }, fields: { postcode: "Vul een postcode in zoals 3512 AB." } },
        { ophalen: { postcode: "3512 AB", adres: " " }, fields: { adres: "Vul een straat en huisnummer in." } },
        { ophalen: { postcode: "3512 AB", adres: "\t\n" }, fields: { adres: "Vul een straat en huisnummer in." } },
        { ophalen: { postcode: "3512 AB", adres: "a".repeat(121) }, fields: { adres: "Vul een straat en huisnummer in." } },
        { ophalen: { postcode: "", adres: "" }, fields: { postcode: "Vul een postcode in zoals 3512 AB.", adres: "Vul een straat en huisnummer in." } },
      ];
      for (const value of cases) {
        const r = await db.query<{ r: unknown }>("select public.spaak_boek($1::jsonb) as r", [JSON.stringify(rpcInput(value.ophalen))]);
        expect(r.rows[0]?.r).toEqual({ ok: false, reason: "ongeldig", fields: value.fields });
        expect((await db.query("select code from public.spaak_afspraken")).rows).toEqual([]);
      }
    } finally { await db.close(); }
  });

  // Checks the SQL shape guard on a direct RPC call, without the API in front (review F1, 06-10).
  // Catches: a spaak_boek that coerces a number to text, ignores a missing or extra key, or accepts a non-object.
  it("rejects every malformed pick-up shape server-side with fields.ophalen and no rows", async () => {
    const db = new PGlite();
    try {
      await db.exec(PRELUDE);
      await db.exec(`set search_path to public;\n${render()}`);
      const shapes: unknown[] = [
        5, "3512 AB", true, [], ["3512 AB", "Oudegracht 1"],
        {}, { postcode: "3512 AB" }, { adres: "Oudegracht 1" },
        { postcode: "3512 AB", adres: 123 }, { postcode: 3512, adres: "Oudegracht 1" },
        { postcode: null, adres: "Oudegracht 1" }, { postcode: "3512 AB", adres: { straat: "Oudegracht" } },
        { postcode: "3512 AB", adres: "Oudegracht 1", extra: 1 },
      ];
      for (const [index, ophalen] of shapes.entries()) {
        const input = { ...rpcInput(ophalen), sleutel: `direct-sql-shape-${index}` };
        const r = await db.query<{ r: unknown }>("select public.spaak_boek($1::jsonb) as r", [JSON.stringify(input)]);
        expect(r.rows[0]?.r, JSON.stringify(ophalen)).toEqual({ ok: false, reason: "ongeldig",
          fields: { ophalen: "Vul postcode en adres in als tekst." } });
        expect((await db.query("select code from public.spaak_afspraken")).rows).toEqual([]);
      }
    } finally { await db.close(); }
  });

  // Checks SQL normalizes raw input and retains the first booking when the same key is reused.
  // Catches: TS-only normalization or SQL overwriting a first booking on retry.
  it("normalizes valid raw RPC input and keeps idempotency", async () => {
    const db = new PGlite();
    try {
      await db.exec(PRELUDE);
      await db.exec(`set search_path to public;\n${render()}`);
      const call = async (p: unknown) => (await db.query<{ r: unknown }>("select public.spaak_boek($1::jsonb) as r", [JSON.stringify(p)])).rows[0]?.r;
      const first = await call(rpcInput({ postcode: " 3512  ab ", adres: " Oudegracht 1 " }));
      expect(first).toMatchObject({ ok: true, booking: { ophaal_postcode: "3512 AB", ophaal_adres: "Oudegracht 1", toeslag_cent: 1000 } });
      expect(await call(rpcInput(null))).toEqual(first);
      expect((await db.query("select ophaal_postcode, ophaal_adres, toeslag_cent from public.spaak_afspraken")).rows)
        .toEqual([{ ophaal_postcode: "3512 AB", ophaal_adres: "Oudegracht 1", toeslag_cent: 1000 }]);
    } finally { await db.close(); }
  });

  // Checks direct INSERTs cannot exploit nullable CHECK expressions or inconsistent surcharges.
  // Catches: SQL CHECK returning UNKNOWN for a half-filled address and thereby accepting it.
  it("rejects every inconsistent row inserted directly with the named constraint", async () => {
    const db = new PGlite();
    try {
      await db.exec(PRELUDE);
      await db.exec(`set search_path to public;\n${render()}`);
      const bad: [string | null, string | null, number][] = [
        [null, null, 1000], ["3512 AB", null, 1000], [null, "Oudegracht 1", 1000],
        ["3512 AB", null, 0], [null, "Oudegracht 1", 0], ["3512 AB", "Oudegracht 1", 0],
        ["3512 AB", "Oudegracht 1", 999], ["3600 AA", "Oudegracht 1", 1000],
        ["3499 AA", "Oudegracht 1", 1000], ["3512ab", "Oudegracht 1", 1000],
        ["3512 AB", " ", 1000], ["3512 AB", "a".repeat(121), 1000],
      ];
      for (const [postcode, adres, toeslag] of bad) {
        await expect(db.query(`insert into public.spaak_afspraken
          (code, sleutel, reparatie_id, datum, start, eind, start_tijdstip, naam, telefoon, email, fiets, aangemaakt, bijgewerkt, ophaal_postcode, ophaal_adres, toeslag_cent)
          values ('ABCDEF', 'direct-insert-key', 'onderhoud', '2026-10-09', '10:00', '11:00', '2026-10-09T08:00:00Z', 'Femke', '0612345678', 'femke@example.nl', 'Gazelle', '2026-10-08T08:15:00Z', '2026-10-08T08:15:00Z', $1, $2, $3)`,
          [postcode, adres, toeslag])).rejects.toThrow(/spaak_afspraken_ophalen_check/);
        expect((await db.query("select code from public.spaak_afspraken")).rows).toEqual([]);
      }
    } finally { await db.close(); }
  });

  // Checks existing rows survive and 0002 can be applied twice by a non-superuser confined to the app schema.
  // Catches: auth/public/storage/registry DDL, unguarded constraints, or destructive conversion of old appointments.
  it("expands existing data twice using only application-schema ownership", async () => {
    const root = fixture([FIRST]);
    const baseline = render(root, SHARED);
    copyFileSync(join(projectRoot, "supabase/migrations", SECOND), join(root, "supabase/migrations", SECOND));
    const full = render(root, SHARED);
    expect(full.startsWith(baseline + "\n")).toBe(true);
    const expansion = full.slice(baseline.length + 1);
    const db = new PGlite();
    try {
      await db.exec(`${PRELUDE}${REGISTRY_PARSE_FIXTURE}`);
      await db.exec("create schema app_spaak_dev;");
      await db.exec(baseline);
      const before = (await db.query<{ r: unknown }>("select app_spaak_dev.spaak_boek($1::jsonb) as r", [JSON.stringify(rpcInput())])).rows[0]?.r;
      expect(before).toMatchObject({ ok: true });
      await db.exec(`
        create role app_migrator nologin nosuperuser nocreatedb nocreaterole nobypassrls;
        alter schema app_spaak_dev owner to app_migrator;
        alter table app_spaak_dev.spaak_afspraken owner to app_migrator;
        alter function app_spaak_dev.spaak_boek(jsonb) owner to app_migrator;
        revoke all on schema public from public;
        set role app_migrator;
        set search_path to app_spaak_dev;
      `);
      for (const schema of ["auth", "public", "storage", "registry"]) {
        expect((await db.query<{ allowed: boolean }>("select has_schema_privilege(current_user, $1, 'USAGE') as allowed", [schema])).rows[0]?.allowed).toBe(false);
      }
      await db.exec(expansion);
      await db.exec(expansion);
      await db.exec("reset role;");
      expect((await db.query("select ophaal_postcode, ophaal_adres, toeslag_cent from app_spaak_dev.spaak_afspraken")).rows)
        .toEqual([{ ophaal_postcode: null, ophaal_adres: null, toeslag_cent: 0 }]);
      const after = (await db.query<{ r: unknown }>("select app_spaak_dev.spaak_boek($1::jsonb) as r", [JSON.stringify(rpcInput())])).rows[0]?.r;
      expect(after).toMatchObject(before as object);
      expect(after).toMatchObject({ ok: true, booking: { ophaal_postcode: null, ophaal_adres: null, toeslag_cent: 0 } });
    } finally { await db.close(); }
  });
});
