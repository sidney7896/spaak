import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-plugin-react detects the React version through an API ESLint 10 removed; name it instead.
  { settings: { react: { version: "19.3" } } },
  globalIgnores([".next/**", "node_modules/**"]),
]);
