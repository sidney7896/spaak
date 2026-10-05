"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Status } from "../../lib/spaak/domain";

type Appointment = { code: string; status: Status; date: string; start: string; end: string; reparatie: string };
type Task = { kind: "lookup"; code: string; recoveringCancellation?: boolean } | { kind: "cancel"; code: string };
type Notice = { message: string; retry?: Task };

const STATUS_LABELS: Record<Status, string> = {
  gepland: "Gepland", ontvangen: "Ontvangen", bezig: "Bezig", klaar: "Klaar",
  opgehaald: "Opgehaald", geannuleerd: "Geannuleerd",
};
const NOT_FOUND = "Geen afspraak gevonden met deze code";
const dayFormatter = new Intl.DateTimeFormat("nl-NL", {
  weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
});

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function appointment(value: unknown, code: string): value is Appointment {
  if (!record(value) || value.code !== code || typeof value.status !== "string" ||
      !Object.hasOwn(STATUS_LABELS, value.status) || typeof value.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || typeof value.start !== "string" ||
      typeof value.end !== "string" || typeof value.reparatie !== "string") return false;
  const date = new Date(`${value.date}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.date;
}

async function fetchReply(task: Task, controller: AbortController): Promise<{ status: number; body: unknown }> {
  const url = `/api/spaak/afspraken/${encodeURIComponent(task.code)}${task.kind === "cancel" ? "/annuleren" : ""}`;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  // Bound the response reader too, even when fetch or a test double ignores abort.
  const deadline = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error("De verbinding is onderbroken."));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      reject(new Error("De werkplaats reageert niet."));
      controller.abort();
    }, 15_000);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, {
          method: task.kind === "cancel" ? "POST" : "GET", cache: "no-store", signal: controller.signal,
        });
        if (response.status >= 500) throw new Error("De werkplaats is even niet bereikbaar.");
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new Error("We konden het antwoord niet lezen.");
        }
        return { status: response.status, body };
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timeout);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}

export function StatusLookup({ initialCode }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode ?? "");
  const [booking, setBooking] = useState<Appointment | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const decline = useRef<HTMLButtonElement>(null);
  const fieldPrefix = useId();

  const execute = useCallback(async (task: Task): Promise<void> => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const requestGeneration = ++generation.current;
    setBusy(true);
    setNotice(null);
    setConfirming(false);
    setCancelled(false);
    if (task.kind === "lookup") setBooking(null);
    try {
      const { status, body } = await fetchReply(task, controller);
      if (generation.current !== requestGeneration) return;
      if (status === 404) {
        setBooking(null);
        setNotice({ message: NOT_FOUND });
      } else if (status === 429 && record(body) && typeof body.fout === "string") {
        setNotice({ message: body.fout });
      } else if (task.kind === "cancel" && status === 409 && record(body)) {
        if (body.reden === "te-laat") {
          setNotice({ message: "Annuleren kan niet meer online. Bel ons: 010-555 01 42" });
        } else if (body.reden === "status") {
          setNotice({ message: "Je afspraak kan niet meer online worden geannuleerd. Bekijk de actuele status.",
            retry: { kind: "lookup", code: task.code, recoveringCancellation: true } });
        } else {
          throw new Error("We konden je aanvraag niet verwerken.");
        }
      } else if (status === 200 && task.kind === "lookup" && appointment(body, task.code)) {
        setBooking(body);
        setCancelled(task.recoveringCancellation === true && body.status === "geannuleerd");
      } else if (status === 200 && task.kind === "cancel" && record(body) && body.status === "geannuleerd") {
        setBooking((current) => current?.code === task.code ? { ...current, status: "geannuleerd" } : current);
        setCancelled(true);
      } else {
        throw new Error("We konden het antwoord niet lezen.");
      }
    } catch (error) {
      if (generation.current === requestGeneration) {
        const message = error instanceof TypeError ? "Er is geen verbinding."
          : error instanceof Error ? error.message : "Er ging iets mis.";
        // A lost POST reply may already have cancelled the booking; retrieve its status first.
        const retry: Task = task.kind === "cancel"
          ? { kind: "lookup", code: task.code, recoveringCancellation: true } : task;
        setNotice({ message, retry });
      }
    } finally {
      if (generation.current === requestGeneration) {
        active.current = null;
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    const normalized = initialCode?.trim().toUpperCase() ?? "";
    setCode(initialCode ?? "");
    setBooking(null);
    setNotice(null);
    setConfirming(false);
    setCancelled(false);
    setBusy(false);
    if (normalized) void execute({ kind: "lookup", code: normalized });
    return () => {
      generation.current++;
      active.current?.abort();
      active.current = null;
    };
  }, [initialCode, execute]);

  useEffect(() => { heading.current?.focus(); }, [booking?.code, booking?.status]);
  useEffect(() => { if (confirming) decline.current?.focus(); }, [confirming]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (active.current) return;
    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      setBooking(null);
      setConfirming(false);
      setCancelled(false);
      setNotice({ message: NOT_FOUND });
      return;
    }
    void execute({ kind: "lookup", code: normalized });
  }

  return <section className="spaak-flow spaak-status-lookup" aria-labelledby={`${fieldPrefix}-title`}>
    <h1 id={`${fieldPrefix}-title`}>Hoe staat het met je fiets?</h1>
    <p className="spaak-lead">Vul je afspraakcode in. Die staat in je bevestiging.</p>
    <form onSubmit={submit}>
      <div className="spaak-field">
        <label htmlFor={`${fieldPrefix}-code`}>Afspraakcode</label>
        <span className="spaak-status-hint" id={`${fieldPrefix}-hint`}>6 letters en cijfers, bijvoorbeeld R7TQ2D</span>
        <input className="spaak-status-code" id={`${fieldPrefix}-code`} name="code" type="text"
          autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-describedby={`${fieldPrefix}-hint`}
          value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} />
      </div>
      <button className="spaak-button" type="submit" disabled={busy}>Bekijk status</button>
    </form>
    {busy && <p className="spaak-loading" role="status">Even ophalen…</p>}
    {notice && <div className="spaak-alert" role="alert">
      <p>{notice.message}</p>
      {notice.retry && <button className="spaak-button spaak-secondary" type="button" disabled={busy}
        onClick={() => { if (notice.retry) void execute(notice.retry); }}>Opnieuw proberen</button>}
    </div>}
    {booking && <section className="spaak-status-result" aria-labelledby={`${fieldPrefix}-result`} aria-live="polite">
      <h2 id={`${fieldPrefix}-result`} ref={heading} tabIndex={-1}>Je afspraak</h2>
      {cancelled && <p className="spaak-status-success">Je afspraak is geannuleerd.</p>}
      <p className="spaak-status-label">{STATUS_LABELS[booking.status]}</p>
      <div className="spaak-panel"><dl className="spaak-summary">
        <div><dt>Dag</dt><dd><time dateTime={booking.date}>{dayFormatter.format(new Date(`${booking.date}T00:00:00Z`))}</time></dd></div>
        <div><dt>Tijdvak</dt><dd>{booking.start} – {booking.end}</dd></div>
        <div><dt>Reparatie</dt><dd>{booking.reparatie}</dd></div>
      </dl></div>
      {booking.status === "gepland" && (confirming
        ? <div className="spaak-panel spaak-status-confirm" role="alertdialog" aria-labelledby={`${fieldPrefix}-confirm`}>
          <h2 id={`${fieldPrefix}-confirm`}>Wil je je afspraak annuleren?</h2>
          <p>Je plek in het tijdvak komt dan weer vrij.</p>
          <div className="spaak-status-actions">
            <button className="spaak-button spaak-status-danger" type="button" disabled={busy}
              onClick={() => void execute({ kind: "cancel", code: booking.code })}>Ja, annuleren</button>
            <button className="spaak-button spaak-secondary" type="button" disabled={busy} ref={decline}
              onClick={() => { setConfirming(false); heading.current?.focus(); }}>Nee, terug</button>
          </div>
        </div>
        : <div className="spaak-status-actions">
          <p>Je kunt tot 24 uur voor je afspraak online annuleren.</p>
          <button className="spaak-button spaak-secondary" type="button" disabled={busy}
            onClick={() => { setNotice(null); setConfirming(true); }}>Afspraak annuleren</button>
        </div>)}
    </section>}
  </section>;
}
