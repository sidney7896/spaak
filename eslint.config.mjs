import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Spaak (route D trial, 05-10): eslint-config-next pulls braces <=3.0.3 through @next/eslint-plugin-next
// (GHSA-vfj7-8cjw-p6xm, high, no fixed release), which the required dependency gate refuses, and the starter pins
// pnpm-workspace.yaml, so the advisory cannot be ignored here. Until the starter carries a reviewed exception, this
// project lints with the TypeScript rules and the classic React hooks rules that eslint-config-next also applies.
export default defineConfig([
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // the same levels eslint-config-next/typescript sets
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
    },
  },
  globalIgnores([".next/**", "node_modules/**"]),
]);
