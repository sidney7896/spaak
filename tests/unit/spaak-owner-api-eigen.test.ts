import { NextRequest, type NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/lib/spaak/memory-store";

const state = vi.hoisted(() => ({
  store: null as unknown,
  staff: null as null | { rol: string },
  getStore: vi.fn(),
}));
vi.mock("../../src/lib/spaak/server", () => ({ getStore: state.getStore }));
vi.mock("../../src/lib/spaak/staff", () => ({ getStaff: async () => state.staff }));

import { GET as listTypes, POST as addType } from "../../src/app/api/spaak/beheer/reparaties/route";
import { POST as setCapacity } from "../../src/app/api/spaak/beheer/capaciteit/route";
import { POST as setClosed } from "../../src/app/api/spaak/beheer/gesloten/route";
import { GET as ownerDay } from "../../src/app/api/spaak/beheer/dag/route";

function request(path: string, body?: unknown): NextRequest {
  return new NextRequest(`https://spaak.example/api/spaak/beheer/${path}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  state.store = new MemoryStore({ now: () => new Date("2026-10-08T08:15:00Z") });
  state.staff = { rol: "eigenaar" };
  state.getStore.mockReset().mockImplementation(() => state.store);
});

describe("owner API boundaries", () => {
  it("checks access before parsing input or touching the store, with uncached Dutch replies", async () => {
    const handlers: { path: string; post: boolean; handle: (req: NextRequest) => Promise<NextResponse> }[] = [
      { path: "reparaties", post: false, handle: listTypes },
      { path: "reparaties", post: true, handle: addType },
      { path: "capaciteit", post: true, handle: setCapacity },
      { path: "gesloten", post: true, handle: setClosed },
      { path: "dag?datum=geen-datum", post: false, handle: ownerDay },
    ];
    for (const staff of [null, { rol: "monteur" }, { rol: "onbekend" }]) {
      state.staff = staff;
      for (const { path, post, handle } of handlers) {
        const req = new NextRequest(`https://spaak.example/api/spaak/beheer/${path}`, {
          method: post ? "POST" : "GET", ...(post ? { body: "{" } : {}),
        });
        const parse = vi.spyOn(req, "json");
        const response = await handle(req);
        expect(response.status).toBe(staff === null ? 401 : 403);
        expect(await response.json()).toEqual({ fout: staff === null ? "Log opnieuw in." : "Alleen voor de eigenaar." });
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(parse).not.toHaveBeenCalled();
      }
    }
    expect(state.getStore).not.toHaveBeenCalled();
  });

  it("rejects capacity changes on Sundays, Mondays and explicitly closed days", async () => {
    const store = state.store as MemoryStore;
    await store.setClosedDay("2026-10-09", true);
    const mutate = vi.spyOn(store, "setCapacity");
    for (const datum of ["2026-10-09", "2026-10-11", "2026-10-12"]) {
      const response = await setCapacity(request("capaciteit", { datum, start: "10:00", capaciteit: 2 }));
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(mutate).not.toHaveBeenCalled();
    await setClosed(request("gesloten", { datum: "2026-10-09", gesloten: false }));
    expect((await setCapacity(request("capaciteit", { datum: "2026-10-09", start: "10:00", capaciteit: 50 }))).status).toBe(200);
  });

  it("rejects overflow calendar dates before reading or changing anything", async () => {
    for (const datum of ["2026-02-29", "2026-04-31", "2026-00-01", "26-10-09", "2026-10-09x"]) {
      expect((await ownerDay(request(`dag?datum=${datum}`))).status).toBe(400);
      expect((await setCapacity(request("capaciteit", { datum, start: "10:00", capaciteit: 2 }))).status).toBe(400);
      expect((await setClosed(request("gesloten", { datum, gesloten: true }))).status).toBe(400);
    }
    expect(state.getStore).not.toHaveBeenCalled();
  });

  it("accepts trim and inclusive repair limits while rejecting missing or fractional prices", async () => {
    for (const prijsCent of [null, 0, 1_000_000]) {
      const response = await addType(request("reparaties", { naam: `  ${"X".repeat(80)}  `, duurMinuten: 480, prijsCent }));
      expect(response.status).toBe(201);
      expect((await response.json()).reparatie).toMatchObject({ naam: "X".repeat(80), duurMinuten: 480, prijsCent });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    state.getStore.mockClear();
    for (const body of [null, [], {}, { naam: "X", duurMinuten: 481, prijsCent: null },
      { naam: "X", duurMinuten: 30, prijsCent: 1_000_001 }, { naam: "X", duurMinuten: 30, prijsCent: 1.5 },
      { naam: "X", duurMinuten: 30 }, { naam: "X", duurMinuten: 30, prijsCent: "100" }]) {
      const response = await addType(request("reparaties", body));
      expect(response.status).toBe(422);
      expect((await response.json()).reden).toBe("ongeldig");
    }
    expect(state.getStore).not.toHaveBeenCalled();
  });

  it("does not expose database exceptions", async () => {
    state.getStore.mockImplementation(() => { throw new Error("private database details"); });
    const response = await listTypes(request("reparaties"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toContain("private database details");
  });
});
