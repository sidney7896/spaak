import { NextResponse, type NextRequest } from "next/server";
import { createNote, updateNote, listNotes } from "../../../lib/notes";
import { getCurrentUser } from "../../../lib/auth/session";
import { getServerConfig } from "../../../lib/config";
import { createLogger } from "../../../lib/observability/logger";
import { createPostHogServer } from "../../../lib/observability/posthog";

function validText(value: FormDataEntryValue | null, max: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }

export async function GET(request: NextRequest) {
  const logger = createLogger(request.headers.get("x-request-id"));
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const notes = await listNotes();
    const analytics = createPostHogServer(request.cookies.get("analytics_consent")?.value === "granted");
    analytics?.capture({ distinctId: user.id, event: "notes_viewed" });
    void analytics?.shutdown();
    return NextResponse.json({ notes });
  } catch (error) {
    logger.error("Could not load notes", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Could not load notes." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // R3-07: the redirect origin is the validated NEXT_PUBLIC_APP_URL, never the request URL, for the
  // same reason S-16 moved the auth callback off it.
  let origin: string;
  try { origin = new URL(getServerConfig().NEXT_PUBLIC_APP_URL).origin; } catch { return NextResponse.json({ error: "Configuration unavailable" }, { status: 503 }); }
  const form = await request.formData();
  const title = form.get("title"); const body = form.get("body"); const id = form.get("id");
  if (!validText(title, 120) || !validText(body, 10000) || (id !== null && !validText(id, 100))) return NextResponse.json({ error: "Invalid note" }, { status: 400 });
  try {
    if (id) await updateNote(id, title.trim(), body.trim());
    else await createNote(title.trim(), body.trim());
    // R4S-05: 303, not the NextResponse.redirect default of 307. A 307 preserves the method and the
    // body (RFC 7231 6.4.7), so the browser re-issued the create as a POST to `/notes`, which is an
    // App Router page with no route handler and no Server Action. 303 is the POST/redirect/GET status.
    return NextResponse.redirect(new URL("/notes", origin), 303);
  } catch { return NextResponse.json({ error: "Note is unavailable." }, { status: 403 }); }
}
