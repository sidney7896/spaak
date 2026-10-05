"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { RepairType } from "../../lib/spaak/store";

type Field = "naam" | "duurMinuten" | "prijsCent";
type FieldErrors = Partial<Record<Field, string>>;
type DaySlot = { start: string; eind: string; capaciteit: number; geboekt: number; vrij: number };
type Day = { datum: string; gesloten: boolean; tijdvakken: DaySlot[] };
type ReadTask = { kind: "load"; date: string } | { kind: "day"; date: string };
type Task = ReadTask
  | { kind: "add"; date: string; input: Omit<RepairType, "id"> }
  | { kind: "capacity"; date: string; start: string; capacity: number }
  | { kind: "closed"; date: string; closed: boolean };
type RequestTask = Exclude<Task, ReadTask> | { kind: "types" } | { kind: "day"; date: string };
type Reply = { status: number; body: unknown };
type Notice = { message: string; retry?: ReadTask };

const dayFormatter = new Intl.DateTimeFormat("nl-NL", {
  weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
});
const priceFormatter = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
const FIELDS: readonly Field[] = ["naam", "duurMinuten", "prijsCent"];
const LABELS: Record<Field, string> = { naam: "Naam", duurMinuten: "Duur in minuten", prijsCent: "Prijs in euro" };

function today(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string): string => parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function repairReply(value: unknown): value is RepairType {
  return record(value) && typeof value.id === "string" && typeof value.naam === "string" &&
    nonnegativeInteger(value.duurMinuten) && (value.prijsCent === null || nonnegativeInteger(value.prijsCent));
}

function typesReply(value: unknown): value is { reparaties: RepairType[] } {
  return record(value) && Array.isArray(value.reparaties) && value.reparaties.every(repairReply);
}

function dayReply(value: unknown, date: string): value is Day {
  return record(value) && value.datum === date && typeof value.gesloten === "boolean" &&
    Array.isArray(value.tijdvakken) && value.tijdvakken.every((slot: unknown) => record(slot) &&
      typeof slot.start === "string" && typeof slot.eind === "string" && nonnegativeInteger(slot.capaciteit) &&
      nonnegativeInteger(slot.geboekt) && nonnegativeInteger(slot.vrij));
}

async function fetchReply(task: RequestTask, controller: AbortController): Promise<Reply> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error("De verbinding is onderbroken."));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      reject(new Error("De werkplaats reageert niet. Probeer het opnieuw."));
      controller.abort();
    }, 15_000);
  });
  const path = task.kind === "types" || task.kind === "add" ? "reparaties"
    : task.kind === "capacity" ? "capaciteit" : task.kind === "closed" ? "gesloten"
      : `dag?datum=${encodeURIComponent(task.date)}`;
  const input = task.kind === "add" ? task.input : task.kind === "capacity"
    ? { datum: task.date, start: task.start, capaciteit: task.capacity }
    : task.kind === "closed" ? { datum: task.date, gesloten: task.closed } : undefined;
  try {
    return await Promise.race([
      (async (): Promise<Reply> => {
        const response = await fetch(`/api/spaak/beheer/${path}`, {
          method: input === undefined ? "GET" : "POST", cache: "no-store", signal: controller.signal,
          ...(input === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
        });
        if (response.status === 401 || response.status === 403) return { status: response.status, body: null };
        if (response.status >= 500) throw new Error("De werkplaats is even niet bereikbaar.");
        const body: unknown = await response.json();
        return { status: response.status, body };
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timeout);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}

export function OwnerSettings({ initialDate }: { initialDate?: string }) {
  const [date, setDate] = useState<string>(() => initialDate ?? today());
  const firstDate = useRef(date);
  const [repairs, setRepairs] = useState<RepairType[]>([]);
  const [day, setDay] = useState<Day | null>(null);
  const [form, setForm] = useState<Record<Field, string>>({ naam: "", duurMinuten: "", prijsCent: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [capacities, setCapacities] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [unreconciledChange, setUnreconciledChange] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [access, setAccess] = useState<401 | 403 | null>(null);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const prefix = useId();

  const execute = useCallback(async (task: Task): Promise<void> => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const requestGeneration = ++generation.current;
    const isRead = task.kind === "load" || task.kind === "day";
    let changeAnswered = false;
    setBusy(true);
    setNotice(null);
    setResult(null);
    setAccess(null);
    if (isRead) {
      setDate(task.date);
      setDay((current) => current?.datum === task.date ? current : null);
    }
    if (task.kind === "add") setErrors({});
    const applyDay = (value: Day): void => {
      setDay(value);
      setCapacities(Object.fromEntries(value.tijdvakken.map((slot) => [slot.start, String(slot.capaciteit)])));
    };
    try {
      let reply: Reply;
      let types: Reply | undefined;
      if (task.kind === "load") {
        [types, reply] = await Promise.all([
          fetchReply({ kind: "types" }, controller), fetchReply({ kind: "day", date: task.date }, controller),
        ]);
      } else {
        reply = await fetchReply(task, controller);
      }
      if (generation.current !== requestGeneration) return;
      const denied = [types?.status, reply.status].find((status) => status === 401 || status === 403);
      if (denied === 401 || denied === 403) {
        setAccess(denied);
        setRepairs([]);
        setDay(null);
        return;
      }
      const { status, body } = reply;
      const reason = record(body) && typeof body.fout === "string" && body.fout.trim() ? body.fout
        : record(body) && typeof body.reden === "string" && body.reden.trim() ? body.reden : null;
      if (task.kind === "load" || task.kind === "day") {
        if (status !== 200 || !dayReply(body, task.date)) throw new Error("We konden het antwoord niet lezen.");
        if (task.kind === "load") {
          if (types?.status !== 200 || !typesReply(types.body)) throw new Error("We konden het antwoord niet lezen.");
          setRepairs(types.body.reparaties);
        }
        applyDay(body);
        // Only both validated reads can reconcile a change whose reply was lost.
        if (task.kind === "load") setUnreconciledChange(false);
      } else if (task.kind === "add" && status === 201 && record(body) && repairReply(body.reparatie)) {
        const repair = body.reparatie;
        setRepairs((current) => [...current, repair]);
        setForm({ naam: "", duurMinuten: "", prijsCent: "" });
        setResult("Reparatiesoort toegevoegd.");
      } else if (task.kind === "add" && status === 422 && record(body) && record(body.velden)) {
        const fields: FieldErrors = {};
        for (const field of FIELDS) {
          const message = body.velden[field];
          if (typeof message === "string") fields[field] = message;
        }
        setErrors(fields);
        setNotice({ message: "Controleer de ingevulde velden." });
      } else if (status === 200 && record(body) && body.ok === true && task.kind === "capacity") {
        setDay((current) => current?.datum === task.date ? {
          ...current, tijdvakken: current.tijdvakken.map((slot) => slot.start === task.start
            ? { ...slot, capaciteit: task.capacity, vrij: Math.max(0, task.capacity - slot.geboekt) } : slot),
        } : current);
        setResult("Capaciteit opgeslagen.");
      } else if (status === 200 && record(body) && body.ok === true && task.kind === "closed") {
        // A failed schedule read after this definite POST reply is a read failure.
        changeAnswered = true;
        if (task.closed) {
          setDay({ datum: task.date, gesloten: true, tijdvakken: [] });
          setResult("De dag is gesloten.");
        } else {
          const refreshed = await fetchReply({ kind: "day", date: task.date }, controller);
          if (generation.current !== requestGeneration) return;
          if (refreshed.status === 401 || refreshed.status === 403) {
            setAccess(refreshed.status);
            setRepairs([]);
            setDay(null);
          } else if (refreshed.status === 200 && dayReply(refreshed.body, task.date)) {
            applyDay(refreshed.body);
            setResult(refreshed.body.gesloten ? "Op zondag en maandag is de werkplaats gesloten." : "De dag is open.");
          } else {
            throw new Error("We konden het antwoord niet lezen.");
          }
        }
      } else if (status >= 400 && status < 500 && reason) {
        setNotice({ message: reason, retry: { kind: "day", date: task.date } });
      } else {
        throw new Error("We konden het antwoord niet lezen.");
      }
    } catch (error) {
      if (generation.current === requestGeneration) {
        const unansweredChange = !isRead && !changeAnswered;
        if (unansweredChange) setUnreconciledChange(true);
        const explanation = error instanceof TypeError ? "Er is geen verbinding."
          : error instanceof Error ? error.message : "Er ging iets mis.";
        setNotice({
          message: unansweredChange ? `Het antwoord is niet ontvangen. De wijziging kan al opgeslagen zijn. ${explanation}` : explanation,
          retry: { kind: "load", date: task.date },
        });
      }
    } finally {
      controller.abort();
      if (generation.current === requestGeneration) {
        active.current = null;
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    void execute({ kind: "load", date: firstDate.current });
    return () => {
      generation.current++;
      active.current?.abort();
      active.current = null;
    };
  }, [execute]);

  const locked = busy || access !== null || unreconciledChange;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (locked || active.current) return;
    const price = form.prijsCent.trim();
    let prijsCent: number | null = null;
    if (price !== "") {
      const parts = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(price);
      prijsCent = parts ? Number(parts[1]) * 100 + Number((parts[2] ?? "").padEnd(2, "0")) : NaN;
      if (!Number.isSafeInteger(prijsCent) || prijsCent > 1_000_000) {
        setErrors((current) => ({ ...current, prijsCent: "Vul een prijs van 0 tot 10.000 euro in, met maximaal twee decimalen." }));
        return;
      }
    }
    void execute({ kind: "add", date, input: { naam: form.naam.trim(), duurMinuten: Number(form.duurMinuten), prijsCent } });
  }

  return <div className="spaak-flow spaak-owner-settings">
    <h1>Instellingen</h1>
    {busy && <p className="spaak-loading" role="status">Even verwerken…</p>}
    {access !== null && <div className="spaak-alert" role="alert">
      <p>{access === 401 ? "Log opnieuw in." : "Alleen voor de eigenaar."}</p>
      <a className="spaak-button spaak-secondary" href={access === 401 ? "/sign-in" : "/werkplaats"}>
        {access === 401 ? "Opnieuw inloggen" : "Naar de werkplaats"}
      </a>
    </div>}
    {notice && <div className="spaak-alert" role="alert">
      <p>{notice.message}</p>
      {notice.retry && <button type="button" className="spaak-button spaak-secondary" disabled={busy}
        onClick={() => { if (notice.retry) void execute(notice.retry); }}>Opnieuw proberen</button>}
    </div>}
    {result && <p className="spaak-panel spaak-confirmation" role="status">{result}</p>}
    <div className="spaak-owner-columns">
      <section aria-labelledby={`${prefix}-repairs`}>
        <h2 id={`${prefix}-repairs`}>Reparatiesoorten</h2>
        <ul className="spaak-owner-repairs">{repairs.map((repair) => <li className="spaak-panel" key={repair.id}>
          <strong className="spaak-choice-name">{repair.naam}</strong>
          <span className="spaak-choice-meta">{repair.duurMinuten} minuten · {repair.prijsCent === null
            ? "Prijs op aanvraag" : priceFormatter.format(repair.prijsCent / 100)}</span>
        </li>)}</ul>
        <form noValidate onSubmit={submit}>
          {FIELDS.map((field) => {
            const id = `${prefix}-${field}`;
            return <div className="spaak-field" key={field}>
              <label htmlFor={id}>{LABELS[field]}</label>
              <input id={id} name={field} type={field === "duurMinuten" ? "number" : "text"}
                inputMode={field === "prijsCent" ? "decimal" : undefined}
                min={field === "duurMinuten" ? 1 : undefined} max={field === "duurMinuten" ? 480 : undefined}
                step={field === "duurMinuten" ? 1 : undefined} value={form[field]} disabled={locked}
                aria-invalid={errors[field] ? true : undefined}
                aria-describedby={errors[field] ? `${id}-error` : field === "prijsCent" ? `${id}-hint` : undefined}
                onChange={(event) => {
                  const value = event.target.value;
                  setForm((current) => ({ ...current, [field]: value }));
                  setErrors((current) => ({ ...current, [field]: undefined }));
                }} />
              {field === "prijsCent" && <p id={`${id}-hint`} className="spaak-owner-hint">Laat leeg voor prijs op aanvraag.</p>}
              {errors[field] && <p className="spaak-field-error" id={`${id}-error`}>{errors[field]}</p>}
            </div>;
          })}
          <button className="spaak-button" type="submit" disabled={locked}>Toevoegen</button>
        </form>
      </section>
      <section aria-labelledby={`${prefix}-capacity`}>
        <h2 id={`${prefix}-capacity`}>Capaciteit</h2>
        <div className="spaak-day-nav">
          <button className="spaak-button spaak-secondary" type="button" disabled={busy || access !== null}
            onClick={() => void execute({ kind: unreconciledChange ? "load" : "day", date: shiftDate(date, -1) })}>Vorige dag</button>
          <button className="spaak-button spaak-secondary" type="button" disabled={busy || access !== null}
            onClick={() => void execute({ kind: unreconciledChange ? "load" : "day", date: shiftDate(date, 1) })}>Volgende dag</button>
        </div>
        <p className="spaak-day-label"><time dateTime={date}>{dayFormatter.format(new Date(`${date}T00:00:00Z`))}</time></p>
        {day && <>
          {day.gesloten && !result && <p>De werkplaats is gesloten op deze dag.</p>}
          <button className="spaak-button spaak-secondary" type="button" disabled={locked}
            onClick={() => void execute({ kind: "closed", date, closed: !day.gesloten })}>
            {day.gesloten ? "Dag openen" : "Dag sluiten"}
          </button>
          <div className="spaak-owner-slots">{day.tijdvakken.map((slot) => {
            const label = `${slot.start} – ${slot.eind}`;
            const id = `${prefix}-capacity-${slot.start}`;
            return <form className="spaak-panel" key={slot.start} onSubmit={(event) => {
              event.preventDefault();
              if (!locked) void execute({ kind: "capacity", date, start: slot.start, capacity: Number(capacities[slot.start]) });
            }}>
              <h3>{label}</h3>
              <p>{slot.geboekt} van {slot.capaciteit} geboekt</p>
              <div className="spaak-field">
                <label htmlFor={id}>Plaatsen {label}</label>
                <input id={id} type="number" min={0} max={50} step={1} required disabled={locked}
                  value={capacities[slot.start] ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCapacities((current) => ({ ...current, [slot.start]: value }));
                  }} />
              </div>
              <button className="spaak-button" type="submit" disabled={locked}>Opslaan {label}</button>
            </form>;
          })}</div>
        </>}
      </section>
    </div>
  </div>;
}
