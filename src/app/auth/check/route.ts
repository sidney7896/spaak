import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { getSafeRedirect } from "../../../lib/auth/redirect";
import { getServerConfig } from "../../../lib/config";
import { hasApplicationAccess } from "../../../lib/auth/session";
import { projectProfile } from "../../../lib/profile";

// Roadmap 11H: after the browser verified an emailed code, the same membership gate as /auth/callback.
export async function GET(request: NextRequest) {
  let origin: string;
  try { origin = new URL(getServerConfig().NEXT_PUBLIC_APP_URL).origin; } catch { return NextResponse.json({ error: "Configuration unavailable" }, { status: 503 }); }
  const redirect = getSafeRedirect(request.nextUrl.searchParams.get("next"), origin);
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL(`/sign-in?error=callback_failed`, origin));
  if (projectProfile.signupMode === "self-service" || await hasApplicationAccess(supabase, user)) return NextResponse.redirect(redirect);
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL(`/sign-in?error=invite_required`, origin));
}
