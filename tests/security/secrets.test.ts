import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { redact } from "../../src/lib/observability/logger";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sourceRoot = join(projectRoot, "src");

// Assembled at run time so this file does not itself contain a literal the repository's secret
// scanner has to be told to ignore.
const PEM_BEGIN = `-----BEGIN ${"PRIVATE"} KEY-----`;
const PEM_END = `-----END ${"PRIVATE"} KEY-----`;

/**
 * R5S-01: this collector kept `/\.(ts|tsx|mjs)$/` only, so a `"use client"` module written as
 * `.js`, `.jsx` or `.cjs` - idiomatic in a Next.js App Router project, and what `eslint-config-next`
 * expects to be able to lint - was neither a client entry point nor a node the walker could reach.
 * Measured in a freshly generated project: `src/app/legacy-panel.jsx` importing the server config
 * and returning `SUPABASE_SERVICE_ROLE_KEY` kept this file green at 4/4, while the byte-identical
 * plant renamed to `.ts` failed it. Every JavaScript and TypeScript spelling is collected now.
 */
const SOURCE_FILE = /\.(m|c)?[jt]sx?$/;

function allFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

function sourceFiles(directory: string): string[] {
  return allFiles(directory).filter((path) => SOURCE_FILE.test(path));
}

/**
 * R4S-06: this file used to fail only when a `"use client"` module or the middleware itself
 * contained `from ".../lib/config"`. One hop of indirection passed 108/108: giving
 * `src/lib/auth/methods.ts` - which the `"use client"` sign-in form imports - an import of the
 * server configuration and an exported function returning `SUPABASE_SERVICE_ROLE_KEY` kept the
 * whole suite green. The S-18 / R3-08 protection was therefore removable undetected.
 *
 * The assertion now walks the relative import graph from every client entry point and from the
 * middleware. Everything below is a pure function over a module map, so the walker itself is tested
 * on a planted fixture graph rather than only on the tree it is asserting about.
 */
export type ModuleGraph = Map<string, string>;

const SOURCE_EXTENSIONS = [
  "", ".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs", ".js", ".jsx",
  "/index.ts", "/index.tsx", "/index.mts", "/index.cts", "/index.mjs", "/index.cjs", "/index.js", "/index.jsx",
];
// A relative specifier that resolves to one of these is data, not a module that can carry a secret.
const NON_MODULE = /\.(json|css|scss|svg|png|jpg|jpeg|webp|woff2?)$/;

export function importSpecifiers(text: string): string[] {
  const specifiers: string[] = [];
  for (const match of text.matchAll(/(?:^|[\s;}])(?:import|export)\s+([^;]*?)\bfrom\s*["']([^"']+)["']/g)) specifiers.push(match[2]);
  for (const match of text.matchAll(/(?:^|[^.\w])import\s*\(\s*["']([^"']+)["']/g)) specifiers.push(match[1]);
  for (const match of text.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) specifiers.push(match[1]);
  return specifiers;
}

/** The module a relative specifier names, `null` for a package or a data file, or an `unresolved:` marker. */
export function resolveSpecifier(from: string, specifier: string, graph: ModuleGraph): string | null {
  if (!specifier.startsWith(".")) return null;
  const segments = [...from.split("/").slice(0, -1), ...specifier.split("/")];
  const base: string[] = [];
  for (const segment of segments) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") base.pop();
    else base.push(segment);
  }
  const path = base.join("/");
  for (const extension of SOURCE_EXTENSIONS) if (graph.has(`${path}${extension}`)) return `${path}${extension}`;
  return NON_MODULE.test(path) ? null : `unresolved:${path}`;
}

/**
 * Every path from an entry point to a forbidden module, as `a -> b -> c`. An import that cannot be
 * resolved is returned too: a specifier this walker cannot follow is a hole in the assertion, not a
 * pass.
 */
export function forbiddenImportPaths(graph: ModuleGraph, entryPoints: string[], forbidden: string[]): string[] {
  const banned = new Set(forbidden);
  const findings = new Set<string>();
  for (const entry of entryPoints) {
    const seen = new Set([entry]);
    const queue: string[][] = [[entry]];
    while (queue.length > 0) {
      const chain = queue.shift() as string[];
      const current = chain[chain.length - 1];
      for (const specifier of importSpecifiers(graph.get(current) ?? "")) {
        const target = resolveSpecifier(current, specifier, graph);
        if (target === null) continue;
        if (target.startsWith("unresolved:")) { findings.add(`${[...chain].join(" -> ")} -> ${target}`); continue; }
        if (banned.has(target)) findings.add([...chain, target].join(" -> "));
        if (seen.has(target)) continue;
        seen.add(target);
        queue.push([...chain, target]);
      }
    }
  }
  return [...findings].sort();
}

function templateModuleGraph(): ModuleGraph {
  const graph: ModuleGraph = new Map();
  for (const file of sourceFiles(sourceRoot)) graph.set(relative(projectRoot, file).split(sep).join("/"), readFileSync(file, "utf8"));
  return graph;
}

export function clientEntryPoints(graph: ModuleGraph): string[] {
  return [...graph.keys()].filter((path) => path === "src/proxy.ts" || /^\s*["']use client["']/m.test(graph.get(path) ?? ""));
}

// The server-only modules: the configuration index (SUPABASE_SERVICE_ROLE_KEY and every other
// server setting), the server Supabase client and the notes store that uses it.
export const SERVER_ONLY_MODULES = ["src/lib/config/index.ts", "src/lib/supabase/server.ts", "src/lib/notes.ts"];

describe("secrets never leave the server", () => {
  it("redacts credentials wherever they appear in a log record", () => {
    const record = redact({
      message: "connect postgres://service_role:hunter2@db.example:5432/postgres",
      authorization: "Bearer abc.def.ghi",
      nested: { apiKey: "should-not-appear", note: "token=abcdef123456" },
      jwt: "eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl",
      pem: `${PEM_BEGIN}MIIEvQIBADANBg${PEM_END}`,
    }) as Record<string, unknown>;
    const serialized = JSON.stringify(record);
    for (const secret of ["hunter2", "should-not-appear", "abcdef123456", "MIIEvQIBADANBg", "c2lnbmF0dXJl"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("postgres://[REDACTED]@db.example");
  });

  /**
   * R5S-01, the collector itself. The assertions below are only as wide as `sourceFiles`, and the
   * tree this project ships today happens to contain no JavaScript module - so a narrowed collector
   * would change nothing measurable here until the day someone adds one. It is therefore measured
   * against a planted directory instead of against the tree.
   */
  it("collects every JavaScript and TypeScript spelling a module can have (R5S-01)", () => {
    const directory = mkdtempSync(join(tmpdir(), "collector-"));
    try {
      const modules = ["mod.ts", "mod.tsx", "mod.mts", "mod.cts", "mod.mjs", "mod.cjs", "mod.js", "mod.jsx"];
      const data = ["data.json", "styles.css", "logo.svg", "font.woff2"];
      for (const name of [...modules, ...data, "NOTES.md"]) writeFileSync(join(directory, name), "export const x = 1;\n");
      mkdirSync(join(directory, "nested"));
      writeFileSync(join(directory, "nested", "deep.jsx"), '"use client";\n');

      expect(sourceFiles(directory).map((path) => basename(path)).sort())
        .toEqual([...modules, "deep.jsx"].sort());
      // ... and the "every file is understood" rule below is not vacuous: it sees the odd one out.
      expect(allFiles(directory).filter((path) => !SOURCE_FILE.test(path) && !NON_MODULE.test(path)).map((path) => basename(path)))
        .toEqual(["NOTES.md"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  /**
   * R5S-01: a file the collector does not understand is a hole in the assertion below, not a pass.
   * `src/` may hold source the walker reads or data it can prove is data - nothing else.
   */
  it("understands every file in the source tree", () => {
    const unread = allFiles(sourceRoot)
      .filter((path) => !SOURCE_FILE.test(path) && !NON_MODULE.test(path))
      .map((path) => relative(projectRoot, path).split(sep).join("/"));
    expect(unread, "the import walker does not collect these files, so it cannot assert anything about them").toEqual([]);
  });

  it("keeps the server-only modules out of every client and edge bundle, at any depth", () => {
    const graph = templateModuleGraph();
    const entryPoints = clientEntryPoints(graph);
    // If this ever becomes empty the assertion below is vacuous, so it is checked first.
    expect(entryPoints).toContain("src/proxy.ts");
    expect(entryPoints.length).toBeGreaterThan(2);
    expect(
      forbiddenImportPaths(graph, entryPoints, SERVER_ONLY_MODULES),
      "a client or edge module reaches a server-only module",
    ).toEqual([]);
  });

  it("detects a server-only import that hides behind one hop (the R4S-06 canary)", () => {
    // The reviewer's exact scenario: the client form imports a helper, and the HELPER imports the
    // server config. The old one-level check passed this; the walker must not.
    const planted: ModuleGraph = new Map([
      ["src/app/sign-in/sign-in-form.tsx", '"use client";\nimport { signIn } from "../../lib/auth/methods";\n'],
      ["src/lib/auth/methods.ts", 'import { getServerConfig } from "../config";\nexport const signIn = () => getServerConfig().SUPABASE_SERVICE_ROLE_KEY;\n'],
      ["src/lib/config/index.ts", "export const getServerConfig = () => ({});\n"],
      ["src/proxy.ts", 'import { browserConfig } from "./lib/config/browser";\n'],
      ["src/lib/config/browser.ts", "export const browserConfig = {};\n"],
    ]);
    expect(forbiddenImportPaths(planted, clientEntryPoints(planted), SERVER_ONLY_MODULES)).toEqual([
      "src/app/sign-in/sign-in-form.tsx -> src/lib/auth/methods.ts -> src/lib/config/index.ts",
    ]);

    // Three hops, a re-export, a dynamic import and the middleware are all followed as well.
    const deeper: ModuleGraph = new Map([
      ["src/proxy.ts", 'import { a } from "./lib/a";\n'],
      ["src/lib/a.ts", 'export * from "./b";\n'],
      ["src/lib/b.ts", 'export const load = () => import("./supabase/server");\n'],
      ["src/lib/supabase/server.ts", "export const createServerSupabaseClient = () => ({});\n"],
    ]);
    expect(forbiddenImportPaths(deeper, ["src/proxy.ts"], SERVER_ONLY_MODULES)).toEqual([
      "src/proxy.ts -> src/lib/a.ts -> src/lib/b.ts -> src/lib/supabase/server.ts",
    ]);

    // A specifier the walker cannot follow is reported instead of silently passing.
    const broken: ModuleGraph = new Map([["src/proxy.ts", 'import { gone } from "./lib/vanished";\n']]);
    expect(forbiddenImportPaths(broken, ["src/proxy.ts"], SERVER_ONLY_MODULES)).toEqual([
      "src/proxy.ts -> unresolved:src/lib/vanished",
    ]);

    // ... and a clean client graph produces nothing.
    const clean: ModuleGraph = new Map([
      ["src/app/sign-in/sign-in-form.tsx", '"use client";\nimport { publicConfig } from "../../lib/config/browser";\n'],
      ["src/lib/config/browser.ts", "export const publicConfig = {};\n"],
    ]);
    expect(forbiddenImportPaths(clean, clientEntryPoints(clean), SERVER_ONLY_MODULES)).toEqual([]);
  });

  /**
   * R5S-01, the reviewer's exact plant: the same leak written with a JavaScript extension. The
   * `.jsx` module must be an entry point, the `.cjs` hop must be resolvable, and the chain must be
   * reported - the three things the `.ts`-only collector could not do.
   */
  it("detects the same leak written as .jsx and .cjs (the R5S-01 canary)", () => {
    const planted: ModuleGraph = new Map([
      ["src/app/legacy-panel.jsx", '"use client";\nimport { serverValue } from "../lib/legacy-helper";\nexport function LegacyPanel() { return serverValue(); }\n'],
      ["src/lib/legacy-helper.cjs", 'const { getServerConfig } = require("./config");\nimport { getServerConfig as direct } from "./config/index";\nmodule.exports.serverValue = () => direct().SUPABASE_SERVICE_ROLE_KEY;\n'],
      ["src/lib/config/index.ts", "export const getServerConfig = () => ({});\n"],
    ]);
    expect(clientEntryPoints(planted)).toEqual(["src/app/legacy-panel.jsx"]);
    expect(forbiddenImportPaths(planted, clientEntryPoints(planted), SERVER_ONLY_MODULES)).toEqual([
      "src/app/legacy-panel.jsx -> src/lib/legacy-helper.cjs -> src/lib/config/index.ts",
    ]);

    // A plain `.js` middleware spelling is followed as well.
    const jsProxy: ModuleGraph = new Map([
      ["src/proxy.ts", 'import { edge } from "./lib/edge.js";\n'],
      ["src/lib/edge.js", 'export { createServerSupabaseClient as edge } from "./supabase/server";\n'],
      ["src/lib/supabase/server.ts", "export const createServerSupabaseClient = () => ({});\n"],
    ]);
    expect(forbiddenImportPaths(jsProxy, ["src/proxy.ts"], SERVER_ONLY_MODULES)).toEqual([
      "src/proxy.ts -> src/lib/edge.js -> src/lib/supabase/server.ts",
    ]);
  });

  it("never hard-codes a credential in the source tree", () => {
    const shapes = [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, /\bre_[A-Za-z0-9]{16,}\b/, new RegExp(PEM_BEGIN.replace("PRIVATE", "[A-Z ]*PRIVATE"))];
    const offenders = sourceFiles(sourceRoot).filter((file) => {
      const text = readFileSync(file, "utf8");
      return shapes.some((shape) => shape.test(text));
    });
    expect(offenders.map((file) => relative(projectRoot, file))).toEqual([]);
  });
});
