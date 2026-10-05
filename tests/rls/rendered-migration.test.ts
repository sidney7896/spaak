import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

/**
 * The rendered migration is applied to PGlite, an in-process Postgres. That is a local fixture
 * database: it proves what the SQL does, never what a live Supabase project does.
 */
const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const ids = { member: "00000000-0000-0000-0000-0000000000a1", outsider: "00000000-0000-0000-0000-0000000000a2" };

function render(args: string[]): string {
  const result = spawnSync(process.execPath, [join(projectRoot, "ops/render-migration.mjs"), ...args], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).not.toContain("{{");
  return result.stdout;
}

const PRELUDE = `
  create schema if not exists auth; create table if not exists auth.users(id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
  create schema if not exists storage;
  create table if not exists storage.buckets(id text primary key, name text, public boolean);
  create table if not exists storage.objects(id uuid primary key, bucket_id text not null, name text not null);
  create function storage.foldername(path text) returns text[] language sql immutable as $fn$ select case when position('/' in path) = 0 then ARRAY[]::text[] else regexp_split_to_array(regexp_replace(path, '/[^/]*$', ''), '/') end $fn$;
`;

/**
 * FIXTURE STAND-IN, not the control-plane function: a shared rendering names
 * `registry.is_member`, and Postgres parses the whole batch before executing it, so the schema has
 * to exist for the statements to parse at all. The shared tests below are about WHERE objects land,
 * never about what this function answers - it always answers false.
 */
const REGISTRY_PARSE_FIXTURE = `
  create schema if not exists registry;
  create function registry.is_member(uid uuid, slug text, env text) returns boolean language sql stable as $fn$ select false $fn$;
`;

async function tableCount(db: PGlite, schema: string): Promise<string | undefined> {
  return (await db.query<{ count: string }>("select count(*)::text as count from pg_tables where schemaname = $1", [schema])).rows[0]?.count;
}

describe("the rendered migration gates rows by membership (fixture database)", () => {
  it("admits a member and denies a non-member in a dedicated project", async () => {
    const migration = render(["--slug", "alpha_app", "--environment", "dev", "--schema", "public", "--bucket", "alpha-app-dev-private", "--topology", "dedicated"]);
    const db = new PGlite();
    try {
      await db.exec(PRELUDE);
      await db.exec(`insert into auth.users values ('${ids.member}'), ('${ids.outsider}');`);
      await db.exec(`set search_path to public;\n${migration}`);
      // The membership row is written by the provisioning path, not by the user.
      await db.exec(`insert into public.app_memberships(user_id, app_slug, env) values ('${ids.member}', 'alpha_app', 'dev');`);

      await db.exec("create role app_user nologin;");
      await db.exec(`
        grant usage on schema auth, storage, public to app_user;
        grant select on auth.users to app_user;
        grant execute on function public.launch_is_member(text, text) to app_user;
        grant select, insert, update, delete on public.notes, storage.objects to app_user;
        alter table storage.objects enable row level security;
        alter table storage.objects force row level security;
      `);

      await db.exec(`set role app_user; set request.jwt.claim.sub = '${ids.member}';`);
      expect((await db.query<{ member: boolean }>("select public.launch_is_member('alpha_app', 'dev') as member")).rows[0]?.member).toBe(true);
      await db.exec("insert into public.notes(title, body) values ('member note', 'private');");
      expect((await db.query<{ count: string }>("select count(*)::text as count from public.notes")).rows[0]?.count).toBe("1");

      await db.exec(`set request.jwt.claim.sub = '${ids.outsider}';`);
      expect((await db.query<{ member: boolean }>("select public.launch_is_member('alpha_app', 'dev') as member")).rows[0]?.member).toBe(false);
      expect((await db.query<{ count: string }>("select count(*)::text as count from public.notes")).rows[0]?.count).toBe("0");
      await expect(db.query("insert into public.notes(title, body) values ('outsider', 'blocked')")).rejects.toThrow();
      await expect(db.query(`insert into storage.objects(id, bucket_id, name) values ('10000000-0000-0000-0000-000000000009', 'alpha-app-dev-private', '${ids.outsider}/x.txt')`)).rejects.toThrow();
      await db.exec("reset role;");
    } finally {
      await db.close();
    }
  });

  it("lands in the schema it was rendered for even when the runner's search_path says otherwise (R3-05)", async () => {
    const production = render(["--slug", "alpha_app", "--environment", "prod", "--schema", "app_alpha_app_prod", "--bucket", "alpha-app-prod-private", "--topology", "shared"]);
    const db = new PGlite();
    try {
      await db.exec(`${PRELUDE}${REGISTRY_PARSE_FIXTURE}`);
      await db.exec("create schema app_alpha_app_dev; create schema app_alpha_app_prod;");
      // The runner points at the DEVELOPMENT schema; the production rendering must pin itself.
      await db.exec(`set search_path to app_alpha_app_dev, public;\n${production}`);
      expect(await tableCount(db, "app_alpha_app_dev")).toBe("0");
      expect(await tableCount(db, "app_alpha_app_prod")).toBe("5"); // notes plus the four Spaak tables (W1b)

      // And with the search_path pin stripped out - a runner that executes statement by statement,
      // so SET LOCAL never survives - the schema qualification still keeps every object in place.
      const unpinned = production
        .split("\n").filter((line) => !line.startsWith("set local search_path")).join("\n")
        .replace(/do \$\$[\s\S]*?\n\$\$;\n/, "");
      const second = new PGlite();
      try {
        await second.exec(`${PRELUDE}${REGISTRY_PARSE_FIXTURE}`);
        await second.exec("create schema app_alpha_app_dev; create schema app_alpha_app_prod;");
        await second.exec(`set search_path to app_alpha_app_dev, public;\n${unpinned}`);
        expect(await tableCount(second, "app_alpha_app_dev")).toBe("0");
        expect(await tableCount(second, "app_alpha_app_prod")).toBe("5");
      } finally {
        await second.close();
      }
    } finally {
      await db.close();
    }
  });

  it("refuses to apply when the target schema does not exist", async () => {
    const production = render(["--slug", "alpha_app", "--environment", "prod", "--schema", "app_alpha_app_prod", "--bucket", "alpha-app-prod-private", "--topology", "shared"]);
    const db = new PGlite();
    try {
      await db.exec(`${PRELUDE}${REGISTRY_PARSE_FIXTURE}`);
      await expect(db.exec(production)).rejects.toThrow(/target schema app_alpha_app_prod does not exist/);
    } finally {
      await db.close();
    }
  });

  it("keeps the shared rendering on the control-plane membership function", () => {
    const shared = render(["--slug", "alpha_app", "--environment", "dev", "--schema", "app_alpha_app_dev", "--bucket", "alpha-app-dev-private", "--topology", "shared"]);
    const policies = shared.split("\n").filter((line) => line.startsWith("create policy "));
    expect(policies.length).toBe(8);
    for (const policy of policies) expect(policy).toContain("registry.is_member(auth.uid(), 'alpha_app', 'dev')");
    expect(shared).not.toContain("create or replace function public.launch_is_member");
  });
});
