// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DayBoard } from "../../src/components/spaak/day-board";

/** W7 / S20: meester-owned; accessible toggle button Ophalen has aria-pressed. */
let replies: Record<string, { status: number; body: unknown }[]>;
let calls: { url: string; init?: RequestInit }[];
const BOOKING = { code: "R7TQ2D", naam: "Femke de Wit", telefoon: "06 1234 5678", fiets: "Gazelle, ketting piept",
  reparatie: "Onderhoudsbeurt", status: "gepland", start: "11:00", eind: "12:00",
  ophalen: { postcode: "3512 AB", adres: "Oudegracht 1" }, toeslagCent: 1000 };
const ORDINARY = { ...BOOKING, code: "K3PL9X", naam: "Bas", ophalen: null, toeslagCent: 0 };
const DAY = { datum: "2026-10-08", tijdvakken: [
  { start: "11:00", eind: "12:00", afspraken: [BOOKING, ORDINARY] },
  { start: "14:00", eind: "15:00", afspraken: [{ ...ORDINARY, code: "B4TR8W", naam: "Ahmed", start: "14:00", eind: "15:00" }] },
] };

beforeEach(() => {
  calls = [];
  replies = { "GET /api/spaak/werkplaats/dag?datum=2026-10-08": [{ status: 200, body: DAY }] };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, "");
    calls.push({ url, init });
    const queue = replies[(init?.method ?? "GET") + " " + url] ?? [];
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    if (!reply) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function card(name: string) { return screen.getByRole("article", { name: new RegExp(name) }); }

describe("W7: the mechanic's pick-up overview", () => {
  // Checks the label and literal normalized address are inside the correct customer's card.
  // Catches: showing only a global filter label, an unnormalized postcode, or addresses on every booking.
  it("shows Ophalen and the exact address only on pick-up bookings", async () => {
    render(<DayBoard initialDate="2026-10-08" />);
    await screen.findByRole("heading", { name: /donderdag 8 oktober/i });
    expect(within(card("Femke de Wit")).getByText("Ophalen", { exact: true })).toBeTruthy();
    expect(within(card("Femke de Wit")).getByText("Oudegracht 1, 3512 AB", { exact: true })).toBeTruthy();
    expect(within(card("Bas")).queryByText("Ophalen", { exact: true })).toBeNull();
    expect(within(card("Bas")).queryByText("Oudegracht 1, 3512 AB", { exact: true })).toBeNull();
  });

  // Checks filtering within a mixed group, hiding empty groups, and restoring the original overview.
  // Catches: filtering whole slots, leaving empty headings, or permanently discarding ordinary bookings.
  it("toggles on and off, hides empty groups and restores all bookings", async () => {
    render(<DayBoard initialDate="2026-10-08" />);
    await screen.findByRole("heading", { name: /donderdag 8 oktober/i });
    const toggle = screen.getByRole("button", { name: "Ophalen", exact: true });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getAllByRole("article")).toHaveLength(3);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(card("Femke de Wit")).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Bas" })).toBeNull();
    expect(screen.queryByRole("article", { name: "Ahmed" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: /11:00\s*[–-]\s*12:00/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: /14:00\s*[–-]\s*15:00/ })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(card("Bas")).toBeTruthy();
    expect(card("Ahmed")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: /14:00\s*[–-]\s*15:00/ })).toBeTruthy();
  });

  // Checks the filtered empty state when appointments exist but none needs pick-up.
  // Catches: using Geen afspraken vandaag, showing empty slot headings, or hiding the toggle in the empty state.
  it("says Vandaag niets op te halen. when only ordinary bookings exist", async () => {
    replies["GET /api/spaak/werkplaats/dag?datum=2026-10-08"] = [{ status: 200,
      body: { datum: DAY.datum, tijdvakken: [{ start: "11:00", eind: "12:00", afspraken: [ORDINARY] }] } }];
    render(<DayBoard initialDate="2026-10-08" />);
    await screen.findByRole("article", { name: "Bas" });
    fireEvent.click(screen.getByRole("button", { name: "Ophalen", exact: true }));
    expect(screen.getByText("Vandaag niets op te halen.", { exact: true })).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.queryByText("Geen afspraken vandaag", { exact: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ophalen", exact: true }));
    expect(card("Bas")).toBeTruthy();
    expect(screen.queryByText("Vandaag niets op te halen.", { exact: true })).toBeNull();
  });

  // Checks the same filtered-empty wording also covers an actually empty day.
  // Catches: a special zero-slot branch bypassing the pick-up filter's empty state.
  it("uses the pick-up empty text on an empty day while the toggle is on", async () => {
    replies["GET /api/spaak/werkplaats/dag?datum=2026-10-08"] = [{ status: 200, body: { datum: DAY.datum, tijdvakken: [] } }];
    render(<DayBoard initialDate="2026-10-08" />);
    await screen.findByText("Geen afspraken vandaag", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "Ophalen", exact: true }));
    expect(screen.getByText("Vandaag niets op te halen.", { exact: true })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(0);
  });
});
