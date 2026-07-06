import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/", "src-tauri/", "node_modules/"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Compiler-powered rules flag ~78 pre-existing render patterns.
      // The hot paths (streaming chat, theme observer, Monaco provider)
      // were fixed in the 8b render pass; the long tail (StructureView
      // static components etc.) is follow-up work — escalate to error
      // once the count reaches zero.
      "react-hooks/static-components": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Existing codebase uses `any` in IPC boundaries; tighten later.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
