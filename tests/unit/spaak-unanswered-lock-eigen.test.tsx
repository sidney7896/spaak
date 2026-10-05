// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingFlow } from "../../src/components/spaak/booking-flow";

const MESSAGE = "We weten nog niet of je afspraak is gelukt. Probeer het opnieuw; je krijgt geen dubbele afspraak.";
const CONTACT = {
  Naam: "Femke de Wit", Telefoon: "0612345678", "E-mail": "femke@example.nl",
  "Wat is er met je fiets?": "Gazelle, ketting piept",
};
const BOOKED = { code: "R7TQ2D", afspraak: {
  date: "2026-10-09", start: "10:00", end: "11:00", repairTypeId: "onderhoud",
} };
type Reply = { status: number; body: unknown } | "network" | "timeout";
let replies: Reply[];
let posts: RequestInit[];

beforeEach(() => {
  replies = [];
  posts = [];
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
      { start: "10:00", eind: "11:00", vrij: 1, capaciteit: 2 },
      { start: "11:00", eind: "12:00", vrij: 2, capaciteit: 2 },
    ] });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function details() {
  render(<BookingFlow initialDate="2026-10-09" />);
  fireEvent.click(await screen.findByRole("button", { name: /Onderhoudsbeurt/ }));
  fireEvent.click(await screen.findByRole("button", { name: "10:00 – 11:00" }));
  for (const [label, value] of Object.entries(CONTACT)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

function expectLocked() {
  for (const label of Object.keys(CONTACT)) {
    expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
  }
  for (const name of ["Bevestigen", "Ander tijdvak kiezen"]) {
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
  }
}

function expectSameRequests() {
  const key = new Headers(posts[0].headers).get("Idempotency-Key");
  expect(key).toBeTruthy();
  for (const post of posts) {
    expect(post.body).toBe(posts[0].body);
    expect(new Headers(post.headers).get("Idempotency-Key")).toBe(key);
  }
}

describe("unanswered booking lock", () => {
  it.each(["network", "timeout", 500, 503] as const)("locks after %s and only retries the stored request", async (failure) => {
    replies = [typeof failure === "number" ? { status: failure, body: {} } : failure,
      { status: 201, body: BOOKED }];
    await details();
    if (failure === "timeout") vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    expectLocked();
    if (failure === "timeout") {
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      vi.useRealTimers();
    }
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(MESSAGE)).toBeTruthy();
    expect(within(alert).getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Vorige aanvraag opnieuw versturen" })).toBeNull();
    expectLocked();

    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "changed@example.nl" } });
    expect((screen.getByLabelText("E-mail") as HTMLInputElement).value).toBe(CONTACT["E-mail"]);
    const confirm = screen.getByRole("button", { name: "Bevestigen" });
    fireEvent.submit(confirm.closest("form")!);
    fireEvent.click(confirm);
    fireEvent.click(screen.getByRole("button", { name: "Ander tijdvak kiezen" }));
    expect(posts).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Wie ben je?" })).toBeTruthy();

    const retry = within(alert).getByRole("button", { name: "Opnieuw proberen" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await screen.findByRole("heading", { name: "Je afspraak staat" });
    expect(posts).toHaveLength(2);
    expectSameRequests();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the alert and lock through repeated failures and an in-flight retry", async () => {
    replies = ["network", { status: 503, body: {} }, "network", { status: 200, body: BOOKED }];
    await details();
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    await screen.findByRole("alert");
    for (let retryIndex = 0; retryIndex < 3; retryIndex++) {
      const retry = screen.getByRole("button", { name: "Opnieuw proberen" });
      await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(false));
      expectLocked();
      fireEvent.click(retry);
      expect(within(screen.getByRole("alert")).getByText(MESSAGE)).toBeTruthy();
      expect((retry as HTMLButtonElement).disabled).toBe(true);
      expectLocked();
      fireEvent.submit(screen.getByRole("button", { name: "Bevestigen" }).closest("form")!);
    }
    await screen.findByRole("heading", { name: "Je afspraak staat" });
    expect(posts).toHaveLength(4);
    expectSameRequests();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([409, 422])("unlocks on %i and submits current details and slot with a fresh key", async (status) => {
    replies = ["network", { status, body: status === 409 ? { reden: "vol" }
      : { reden: "ongeldig", velden: { email: "Controleer je e-mail." } } },
      { status: 201, body: { ...BOOKED, afspraak: { ...BOOKED.afspraak, start: "11:00", end: "12:00" } } }];
    await details();
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    fireEvent.click(within(await screen.findByRole("alert")).getByRole("button", { name: "Opnieuw proberen" }));
    await screen.findByText(status === 409 ? /Dit tijdvak is net vol geraakt/ : "Controleer je gegevens en probeer het nog eens.");
    for (const label of Object.keys(CONTACT)) {
      expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(false);
    }
    expect((screen.getByRole("button", { name: "Bevestigen" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Ander tijdvak kiezen" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Opnieuw proberen" })).toBeNull();
    expect(posts).toHaveLength(2);
    expectSameRequests();

    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "new@example.nl" } });
    fireEvent.click(screen.getByRole("button", { name: "Ander tijdvak kiezen" }));
    fireEvent.click(await screen.findByRole("button", { name: "11:00 – 12:00" }));
    fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
    await screen.findByRole("heading", { name: "Je afspraak staat" });
    expect(posts).toHaveLength(3);
    expect(JSON.parse(String(posts[2].body))).toMatchObject({ email: "new@example.nl", start: "11:00" });
    expect(new Headers(posts[2].headers).get("Idempotency-Key"))
      .not.toBe(new Headers(posts[0].headers).get("Idempotency-Key"));
  });
});
