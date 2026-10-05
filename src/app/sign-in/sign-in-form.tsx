"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "../../lib/supabase/browser";
import { enabledSignInMethods, providerLabels } from "../../lib/auth/methods";
import { projectProfile } from "../../lib/profile";

// Roadmap 11H: one email carries a code and a link. The code works on any device; the link only in
// the browser that asked for it (PKCE), so the code is the main path.
export function SignInForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const methods = enabledSignInMethods(projectProfile);
  async function signInWith(provider: "google" | "microsoft" | "apple") {
    const supabase = createBrowserSupabaseClient();
    const providerName = provider === "microsoft" ? "azure" : provider;
    const { error: authError } = await supabase.auth.signInWithOAuth({ provider: providerName, options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` } });
    if (authError) setError(authError.message);
  }
  async function sendCode(event: React.FormEvent) {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    const supabase = createBrowserSupabaseClient();
    const { error: authError } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`, shouldCreateUser: projectProfile.signupMode === "self-service" } });
    setBusy(false);
    if (!authError) { setSent(true); setMessage(`We hebben een inlogcode gestuurd naar ${email}. Typ de code hieronder; dat kan op elk apparaat.`); return; }
    if (/signups not allowed/i.test(authError.message)) setError("Dit e-mailadres heeft (nog) geen toegang. Vraag je beheerder om een uitnodiging.");
    else if (/rate limit/i.test(authError.message)) setError("Er zijn net te veel mails verstuurd. Wacht een minuut en probeer het opnieuw.");
    else setError("Versturen is niet gelukt. Probeer het zo opnieuw.");
  }
  async function verifyCode(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    const supabase = createBrowserSupabaseClient();
    const { error: authError } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (authError) {
      setBusy(false);
      setError(/rate limit|too many/i.test(authError.message)
        ? "Te veel pogingen achter elkaar. Wacht een paar minuten en probeer het opnieuw."
        : "Deze code klopt niet of is verlopen. Vraag een nieuwe code aan.");
      return;
    }
    // A full navigation on purpose: /auth/check is a route handler that reads the fresh session cookies and redirects.
    // A full navigation on purpose: the Next lint rule that flagged a relative destination is not loaded here.
    window.location.assign("/auth/check?next=/dashboard");
  }
  function otherEmail() { setSent(false); setCode(""); setMessage(""); setError(""); }
  return <div className="stack">
    {methods.filter((method) => method !== "magicLink").map((method) => <button key={method} className="secondary" type="button" onClick={() => void signInWith(method)}>{`Verder met ${providerLabels[method]}`}</button>)}
    {methods.includes("magicLink") && !sent && <form className="stack" onSubmit={(event) => void sendCode(event)}><p className="muted">Vul je e-mailadres in. Je krijgt een mail met een inlogcode.</p><label className="field">E-mailadres<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><button type="submit" disabled={busy}>Stuur inlogcode</button></form>}
    {message && <p className="notice ok" role="status">{message}</p>}
    {methods.includes("magicLink") && sent && <form className="stack" onSubmit={(event) => void verifyCode(event)}><label className="field">Inlogcode<input className="code-input" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={8} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /></label><button type="submit" disabled={busy}>Inloggen</button><button className="secondary" type="button" onClick={otherEmail}>Ander e-mailadres</button></form>}
    {methods.length === 0 && <p className="muted">Er is voor deze app nog geen manier van inloggen ingeschakeld.</p>}
    {projectProfile.signupMode === "self-service" && <p><a href="/sign-up">Account aanmaken</a></p>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </div>;
}
