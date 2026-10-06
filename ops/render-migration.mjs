#!/usr/bin/env node
// Render the application migration for exactly one environment.
//
// Three modes:
//   (render)  --slug <s> --environment <e> --schema <s> --bucket <b> [--topology t] [--output f]
//   --check   [--environment e] --schema <s>     validate the rendering without applying it
//   --apply   --environment <e> --schema <s>     render and hand the file to the migration runner
//
// In --check and --apply mode the slug and topology come from project.profile.json, so CI cannot
// check one project's schema against another project's identity. Nothing is ever guessed: when the
// environment cannot be derived from --environment or from the schema suffix the run fails.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "..");
const migrationDirectory = join(projectDir, "supabase", "migrations");
const profilePath = join(projectDir, "project.profile.json");

export const ENVIRONMENT_CODES = {
  dev: "dev", development: "dev", test: "dev",
  stg: "stg", staging: "stg",
  prod: "prod", production: "prod",
};

/**
 * R4S-09: `ENVIRONMENT_CODES[value]` on a plain object literal answers for every `Object.prototype`
 * name, so `--environment toString` produced a truthy "environment", the expected-schema comparison
 * compared the garbage against itself, and `migration:check` reported ok about something it had not
 * checked. Only an own key is an environment.
 */
export function environmentCode(value) {
  return typeof value === "string" && Object.hasOwn(ENVIRONMENT_CODES, value) ? ENVIRONMENT_CODES[value] : null;
}

const SLUG = /^[a-z][a-z0-9_]{1,30}$/;
const BOOLEAN_FLAGS = new Set(["check", "apply"]);

/** Flags with a value plus the standalone boolean flags; an unknown shape is rejected, never ignored. */
export function parseFlags(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--") || token.length < 3) throw new Error(`Invalid argument ${token}`);
    const name = token.slice(2);
    const next = argv[index + 1];
    if (BOOLEAN_FLAGS.has(name)) { values[name] = true; continue; }
    if (next === undefined || next.startsWith("--")) throw new Error(`Invalid argument ${token}`);
    values[name] = next;
    index += 1;
  }
  return values;
}

/** dev|stg|prod for a schema that carries the environment in its name, else null. */
export function environmentFromSchema(schema) {
  const match = typeof schema === "string" ? schema.match(/^app_[a-z][a-z0-9_]{1,30}_(dev|stg|prod)$/) : null;
  return match ? match[1] : null;
}

export function membershipPredicate(topology, slug, environment) {
  return topology === "dedicated"
    ? `public.launch_is_member('${slug}', '${environment}')`
    : `registry.is_member(auth.uid(), '${slug}', '${environment}')`;
}

/** Keep the block for this topology, drop the other one entirely. */
export function selectTopologyBlocks(template, topology) {
  let output = template;
  for (const name of ["shared", "dedicated"]) {
    const block = new RegExp(`[ \\t]*\\{\\{#${name}\\}\\}\\n([\\s\\S]*?)[ \\t]*\\{\\{/${name}\\}\\}\\n`, "g");
    output = output.replace(block, (_match, body) => (name === topology ? body : ""));
  }
  if (/\{\{[#/]/.test(output)) throw new Error("migration contains an unbalanced topology block");
  return output;
}

/**
 * Resolve every value the rendering needs and refuse anything that does not belong together.
 * `profile` is only consulted for values the caller did not state.
 */
export function resolveTarget(flags, profile = {}) {
  const topology = flags.topology ?? profile.topology ?? "shared";
  if (!["shared", "dedicated"].includes(topology)) throw new Error("topology must be shared or dedicated");
  const rawSlug = flags.slug ?? profile.slug ?? "";
  const slug = String(rawSlug).replaceAll("-", "_");
  if (!SLUG.test(slug)) throw new Error("slug must match ^[a-z][a-z0-9_]{1,30}$ (from --slug or project.profile.json)");
  const requestedEnvironment = flags.environment ?? null;
  const environment = requestedEnvironment
    ? environmentCode(requestedEnvironment)
    : environmentFromSchema(flags.schema) ?? environmentCode(process.env.APP_ENV ?? "");
  if (!environment) {
    throw new Error(requestedEnvironment
      ? `environment must be one of ${Object.keys(ENVIRONMENT_CODES).join(", ")}; received ${requestedEnvironment}`
      : "environment could not be derived from the schema; pass --environment <dev|stg|prod>");
  }
  const expectedSchema = topology === "dedicated" ? "public" : `app_${slug}_${environment}`;
  const schema = flags.schema ?? expectedSchema;
  if (schema !== expectedSchema) {
    throw new Error(topology === "dedicated"
      ? `dedicated migrations must target public; received ${schema}`
      : `schema must be ${expectedSchema} for ${environment}; received ${schema}`);
  }
  const expectedBucket = `${slug.replaceAll("_", "-")}-${environment}-private`;
  const bucket = flags.bucket ?? expectedBucket;
  if (bucket !== expectedBucket) throw new Error(`bucket must be ${expectedBucket} for ${environment}; received ${bucket}`);
  return { topology, slug, environment, schema, bucket };
}

export function renderMigration(template, target) {
  const rendered = selectTopologyBlocks(template, target.topology)
    .replaceAll("{{MEMBERSHIP_PREDICATE}}", membershipPredicate(target.topology, target.slug, target.environment))
    .replaceAll("{{APP_SLUG}}", target.slug)
    .replaceAll("{{APP_ENV}}", target.environment)
    .replaceAll("{{APP_SCHEMA}}", target.schema)
    .replaceAll("{{APP_BUCKET}}", target.bucket);
  const leftover = rendered.match(/\{\{[^}]*\}\}/);
  if (leftover) throw new Error(`migration contains unresolved placeholder ${leftover[0]}`);
  // R3-05: a rendering that does not pin and assert its own schema must never leave this script.
  if (!rendered.includes(`set local search_path = ${target.schema}, public;`)) throw new Error("rendered migration does not pin its target schema");
  if (!rendered.includes(`raise exception 'launch: this migration was rendered for schema ${target.schema}`)) throw new Error("rendered migration does not assert its target schema");
  if (target.topology === "dedicated" && rendered.includes("registry.is_member")) throw new Error("a dedicated rendering must not reference the control-plane registry");
  if (target.topology === "shared" && rendered.includes("create or replace function public.launch_is_member")) throw new Error("a shared rendering must not redefine the control-plane membership wrapper");
  return rendered;
}

async function readProfile() {
  if (!existsSync(profilePath)) return {};
  try {
    const profile = JSON.parse(await readFile(profilePath, "utf8"));
    return { slug: profile.slug ?? undefined, topology: profile.topology ?? undefined };
  } catch {
    throw new Error(`project.profile.json is not valid JSON (${profilePath})`);
  }
}

function usage(message) {
  return `Error: ${message}\nUsage: node ops/render-migration.mjs --slug <registry-slug> --environment <dev|stg|prod> --schema <schema> --bucket <bucket> [--topology shared|dedicated] [--output <file>]\n       node ops/render-migration.mjs --check [--environment <env>] --schema <schema>\n       node ops/render-migration.mjs --apply --environment <env> --schema <schema>`;
}

/**
 * Resolve the migration runner BEFORE anything is rendered to disk, so a misconfigured job leaves
 * no half-finished artifact behind and cannot look as if it had started applying.
 */
export function requireMigrationRunner(environment = process.env) {
  if (!environment.DATABASE_URL) {
    throw new Error("migration:apply requires DATABASE_URL for the target environment; nothing was applied");
  }
  return { command: environment.LAUNCH_PSQL ?? "psql", databaseUrl: environment.DATABASE_URL };
}

/**
 * R4S-10: process arguments are readable by every other process on the host for the lifetime of the
 * call, and a Postgres connection URI normally carries the password. The password is moved into
 * `PGPASSWORD`, which libpq reads, and the argument list keeps only the credential-free URI. A
 * value that is not a URL, or a URL without a password, is passed through unchanged.
 */
export function withoutPassword(databaseUrl) {
  let url;
  try { url = new URL(databaseUrl); } catch { return { argument: databaseUrl, env: {} }; }
  if (url.password === "") return { argument: databaseUrl, env: {} };
  const password = decodeURIComponent(url.password);
  url.password = "";
  return { argument: url.toString(), env: { PGPASSWORD: password } };
}

/** Hand the rendered file to the migration runner. Never claims success it did not observe. */
export function applyRendered(file, target, environment = process.env, run = spawnSync) {
  const { command, databaseUrl } = requireMigrationRunner(environment);
  const { argument, env } = withoutPassword(databaseUrl);
  const result = run(command, [argument, "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", file], { stdio: "inherit", env: { ...environment, ...env } });
  if (result.error) throw new Error(`migration:apply could not start ${command} (${result.error.message}); nothing was applied`);
  if (result.status !== 0) throw new Error(`migration:apply failed for schema ${target.schema} (${command} exited ${result.status})`);
  return { command, file, schema: target.schema };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const target = resolveTarget(flags, (flags.check || flags.apply) ? await readProfile() : { topology: flags.topology });
  const entries = await readdir(migrationDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9]{4}_[a-z0-9_]+\.sql$/.test(entry.name)) {
      throw new Error(`invalid migration file ${entry.name}`);
    }
  }
  const names = entries.map((entry) => entry.name).sort();
  if (!names.includes("0001_notes_and_private_storage.sql")) throw new Error("initial migration 0001 is required");
  const templates = await Promise.all(names.map((name) => readFile(join(migrationDirectory, name), "utf8")));
  // Validate the R3-05 pins on the whole set; the initial migration carries both pins.
  const rendered = renderMigration(templates.map((template) => selectTopologyBlocks(template, target.topology)).join("\n"), target);

  if (flags.check) {
    process.stdout.write(`migration:check ok - ${target.slug}/${target.environment} renders ${rendered.split("\n").length} lines pinned to schema ${target.schema} and bucket ${target.bucket}\n`);
    return;
  }
  if (flags.apply) {
    requireMigrationRunner();
    const outputDirectory = join(projectDir, "ops", ".rendered");
    await mkdir(outputDirectory, { recursive: true });
    const file = join(outputDirectory, `0001_${target.schema}.sql`);
    await writeFile(file, rendered);
    const applied = applyRendered(file, target);
    process.stdout.write(`migration:apply ok - ${applied.file} applied to ${applied.schema} via ${applied.command}\n`);
    return;
  }
  if (flags.output) {
    await mkdir(dirname(resolve(flags.output)), { recursive: true });
    await writeFile(flags.output, rendered);
  } else {
    process.stdout.write(rendered);
  }
}

// R8REL-01: this script decides FOR ITSELF, by real path, whether it was invoked as a script -
// there is no shared helper whose single return value could silence all six project ops scripts at
// once. It runs the required `migrations` gate (`migration:check`), so one shared `return false`
// used to make that gate a silent exit 0. Real paths, because a plain comparison of
// `import.meta.url` with `process.argv[1]` is false under a symlinked checkout (macOS /var ->
// /private/var). `ops/release/release-controls.test.mjs` runs it against an input it must refuse.
function invokedAsScript(moduleUrl) {
  const invoked = process.argv[1];
  if (typeof invoked !== "string" || invoked.length === 0) return false;
  const real = (value) => {
    try {
      return realpathSync(value);
    } catch {
      return value;
    }
  };
  return real(fileURLToPath(moduleUrl)) === real(invoked);
}

if (invokedAsScript(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(usage(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
