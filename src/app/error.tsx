"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="narrow"><section className="card stack"><h1>Er ging iets mis</h1><p className="muted">Probeer het opnieuw. Blijft het misgaan, neem dan contact op met je beheerder.</p><div><button onClick={reset}>Opnieuw proberen</button></div></section></main>;
}
