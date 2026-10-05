import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { getCurrentUser, hasApplicationAccess } from "../auth/session";
import { createServerSupabaseClient } from "../supabase/server";

export type Staff = { rol: "monteur" | "eigenaar" };
export const TEST_STAFF_COOKIE = "spaak_test_staff";
export const TEST_STAFF_MAX_AGE = 12 * 60 * 60;

export function getTestStaffSecret(): string | null {
  const secret = process.env.SPAAK_TEST_SECRET;
  return process.env.APP_ENV === "test" && secret !== undefined && secret.length >= 16 ? secret : null;
}

function signature(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createTestStaffCookie(rol: Staff["rol"], secret: string): string {
  const expires = Math.floor(Date.now() / 1000) + TEST_STAFF_MAX_AGE;
  const value = `${rol}.${expires}`;
  return `${value}.${signature(value, secret)}`;
}

function verifyTestStaffCookie(value: string | undefined, secret: string): Staff | null {
  if (!value) return null;
  const match = /^(monteur|eigenaar)\.([1-9]\d{0,12})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return null;
  const [, rol, expires, supplied] = match;
  const now = Math.floor(Date.now() / 1000);
  const expiry = Number(expires);
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + TEST_STAFF_MAX_AGE) return null;
  const expected = signature(`${rol}.${expires}`, secret);
  // Compare the canonical base64url spelling, including the final padding bits.
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null;
  return { rol: rol === "eigenaar" ? "eigenaar" : "monteur" };
}

export async function getStaff(request?: NextRequest): Promise<Staff | null> {
  const secret = getTestStaffSecret();
  if (secret !== null) {
    const cookieStore = request ? request.cookies : await cookies();
    const staff = verifyTestStaffCookie(cookieStore.get(TEST_STAFF_COOKIE)?.value, secret);
    if (staff) return staff;
  }

  try {
    const user = await getCurrentUser();
    if (!user || !await hasApplicationAccess(await createServerSupabaseClient(), user)) return null;
    const owners = (process.env.SPAAK_EIGENAAR_EMAILS ?? "").split(",")
      .map((email) => email.trim().toLowerCase()).filter(Boolean);
    return { rol: user.email && owners.includes(user.email.trim().toLowerCase()) ? "eigenaar" : "monteur" };
  } catch {
    // An unavailable auth service must not expose the workshop's customer data.
    return null;
  }
}
