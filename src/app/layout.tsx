import type { Metadata } from "next";
import { getPublicConfig } from "../lib/config";
import { projectProfile } from "../lib/profile";
import { AnalyticsBootstrap } from "./analytics-bootstrap";
import { AccountNav } from "./account-nav";
import { SiteNav } from "./site-nav";
import { bodyFont, displayFont } from "./fonts";
import "./globals.css";

const appName = projectProfile.client ?? "App";

export const metadata: Metadata = { title: appName, description: `Afspraak maken voor je fietsreparatie bij ${appName}.` };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let environment = "development";
  try { environment = getPublicConfig().APP_ENV; } catch { /* health and setup pages remain renderable while configuring env. */ }
  return <html lang="nl" className={`${displayFont.variable} ${bodyFont.variable}`}><body><div className="shell"><AnalyticsBootstrap />
    {environment !== "production" && <div className="banner" role="status">Proefversie ({environment}): niet voor echt gebruik</div>}
    <SiteNav brand={appName}><AccountNav /></SiteNav>
    {children}
  </div></body></html>;
}
