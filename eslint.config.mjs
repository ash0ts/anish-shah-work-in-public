import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["vendor/braces-bounded/**/*.js"],
    // Preserve the licensed upstream CommonJS package's module format.
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    // Local Worker state, archived candidates, and browser output are generated.
    ".wrangler/**",
    ".playwright/**",
    "playwright-report/**",
    "test-results/**",
    "dist/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
