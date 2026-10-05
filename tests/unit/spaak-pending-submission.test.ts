// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingFlow } from "../../src/components/spaak/booking-flow";

const RECOVER = "Vorige aanvraag opnieuw versturen";
const PENDING = "Je vorige aanvraag is nog niet bevestigd.";
const BOOKED = { code: "R7TQ2D", afspraak: {
  date: "2026-10-09", start: "10:00", end: "11:00", repairTypeId: "onderhoud",
} };
type Reply = { status: number; body: unknown } | "network" | "timeout";
let replies: Reply[];
let posts: RequestInit[];
let unavailable: boolean;

beforeEach(() => {
  replies = ["network", { status: 200, body: BOOKED }];
  posts = [];
  unavailable = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/spaak/afspraken") {
      posts.push(init!);
      const reply = replies.shift();
      if (reply === "network") throw new TypeError("Failed to fetch");
      if (reply === "timeout") return new Promise<Response>(() => {});
      if (!reply) throw new Error("Unexpected booking request");
      return Response.json(reply.body, { status: reply.status });
    }
    if (url === "/api/spaak/reparaties") return Response.json({ reparaties: [
      { id: "onderhoud", naam: "Onderhoudsbeurt", duurMinuten: 60, prijsCent: 6900 },
    ] });
    const datum = new URL(url, "https://spaak.example").searchParams.get("datum");
    return Response.json({ datum, reden: null, volgende: null, tijdvakken: [
      { start: "10:00", eind: "11:00", vrij: unavailable ? 0 : 1, capaciteit: 2, voorbij: unavailable },
    ] });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function details() {
  render(createElement(BookingFlow, { initialDate: "2026-10-09" }));
  fireEvent.click(await screen.findByRole("button", { name: /Onderhoudsbeurt/ }));
  fireEvent.click(await screen.findByRole("button", { name: "10:00 – 11:00" }));
  await screen.findByRole("heading", { name: "Wie ben je?" });
  for (const [label, value] of Object.entries({
    Naam: "Femke de Wit", Telefoon: "0612345678", "E-mail": "femke@example.nl",
    "Wat is er met je fiets?": "Gazelle, ketting piept",
  })) fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function unanswered() {
  await details();
  fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
  await screen.findByRole("alert");
  expect(screen.getByText(PENDING)).toBeTruthy();
}

function expectSameRequest() {
  expect(posts).toHaveLength(2);
  expect(posts[1].body).toBe(posts[0].body);
  const keys = posts.map((post) => new Headers(post.headers).get("Idempotency-Key"));
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
}

describe("unanswered booking recovery", () => {
  it.each([1, 2, 3])("replays the stored request from step %i despite changed input or availability", async (step) => {
    await unanswered();
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "invalid" } });
    if (step !== 3) {
      unavailable = true;
      fireEvent.click(screen.getByRole("button", { name: "Ander tijdvak kiezen" }));
      const past = await screen.findByRole("button", { name: "10:00 – 11:00 Voorbij" });
      expect((past as HTMLButtonElement).disabled).toBe(true);
      if (step === 1) fireEvent.click(screen.getByRole("button", { name: "Andere reparatie kiezen" }));
      else {
        fireEvent.click(screen.getByRole("button", { name: "Volgende dag" }));
        await screen.findByRole("button", { name: "10:00 – 11:00 Voorbij" });
      }
    }
    expect(screen.getByText(PENDING)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: RECOVER }));
    await screen.findByRole("heading", { name: "Je afspraak staat" });
    expect(screen.getByLabelText("Afspraakcode").textContent).toBe(BOOKED.code);
    expectSameRequest();
    expect(screen.queryByText(PENDING)).toBeNull();
    expect(screen.queryByRole("button", { name: RECOVER })).toBeNull();
  });

  it.each([200, 201, 409, 422])("clears recovery after a definitive %i reply", async (status) => {
    replies[1] = { status, body: status < 400 ? BOOKED
      : status === 409 ? { reden: "vol" } : { reden: "ongeldig", velden: { email: "Controleer je e-mail." } } };
    await unanswered();
    fireEvent.click(screen.getByRole("button", { name: RECOVER }));
    await waitFor(() => expect(screen.queryByRole("button", { name: RECOVER })).toBeNull());
    expect(screen.queryByText(PENDING)).toBeNull();
    expectSameRequest();
    if (status < 400) expect(screen.getByRole("heading", { name: "Je afspraak staat" })).toBeTruthy();
    else {
      expect(screen.getByRole("alert").textContent).toMatch(status === 409 ? /net vol/ : /Controleer/);
      replies.push({ status: 201, body: BOOKED });
      fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
      await screen.findByRole("heading", { name: "Je afspraak staat" });
      expect(posts).toHaveLength(3);
      expect(new Headers(posts[2].headers).get("Idempotency-Key"))
        .not.toBe(new Headers(posts[0].headers).get("Idempotency-Key"));
    }
  });

  it("keeps the original request through repeated network and server failures", async () => {
    replies = ["network", { status: 503, body: {} }, "network", { status: 201, body: BOOKED }];
    await unanswered();
    for (const message of [/even niet bereikbaar/, /geen verbinding/]) {
      fireEvent.click(screen.getByRole("button", { name: RECOVER }));
      await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(message));
      expect(screen.getByText(PENDING)).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: RECOVER }));
    await screen.findByRole("heading", { name: "Je afspraak staat" });
    expect(posts).toHaveLength(4);
    for (const post of posts) {
      expect(post.body).toBe(posts[0].body);
      expect(new Headers(post.headers).get("Idempotency-Key"))
        .toBe(new Headers(posts[0].headers).get("Idempotency-Key"));
    }
  });

  it("keeps recovery after a timeout and blocks simultaneous resubmission", async () => {
    await details();
    replies = ["timeout", { status: 201, body: BOOKED }];
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    const recover = screen.getByRole("button", { name: RECOVER });
    expect((recover as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(recover);
    expect(posts).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    vi.useRealTimers();
    expect(screen.getByRole("alert").textContent).toMatch(/reageert niet/);
    expect(screen.getByText(PENDING)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: RECOVER }));
    await screen.findByRole("heading", { name: "Je afspraak staat" });
    expectSameRequest();
  });
});
