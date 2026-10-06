// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DayBoard } from "../../src/components/spaak/day-board";

const BOOKING = { code: "R7TQ2D", naam: "Femke de Wit", telefoon: "06 1234 5678", fiets: "Gazelle",
  reparatie: "Onderhoudsbeurt", status: "gepland", start: "11:00", eind: "12:00", ophalen: null, toeslagCent: 0 };
const DAY = { datum: "2026-10-08", tijdvakken: [{ start: "11:00", eind: "12:00", afspraken: [BOOKING] }] };
function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("day board recovery", () => {
  it("uses the Amsterdam date across a UTC midnight boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T22:30:00Z"));
    const fetchMock = vi.fn().mockResolvedValue(reply(DAY));
    vi.stubGlobal("fetch", fetchMock);
    render(<DayBoard />);
    await act(async () => {});
    expect(fetchMock.mock.calls[0][0]).toBe("/api/spaak/werkplaats/dag?datum=2026-10-08");
    expect(screen.getByRole("heading", { name: /donderdag 8 oktober/ })).toBeTruthy();
  });

  it("retries a failed day request", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Offline")).mockResolvedValueOnce(reply(DAY));
    vi.stubGlobal("fetch", fetchMock);
    render(<DayBoard initialDate="2026-10-08" />);
    expect((await screen.findByRole("alert")).textContent).toContain("Opnieuw proberen");
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    await screen.findByRole("article", { name: BOOKING.naam });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["fetch", "body"])("bounds a stalled %s at fifteen seconds even when abort is ignored", async (stage) => {
    vi.useFakeTimers();
    const stalled = stage === "fetch" ? new Promise<Response>(() => {}) : Promise.resolve({
      status: 200, json: () => new Promise<unknown>(() => {}),
    });
    const fetchMock = vi.fn().mockReturnValueOnce(stalled).mockResolvedValueOnce(reply(DAY));
    vi.stubGlobal("fetch", fetchMock);
    render(<DayBoard initialDate="2026-10-08" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole("alert").textContent).toContain("Opnieuw proberen");
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    await screen.findByRole("article", { name: BOOKING.naam });
  });

  it("refreshes after a lost status reply and suppresses duplicate clicks", async () => {
    let rejectPost: (error: Error) => void = () => {};
    const post = new Promise<Response>((_resolve, reject) => { rejectPost = reject; });
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(DAY)).mockReturnValueOnce(post)
      .mockResolvedValueOnce(reply({ ...DAY, tijdvakken: [{ ...DAY.tijdvakken[0], afspraken: [{ ...BOOKING, status: "ontvangen" }] }] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DayBoard initialDate="2026-10-08" />);
    const card = await screen.findByRole("article", { name: BOOKING.naam });
    const receive = within(card).getByRole("button", { name: "Ontvangen" });
    fireEvent.click(receive);
    fireEvent.click(receive);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { rejectPost(new TypeError("Lost reply")); });
    expect(screen.getByRole("alert").textContent).toContain("De status kon niet worden gewijzigd.");
    expect(within(card).getByText("Gepland", { selector: "[data-status]" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    await screen.findByText("Ontvangen", { selector: "[data-status]" });
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).method)).toEqual(["GET", "POST", "GET"]);
  });

  it("removes customer data when a status POST returns 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(DAY)).mockResolvedValueOnce(reply({}, 401)));
    render(<DayBoard initialDate="2026-10-08" />);
    const card = await screen.findByRole("article", { name: BOOKING.naam });
    fireEvent.click(within(card).getByRole("button", { name: "Ontvangen" }));
    const link = await screen.findByRole("link", { name: "Opnieuw inloggen" });
    expect(link.getAttribute("href")).toBe("/sign-in");
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("ignores the previous day's reply after navigation", async () => {
    let resolveOld: (response: Response) => void = () => {};
    const old = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(old)
      .mockResolvedValueOnce(reply({ datum: "2026-10-09", tijdvakken: [] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DayBoard initialDate="2026-10-08" />);
    fireEvent.click(screen.getByRole("button", { name: "Volgende dag" }));
    await screen.findByText("Geen afspraken vandaag");
    await act(async () => { resolveOld(reply(DAY)); });
    expect(screen.getByRole("heading", { name: /vrijdag 9 oktober/ })).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
  });
});
