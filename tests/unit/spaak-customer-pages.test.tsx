// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingFlow } from "../../src/components/spaak/booking-flow";

const staff = vi.hoisted(() => ({ value: { rol: "eigenaar" } as null | { rol: string } }));
vi.mock("../../src/lib/spaak/staff", () => ({ getStaff: async () => staff.value }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error("redirect " + to); },
  usePathname: () => "/", useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));

import HomePage from "../../src/app/page";
import StatusPage from "../../src/app/status/page";
import WorkshopPage from "../../src/app/werkplaats/page";
import OwnerPage from "../../src/app/beheer/page";

/**
 * Werkstuk W2b (route D trial, 05-10): polish after the first look at the protected preview.
 * 1. "Vorige dag" led a customer to days that have passed; it is disabled on today (Amsterdam) and earlier.
 * 2. Without the starter header, staff reach their pages through a quiet footer link "Voor de werkplaats".
 * 3. A page can open on a given day with `?datum=YYYY-MM-DD` (the browser suite and staff use it); anything else is
 *    ignored and the page opens on its usual day.
 * The clock is Thursday 8 October 2026, 10:15 in Amsterdam. Written by the meester; the builder may not change this
 * file.
 */

let urls: string[] = [];
const TYPES = { reparaties: [{ id: "onderhoud", naam: "Onderhoudsbeurt", duurMinuten: 60, prijsCent: 6900 }] };
function day(datum: string) {
  return { datum, reden: null, volgende: null, tijdvakken: [{ start: "14:00", eind: "15:00", vrij: 2, capaciteit: 2, voorbij: false }] };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-08T08:15:00.000Z"));
  urls = [];
  staff.value = { rol: "eigenaar" };
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(String(input), "https://spaak.example");
    urls.push(url.pathname + url.search);
    const body = url.pathname.endsWith("/reparaties") ? TYPES
      : url.pathname === "/api/spaak/dag" ? day(url.searchParams.get("datum") ?? "")
      : url.pathname.endsWith("/dag") ? { datum: url.searchParams.get("datum"), gesloten: false, tijdvakken: [] }
      : { fout: "onbekend" };
    return new Response(JSON.stringify(body), { status: url.pathname.startsWith("/api/spaak/") ? 200 : 404,
                                                headers: { "content-type": "application/json" } });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function toDay(initialDate: string) {
  render(<BookingFlow initialDate={initialDate} />);
  fireEvent.click(await screen.findByRole("button", { name: /Onderhoudsbeurt/ }));
  await screen.findByRole("heading", { name: "Wanneer kom je?" });
  await screen.findByRole("button", { name: /14:00\s*[–-]\s*15:00/ });
}

describe("choosing a day", () => {
  it("cannot go back before today", async () => {
    await toDay("2026-10-08");
    expect((screen.getByRole("button", { name: "Vorige dag" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Volgende dag" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("can go back to today from a later day, and no further", async () => {
    await toDay("2026-10-09");
    const back = screen.getByRole("button", { name: "Vorige dag" }) as HTMLButtonElement;
    expect(back.disabled).toBe(false);
    await act(async () => { fireEvent.click(back); });
    expect(await screen.findByText(/donderdag 8 oktober/i)).toBeTruthy();
    await screen.findByRole("button", { name: /14:00\s*[–-]\s*15:00/ });
    expect((screen.getByRole("button", { name: "Vorige dag" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the customer pages", () => {
  it("offer staff a quiet way to their pages", async () => {
    render(await HomePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("link", { name: "Voor de werkplaats" }).getAttribute("href")).toBe("/werkplaats");
    cleanup();
    render(await StatusPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("link", { name: "Voor de werkplaats" }).getAttribute("href")).toBe("/werkplaats");
  });
});

describe("the booking page footer (W7, meester 06-10)", () => {
  // Checks the visible footer line names pick-up as an alternative to bringing the bike (review W7-h2 F1).
  // Catches: fixing only the confirmation texts and leaving the old "bring your bike" footer on the home page.
  it("says the bike can also be picked up within the ring", async () => {
    const { container } = render(await HomePage({ searchParams: Promise.resolve({}) }));
    // Scoped to the page footer itself (review W7-h3 F1): the line must live in <footer class="spaak-footer">.
    const footer = container.querySelector<HTMLElement>("footer.spaak-footer");
    if (!footer) throw new Error("Expected the home page footer.");
    expect(within(footer).getByText("Je brengt je fiets op het gekozen tijdvak, of laat hem ophalen binnen de ring.", { exact: true })).toBeTruthy();
    expect(within(footer).queryByText("Je brengt je fiets op het gekozen tijdvak.", { exact: true })).toBeNull();
    // Moving through the booking steps never removes it (it is page chrome, not part of a step).
    fireEvent.click(await screen.findByRole("button", { name: /Onderhoudsbeurt/ }));
    await screen.findByRole("heading", { name: "Wanneer kom je?" });
    // Query the footer again from the live document (review W7-h4 F1): a detached old node would still hold the text.
    const footerNa = container.querySelector<HTMLElement>("footer.spaak-footer");
    if (!footerNa) throw new Error("Expected the home page footer after moving to step 2.");
    expect(footerNa.isConnected).toBe(true);
    expect(within(footerNa).getByText("Je brengt je fiets op het gekozen tijdvak, of laat hem ophalen binnen de ring.", { exact: true })).toBeTruthy();
  });
});

describe("opening a page on a given day", () => {
  it("the booking page asks for that day", async () => {
    render(await HomePage({ searchParams: Promise.resolve({ datum: "2026-10-13" }) }));
    fireEvent.click(await screen.findByRole("button", { name: /Onderhoudsbeurt/ }));
    await screen.findByRole("button", { name: /14:00\s*[–-]\s*15:00/ });
    expect(urls).toContain("/api/spaak/dag?datum=2026-10-13");
  });

  it("the workshop and the owner's page ask for that day", async () => {
    render(await WorkshopPage({ searchParams: Promise.resolve({ datum: "2026-10-13" }) }));
    await vi.waitFor(() => expect(urls).toContain("/api/spaak/werkplaats/dag?datum=2026-10-13"));
    cleanup();
    render(await OwnerPage({ searchParams: Promise.resolve({ datum: "2026-10-14" }) }));
    await vi.waitFor(() => expect(urls).toContain("/api/spaak/beheer/dag?datum=2026-10-14"));
  });

  it.each(["2026-02-30", "13-10-2026", "morgen", ""])("ignores %j and opens the usual day", async (datum) => {
    render(await WorkshopPage({ searchParams: Promise.resolve({ datum }) }));
    await vi.waitFor(() => expect(urls).toContain("/api/spaak/werkplaats/dag?datum=2026-10-08"));
    expect(urls.some((u) => u.includes(encodeURIComponent(datum)) && datum !== "")).toBe(false);
  });

  it("still sends staff without access to sign in", async () => {
    staff.value = null;
    await expect(WorkshopPage({ searchParams: Promise.resolve({ datum: "2026-10-13" }) })).rejects.toThrow("redirect /sign-in");
  });
});
