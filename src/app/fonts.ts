import { Manrope, Source_Sans_3 } from "next/font/google";

// Self-hosted at build time by next/font: no request to Google while someone uses the app.
export const displayFont = Manrope({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-display", display: "swap" });
export const bodyFont = Source_Sans_3({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-body", display: "swap" });
