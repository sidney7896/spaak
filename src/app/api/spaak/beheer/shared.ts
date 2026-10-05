import type { NextRequest, NextResponse } from "next/server";
import { slotsForDate } from "../../../../lib/spaak/domain";
import { getStaff } from "../../../../lib/spaak/staff";
import { spaakJson } from "../response";

export async function requireOwner(request: NextRequest): Promise<NextResponse | null> {
  const staff = await getStaff(request);
  if (staff === null) return spaakJson({ fout: "Log opnieuw in." }, 401);
  if (staff.rol !== "eigenaar") return spaakJson({ fout: "Alleen voor de eigenaar." }, 403);
  return null;
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    slotsForDate(value, []);
    return true;
  } catch {
    return false;
  }
}
