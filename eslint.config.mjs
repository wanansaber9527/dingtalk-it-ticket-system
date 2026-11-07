import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({ baseDirectory: path.dirname(fileURLToPath(import.meta.url)) });
export default [
  { ignores: [".next*/**", "node_modules/**", "ticket-correction-console/**", ".local-dev/**", "output/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // VM 测试替身模拟动态模块边界；应用源码仍执行严格类型检查。
  { files: ["tests/**/*.ts"], rules: { "@typescript-eslint/no-explicit-any": "off", "@next/next/no-assign-module-variable": "off" } },
  { files: ["scripts/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  }
];
