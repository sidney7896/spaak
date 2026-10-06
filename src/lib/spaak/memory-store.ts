import { canCancel, generateCode, nextStatus, normalizePostcode, OPHAAL_TOESLAG_CENT, slotsForDate, slotStart, validateContact, validateOphalen } from "./domain";
import type { Slot, Status } from "./domain";
import type {
  Booking, BookingFields, BookingInput, BookingResult, CancelResult, DayAvailability, DayOverviewGroup,
  RepairType, SpaakStore, StatusResult,
} from "./store";

function copyBooking(booking: Booking): Booking {
  return { ...booking, ophalen: booking.ophalen ? { ...booking.ophalen } : null };
}

export class MemoryStore implements SpaakStore {
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly repairTypes: RepairType[] = [
    { id: "onderhoud", naam: "Onderhoudsbeurt", duurMinuten: 60, prijsCent: 6900 },
    { id: "remmen", naam: "Remmen afstellen", duurMinuten: 30, prijsCent: 2500 },
    { id: "band", naam: "Band plakken", duurMinuten: 20, prijsCent: 1500 },
    { id: "overig", naam: "Overig", duurMinuten: 60, prijsCent: null },
  ];
  private readonly bookings = new Map<string, Booking>();
  private readonly idempotency = new Map<string, string>();
  private readonly capacities = new Map<string, Map<string, number>>();
  private readonly closedDays = new Set<string>();
  private nextRepairTypeId = 1;

  constructor(options: { now?: () => Date; random?: () => number } = {}) {
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
  }

  async listRepairTypes(): Promise<RepairType[]> {
    return this.repairTypes.map((type) => ({ ...type }));
  }

  async addRepairType(input: Omit<RepairType, "id">): Promise<RepairType> {
    if (!input.naam.trim() || !Number.isSafeInteger(input.duurMinuten) || input.duurMinuten <= 0 ||
        (input.prijsCent !== null && (!Number.isSafeInteger(input.prijsCent) || input.prijsCent < 0))) {
      throw new Error("Ongeldig reparatietype.");
    }
    const type: RepairType = {
      id: `reparatie-${this.nextRepairTypeId++}`,
      naam: input.naam.trim(),
      duurMinuten: input.duurMinuten,
      prijsCent: input.prijsCent,
    };
    this.repairTypes.push(type);
    return { ...type };
  }

  private slots(date: string): Slot[] {
    return slotsForDate(date, this.closedDays.has(date) ? [date] : []).map((slot) => ({
      ...slot,
      capacity: this.capacities.get(date)?.get(slot.start) ?? slot.capacity,
    }));
  }

  private activeBookings(date: string, start: string): Booking[] {
    return [...this.bookings.values()].filter((booking) =>
      booking.date === date && booking.start === start && booking.status !== "geannuleerd",
    );
  }

  private availability(date: string, now: Date): DayAvailability {
    const slots = this.slots(date).map((slot) => {
      const booked = this.activeBookings(date, slot.start).length;
      const past = slotStart(date, slot.start).getTime() <= now.getTime();
      return { ...slot, booked, past, free: past ? 0 : Math.max(0, slot.capacity - booked) };
    });
    const closed = slots.length === 0;
    const futureSlots = slots.filter((slot) => !slot.past);
    const reason: DayAvailability["reason"] = closed ? "gesloten" : futureSlots.length === 0 ? "verleden" :
      futureSlots.some((slot) => slot.free > 0) ? null : "vol";
    return { date, closed, slots, reason };
  }

  async dayAvailability(date: string): Promise<DayAvailability> {
    return this.availability(date, this.now());
  }

  async nextAvailableDate(date: string): Promise<string | null> {
    slotsForDate(date, []); // Validate before parsing or doing date arithmetic.
    const candidate = new Date(`${date}T00:00:00.000Z`);
    const now = this.now();
    // Include the requested day, then search through 60 days ahead.
    for (let offset = 0; offset <= 60; offset++) {
      const day = candidate.toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
      if (this.availability(day, now).reason === null) return day;
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
    return null;
  }

  async book(input: BookingInput, idempotencyKey: string): Promise<BookingResult> {
    const previousCode = this.idempotency.get(idempotencyKey);
    if (previousCode !== undefined) {
      const previous = this.bookings.get(previousCode);
      if (previous) return { ok: true, booking: copyBooking(previous) };
    }

    const fields: BookingFields = {
      ...validateContact(input), ...(input.ophalen ? validateOphalen(input.ophalen) : {}),
    };
    if (!this.repairTypes.some((type) => type.id === input.repairTypeId)) {
      fields.repairTypeId = "Kies een geldig reparatietype.";
    }
    let slots: Slot[];
    try {
      slots = this.slots(input.date);
    } catch {
      fields.date = "Kies een geldige datum.";
      return { ok: false, reason: "ongeldig", fields };
    }
    if (Object.keys(fields).length > 0) return { ok: false, reason: "ongeldig", fields };
    if (slots.length === 0) return { ok: false, reason: "gesloten" };
    const slot = slots.find((candidate) => candidate.start === input.start);
    if (!slot) return { ok: false, reason: "ongeldig", fields: { start: "Kies een geldig tijdslot." } };
    const now = this.now();
    if (slotStart(input.date, slot.start).getTime() <= now.getTime()) return { ok: false, reason: "verleden" };

    // No await between the capacity/idempotency checks and both writes.
    if (this.activeBookings(input.date, slot.start).length >= slot.capacity) return { ok: false, reason: "vol" };
    let code: string;
    do {
      code = generateCode(this.random);
    } while (this.bookings.has(code));
    const booking: Booking = {
      repairTypeId: input.repairTypeId,
      date: input.date,
      start: input.start,
      naam: input.naam.trim(),
      telefoon: input.telefoon.trim(),
      email: input.email.trim(),
      fiets: input.fiets.trim(),
      code,
      end: slot.end,
      status: "gepland",
      createdAt: now.toISOString(),
      ophalen: input.ophalen ? { postcode: normalizePostcode(input.ophalen.postcode)!, adres: input.ophalen.adres.trim() } : null,
      toeslagCent: input.ophalen ? OPHAAL_TOESLAG_CENT : 0,
    };
    this.bookings.set(code, booking);
    this.idempotency.set(idempotencyKey, code);
    return { ok: true, booking: copyBooking(booking) };
  }

  private lookup(code: string): Booking | undefined {
    return this.bookings.get(code.trim().toUpperCase());
  }

  async findByCode(code: string): Promise<Booking | null> {
    const booking = this.lookup(code);
    return booking ? copyBooking(booking) : null;
  }

  async cancel(code: string): Promise<CancelResult> {
    const booking = this.lookup(code);
    if (!booking) return { ok: false, reason: "onbekend" };
    if (booking.status !== "gepland") return { ok: false, reason: "status" };
    if (!canCancel(slotStart(booking.date, booking.start), this.now())) return { ok: false, reason: "te-laat" };
    booking.status = "geannuleerd";
    return { ok: true };
  }

  async dayOverview(date: string): Promise<DayOverviewGroup[]> {
    // Existing repairs remain visible even when their day is subsequently closed.
    return slotsForDate(date, []).flatMap((slot): DayOverviewGroup[] => {
      const bookings = this.activeBookings(date, slot.start).map(copyBooking);
      if (bookings.length === 0) return [];
      const capacity = this.capacities.get(date)?.get(slot.start) ?? slot.capacity;
      return [{ slot: { ...slot, capacity }, bookings }];
    });
  }

  async setStatus(code: string, status: Status): Promise<StatusResult> {
    const booking = this.lookup(code);
    if (!booking) return { ok: false, reason: "onbekend" };
    if (nextStatus(booking.status) !== status) return { ok: false, reason: "overgang" };
    booking.status = status;
    return { ok: true };
  }

  async setCapacity(date: string, start: string, capacity: number): Promise<void> {
    if (!Number.isSafeInteger(capacity) || capacity < 0 || !slotsForDate(date, []).some((slot) => slot.start === start)) {
      throw new Error("Ongeldige capaciteit of ongeldig tijdslot.");
    }
    let day = this.capacities.get(date);
    if (!day) {
      day = new Map<string, number>();
      this.capacities.set(date, day);
    }
    day.set(start, capacity);
  }

  async setClosedDay(date: string, closed: boolean): Promise<void> {
    slotsForDate(date, []);
    if (typeof closed !== "boolean") throw new Error("Ongeldige instelling voor een gesloten dag.");
    if (closed) this.closedDays.add(date);
    else this.closedDays.delete(date);
  }
}
