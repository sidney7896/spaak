// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Werkstuk W2b (route D trial, 05-10): polish after the first look at the protected preview. A customer on the booking
 * page or the status page saw the starter's own header (shop name plus "Inloggen") above the Spaak header. The
 * starter navigation stays for staff pages and sign-in, and disappears on the two customer pages.
 * Written by the meester; the builder may not change this file.
 */

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { SiteNav } from "../../src/app/site-nav";

afterEach(cleanup);

function show(pathname: string) {
  nav.pathname = pathname;
  render(<SiteNav brand="Fietsenmakerij De Spaak (verzonnen)"><a href="/sign-in">Inloggen</a></SiteNav>);
}

describe("the starter navigation", () => {
  it.each(["/", "/status"])("is not shown on the customer page %s", (pathname) => {
    show(pathname);
    expect(screen.queryByRole("navigation", { name: "Hoofdmenu" })).toBeNull();
    expect(screen.queryByText("Inloggen")).toBeNull();
  });

  it.each(["/werkplaats", "/beheer", "/sign-in", "/notes", "/statusbericht"])("stays on %s", (pathname) => {
    show(pathname);
    const menu = screen.getByRole("navigation", { name: "Hoofdmenu" });
    expect(menu.textContent).toContain("Fietsenmakerij De Spaak (verzonnen)");
    expect(screen.getByRole("link", { name: "Inloggen" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Fietsenmakerij De Spaak/ }).getAttribute("href")).toBe("/");
  });
});
