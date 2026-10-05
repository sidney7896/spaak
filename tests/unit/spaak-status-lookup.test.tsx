// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusLookup } from "../../src/components/spaak/status-lookup";

/**
 * Werkstuk W3 (route D trial, 05-10): the status page on the phone (journey J2). Fetch is faked; the accessible names
 * are the contract the end-to-end suite (W6) uses. Written by the meester; the builder may not change this file.
 */

let replies: Record<string, { status: number; body: unknown }[]>;
let calls: { url: string; init?: RequestInit }[];
const FOUND = { code: "R7TQ2D", status: "gepland", date: "2026-10-09", start: "11:00", end: "12:00", reparatie: "Onderhoudsbeurt" };

beforeEach(() => {
  calls = [];
  replies = {};
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const keyName = (init?.method ?? "GET") + " " + url.replace(/^https?:\/\/[^/]+/, "");
    const queue = replies[keyName] ?? [];
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    if (!reply) return new Response(JSON.stringify({ fout: "Geen afspraak gevonden met deze code" }), { status: 404 });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function lookUp(code: string) {
  fireEvent.change(screen.getByLabelText("Afspraakcode"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Bekijk status" }));
}

describe("journey J2: status and cancelling", () => {
  it("shows the status, day, slot and repair for a code", async () => {
    replies["GET /api/spaak/afspraken/R7TQ2D"] = [{ status: 200, body: { ...FOUND, status: "bezig" } }];
    render(<StatusLookup />);
    lookUp(" r7tq2d ");
    await screen.findByRole("heading", { name: "Je afspraak" });
    expect(screen.getByText(/Bezig/)).toBeTruthy();
    expect(screen.getByText(/vrijdag 9 oktober/i)).toBeTruthy();
    expect(screen.getByText(/11:00\s*[–-]\s*12:00/)).toBeTruthy();
    expect(screen.getByText(/Onderhoudsbeurt/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Afspraak annuleren" })).toBeNull();
  });

  it("says plainly when nothing is found", async () => {
    render(<StatusLookup />);
    lookUp("ZZZZZZ");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Geen afspraak gevonden met deze code");
  });

  it("cancels after a confirmation", async () => {
    replies["GET /api/spaak/afspraken/R7TQ2D"] = [{ status: 200, body: FOUND }];
    replies["POST /api/spaak/afspraken/R7TQ2D/annuleren"] = [{ status: 200, body: { status: "geannuleerd" } }];
    render(<StatusLookup initialCode="R7TQ2D" />);
    fireEvent.click(await screen.findByRole("button", { name: "Afspraak annuleren" }));
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Ja, annuleren" }));
    expect(await screen.findByText("Je afspraak is geannuleerd.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Afspraak annuleren" })).toBeNull();
  });

  it("explains a late cancellation with the phone number", async () => {
    replies["GET /api/spaak/afspraken/R7TQ2D"] = [{ status: 200, body: FOUND }];
    replies["POST /api/spaak/afspraken/R7TQ2D/annuleren"] = [{ status: 409, body: { reden: "te-laat", telefoon: "010-555 01 42" } }];
    render(<StatusLookup initialCode="R7TQ2D" />);
    fireEvent.click(await screen.findByRole("button", { name: "Afspraak annuleren" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, annuleren" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Annuleren kan niet meer online. Bel ons: 010-555 01 42");
  });

  it("lets the customer change their mind", async () => {
    replies["GET /api/spaak/afspraken/R7TQ2D"] = [{ status: 200, body: FOUND }];
    render(<StatusLookup initialCode="R7TQ2D" />);
    fireEvent.click(await screen.findByRole("button", { name: "Afspraak annuleren" }));
    fireEvent.click(screen.getByRole("button", { name: "Nee, terug" }));
    expect(screen.getByRole("button", { name: "Afspraak annuleren" })).toBeTruthy();
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(0);
  });

  it("asks to try again after too many attempts", async () => {
    replies["GET /api/spaak/afspraken/ZZZZZZ"] = [{ status: 429, body: { fout: "Te veel pogingen. Probeer het over een paar minuten opnieuw." } }];
    render(<StatusLookup />);
    lookUp("ZZZZZZ");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Te veel pogingen/);
  });
});
