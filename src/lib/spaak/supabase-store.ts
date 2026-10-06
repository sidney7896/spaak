import { CODE_ALPHABET, normalizePostcode, OPHAAL_TOESLAG_CENT, slotsForDate, slotStart, validateContact, validateOphalen } from "./domain";
import type { Slot, Status } from "./domain";
import type {
  Booking, BookingFields, BookingInput, BookingResult, CancelResult, DayAvailability, DayOverviewGroup,
  RepairType, SpaakStore, StatusResult,
} from "./store";

export type RpcClient = {
  schema(name: string): {
    rpc(fn: string, args: { p: unknown }): Promise<{ data: unknown; error: { message: string } | null }>;
  };
};

function malformed(): never {
  throw new Error("Ongeldig antwoord van de Spaak database.");
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return malformed();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : malformed();
}

function integer(value: unknown, minimum = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : malformed();
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : malformed();
}

function date(value: unknown): string {
  const result = text(value);
  try { slotsForDate(result, []); } catch { return malformed(); }
  return result;
}

function time(value: unknown): string {
  const result = text(value);
  return /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(result) ? result.slice(0, 5) : malformed();
}

function repair(value: unknown): RepairType {
  const row = object(value);
  const result = {
    id: text(row.id), naam: text(row.naam), duurMinuten: integer(row.duur_minuten, 1),
    prijsCent: row.prijs_cent === null ? null : integer(row.prijs_cent),
  };
  if (!result.id || !result.naam.trim()) return malformed();
  return result;
}

const statuses: readonly Status[] = ["gepland", "ontvangen", "bezig", "klaar", "opgehaald", "geannuleerd"];

function booking(value: unknown): Booking {
  const row = object(value);
  const status = text(row.status);
  if (!statuses.includes(status as Status)) return malformed();
  const code = text(row.code);
  if (code.length !== 6 || [...code].some((letter) => !CODE_ALPHABET.includes(letter))) return malformed();
  const created = text(row.aangemaakt);
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(created) ||
      !Number.isFinite(new Date(created).getTime())) return malformed();
  date(created.slice(0, 10));
  const result: Booking = {
    code, repairTypeId: text(row.reparatie_id), date: date(row.datum),
    start: time(row.start), end: time(row.eind), status: status as Status,
    naam: text(row.naam), telefoon: text(row.telefoon), email: text(row.email), fiets: text(row.fiets),
    createdAt: new Date(created).toISOString(),
    ophalen: row.ophaal_postcode === null && row.ophaal_adres === null ? null
      : { postcode: text(row.ophaal_postcode), adres: text(row.ophaal_adres) },
    toeslagCent: integer(row.toeslag_cent),
  };
  if (result.ophalen ? Object.keys(validateOphalen(result.ophalen)).length > 0 ||
      normalizePostcode(result.ophalen.postcode) !== result.ophalen.postcode ||
      result.ophalen.adres.trim() !== result.ophalen.adres || result.toeslagCent !== OPHAAL_TOESLAG_CENT
    : result.toeslagCent !== 0) return malformed();
  const slot = slotsForDate(result.date, []).find((slot) => slot.start === result.start);
  if (!result.repairTypeId || Object.keys(validateContact(result)).length || slot?.end !== result.end) return malformed();
  return result;
}

function outcome<T extends string>(value: unknown, reasons: readonly T[]): { ok: true } | { ok: false; reason: T } {
  const row = object(value);
  if (row.ok === true) return { ok: true };
  if (row.ok !== false || !reasons.includes(row.reason as T)) return malformed();
  return { ok: false, reason: row.reason as T };
}

export class SupabaseStore implements SpaakStore {
  private readonly rpc: ReturnType<RpcClient["schema"]>;
  private readonly now: () => Date;

  constructor(options: { client: RpcClient; schema: string; now?: () => Date }) {
    if (!/^[a-z][a-z0-9_]*$/.test(options.schema)) throw new Error("Ongeldig Spaak databaseschema.");
    this.rpc = options.client.schema(options.schema);
    this.now = options.now ?? (() => new Date());
  }

  private async call(fn: string, p: unknown): Promise<unknown> {
    const response = await this.rpc.rpc(fn, { p });
    if (response.error) throw new Error(`Spaak database (${fn}): ${response.error.message}`);
    return response.data;
  }

  async listRepairTypes(): Promise<RepairType[]> {
    const types = array(await this.call("spaak_reparaties", {})).map(repair);
    if (new Set(types.map((type) => type.id)).size !== types.length) return malformed();
    return types;
  }

  async addRepairType(input: Omit<RepairType, "id">): Promise<RepairType> {
    if (!input.naam.trim() || !Number.isSafeInteger(input.duurMinuten) || input.duurMinuten <= 0 ||
        (input.prijsCent !== null && (!Number.isSafeInteger(input.prijsCent) || input.prijsCent < 0))) {
      throw new Error("Ongeldig reparatietype.");
    }
    return repair(await this.call("spaak_reparatie_toevoegen", { ...input, naam: input.naam.trim() }));
  }

  private readDay(value: unknown, defaults: Slot[]): { closed: boolean; slots: (Slot & { booked: number; free: number })[] } {
    const row = object(value);
    if (typeof row.closed !== "boolean") return malformed();
    const slots = array(row.slots).map((value) => {
      const slot = object(value);
      const result = {
        start: time(slot.start), end: time(slot.end), capacity: integer(slot.capacity),
        booked: integer(slot.booked), free: integer(slot.free),
      };
      if (result.capacity > 50 || result.free !== Math.max(0, result.capacity - result.booked)) return malformed();
      return result;
    });
    if (row.closed ? slots.length !== 0 : slots.length !== defaults.length || defaults.length === 0) return malformed();
    if (slots.some((slot, index) => slot.start !== defaults[index]?.start || slot.end !== defaults[index]?.end)) return malformed();
    return { closed: row.closed, slots };
  }

  async dayAvailability(date: string): Promise<DayAvailability> {
    const defaults = slotsForDate(date, []);
    const now = this.now();
    const day = this.readDay(await this.call("spaak_dag", { datum: date, slots: defaults }), defaults);
    const slots = day.slots.map((slot) => {
      const past = slotStart(date, slot.start).getTime() <= now.getTime();
      return { ...slot, past, free: past ? 0 : slot.free };
    });
    const future = slots.filter((slot) => !slot.past);
    const reason = day.closed ? "gesloten" : future.length === 0 ? "verleden" :
      future.some((slot) => slot.free > 0) ? null : "vol";
    return { date, closed: day.closed, slots, reason };
  }

  async nextAvailableDate(date: string): Promise<string | null> {
    slotsForDate(date, []);
    const candidate = new Date(`${date}T00:00:00.000Z`);
    const now = this.now();
    const days: { datum: string; slots: Slot[] }[] = [];
    for (let offset = 0; offset <= 60; offset++) {
      const datum = candidate.toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) break;
      days.push({ datum, slots: slotsForDate(datum, []).filter((slot) => slotStart(datum, slot.start).getTime() > now.getTime()) });
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
    const value = await this.call("spaak_volgende_vrije_dag", { dagen: days });
    if (value === null) return null;
    const result = text(value);
    if (!days.some((day) => day.datum === result && day.slots.length > 0)) return malformed();
    return result;
  }

  async book(input: BookingInput, idempotencyKey: string): Promise<BookingResult> {
    const fields: BookingFields = {
      ...validateContact(input), ...(input.ophalen ? validateOphalen(input.ophalen) : {}),
    };
    let slots: Slot[];
    try { slots = slotsForDate(input.date, []); } catch {
      fields.date = "Kies een geldige datum.";
      return { ok: false, reason: "ongeldig", fields };
    }
    if (Object.keys(fields).length) return { ok: false, reason: "ongeldig", fields };
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) return { ok: false, reason: "ongeldig", fields: {} };
    if (!slots.length) return { ok: false, reason: "gesloten" };
    const slot = slots.find((slot) => slot.start === input.start);
    if (!slot) return { ok: false, reason: "ongeldig", fields: { start: "Kies een geldig tijdslot." } };
    const result = object(await this.call("spaak_boek", {
      ...input, naam: input.naam.trim(), telefoon: input.telefoon.trim(), email: input.email.trim(), fiets: input.fiets.trim(),
      end: slot.end, sleutel: idempotencyKey, capacity: slot.capacity,
      start_tijdstip: slotStart(input.date, slot.start).toISOString(), nu: this.now().toISOString(),
    }));
    if (result.ok === true) return { ok: true, booking: booking(result.booking) };
    const failure = outcome(result, ["ongeldig", "gesloten", "verleden", "vol"] as const);
    if (failure.ok) return malformed();
    if (failure.reason === "ongeldig") {
      const rawFields = object(result.fields);
      const fields: BookingFields = {};
      for (const field of ["repairTypeId", "date", "start", "naam", "telefoon", "email", "fiets", "ophalen", "postcode", "adres"] as const) {
        if (Object.hasOwn(rawFields, field)) fields[field] = text(rawFields[field]);
      }
      return { ...failure, fields };
    }
    return failure;
  }

  async findByCode(code: string): Promise<Booking | null> {
    const value = await this.call("spaak_zoek", { code: code.trim().toUpperCase() });
    return value === null ? null : booking(value);
  }

  async cancel(code: string): Promise<CancelResult> {
    return outcome(await this.call("spaak_annuleer", { code: code.trim().toUpperCase(), nu: this.now().toISOString() }),
      ["onbekend", "status", "te-laat"] as const);
  }

  async dayOverview(date: string): Promise<DayOverviewGroup[]> {
    const defaults = slotsForDate(date, []);
    const result = array(await this.call("spaak_dagoverzicht", { datum: date, slots: defaults })).map((value) => {
      const group = object(value);
      const rawSlot = object(group.slot);
      const slot = { start: time(rawSlot.start), end: time(rawSlot.end), capacity: integer(rawSlot.capacity) };
      const bookings = array(group.bookings).map(booking);
      if (slot.capacity > 50 || !defaults.some((s) => s.start === slot.start && s.end === slot.end) ||
          !bookings.length || bookings.some((b) => b.date !== date || b.start !== slot.start || b.status === "geannuleerd")) return malformed();
      return { slot, bookings };
    });
    if (result.some((group, index) => index > 0 && group.slot.start <= result[index - 1].slot.start) ||
        new Set(result.flatMap((group) => group.bookings.map((b) => b.code))).size !== result.flatMap((group) => group.bookings).length) return malformed();
    return result;
  }

  async setStatus(code: string, status: Status): Promise<StatusResult> {
    return outcome(await this.call("spaak_status", { code: code.trim().toUpperCase(), status, nu: this.now().toISOString() }),
      ["onbekend", "overgang"] as const);
  }

  async setCapacity(date: string, start: string, capacity: number): Promise<void> {
    if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > 50 ||
        !slotsForDate(date, []).some((slot) => slot.start === start)) throw new Error("Ongeldige capaciteit of ongeldig tijdslot.");
    const result = outcome(await this.call("spaak_capaciteit_zet", { datum: date, start, capaciteit: capacity }), []);
    if (!result.ok) return malformed();
  }

  async setClosedDay(date: string, closed: boolean): Promise<void> {
    slotsForDate(date, []);
    if (typeof closed !== "boolean") throw new Error("Ongeldige instelling voor een gesloten dag.");
    const result = outcome(await this.call("spaak_gesloten_zet", { datum: date, gesloten: closed }), []);
    if (!result.ok) return malformed();
  }
}
