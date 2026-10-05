import { projectProfile } from "../../lib/profile";

export default function SignUpPage() {
  if (projectProfile.signupMode !== "self-service") return <main className="narrow"><section className="card stack"><h1>Uitnodiging nodig</h1><p className="muted">Deze app werkt alleen op uitnodiging. Vraag je beheerder om toegang.</p></section></main>;
  return <main className="narrow"><section className="card stack"><h1>Account aanmaken</h1><p className="muted">Je maakt een account aan door de eerste keer in te loggen met je e-mailadres.</p><p><a className="button" href="/sign-in">Verder naar inloggen</a></p></section></main>;
}
