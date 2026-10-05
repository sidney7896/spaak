// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusLookup } from "../../src/components/spaak/status-lookup";

const FOUND = {
  code: "R7TQ2D", status: "gepland", date: "2026-10-09", start: "11:00", end: "12:00", reparatie: "Onderhoudsbeurt",
};
function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("status request recovery", () => {
  it("retries a network failure and keeps the normalized code", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(reply(FOUND));
    vi.stubGlobal("fetch", fetchMock);
    render(<StatusLookup initialCode=" r7tq2d " />);
    expect((await screen.findByRole("alert")).textContent).toContain("Opnieuw proberen");
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    await screen.findByRole("heading", { name: "Je afspraak" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/spaak/afspraken/R7TQ2D");
  });

  it.each(["fetch", "body"])("limits a stalled %s to 15 seconds even when abort is ignored", async (stage) => {
    vi.useFakeTimers();
    const stalled = new Promise<Response>(() => {});
    const stalledBody = { status: 200, json: () => new Promise<unknown>(() => {}) };
    const fetchMock = vi.fn().mockReturnValueOnce(stage === "fetch" ? stalled : Promise.resolve(stalledBody))
      .mockResolvedValueOnce(reply(FOUND));
    vi.stubGlobal("fetch", fetchMock);
    render(<StatusLookup initialCode="R7TQ2D" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole("alert").textContent).toContain("Opnieuw proberen");
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    await screen.findByRole("heading", { name: "Je afspraak" });
  });

  it("recovers a lost cancellation reply by looking up its result before sending another POST", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(FOUND))
      .mockRejectedValueOnce(new TypeError("Lost reply"))
      .mockResolvedValueOnce(reply({ ...FOUND, status: "geannuleerd" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StatusLookup initialCode="R7TQ2D" />);
    fireEvent.click(await screen.findByRole("button", { name: "Afspraak annuleren" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, annuleren" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    await screen.findByText("Je afspraak is geannuleerd.");
    expect(screen.getByText("Geannuleerd")).toBeTruthy();
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).method)).toEqual(["GET", "POST", "GET"]);
    expect(screen.queryByRole("button", { name: "Afspraak annuleren" })).toBeNull();
  });

  it("cancels the displayed booking even if the input has since changed", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(FOUND))
      .mockResolvedValueOnce(reply({ status: "geannuleerd" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StatusLookup initialCode="R7TQ2D" />);
    fireEvent.click(await screen.findByRole("button", { name: "Afspraak annuleren" }));
    fireEvent.change(screen.getByLabelText("Afspraakcode"), { target: { value: "ZZZZZZ" } });
    const confirm = screen.getByRole("button", { name: "Ja, annuleren" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await screen.findByText("Je afspraak is geannuleerd.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/spaak/afspraken/R7TQ2D/annuleren");
  });

  it("ignores a stale initial-code lookup when the supplied code changes", async () => {
    let resolveOld: (value: Response) => void = () => {};
    const oldReply = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(oldReply)
      .mockResolvedValueOnce(reply({ ...FOUND, code: "ABCDEF", reparatie: "Band plakken" }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<StatusLookup initialCode="R7TQ2D" />);
    view.rerender(<StatusLookup initialCode="ABCDEF" />);
    await screen.findByText("Band plakken");
    await act(async () => { resolveOld(reply(FOUND)); });
    expect(screen.queryByText("Onderhoudsbeurt")).toBeNull();
    expect(screen.getByText("Band plakken")).toBeTruthy();
  });
});
