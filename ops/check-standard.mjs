#!/usr/bin/env node
// Operational readiness check against the Project Launch Standard (the `check:standard` script the
// canonical `operational_readiness` gate runs).
//
// Everything here is offline and structural: it proves that the generated project still carries the
// artifacts the standard requires and that they agree with one another. It proves nothing about a
// live provider, and it says so rather than implying otherwise.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SLUG = /^[a-z][a-z0-9_]{1,30}$/;
const ENVIRONMENTS = { dev: "dev", staging: "stg", production: "prod" };
const IDENTITY_SETTINGS = [
  "APP_ENV",
  "NEXT_PUBLIC_APP_ENV",
  "NEXT_PUBLIC_APP_URL",
  "SUPABASE_DB_SCHEMA",
  "NEXT_PUBLIC_SUPABASE_DB_SCHEMA",
  "SUPABASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET",
];
// A placeholder file must stay a placeholder file: these shapes are real credentials, not examples.
const CREDENTIAL_SHAPES = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /\bre_[A-Za-z0-9]{16,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

function scalar(value) {
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  const quoted = value.match(/^"(.*)"$/) ?? value.match(/^'(.*)'$/);
  return quoted ? quoted[1] : value;
}

/**
 * The manifest's own shape: nested mappings of scalars, with `{}`/`[]` flow values kept as text.
 * A line this cannot understand is an error, never a silently skipped key - the point of the check
 * is that the manifest still says what it is supposed to say. Deliberately dependency-free, like
 * the release helpers, so it also runs in a checkout without node_modules.
 */
export function parseManifest(text) {
  const root = {};
  const stack = [{ indent: -1, node: root }];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const match = raw.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (!match) throw new Error(`line not understood: ${raw.trim()}`);
    const indent = match[1].length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (match[3] === "") {
      const node = {};
      parent[match[2]] = node;
      stack.push({ indent, node });
    } else {
      parent[match[2]] = scalar(match[3]);
    }
  }
  return root;
}

function readJson(path, errors, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    errors.push(`${label}: missing or not valid JSON`);
    return null;
  }
}

/**
 * The script/test-directory contract lives in the release lane's own checker, which the generator
 * delivers to `ops/release/`. It is loaded at run time: the bare template does not carry it, and a
 * project that lost it must fail here rather than skip the check.
 */
async function releaseScriptErrors(root) {
  const checker = join(root, "ops", "release", "check-project-scripts.mjs");
  if (!existsSync(checker)) return ["ops/release/check-project-scripts.mjs: is missing, so the workflow-script contract cannot be checked"];
  try {
    const { checkProjectScripts } = await import(pathToFileURL(checker).href);
    return checkProjectScripts(root).errors;
  } catch (error) {
    return [`ops/release/check-project-scripts.mjs: could not be loaded (${error instanceof Error ? error.message : error})`];
  }
}

export async function checkStandard(rootDir = process.cwd()) {
  const root = resolve(rootDir);
  const errors = [];
  const at = (relative) => join(root, relative);

  const profile = readJson(at("project.profile.json"), errors, "project.profile.json");
  if (profile) {
    if (!SLUG.test(String(profile.slug ?? ""))) errors.push("project.profile.json: slug must match ^[a-z][a-z0-9_]{1,30}$ (an unconfigured template is not a project)");
    if (!["shared", "dedicated"].includes(profile.topology)) errors.push("project.profile.json: topology must be shared or dedicated");
    if (!["invite-only", "self-service"].includes(profile.signupMode)) errors.push("project.profile.json: signupMode must be invite-only or self-service");
    if (!profile.modules || typeof profile.modules !== "object") errors.push("project.profile.json: modules must be an object");
  }

  if (!existsSync(at("PROJECT_MANIFEST.yaml"))) {
    errors.push("PROJECT_MANIFEST.yaml: is missing");
  } else {
    let manifest = null;
    try { manifest = parseManifest(readFileSync(at("PROJECT_MANIFEST.yaml"), "utf8")); } catch (error) { errors.push(`PROJECT_MANIFEST.yaml: could not be read (${error instanceof Error ? error.message : error})`); }
    if (manifest && profile && SLUG.test(String(profile.slug ?? ""))) {
      if (manifest.project?.slug !== profile.slug) errors.push(`PROJECT_MANIFEST.yaml: project.slug is ${manifest.project?.slug} but project.profile.json says ${profile.slug}`);
      if (manifest.topology !== profile.topology) errors.push(`PROJECT_MANIFEST.yaml: topology is ${manifest.topology} but project.profile.json says ${profile.topology}`);
      for (const [environment, suffix] of Object.entries(ENVIRONMENTS)) {
        const expected = profile.topology === "dedicated" ? "public" : `app_${profile.slug}_${suffix}`;
        const actual = manifest.environments?.[environment]?.supabase_schema;
        if (actual !== expected) errors.push(`PROJECT_MANIFEST.yaml: environments.${environment}.supabase_schema must be ${expected}; found ${actual ?? "nothing"}`);
      }
    }
  }

  if (!existsSync(at(".env.example"))) {
    errors.push(".env.example: is missing");
  } else {
    const envExample = readFileSync(at(".env.example"), "utf8");
    for (const name of IDENTITY_SETTINGS) {
      if (!new RegExp(`^${name}=.+$`, "m").test(envExample)) errors.push(`.env.example: missing the ${name} setting`);
    }
    if (!/^# Schema map:/m.test(envExample)) errors.push(".env.example: missing the schema map comment");
    for (const shape of CREDENTIAL_SHAPES) {
      if (shape.test(envExample)) { errors.push(".env.example: contains something shaped like a real credential; it must hold placeholders only"); break; }
    }
  }

  // R5S-03: R4S-02 was closed by delivering a lockfile, but nothing then noticed it going away.
  // Every job of both canonical workflows starts at `pnpm install --frozen-lockfile`, and
  // `ops/release/record-candidate.mjs` folds the lockfile hash into the release identity - so a
  // project that gitignored or deleted it is back at `ERR_PNPM_NO_LOCKFILE` in every job, with no
  // offline gate and no document naming the cause. This is that gate.
  if (!existsSync(at("pnpm-lock.yaml"))) {
    errors.push("pnpm-lock.yaml: is missing; every job of both canonical workflows starts with pnpm install --frozen-lockfile and the release identity hashes this file, so it must stay committed");
  }

  const workflowDirectory = at(join(".github", "workflows"));
  if (!existsSync(workflowDirectory)) {
    errors.push(".github/workflows: directory is missing");
  } else {
    const present = readdirSync(workflowDirectory).sort();
    if (present.join(",") !== "ci.yml,release.yml") errors.push(`.github/workflows: must contain exactly the canonical ci.yml and release.yml; found ${present.join(", ") || "nothing"}`);
  }

  const migration = at(join("supabase", "migrations", "0001_notes_and_private_storage.sql"));
  if (!existsSync(migration)) {
    errors.push("supabase/migrations/0001_notes_and_private_storage.sql: is missing");
  } else {
    const sql = readFileSync(migration, "utf8");
    if (!sql.includes("set local search_path = {{APP_SCHEMA}}, public;")) errors.push("supabase/migrations/0001_notes_and_private_storage.sql: no longer pins the rendered target schema");
    if (!sql.includes("refusing to apply")) errors.push("supabase/migrations/0001_notes_and_private_storage.sql: no longer asserts the rendered target schema");
  }

  for (const directory of ["ops", "docs"]) {
    if (!(existsSync(at(directory)) && statSync(at(directory)).isDirectory())) errors.push(`${directory}/: directory is missing`);
  }

  errors.push(...(await releaseScriptErrors(root)));
  return { errors, root };
}

// R8REL-01: this script decides FOR ITSELF, by real path, whether it was invoked as a script -
// there is no shared helper whose single return value could silence all six project ops scripts at
// once. It runs the required `operational_readiness` gate (`check:standard`), so one shared
// `return false` used to make that gate a silent exit 0. Real paths, because a plain comparison of
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
  const positional = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  const result = await checkStandard(positional ? resolve(positional) : process.cwd());
  if (result.errors.length > 0) {
    for (const error of result.errors) process.stderr.write(`${error}\n`);
    process.stderr.write(`check:standard failed with ${result.errors.length} finding(s). This is a structural check; it is not evidence about any live provider.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("check:standard ok - manifest, profile, environment template, workflows, migration and release scripts agree (structural check only)\n");
  }
}
