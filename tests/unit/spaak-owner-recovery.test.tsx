// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerSettings } from "../../src/components/spaak/owner-settings";

/**
 * Werkstuk W5, repair 1 (route D trial, 05-10). Sol's review of 2ddc6ea: when a change got no answer (it may have been
 * saved), the screen must not allow another change until a refresh from the server has succeeded; a failed refresh or
 * moving to another day must not lift that lock, or the owner can add the same repair type twice. Fetch is faked and
 * honours the abort signal. Written by the meester; the builder may not change this file.
 */

type Reply = { status: number; body: unknown } | "hang" | "network-error";
let replies: Record<string, Reply[]>;
let calls: { method: string; url: string }[];
const TYPES = { reparaties: [{ id: "onderhoud", naam: "Onderhoudsbeurt", duurMinuten: 60, prijsCent: 6900 }] };
const WITH_NEW = { reparaties: [...TYPES.reparaties, { id: "banden-wisselen", naam: "Banden wisselen", duurMinuten: 30, prijsCent: 2500 }] };
const day = (datum: string) => ({ datum, gesloten: false, tijdvakken: [{ start: "10:00", eind: "11:00", capaciteit: 3, geboekt: 2, vrij: 1 }] });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  calls = [];
  replies = {
    "GET /api/spaak/beheer/reparaties": [{ status: 200, body: TYPES }],
    "GET /api/spaak/beheer/dag?datum=2026-10-09": [{ status: 200, body: day("2026-10-09") }],
    "GET /api/spaak/beheer/dag?datum=2026-10-10": [{ status: 200, body: day("2026-10-10") }],
    "POST /api/spaak/beheer/reparaties": ["hang"],
  };
  vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, "");
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    const queue = replies[method + " " + url] ?? [];
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    if (!reply) return Promise.resolve(new Response("{}", { status: 404 }));
    if (reply === "network-error") return Promise.reject(new TypeError("Failed to fetch"));
    if (reply === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } }));
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function changes() {
  return ["Toevoegen", "Opslaan 10:00 – 11:00", "Dag sluiten"].map((name) => screen.getByRole("button", { name }) as HTMLButtonElement);
}

async function unansweredAdd() {
  render(<OwnerSettings initialDate="2026-10-09" />);
  await screen.findByText("Onderhoudsbeurt");
  await screen.findByRole("button", { name: "Opslaan 10:00 – 11:00" });
  fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Banden wisselen" } });
  fireEvent.change(screen.getByLabelText("Duur in minuten"), { target: { value: "30" } });
  fireEvent.change(screen.getByLabelText("Prijs in euro"), { target: { value: "25" } });
  fireEvent.click(screen.getByRole("button", { name: "Toevoegen" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  return await screen.findByRole("alert");
}

const posts = () => calls.filter((c) => c.method === "POST").length;

describe("after a change that got no answer", () => {
  it("stays locked through a failed refresh and opens after a successful one", async () => {
    const alert = await unansweredAdd();
    expect(changes().every((button) => button.disabled)).toBe(true);
    replies["GET /api/spaak/beheer/reparaties"] = ["network-error", { status: 200, body: WITH_NEW }];
    fireEvent.click(within(alert).getByRole("button", { name: "Opnieuw proberen" }));
    const again = await screen.findByRole("alert");
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(changes().every((button) => button.disabled)).toBe(true);
    fireEvent.click(within(again).getByRole("button", { name: "Opnieuw proberen" }));
    expect(await screen.findByText("Banden wisselen")).toBeTruthy();
    await vi.waitFor(() => expect(changes().every((button) => !button.disabled)).toBe(true));
    expect(posts()).toBe(1);
  });

  it("stays locked when the owner moves to another day", async () => {
    await unansweredAdd();
    fireEvent.click(screen.getByRole("button", { name: "Volgende dag" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await vi.waitFor(() => expect(calls.some((c) => c.url === "/api/spaak/beheer/dag?datum=2026-10-10")).toBe(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const locked = changes().every((button) => button.disabled);
    const refreshed = calls.filter((c) => c.method === "GET" && c.url === "/api/spaak/beheer/reparaties").length > 1;
    // Either moving day is itself the full refresh (types reloaded successfully), or the lock stays.
    expect(locked || refreshed).toBe(true);
    if (!refreshed) {
      fireEvent.click(screen.getByRole("button", { name: "Toevoegen" }));
      expect(posts()).toBe(1);
    }
  });
});
