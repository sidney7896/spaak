import Link from "next/link";
import { getCurrentUser } from "../lib/auth/session";

// The navigation knows whether someone is signed in; it never offers "Inloggen" to a signed-in user.
export async function AccountNav() {
  let email: string | null = null;
  try { email = (await getCurrentUser())?.email ?? null; } catch { email = null; }
  if (!email) return <div className="nav-links"><Link className="button" href="/sign-in">Inloggen</Link></div>;
  return <div className="nav-links"><Link href="/dashboard">Overzicht</Link><Link href="/notes">Notities</Link><span className="account">{email}</span><form action="/auth/sign-out" method="post"><button className="secondary" type="submit">Uitloggen</button></form></div>;
}
