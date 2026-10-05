// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerSettings } from "../../src/components/spaak/owner-settings";

/**
 * Werkstuk W5 (route D trial, 05-10): the owner's settings screen on a laptop (journey J4). Fetch is faked; accessible
 * names are the contract for the end-to-end suite (W6). Written by the meester; the builder may not change this file.
 */

let replies: Record<string, { status: number; body: unknown }[]>;
let calls: { url: string; init?: RequestInit }[];
const TYPES = { reparaties: [{ id: "onderhoud", naam: "Onderhoudsbeurt", duurMinuten: 60, prijsCent: 6900 }] };
const DAY = { datum: "2026-10-09", gesloten: false, tijdvakken: [{ start: "10:00", eind: "11:00", capaciteit: 3, geboekt: 2, vrij: 1 }] };

beforeEach(() => {
  calls = [];
  replies = {
    "GET /api/spaak/beheer/reparaties": [{ status: 200, body: TYPES }],
    "GET /api/spaak/beheer/dag?datum=2026-10-09": [{ status: 200, body: DAY }],
    "POST /api/spaak/beheer/reparaties": [{ status: 201, body: { reparatie: { id: "banden-wisselen", naam: "Banden wisselen", duurMinuten: 30, prijsCent: 2500 } } }],
    "POST /api/spaak/beheer/capaciteit": [{ status: 200, body: { ok: true } }],
    "POST /api/spaak/beheer/gesloten": [{ status: 200, body: { ok: true } }],
  };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, "");
    calls.push({ url, init });
    const queue = replies[(init?.method ?? "GET") + " " + url] ?? [];
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    if (!reply) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function posted(url: string) {
  return calls.filter((c) => c.init?.method === "POST" && c.url === url).map((c) => JSON.parse(String(c.init?.body)));
}

describe("journey J4: the owner's settings", () => {
  it("adds a repair type with duration and price in euros", async () => {
    render(<OwnerSettings initialDate="2026-10-09" />);
    await screen.findByText("Onderhoudsbeurt");
    fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Banden wisselen" } });
    fireEvent.change(screen.getByLabelText("Duur in minuten"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Prijs in euro"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Toevoegen" }));
    expect(await screen.findByText("Banden wisselen")).toBeTruthy();
    expect(posted("/api/spaak/beheer/reparaties")).toEqual([{ naam: "Banden wisselen", duurMinuten: 30, prijsCent: 2500 }]);
  });

  it("sends an empty price as price on quote", async () => {
    render(<OwnerSettings initialDate="2026-10-09" />);
    await screen.findByText("Onderhoudsbeurt");
    fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Overig" } });
    fireEvent.change(screen.getByLabelText("Duur in minuten"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Toevoegen" }));
    await screen.findByText("Banden wisselen");
    expect(posted("/api/spaak/beheer/reparaties")[0].prijsCent).toBeNull();
  });

  it("shows booked places per slot and changes the capacity", async () => {
    render(<OwnerSettings initialDate="2026-10-09" />);
    expect(await screen.findByText(/2 van 3 geboekt/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Plaatsen 10:00\s*[–-]\s*11:00/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /Opslaan 10:00/ }));
    await screen.findByText(/opgeslagen/i);
    expect(posted("/api/spaak/beheer/capaciteit")).toEqual([{ datum: "2026-10-09", start: "10:00", capaciteit: 1 }]);
  });

  it("closes a day", async () => {
    render(<OwnerSettings initialDate="2026-10-09" />);
    fireEvent.click(await screen.findByRole("button", { name: "Dag sluiten" }));
    await screen.findByText(/gesloten/i);
    expect(posted("/api/spaak/beheer/gesloten")).toEqual([{ datum: "2026-10-09", gesloten: true }]);
  });

  it("names wrong input from the server next to the field", async () => {
    replies["POST /api/spaak/beheer/reparaties"] = [{ status: 422, body: { reden: "ongeldig", velden: { duurMinuten: "Vul een duur van 1 tot 480 minuten in." } } }];
    render(<OwnerSettings initialDate="2026-10-09" />);
    await screen.findByText("Onderhoudsbeurt");
    fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText("Duur in minuten"), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "Toevoegen" }));
    const field = screen.getByLabelText("Duur in minuten");
    await screen.findByText("Vul een duur van 1 tot 480 minuten in.");
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });
});
