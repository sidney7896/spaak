import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/lib/spaak/memory-store";
import { SupabaseStore, type RpcClient } from "../../src/lib/spaak/supabase-store";
import type { BookingInput, SpaakStore } from "../../src/lib/spaak/store";

/** W7: same contract for both stores; PGlite proves local SQL behaviour, not live Supabase. */
const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const NOW = new Date("2026-10-08T08:15:00.000Z");
const RING = "We halen alleen op binnen de ring: postcodes 3500 tot en met 3599";
const FORMAT = "Vul een postcode in zoals 3512 AB.";
const ADDRESS = "Vul een straat en huisnummer in.";
const PICKUP = { postcode: " 3512  ab ", adres: " Oudegracht 1 " };
const NORMALIZED = { postcode: "3512 AB", adres: "Oudegracht 1" };
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
  expect(result.stdout).not.toContain("{{");
  return result.stdout;
}

function client(database: PGlite): RpcClient {
  return { schema: (schema: string) => ({ rpc: async (fn: string, args: { p: unknown }) => {
    if (!/^spaak_[a-z_]+$/.test(fn)) return { data: null, error: { message: "unknown function" } };
    try {
      const r = await database.query<{ r: unknown }>(`select ${schema}.${fn}($1::jsonb) as r`, [JSON.stringify(args.p)]);
      return { data: r.rows[0]?.r ?? null, error: null };
    } catch (error) {
      return { data: null, error: { message: String(error) } };
    }
  } }) };
}

function input(over: Partial<BookingInput> = {}): BookingInput {
  return { repairTypeId: "onderhoud", date: "2026-10-09", start: "10:00", naam: "Femke de Wit", telefoon: "06 1234 5678",
    email: "femke@example.nl", fiets: "Gazelle, ketting piept", ...over };
}

describe.each(["memory", "Supabase"] as const)("W7: %s store", (kind) => {
  let db: PGlite | undefined;
  let store: SpaakStore;

  beforeEach(async () => {
    if (kind === "memory") {
      let n = 0;
      store = new MemoryStore({ now: () => NOW, random: () => ((n++ * 7919) % 1000) / 1000 });
    } else {
      db = new PGlite();
      await db.exec(PRELUDE);
      await db.exec(`set search_path to public;\n${render()}`);
      store = new SupabaseStore({ client: client(db), schema: "public", now: () => NOW });
    }
  });

  afterEach(async () => { if (db) await db.close(); });

  // Checks the complete returned booking and a subsequent lookup of what was stored.
  // Catches: normalizing only the reply, keeping address padding, or computing the surcharge from the repair price.
  it("stores and returns normalized pick-up with a 1000-cent surcharge", async () => {
    const result = await store.book(input({ ophalen: PICKUP }), "pickup-key-01");
    if (!result.ok) throw new Error("Expected pick-up booking.");
    expect(result.booking).toEqual({ ...input(), code: result.booking.code, end: "11:00", status: "gepland",
      createdAt: NOW.toISOString(), ophalen: NORMALIZED, toeslagCent: 1000 });
    expect(await store.findByCode(result.booking.code)).toEqual(result.booking);
    if (db) {
      expect((await db.query("select ophaal_postcode, ophaal_adres, toeslag_cent from public.spaak_afspraken")).rows)
        .toEqual([{ ophaal_postcode: "3512 AB", ophaal_adres: "Oudegracht 1", toeslag_cent: 1000 }]);
    }
  });

  // Checks S19 is a definitive refusal before any booking or capacity is consumed.
  // Catches: storing before validation or silently dropping invalid pick-up and booking anyway.
  it("refuses 3600 AA with the exact postcode error and stores nothing", async () => {
    expect(await store.book(input({ ophalen: { postcode: "3600 AA", adres: "Oudegracht 1" } }), "pickup-key-02"))
      .toEqual({ ok: false, reason: "ongeldig", fields: { postcode: RING } });
    expect(await store.dayOverview("2026-10-09")).toEqual([]);
    expect((await store.dayAvailability("2026-10-09")).slots.find((s) => s.start === "10:00")?.free).toBe(2);
    if (db) expect((await db.query("select code from public.spaak_afspraken")).rows).toEqual([]);
  });

  // Checks format and address validation, including simultaneous field errors.
  // Catches: validating only the range, only the postcode, or only the first failing field.
  it("refuses malformed postcodes and invalid trimmed addresses without rows", async () => {
    const cases = [
      { ophalen: { postcode: "0123 AB", adres: "Oudegracht 1" }, fields: { postcode: FORMAT } },
      { ophalen: { postcode: "3512 AB", adres: "" }, fields: { adres: ADDRESS } },
      { ophalen: { postcode: "3512 AB", adres: " \t\n " }, fields: { adres: ADDRESS } },
      { ophalen: { postcode: "3512 AB", adres: "a".repeat(121) }, fields: { adres: ADDRESS } },
      { ophalen: { postcode: "3600 AA", adres: " " }, fields: { postcode: RING, adres: ADDRESS } },
    ];
    for (const [index, value] of cases.entries()) {
      expect(await store.book(input({ ophalen: value.ophalen }), `invalid-pickup-${index}`))
        .toEqual({ ok: false, reason: "ongeldig", fields: value.fields });
    }
    expect(await store.dayOverview("2026-10-09")).toEqual([]);
    if (db) expect((await db.query("select code from public.spaak_afspraken")).rows).toEqual([]);
  });

  // Checks both old callers that omit pick-up and callers explicitly opting out.
  // Catches: leaving undefined in Booking, charging the default booking, or treating null as an object.
  it("stores null pick-up and zero surcharge for omitted and explicit null input", async () => {
    for (const [index, value] of [input(), input({ ophalen: null })].entries()) {
      const result = await store.book(value, `no-pickup-key-${index}`);
      if (!result.ok) throw new Error("Expected ordinary booking.");
      expect(result.booking).toEqual({ ...input(), code: result.booking.code, end: "11:00", status: "gepland",
        createdAt: NOW.toISOString(), ophalen: null, toeslagCent: 0 });
      expect(await store.findByCode(result.booking.code)).toEqual(result.booking);
    }
    if (db) expect((await db.query("select ophaal_postcode, ophaal_adres, toeslag_cent from public.spaak_afspraken")).rows)
      .toEqual([{ ophaal_postcode: null, ophaal_adres: null, toeslag_cent: 0 },
        { ophaal_postcode: null, ophaal_adres: null, toeslag_cent: 0 }]);
  });

  // Checks a reused key preserves the first booking even when pick-up changes on a valid retry.
  // Catches: creating a second row or overwriting pick-up and surcharge on an idempotent retry.
  it("returns the first whole booking for the same key", async () => {
    const first = await store.book(input({ ophalen: PICKUP }), "same-pickup-key");
    if (!first.ok) throw new Error("Expected first booking.");
    expect(await store.book(input({ ophalen: PICKUP }), "same-pickup-key")).toEqual(first);
    expect(await store.book(input({ ophalen: null }), "same-pickup-key")).toEqual(first);
    expect((await store.dayOverview("2026-10-09")).flatMap((g) => g.bookings)).toEqual([first.booking]);
  });

  // Checks the day overview transports pick-up data and ordinary bookings together.
  // Catches: losing new columns in dayOverview or omitting non-pick-up bookings at store level.
  it("carries pick-up and surcharge in the overview without filtering ordinary bookings", async () => {
    const pickup = await store.book(input({ ophalen: PICKUP }), "overview-pickup");
    const ordinary = await store.book(input({ start: "14:00", naam: "Bas" }), "overview-ordinary");
    if (!pickup.ok || !ordinary.ok) throw new Error("Expected both bookings.");
    expect(await store.dayOverview("2026-10-09")).toEqual([
      { slot: { start: "10:00", end: "11:00", capacity: 2 }, bookings: [pickup.booking] },
      { slot: { start: "14:00", end: "15:00", capacity: 2 }, bookings: [ordinary.booking] },
    ]);
    expect(pickup.booking.ophalen).toEqual(NORMALIZED);
    expect(ordinary.booking.ophalen).toBeNull();
  });

  // Checks both area endpoints also survive the store and database constraint.
  // Catches: a stricter SQL range than the domain, or rejecting a trimmed 120-character address.
  it("books 3500 and 3599 with trimmed address lengths 1 and 120", async () => {
    for (const [index, ophalen] of [{ postcode: "3500 aa", adres: " a " },
      { postcode: "3599 zz", adres: ` ${"a".repeat(120)} ` }].entries()) {
      const result = await store.book(input({ ophalen }), `boundary-pickup-${index}`);
      if (!result.ok) throw new Error("Expected boundary booking.");
      expect(result.booking.ophalen).toEqual({ postcode: ophalen.postcode.toUpperCase(), adres: ophalen.adres.trim() });
      expect(result.booking.toeslagCent).toBe(1000);
    }
  });
});

describe("W7: Supabase RPC error mapping", () => {
  // Checks a database refusal survives the mapper even though local input is valid.
  // Catches: assuming every SQL ongeldig has fields.repairTypeId and throwing away postcode/adres.
  it("preserves postcode and address fields returned by the database", async () => {
    const failure = { ok: false, reason: "ongeldig", fields: { postcode: RING, adres: ADDRESS } };
    const rpc = vi.fn(async () => ({ data: failure, error: null }));
    const store = new SupabaseStore({ client: { schema: () => ({ rpc }) }, schema: "public", now: () => NOW });
    expect(await store.book(input({ ophalen: NORMALIZED }), "sql-refusal-key")).toEqual(failure);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  // Checks SupabaseStore performs pick-up validation before calling spaak_boek.
  // Catches: relying entirely on SQL validation and making an RPC for invalid pick-up.
  it("does not call the database for invalid pick-up", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const store = new SupabaseStore({ client: { schema: () => ({ rpc }) }, schema: "public", now: () => NOW });
    expect(await store.book(input({ ophalen: { postcode: "3600 AA", adres: "Oudegracht 1" } }), "local-refusal-key"))
      .toEqual({ ok: false, reason: "ongeldig", fields: { postcode: RING } });
    expect(rpc).not.toHaveBeenCalled();
  });
});
