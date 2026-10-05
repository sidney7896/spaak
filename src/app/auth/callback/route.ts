import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { getSafeRedirect } from "../../../lib/auth/redirect";
import { getServerConfig } from "../../../lib/config";
import { hasApplicationAccess } from "../../../lib/auth/session";
import { projectProfile } from "../../../lib/profile";

export function callbackOrigin(appUrl: string): string { return new URL(appUrl).origin; }

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  let origin: string;
  try { origin = callbackOrigin(getServerConfig().NEXT_PUBLIC_APP_URL); } catch { return NextResponse.json({ error: "Configuration unavailable" }, { status: 503 }); }
  const redirect = getSafeRedirect(request.nextUrl.searchParams.get("next"), origin);
  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && (projectProfile.signupMode === "self-service" || await hasApplicationAccess(supabase, user))) return NextResponse.redirect(redirect);
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL(`/sign-in?error=invite_required`, origin));
    }
  }
  return NextResponse.redirect(new URL(`/sign-in?error=callback_failed`, origin));
}
