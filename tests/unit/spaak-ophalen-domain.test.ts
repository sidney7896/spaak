import { describe, expect, it } from "vitest";
import { normalizePostcode, OPHAAL_TOESLAG_CENT, validateOphalen, type Ophalen } from "../../src/lib/spaak/domain";

/** Werkstuk W7: meester-owned acceptance contract; the builder may not change this file. */
const FORMAT = "Vul een postcode in zoals 3512 AB.";
const RING = "We halen alleen op binnen de ring: postcodes 3500 tot en met 3599";
const ADDRESS = "Vul een straat en huisnummer in.";

describe("W7: postcode and pick-up validation", () => {
  // Checks the surcharge in cents, independently of a repair price.
  // Catches: charging 10 cents, or adding the surcharge to every booking.
  it("exports a surcharge of exactly 1000 cents", () => {
    expect(OPHAAL_TOESLAG_CENT).toBe(1000);
  });

  // Checks every whitespace character is removed before formatting.
  // Catches: trim-only normalization, or preserving lowercase letters.
  it("normalizes the examples and whitespace inside digits and letters", () => {
    for (const value of ["3512ab", " 3512 AB ", "3512  ab", "3\t5\n1\r2 a\tb", "\u00a03512\u00a0ab\u00a0"]) {
      expect(normalizePostcode(value), value).toBe("3512 AB");
    }
    expect(normalizePostcode("1000 aa")).toBe("1000 AA");
    expect(normalizePostcode("9999zz")).toBe("9999 ZZ");
  });

  // Checks the whole value is an ASCII postcode with a nonzero leading digit.
  // Catches: accepting a prefix, punctuation, leading zeroes or Unicode letters.
  it("rejects malformed postcodes", () => {
    for (const value of ["0123 AB", "3512A", "3512 ABC", "3512-AB", "", " \t\n", "3512 ÅB", "3512 Aé", "3512 АB", "x3512AB", "3512AB!"]) {
      expect(normalizePostcode(value), value).toBeNull();
    }
  });

  // Checks normalization and the inclusive service-area boundaries separately.
  // Catches: excluding 3500 or 3599, accepting 3499 or 3600, or confusing format with range.
  it("uses the exact postcode errors and includes both ring boundaries", () => {
    for (const postcode of ["3499 AB", "3600 AA"]) {
      expect(validateOphalen({ postcode, adres: "Oudegracht 1" })).toEqual({ postcode: RING });
    }
    for (const postcode of ["3500 ab", " 3599 AB ", "3512  ab"]) {
      expect(validateOphalen({ postcode, adres: "Oudegracht 1" })).toEqual({});
    }
    for (const postcode of ["", "0123 AB", "3512A", "3512 ÅB"]) {
      expect(validateOphalen({ postcode, adres: "Oudegracht 1" })).toEqual({ postcode: FORMAT });
    }
  });

  // Checks address lengths after trimming, including both accepted endpoints.
  // Catches: accepting whitespace-only or 121-character addresses, or counting surrounding spaces.
  it("accepts trimmed lengths 1 through 120 and rejects all other lengths", () => {
    for (const adres of ["", " \t\n ", "a".repeat(121), ` ${"a".repeat(121)} `]) {
      expect(validateOphalen({ postcode: "3512 AB", adres })).toEqual({ adres: ADDRESS });
    }
    for (const adres of ["a", ` a `, "a".repeat(120), ` ${"a".repeat(120)} `]) {
      expect(validateOphalen({ postcode: "3512 AB", adres })).toEqual({});
    }
  });

  // Checks both errors survive and validation does not overwrite the entered values.
  // Catches: returning only the first error or mutating input while validating it.
  it("reports both fields without changing the Ophalen value", () => {
    const ophalen: Ophalen = { postcode: " 3600 aa ", adres: " " };
    expect(validateOphalen(ophalen)).toEqual({ postcode: RING, adres: ADDRESS });
    expect(ophalen).toEqual({ postcode: " 3600 aa ", adres: " " });
  });
});
