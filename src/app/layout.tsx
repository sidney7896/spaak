import type { Metadata } from "next";
import Link from "next/link";
import { getPublicConfig } from "../lib/config";
import { projectProfile } from "../lib/profile";
import { AnalyticsBootstrap } from "./analytics-bootstrap";
import { AccountNav } from "./account-nav";
import { bodyFont, displayFont } from "./fonts";
import "./globals.css";

const appName = projectProfile.client ?? "App";

export const metadata: Metadata = { title: appName, description: `${appName}: inloggen, overzicht en notities` };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let environment = "development";
  try { environment = getPublicConfig().APP_ENV; } catch { /* health and setup pages remain renderable while configuring env. */ }
  return <html lang="nl" className={`${displayFont.variable} ${bodyFont.variable}`}><body><div className="shell"><AnalyticsBootstrap />
    {environment !== "production" && <div className="banner" role="status">Proefversie ({environment}): niet voor echt gebruik</div>}
    <nav className="nav" aria-label="Hoofdmenu"><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">{appName.slice(0, 1).toUpperCase()}</span>{appName}</Link><AccountNav /></nav>
    {children}
  </div></body></html>;
}
