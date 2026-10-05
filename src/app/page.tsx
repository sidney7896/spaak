import Link from "next/link";
import { projectProfile } from "../lib/profile";

export default function HomePage() {
  const appName = projectProfile.client ?? "deze app";
  return <main><section className="card hero"><h1>Welkom bij {appName}</h1><p className="muted">Log in met je e-mailadres. Je krijgt een code die je op elk apparaat kunt gebruiken.</p><p><Link className="button" href="/sign-in">Inloggen</Link></p></section></main>;
}
