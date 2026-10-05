import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SupabaseStore, type RpcClient } from "../../src/lib/spaak/supabase-store";
import type { BookingInput } from "../../src/lib/spaak/store";

/**
 * Werkstuk W1b (route D trial, 05-10): the database store that preview and production use. The rules live in the
 * rendered migration as functions with one jsonb argument (`p`) that the server calls through Supabase RPC with the
 * service role; here the same rendered migration runs in PGlite (an in-process Postgres: it proves what the SQL does,
 * not what a live Supabase project does) and a small client turns `rpc(name, {p})` into `select fn($1::jsonb)`.
 * The store must behave like the MemoryStore of W1a. The clock is Thursday 8 October 2026, 10:15 in Amsterdam.
 * Written by the meester; the builder may not change this file.
 */

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const NOW = new Date("2026-10-08T08:15:00.000Z");
const PRELUDE = `
  create schema if not exists auth; create table if not exists auth.users(id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $fn$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
  create schema if not exists storage;
  create table if not exists storage.buckets(id text primary key, name text, public boolean);
  create table if not exists storage.objects(id uuid primary key, bucket_id text not null, name text not null);
  create function storage.foldername(path text) returns text[] language sql immutable as $fn$ select case when position('/' in path) = 0 then ARRAY[]::text[] else regexp_split_to_array(regexp_replace(path, '/[^/]*$', ''), '/') end $fn$;
`;

function render(): string {
  const result = spawnSync(process.execPath, [join(projectRoot, "ops/render-migration.mjs"), "--slug", "spaak", "--environment", "dev",
    "--schema", "public", "--bucket", "spaak-dev-private", "--topology", "dedicated"], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

let db: PGlite;
let store: SupabaseStore;
let calls: string[];

function client(database: PGlite): RpcClient {
  return {
    schema: (schema: string) => ({
      rpc: async (fn: string, args: { p: unknown }) => {
        calls.push(fn);
        if (!/^spaak_[a-z_]+$/.test(fn)) return { data: null, error: { message: "unknown function" } };
        try {
          const r = await database.query<{ r: unknown }>(`select ${schema}.${fn}($1::jsonb) as r`, [JSON.stringify(args.p)]);
          return { data: r.rows[0]?.r ?? null, error: null };
        } catch (error) {
          return { data: null, error: { message: String(error) } };
        }
      },
    }),
  };
}

function input(over: Partial<BookingInput> = {}): BookingInput {
  return { repairTypeId: "onderhoud", date: "2026-10-09", start: "10:00", naam: "Femke de Wit", telefoon: "06 1234 5678",
           email: "femke@example.nl", fiets: "Gazelle, ketting piept", ...over };
}

beforeEach(async () => {
  calls = [];
  db = new PGlite();
  await db.exec(PRELUDE);
  await db.exec(`set search_path to public;\n${render()}`);
  store = new SupabaseStore({ client: client(db), schema: "public", now: () => NOW });
});

afterEach(async () => {
  await db.close();
});

describe("the migration", () => {
  it("creates the four Spaak tables with row level security and no public access", async () => {
    const tables = (await db.query<{ t: string; rls: boolean; forced: boolean }>(
      "select c.relname as t, c.relrowsecurity as rls, c.relforcerowsecurity as forced from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'spaak_%' and c.relkind = 'r' order by 1")).rows;
    expect(tables.map((r) => r.t)).toEqual(["spaak_afspraken", "spaak_capaciteit", "spaak_gesloten", "spaak_reparaties"]);
    expect(tables.every((r) => r.rls && r.forced)).toBe(true);
    await db.exec("create role buitenstaander nologin; grant usage on schema public to buitenstaander;");
    await store.book(input(), "key-0000001");
    await db.exec("set role buitenstaander;");
    await expect(db.query("select * from public.spaak_afspraken")).rejects.toThrow();
    await expect(db.query("select public.spaak_zoek('{\"code\":\"ABCDEF\"}'::jsonb)")).rejects.toThrow();
    await db.exec("reset role;");
  });

  it("serialises bookings of one slot with a transaction-scoped lock", () => {
    const sql = render();
    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(/gen_random_uuid\(\)|gen_random_bytes/);
  });
});

describe("the store behaves like the MemoryStore", () => {
  it("starts with the shop's four repair types and adds one", async () => {
    expect((await store.listRepairTypes()).map((t) => [t.id, t.naam, t.duurMinuten, t.prijsCent])).toEqual([
      ["onderhoud", "Onderhoudsbeurt", 60, 6900], ["remmen", "Remmen afstellen", 30, 2500],
      ["band", "Band plakken", 20, 1500], ["overig", "Overig", 60, null]]);
    const added = await store.addRepairType({ naam: "Banden wisselen", duurMinuten: 30, prijsCent: 2500 });
    expect((await store.book(input({ repairTypeId: added.id }), "key-0000002")).ok).toBe(true);
    await expect(store.addRepairType({ naam: " ", duurMinuten: 30, prijsCent: 1 })).rejects.toThrow();
  });

  it("books, counts capacity and refuses the third booking of a weekday slot", async () => {
    const first = await store.book(input(), "key-a000001");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.booking.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(first.booking).toMatchObject({ date: "2026-10-09", start: "10:00", end: "11:00", status: "gepland" });
    expect((await store.book(input({ naam: "Ahmed" }), "key-b000001")).ok).toBe(true);
    expect(await store.book(input({ naam: "Bas" }), "key-c000001")).toEqual({ ok: false, reason: "vol" });
    const slot = (await store.dayAvailability("2026-10-09")).slots.find((s) => s.start === "10:00");
    expect(slot).toMatchObject({ capacity: 2, booked: 2, free: 0 });
  });

  it("gives one booking for one idempotency key", async () => {
    const a = await store.book(input(), "same-key-01");
    const b = await store.book(input(), "same-key-01");
    expect(a.ok && b.ok && a.booking.code === b.booking.code).toBe(true);
    expect((await store.dayOverview("2026-10-09")).flatMap((g) => g.bookings)).toHaveLength(1);
  });

  it("refuses wrong details, closed days, past slots and unknown slots before touching the database", async () => {
    const before = calls.length;
    const wrong = await store.book(input({ email: "geen-apenstaart" }), "key-d000001");
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reason).toBe("ongeldig");
    expect(calls.slice(before).filter((c) => c === "spaak_boek")).toHaveLength(0);
    expect(await store.book(input({ date: "2026-10-11" }), "key-e000001")).toEqual({ ok: false, reason: "gesloten" });
    expect(await store.book(input({ date: "2026-10-08", start: "09:00" }), "key-f000001")).toEqual({ ok: false, reason: "verleden" });
    expect(await store.book(input({ start: "10:30" }), "key-g000001")).toMatchObject({ ok: false, reason: "ongeldig" });
    await store.setClosedDay("2026-10-09", true);
    expect(await store.book(input(), "key-h000001")).toEqual({ ok: false, reason: "gesloten" });
    expect((await store.dayAvailability("2026-10-09")).reason).toBe("gesloten");
    await store.setClosedDay("2026-10-09", false);
    expect((await store.dayAvailability("2026-10-09")).reason).toBeNull();
  });

  it("finds the next free day", async () => {
    expect(await store.nextAvailableDate("2026-10-11")).toBe("2026-10-13");
    for (const start of ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]) {
      await store.setCapacity("2026-10-09", start, 0);
    }
    expect(await store.nextAvailableDate("2026-10-09")).toBe("2026-10-10");
    expect((await store.dayAvailability("2026-10-09")).reason).toBe("vol");
  });

  it("finds by code, cancels with the 24-hour rule and frees the place", async () => {
    const late = await store.book(input({ start: "09:00" }), "key-i000001");
    const early = await store.book(input({ start: "11:00" }), "key-j000001");
    if (!late.ok || !early.ok) throw new Error("booking failed");
    expect((await store.findByCode(" " + early.booking.code.toLowerCase() + " "))?.code).toBe(early.booking.code);
    expect(await store.findByCode("ZZZZZZ")).toBeNull();
    expect(await store.cancel(late.booking.code)).toEqual({ ok: false, reason: "te-laat" });
    expect(await store.cancel(early.booking.code)).toEqual({ ok: true });
    expect(await store.cancel(early.booking.code)).toEqual({ ok: false, reason: "status" });
    expect(await store.cancel("ZZZZZZ")).toEqual({ ok: false, reason: "onbekend" });
    expect((await store.dayAvailability("2026-10-09")).slots.find((s) => s.start === "11:00")?.free).toBe(2);
  });

  it("moves the status one step at a time and shows the day per slot", async () => {
    const b = await store.book(input({ date: "2026-10-13", start: "14:00" }), "key-k000001");
    await store.book(input({ date: "2026-10-13", start: "10:00", naam: "Vroeg" }), "key-l000001");
    if (!b.ok) throw new Error("booking failed");
    expect((await store.setStatus(b.booking.code, "ontvangen")).ok).toBe(true);
    expect(await store.setStatus(b.booking.code, "klaar")).toEqual({ ok: false, reason: "overgang" });
    expect(await store.setStatus("ZZZZZZ", "bezig")).toEqual({ ok: false, reason: "onbekend" });
    expect((await store.findByCode(b.booking.code))?.status).toBe("ontvangen");
    expect(await store.cancel(b.booking.code)).toEqual({ ok: false, reason: "status" });
    const overview = await store.dayOverview("2026-10-13");
    expect(overview.map((g) => g.slot.start)).toEqual(["10:00", "14:00"]);
    expect(overview[0].bookings[0].naam).toBe("Vroeg");
  });

  it("keeps bookings when the capacity drops below them", async () => {
    await store.setCapacity("2026-10-09", "10:00", 3);
    await store.book(input({ naam: "A" }), "key-m000001");
    await store.book(input({ naam: "B" }), "key-n000001");
    await store.setCapacity("2026-10-09", "10:00", 1);
    expect((await store.dayAvailability("2026-10-09")).slots.find((s) => s.start === "10:00")).toMatchObject({ capacity: 1, booked: 2, free: 0 });
    expect(await store.book(input({ naam: "C" }), "key-o000001")).toEqual({ ok: false, reason: "vol" });
    await expect(store.setCapacity("2026-10-09", "10:30", 2)).rejects.toThrow();
  });

  it("surfaces a database error as a rejection, never as a wrong answer", async () => {
    const broken = new SupabaseStore({ client: { schema: () => ({ rpc: async () => ({ data: null, error: { message: "boom" } }) }) },
                                       schema: "public", now: () => NOW });
    await expect(broken.book(input(), "key-p000001")).rejects.toThrow();
    await expect(broken.findByCode("ABCDEF")).rejects.toThrow();
  });
});
