export function Wheel({ spokes = 8 }: { spokes?: number }) {
  return <svg className="spaak-wheel" viewBox="0 0 64 64" width="56" height="56" aria-hidden="true" focusable="false">
    <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeWidth="5" />
    {Array.from({ length: 8 }, (_, index) => {
      const angle = index * Math.PI / 4 - Math.PI / 2;
      return <line key={index} x1="32" y1="32" x2={32 + Math.cos(angle) * 25}
        y2={32 + Math.sin(angle) * 25} stroke={index < spokes ? "currentColor" : "var(--spaak-line)"}
        strokeWidth="4" strokeLinecap="round" />;
    })}
    <circle cx="32" cy="32" r="6" fill="var(--spaak-ink)" />
  </svg>;
}
