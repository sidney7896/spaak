// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DayBoard } from "../../src/components/spaak/day-board";

/**
 * Werkstuk W4 (route D trial, 05-10): the mechanic's day overview on a tablet (journey J3, scenarios S12 and S13 of
 * the product card; the customer's choice D1: big status buttons in two rows of two). Fetch is faked; the accessible
 * names are the contract the end-to-end suite (W6) uses. Written by the meester; the builder may not change this file.
 */

let replies: Record<string, { status: number; body: unknown }[]>;
let calls: { url: string; init?: RequestInit }[];

const BOOKING = { code: "R7TQ2D", naam: "Femke de Wit", telefoon: "06 1234 5678", fiets: "Gazelle, ketting piept",
                  reparatie: "Onderhoudsbeurt", status: "gepland", start: "11:00", eind: "12:00" };
const DAY = { datum: "2026-10-08", tijdvakken: [
  { start: "11:00", eind: "12:00", afspraken: [BOOKING] },
  { start: "14:00", eind: "15:00", afspraken: [{ ...BOOKING, code: "K3PL9X", naam: "Bas", status: "bezig", start: "14:00", eind: "15:00" }] },
] };

beforeEach(() => {
  calls = [];
  replies = {
    "GET /api/spaak/werkplaats/dag?datum=2026-10-08": [{ status: 200, body: DAY }],
    "GET /api/spaak/werkplaats/dag?datum=2026-10-09": [{ status: 200, body: { datum: "2026-10-09", tijdvakken: [] } }],
    "POST /api/spaak/werkplaats/status": [{ status: 200, body: { ok: true } }],
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

function card(name: string) {
  return screen.getByRole("article", { name: new RegExp(name) });
}

describe("journey J3: the mechanic's day", () => {
  it("shows the day per slot with what the mechanic needs", async () => {
    render(<DayBoard initialDate="2026-10-08" />);
    await screen.findByRole("heading", { name: /donderdag 8 oktober/i });
    const slots = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(slots.some((t) => /11:00\s*[–-]\s*12:00/.test(t ?? ""))).toBe(true);
    expect(slots.some((t) => /14:00\s*[–-]\s*15:00/.test(t ?? ""))).toBe(true);
    const femke = card("Femke de Wit");
    for (const text of ["Onderhoudsbeurt", "Gazelle, ketting piept", "06 1234 5678", "R7TQ2D", "Gepland"]) {
      expect(within(femke).getByText(new RegExp(text))).toBeTruthy();
    }
  });

  it("has the four big status buttons and only the next step is possible", async () => {
    render(<DayBoard initialDate="2026-10-08" />);
    await screen.findByRole("heading", { name: /donderdag 8 oktober/i });
    const femke = card("Femke de Wit");
    const names = ["Ontvangen", "Bezig", "Klaar", "Opgehaald"];
    const buttons = names.map((n) => within(femke).getByRole("button", { name: n }) as HTMLButtonElement);
    expect(buttons.map((b) => b.disabled)).toEqual([false, true, true, true]);
    const bas = card("Bas");
    expect((within(bas).getByRole("button", { name: "Klaar" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("sets the status and shows it at once", async () => {
    render(<DayBoard initialDate="2026-10-08" />);
    await screen.findByRole("heading", { name: /donderdag 8 oktober/i });
    fireEvent.click(within(card("Femke de Wit")).getByRole("button", { name: "Ontvangen" }));
    await within(card("Femke de Wit")).findByText(/Ontvangen/, { selector: "[data-status]" });
    const post = calls.find((c) => c.init?.method === "POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ code: "R7TQ2D", status: "ontvangen" });
    expect((within(card("Femke de Wit")).getByRole("button", { name: "Bezig" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says when a status change was refused and keeps the old status", async () => {
    replies["POST /api/spaak/werkplaats/status"] = [{ status: 409, body: { reden: "overgang" } }];
    render(<DayBoard initialDate="2026-10-08" />);
    await screen.findByRole("heading", { name: /donderdag 8 oktober/i });
    fireEvent.click(within(card("Femke de Wit")).getByRole("button", { name: "Ontvangen" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/kon niet|niet gelukt/i);
    expect(within(card("Femke de Wit")).getByText(/Gepland/, { selector: "[data-status]" })).toBeTruthy();
  });

  it("shows an empty day plainly with a way to tomorrow", async () => {
    render(<DayBoard initialDate="2026-10-09" />);
    expect(await screen.findByText("Geen afspraken vandaag")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Naar morgen" })).toBeTruthy();
  });

  it("moves to the next day", async () => {
    render(<DayBoard initialDate="2026-10-08" />);
    await screen.findByRole("heading", { name: /donderdag 8 oktober/i });
    fireEvent.click(screen.getByRole("button", { name: "Volgende dag" }));
    await screen.findByRole("heading", { name: /vrijdag 9 oktober/i });
    expect(calls.some((c) => c.url === "/api/spaak/werkplaats/dag?datum=2026-10-09")).toBe(true);
  });

  it("sends the mechanic to sign in when the session is gone", async () => {
    replies["GET /api/spaak/werkplaats/dag?datum=2026-10-08"] = [{ status: 401, body: { fout: "Log opnieuw in." } }];
    render(<DayBoard initialDate="2026-10-08" />);
    const link = await screen.findByRole("link", { name: "Opnieuw inloggen" });
    expect(link.getAttribute("href")).toBe("/sign-in");
  });
});
