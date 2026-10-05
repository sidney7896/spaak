import type { Contact, Slot, Status } from "./domain";

export type RepairType = { id: string; naam: string; duurMinuten: number; prijsCent: number | null };
export type BookingInput = Contact & { repairTypeId: string; date: string; start: string };
export type Booking = BookingInput & { code: string; end: string; status: Status; createdAt: string };

export type AvailableSlot = Slot & { booked: number; free: number; past: boolean };
export type DayAvailability = {
  date: string;
  closed: boolean;
  slots: AvailableSlot[];
  reason: "gesloten" | "vol" | "verleden" | null;
};
export type DayOverviewGroup = { slot: Slot; bookings: Booking[] };

export type BookingResult =
  | { ok: true; booking: Booking }
  | {
    ok: false;
    reason: "ongeldig" | "gesloten" | "verleden" | "vol";
    fields?: Partial<Record<keyof BookingInput, string>>;
  };
export type CancelResult = { ok: true } | { ok: false; reason: "onbekend" | "status" | "te-laat" };
export type StatusResult = { ok: true } | { ok: false; reason: "onbekend" | "overgang" };

export interface SpaakStore {
  listRepairTypes(): Promise<RepairType[]>;
  addRepairType(input: Omit<RepairType, "id">): Promise<RepairType>;
  dayAvailability(date: string): Promise<DayAvailability>;
  nextAvailableDate(date: string): Promise<string | null>;
  book(input: BookingInput, idempotencyKey: string): Promise<BookingResult>;
  findByCode(code: string): Promise<Booking | null>;
  cancel(code: string): Promise<CancelResult>;
  dayOverview(date: string): Promise<DayOverviewGroup[]>;
  setStatus(code: string, status: Status): Promise<StatusResult>;
  setCapacity(date: string, start: string, capacity: number): Promise<void>;
  setClosedDay(date: string, closed: boolean): Promise<void>;
}
