// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingFlow } from "../../src/components/spaak/booking-flow";

/**
 * Werkstuk W2 (route D trial, 05-10): the customer's booking flow on the phone (journey J1 of the product card).
 * The component talks only to the public API (`/api/spaak/reparaties`, `/api/spaak/dag`, `/api/spaak/afspraken`);
 * fetch is faked here. Accessible names are the contract: the end-to-end suite (W6) uses the same names in a real
 * browser. Written by the meester; the builder may not change this file.
 */

type Reply = { status: number; body: unknown } | "network-error" | "hang";
let replies: Record<string, Reply[]>;
let calls: { url: string; init?: RequestInit }[];

const DAY = {
  datum: "2026-10-09",
  reden: null,
  volgende: null,
  tijdvakken: [
    { start: "09:00", eind: "10:00", vrij: 0, capaciteit: 2 },
    { start: "10:00", eind: "11:00", vrij: 1, capaciteit: 2 },
  ],
};
const TYPES = { reparaties: [{ id: "onderhoud", naam: "Onderhoudsbeurt", duurMinuten: 60, prijsCent: 6900 },
                              { id: "overig", naam: "Overig", duurMinuten: 60, prijsCent: null }] };
const BOOKED = { code: "R7TQ2D", afspraak: { date: "2026-10-09", start: "10:00", end: "11:00", status: "gepland",
                                             repairTypeId: "onderhoud" } };

function key(url: string) {
  if (url.startsWith("/api/spaak/reparaties")) return "reparaties";
  if (url.startsWith("/api/spaak/dag")) return "dag:" + new URL(url, "https://x").searchParams.get("datum");
  if (url.startsWith("/api/spaak/afspraken")) return "afspraken";
  return url;
}

beforeEach(() => {
  calls = [];
  replies = {
    reparaties: [{ status: 200, body: TYPES }],
    "dag:2026-10-09": [{ status: 200, body: DAY }],
    afspraken: [{ status: 201, body: BOOKED }],
  };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const queue = replies[key(url)] ?? [];
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    if (!reply) return new Response(JSON.stringify({ fout: "onbekend" }), { status: 404 });
    if (reply === "network-error") throw new TypeError("Failed to fetch");
    if (reply === "hang") return new Promise<Response>(() => {});
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function toDetails() {
  render(<BookingFlow initialDate="2026-10-09" />);
  fireEvent.click(await screen.findByRole("button", { name: /Onderhoudsbeurt/ }));
  await screen.findByRole("heading", { name: "Wanneer kom je?" });
  fireEvent.click(await screen.findByRole("button", { name: /10:00\s*[–-]\s*11:00/ }));
  await screen.findByRole("heading", { name: "Wie ben je?" });
}

function fill(over: Partial<Record<"Naam" | "Telefoon" | "E-mail" | "Wat is er met je fiets?", string>> = {}) {
  const values = { Naam: "Femke de Wit", Telefoon: "06 1234 5678", "E-mail": "femke@example.nl",
                   "Wat is er met je fiets?": "Gazelle, ketting piept", ...over };
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

function description(element: HTMLElement) {
  return (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

function bookingPosts() {
  return calls.filter((c) => key(c.url) === "afspraken");
}

describe("journey J1: booking on the phone", () => {
  it("walks the four steps and shows the code", async () => {
    await toDetails();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    await screen.findByRole("heading", { name: "Je afspraak staat" });
    expect(screen.getByLabelText("Afspraakcode").textContent).toBe("R7TQ2D");
    const post = bookingPosts()[0];
    expect(post.init?.method).toBe("POST");
    const sent = JSON.parse(String(post.init?.body));
    expect(sent).toMatchObject({ repairTypeId: "onderhoud", date: "2026-10-09", start: "10:00", naam: "Femke de Wit" });
    expect(new Headers(post.init?.headers).get("idempotency-key")).toMatch(/^.{8,200}$/);
  });

  it("shows a full slot as Vol and does not let it be chosen", async () => {
    render(<BookingFlow initialDate="2026-10-09" />);
    fireEvent.click(await screen.findByRole("button", { name: /Onderhoudsbeurt/ }));
    const full = await screen.findByRole("button", { name: /09:00\s*[–-]\s*10:00.*Vol/ });
    expect((full as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /10:00\s*[–-]\s*11:00/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the details when the last place was just taken", async () => {
    replies.afspraken = [{ status: 409, body: { reden: "vol" } }];
    await toDetails();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Dit tijdvak is net vol geraakt. Kies een ander tijdvak.");
    expect((screen.getByLabelText("Naam") as HTMLInputElement).value).toBe("Femke de Wit");
  });

  it("sends one booking for a double tap, and reuses the key when retrying", async () => {
    replies.afspraken = ["network-error", { status: 201, body: BOOKED }];
    await toDetails();
    fill();
    const confirm = screen.getByRole("button", { name: "Bevestigen" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await screen.findByRole("alert");
    expect(bookingPosts()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    await screen.findByRole("heading", { name: "Je afspraak staat" });
    const keys = bookingPosts().map((c) => new Headers(c.init?.headers).get("idempotency-key"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("names wrong fields next to the field and keeps the input", async () => {
    replies.afspraken = [{ status: 422, body: { reden: "ongeldig", velden: { email: "Vul een geldig e-mailadres in." } } }];
    await toDetails();
    fill({ "E-mail": "femke.example.nl" });
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    const email = screen.getByLabelText("E-mail");
    await waitFor(() => expect(description(email)).toMatch(/Vul een geldig e-mailadres in\./));
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect((email as HTMLInputElement).value).toBe("femke.example.nl");
  });

  it("checks obvious mistakes before sending", async () => {
    await toDetails();
    fill({ Telefoon: "06 12a4 5678", Naam: " " });
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    await waitFor(() => expect(screen.getByLabelText("Telefoon").getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByLabelText("Naam").getAttribute("aria-invalid")).toBe("true");
    expect(bookingPosts()).toHaveLength(0);
  });

  it("explains a closed day and offers the next day with room", async () => {
    replies["dag:2026-10-11"] = [{ status: 200, body: { datum: "2026-10-11", reden: "gesloten", volgende: "2026-10-13", tijdvakken: [] } }];
    replies["dag:2026-10-13"] = [{ status: 200, body: { ...DAY, datum: "2026-10-13" } }];
    render(<BookingFlow initialDate="2026-10-11" />);
    fireEvent.click(await screen.findByRole("button", { name: /Onderhoudsbeurt/ }));
    expect(await screen.findByText(/gesloten/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /dinsdag 13 oktober/i }));
    await screen.findByRole("button", { name: /10:00\s*[–-]\s*11:00/ });
  });

  it("recovers when the server does not answer or fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    replies.reparaties = ["hang", { status: 200, body: TYPES }];
    render(<BookingFlow initialDate="2026-10-09" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Opnieuw proberen|reageert niet/);
    vi.useRealTimers();
    fireEvent.click(within(alert).getByRole("button", { name: "Opnieuw proberen" }));
    await screen.findByRole("button", { name: /Onderhoudsbeurt/ });
  });

  it("shows a price on quote for repair types without a price", async () => {
    render(<BookingFlow initialDate="2026-10-09" />);
    const overig = await screen.findByRole("button", { name: /Overig/ });
    expect(overig.textContent).toMatch(/offerte/i);
    expect(screen.getByRole("button", { name: /Onderhoudsbeurt/ }).textContent).toMatch(/€\s?69/);
  });
});
