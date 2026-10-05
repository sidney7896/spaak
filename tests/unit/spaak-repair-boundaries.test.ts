import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { slotStart } from "../../src/lib/spaak/domain";
import { MemoryStore } from "../../src/lib/spaak/memory-store";
import type { BookingInput } from "../../src/lib/spaak/store";

const state = vi.hoisted(() => ({ store: null as unknown as MemoryStore }));
vi.mock("../../src/lib/spaak/server", () => ({ getStore: () => state.store }));

import { POST } from "../../src/app/api/spaak/afspraken/route";
import { GET } from "../../src/app/api/spaak/dag/route";

const INPUT: BookingInput = {
  repairTypeId: "onderhoud", date: "2026-10-09", start: "10:00",
  naam: "Femke de Wit", telefoon: "06 1234 5678", email: "femke@example.nl", fiets: "Gazelle, ketting piept",
};

function post(input: BookingInput) {
  return POST(new NextRequest("https://spaak.example/api/spaak/afspraken", {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": "boundary-key-01" },
    body: JSON.stringify(input),
  }));
}

beforeEach(() => {
  let sequence = 0;
  state.store = new MemoryStore({
    now: () => new Date("2026-10-08T08:15:00.000Z"),
    random: () => ((sequence++ * 7919) % 1000) / 1000,
  });
});

describe("Spaak repair: submission identity and clock boundaries", () => {
  it("rejects a key collision on each submitted field without disclosing any booking data", async () => {
    const first = await (await post(INPUT)).json();
    const changes: Partial<BookingInput>[] = [
      { naam: "Bob Bakker" }, { telefoon: "06 9999 0000" }, { email: "bob@example.nl" },
      { fiets: "Batavus" }, { repairTypeId: "band" }, { date: "2026-10-13" }, { start: "11:00" },
    ];
    for (const change of changes) {
      const response = await post({ ...INPUT, ...change });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ reden: "sleutel" });
    }
    expect((await (await post(INPUT)).json()).code).toBe(first.code);
    expect((await state.store.dayOverview(INPUT.date)).flatMap((group) => group.bookings)).toHaveLength(1);
  });

  it("compares trimmed contact fields on retries and returns the original booking", async () => {
    const first = await (await post(INPUT)).json();
    const retry = await post({
      ...INPUT, naam: ` ${INPUT.naam} `, telefoon: ` ${INPUT.telefoon} `,
      email: ` ${INPUT.email} `, fiets: ` ${INPUT.fiets} `,
    });
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(first);
  });

  it("retains booking counts and capacity when a slot becomes past at its exact start", async () => {
    let now = new Date("2026-10-09T07:59:59.999Z");
    state.store = new MemoryStore({ now: () => now });
    await state.store.book(INPUT, "first");
    await state.store.setCapacity(INPUT.date, INPUT.start, 3);
    expect((await state.store.dayAvailability(INPUT.date)).slots.find((slot) => slot.start === INPUT.start))
      .toMatchObject({ booked: 1, capacity: 3, free: 2, past: false });
    now = slotStart(INPUT.date, INPUT.start);
    expect((await state.store.dayAvailability(INPUT.date)).slots.find((slot) => slot.start === INPUT.start))
      .toMatchObject({ booked: 1, capacity: 3, free: 0, past: true });
    expect((await state.store.dayOverview(INPUT.date))[0].bookings).toHaveLength(1);
  });

  it("uses the store's changing clock in the day API", async () => {
    let now = new Date("2026-10-09T07:59:59.999Z");
    state.store = new MemoryStore({ now: () => now });
    const read = async () => (await (await GET(new NextRequest(
      `https://spaak.example/api/spaak/dag?datum=${INPUT.date}`,
    ))).json()).tijdvakken.find((slot: { start: string }) => slot.start === INPUT.start);
    expect(await read()).toMatchObject({ vrij: 2, capaciteit: 2, voorbij: false });
    now = slotStart(INPUT.date, INPUT.start);
    expect(await read()).toMatchObject({ vrij: 0, capaciteit: 2, voorbij: true });
  });

  it("skips a day when even its final slot has started", async () => {
    state.store = new MemoryStore({ now: () => slotStart("2026-10-10", "15:00") });
    const day = await state.store.dayAvailability("2026-10-10");
    expect(day.reason).toBe("verleden");
    expect(day.slots.every((slot) => slot.past && slot.free === 0)).toBe(true);
    expect(await state.store.nextAvailableDate("2026-10-10")).toBe("2026-10-13");
  });
});
