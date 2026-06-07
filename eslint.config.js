import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["commitlint.config.cjs", "eslint.config.js", "dist/**", "coverage/**", "node_modules/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error"
    }
  },
  {
    files: ["*.cjs", "*.js"],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      "no-undef": "off"
    }
  }
];
