import { SignInForm } from "./sign-in-form";

const meldingen: Record<string, string> = {
  invite_required: "Dit account heeft (nog) geen toegang tot deze app. Vraag je beheerder om een uitnodiging.",
  callback_failed: "Inloggen is niet gelukt. Vraag een nieuwe code aan en probeer het opnieuw.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const melding = error && Object.hasOwn(meldingen, error) ? meldingen[error] : null;
  return <main className="narrow"><section className="card stack"><h1>Inloggen</h1>{melding && <p className="notice error" role="alert">{melding}</p>}<SignInForm /></section></main>;
}
