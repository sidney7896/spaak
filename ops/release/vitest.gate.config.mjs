// THE ONLY VITEST CONFIGURATION A GATE EVER USES (D-025, R9REL-02).
//
// This file is copied BYTE-IDENTICALLY to starter/ci/ops-release/vitest.gate.config.mjs and
// delivered into every generated project as `ops/release/vitest.gate.config.mjs`.
//
// Every test gate is run as `vitest run <paths> --config ops/release/vitest.gate.config.mjs` by
// `ops/release/run-gate.mjs`, so vitest never discovers a configuration file of its own. That is
// the point: the ninth review added one `vitest.config.js` with `passWithNoTests: true` to a real
// generated project and made `ci-release-controls` green with zero tests executed - the self-test
// that exists to catch a neutered control was the very file the config excluded - and made six
// required gates vacuous, with every delivered control still reporting success.
//
// It is pinned by digest in `ops/release/gates.json`, and `run-gate.mjs` additionally refuses to
// run any test gate unless this file forbids `passWithNoTests` in so many words. The count of tests
// the run actually collected is compared with the minimum the declaration pins, so a green gate
// proves EXECUTION and not merely the existence of a file.
//
// It deliberately narrows nothing: no `include`, no `exclude`, no `root`. The gate names the
// directories it runs on the command line, and nothing in the repository may take them away again.
export default {
  test: {
    passWithNoTests: false,
  },
};
