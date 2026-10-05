import { NextResponse } from "next/server";

export function spaakJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
