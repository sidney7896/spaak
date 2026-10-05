import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  canCancel,
  generateCode,
  nextStatus,
  slotsForDate,
  slotStart,
  validateContact,
} from "../../src/lib/spaak/domain";

/**
 * Werkstuk W1a (route D trial, 05-10): the booking rules of the fictitious bike shop De Spaak, without screens or a
 * database. Written by the meester from the product card (KLAARKAART, Productversie 1); the builder may not change
 * this file. All times are wall-clock times in Europe/Amsterdam.
 */

const contact = { naam: "Femke de Wit", telefoon: "06 1234 5678", email: "femke@example.nl", fiets: "Gazelle, piept" };

describe("opening hours and slots", () => {
  it("has eight one-hour slots of two places on a weekday", () => {
    const slots = slotsForDate("2026-10-08", []);
    expect(slots.map((s) => s.start)).toEqual(["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
    expect(slots[0]).toEqual({ start: "09:00", end: "10:00", capacity: 2 });
    expect(slots[7].end).toBe("17:00");
  });

  it("has seven slots of three places on Saturday", () => {
    const slots = slotsForDate("2026-10-10", []);
    expect(slots).toHaveLength(7);
    expect(slots[6]).toEqual({ start: "15:00", end: "16:00", capacity: 3 });
  });

  it("is closed on Sunday, Monday and on closed days", () => {
    expect(slotsForDate("2026-10-11", [])).toEqual([]);
    expect(slotsForDate("2026-10-12", [])).toEqual([]);
    expect(slotsForDate("2026-10-09", ["2026-10-09"])).toEqual([]);
    expect(slotsForDate("2026-10-09", ["2026-10-16"])).toHaveLength(8);
  });

  it("refuses dates that do not exist", () => {
    for (const bad of ["2026-13-01", "2026-02-30", "08-10-2026", "", "2026-10-8"]) {
      expect(() => slotsForDate(bad, [])).toThrow();
    }
  });

  it("knows the real instant of a slot, also across the switch to winter time", () => {
    expect(slotStart("2026-10-08", "09:00").toISOString()).toBe("2026-10-08T07:00:00.000Z");
    expect(slotStart("2026-10-27", "09:00").toISOString()).toBe("2026-10-27T08:00:00.000Z");
  });
});

describe("contact details", () => {
  it("accepts ordinary Dutch details, including a 60-character name and a 500-character bike description", () => {
    expect(validateContact(contact)).toEqual({});
    expect(validateContact({ ...contact, telefoon: "06-12345678" })).toEqual({});
    expect(validateContact({ ...contact, telefoon: "+31 6 12345678" })).toEqual({});
    expect(validateContact({ ...contact, naam: "N".repeat(60), fiets: "f".repeat(500) })).toEqual({});
  });

  it("names every field that is wrong, in Dutch", () => {
    const errors = validateContact({ naam: " ", telefoon: "06 12a4 5678", email: "femke.example.nl", fiets: "" });
    expect(Object.keys(errors).sort()).toEqual(["email", "fiets", "naam", "telefoon"]);
    for (const message of Object.values(errors)) expect(message.length).toBeGreaterThan(5);
    expect(validateContact({ ...contact, naam: "N".repeat(81) })).toHaveProperty("naam");
    expect(validateContact({ ...contact, fiets: "f".repeat(501) })).toHaveProperty("fiets");
    expect(validateContact({ ...contact, telefoon: "0612" })).toHaveProperty("telefoon");
  });
});

describe("booking codes", () => {
  it("are six characters from an alphabet without look-alikes", () => {
    expect(CODE_ALPHABET).toBe("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    let i = 0;
    const values = [0, 0.999, 0.5, 0.25, 0.75, 0.1];
    const code = generateCode(() => values[i++ % values.length]);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(code[0]).toBe("A");
    expect(code[1]).toBe("9");
  });
});

describe("cancelling and status", () => {
  it("allows cancelling until 24 hours before the slot", () => {
    const start = slotStart("2026-10-09", "10:00");
    expect(canCancel(start, new Date(start.getTime() - 24 * 3600_000))).toBe(true);
    expect(canCancel(start, new Date(start.getTime() - 24 * 3600_000 + 60_000))).toBe(false);
    expect(canCancel(start, new Date(start.getTime() + 60_000))).toBe(false);
  });

  it("moves a repair forward one step at a time", () => {
    expect(nextStatus("gepland")).toBe("ontvangen");
    expect(nextStatus("ontvangen")).toBe("bezig");
    expect(nextStatus("bezig")).toBe("klaar");
    expect(nextStatus("klaar")).toBe("opgehaald");
    expect(nextStatus("opgehaald")).toBeNull();
    expect(nextStatus("geannuleerd")).toBeNull();
  });
});
