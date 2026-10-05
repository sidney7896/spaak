// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OwnerSettings } from "../../src/components/spaak/owner-settings";

const REPAIR = { id: "onderhoud", naam: "Onderhoudsbeurt", duurMinuten: 60, prijsCent: 6900 };
const DAY = { datum: "2026-10-09", gesloten: false,
  tijdvakken: [{ start: "10:00", eind: "11:00", capaciteit: 3, geboekt: 2, vrij: 1 }] };
function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("owner settings recovery", () => {
  it.each(["25,01", "25.01"])("converts %s to integer cents", async (price) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply({ reparaties: [REPAIR] })).mockResolvedValueOnce(reply(DAY))
      .mockResolvedValueOnce(reply({ reparatie: { id: "band", naam: "Band", duurMinuten: 30, prijsCent: 2501 } }, 201));
    vi.stubGlobal("fetch", fetchMock);
    render(<OwnerSettings initialDate={DAY.datum} />);
    await screen.findByText(REPAIR.naam);
    fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Band" } });
    fireEvent.change(screen.getByLabelText("Duur in minuten"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Prijs in euro"), { target: { value: price } });
    fireEvent.click(screen.getByRole("button", { name: "Toevoegen" }));
    await screen.findByText("Band");
    expect(JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body)).prijsCent).toBe(2501);
  });

  it("loads the reopened schedule and navigates to the next date", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply({ reparaties: [REPAIR] }))
      .mockResolvedValueOnce(reply({ ...DAY, gesloten: true, tijdvakken: [] }))
      .mockResolvedValueOnce(reply({ ok: true })).mockResolvedValueOnce(reply(DAY))
      .mockResolvedValueOnce(reply({ ...DAY, datum: "2026-10-10" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OwnerSettings initialDate={DAY.datum} />);
    fireEvent.click(await screen.findByRole("button", { name: "Dag openen" }));
    await screen.findByText("De dag is open.");
    expect(screen.getByLabelText("Plaatsen 10:00 – 11:00")).toBeTruthy();
    expect(JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body))).toEqual({ datum: DAY.datum, gesloten: false });
    fireEvent.click(screen.getByRole("button", { name: "Volgende dag" }));
    await screen.findByText("2 van 3 geboekt");
    expect(fetchMock.mock.calls[4][0]).toBe("/api/spaak/beheer/dag?datum=2026-10-10");
  });

  it.each([401, 403] as const)("locks changes and shows a recovery link on %s", async (status) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply({ reparaties: [REPAIR] })).mockResolvedValueOnce(reply(DAY))
      .mockResolvedValueOnce(reply({}, status));
    vi.stubGlobal("fetch", fetchMock);
    render(<OwnerSettings initialDate={DAY.datum} />);
    fireEvent.click(await screen.findByRole("button", { name: "Dag sluiten" }));
    const link = await screen.findByRole("link", { name: status === 401 ? "Opnieuw inloggen" : "Naar de werkplaats" });
    expect(link.getAttribute("href")).toBe(status === 401 ? "/sign-in" : "/werkplaats");
    expect(screen.queryByText(REPAIR.naam)).toBeNull();
    expect((screen.getByRole("button", { name: "Toevoegen" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(["fetch", "body"])("bounds a stalled %s and refreshes before another mutation", async (stage) => {
    vi.useFakeTimers();
    const stalled = stage === "fetch" ? new Promise<Response>(() => {}) : Promise.resolve({
      status: 201, json: () => new Promise<unknown>(() => {}),
    });
    const added = { id: "band", naam: "Band", duurMinuten: 30, prijsCent: null };
    const fetchMock = vi.fn().mockResolvedValueOnce(reply({ reparaties: [REPAIR] })).mockResolvedValueOnce(reply(DAY))
      .mockReturnValueOnce(stalled).mockResolvedValueOnce(reply({ reparaties: [REPAIR, added] })).mockResolvedValueOnce(reply(DAY));
    vi.stubGlobal("fetch", fetchMock);
    render(<OwnerSettings initialDate={DAY.datum} />);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Band" } });
    fireEvent.change(screen.getByLabelText("Duur in minuten"), { target: { value: "30" } });
    const add = screen.getByRole("button", { name: "Toevoegen" });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole("alert").textContent).toContain("De wijziging kan al opgeslagen zijn.");
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect((fetchMock.mock.calls[2][1] as RequestInit).signal?.aborted).toBe(true);
    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    await screen.findByText("Band");
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).method)).toEqual(["GET", "GET", "POST", "GET", "GET"]);
  });

  it("links server field errors to the corresponding input", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply({ reparaties: [REPAIR] })).mockResolvedValueOnce(reply(DAY))
      .mockResolvedValueOnce(reply({ reden: "ongeldig", velden: { naam: "Vul een naam in." } }, 422)));
    render(<OwnerSettings initialDate={DAY.datum} />);
    await screen.findByText(REPAIR.naam);
    fireEvent.click(screen.getByRole("button", { name: "Toevoegen" }));
    const error = await screen.findByText("Vul een naam in.");
    const input = screen.getByLabelText("Naam");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
  });
});
