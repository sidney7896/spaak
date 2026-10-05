import { NextResponse, type NextRequest } from "next/server";
import {
  createTestStaffCookie, getTestStaffSecret, TEST_STAFF_COOKIE, TEST_STAFF_MAX_AGE,
} from "../../../../lib/spaak/staff";
import { spaakJson } from "../response";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = getTestStaffSecret();
  if (secret === null) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return spaakJson({ fout: "Kies een geldige rol." }, 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body) || !("rol" in body) ||
      (body.rol !== "monteur" && body.rol !== "eigenaar")) {
    return spaakJson({ fout: "Kies een geldige rol." }, 400);
  }

  const response = spaakJson({ rol: body.rol });
  response.cookies.set(TEST_STAFF_COOKIE, createTestStaffCookie(body.rol, secret), {
    path: "/", httpOnly: true, sameSite: "lax", maxAge: TEST_STAFF_MAX_AGE,
    secure: !(request.nextUrl.protocol === "http:" && request.nextUrl.hostname === "localhost"),
  });
  return response;
}
