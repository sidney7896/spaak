import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
// R3-08: the middleware runs in the edge bundle and needs only the public settings, so it imports
// the browser config module directly instead of the server config index (which declares the
// service-role key, Sentry DSN and provider keys).
import { getBrowserPublicConfig } from "./lib/config/browser";

export async function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  // Rebuilt on demand so that it always carries the request's CURRENT cookie header.
  const forwardRequest = () => {
    const headers = new Headers(request.headers);
    headers.set("x-request-id", requestId);
    const next = NextResponse.next({ request: { headers } });
    next.headers.set("x-request-id", requestId);
    return next;
  };
  let response = forwardRequest();
  let config: ReturnType<typeof getBrowserPublicConfig>;
  try { config = getBrowserPublicConfig(); } catch { return response; }
  const supabase = createServerClient(config.NEXT_PUBLIC_SUPABASE_URL, config.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    db: { schema: config.NEXT_PUBLIC_SUPABASE_DB_SCHEMA },
    cookies: {
      getAll: () => request.cookies.getAll(),
      // R3-04: a refreshed session must reach BOTH the browser and the handlers of this same
      // request. Writing only to the response leaves every server component of this request
      // presenting the token Supabase has already rotated, which reads as "no user" and signs
      // people out at random. This is the documented @supabase/ssr Next.js pattern.
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        const refreshed = forwardRequest();
        cookiesToSet.forEach(({ name, value, options }) => refreshed.cookies.set(name, value, options));
        response = refreshed;
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
