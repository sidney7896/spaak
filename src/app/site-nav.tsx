"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteNav({ brand, children }: { brand: string; children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/" || pathname === "/status" || pathname.startsWith("/status/")) return null;
  return <nav className="nav" aria-label="Hoofdmenu"><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">{brand.slice(0, 1).toUpperCase()}</span>{brand}</Link>{children}</nav>;
}
