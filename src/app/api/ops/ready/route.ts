import { NextResponse } from "next/server";
import { getCurrentUser, hasApplicationAccess } from "../../../../lib/auth/session";
import { getServerConfig } from "../../../../lib/config";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";
import { projectProfile } from "../../../../lib/profile";

export async function GET() {
  let user;
  try { user = await getCurrentUser(); } catch { return NextResponse.json({ ready: false, config: false, database: "unreachable" }, { status: 503 }); }
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let configOk = true;
  try { getServerConfig(); } catch { configOk = false; }
  if (!configOk) return NextResponse.json({ ready: false, config: false, database: "unreachable", modules: {} }, { status: 503 });
  const supabase = await createServerSupabaseClient();
  if (!(await hasApplicationAccess(supabase, user))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { error: databaseError } = await supabase.from("notes").select("id").limit(1);
  const database = databaseError ? "unreachable" : "ok";
  const ready = database === "ok";
  return NextResponse.json({ ready, config: true, database, modules: Object.fromEntries(Object.entries(projectProfile.modules).map(([name, state]) => [name, state.enabled])) }, { status: ready ? 200 : 503 });
}
