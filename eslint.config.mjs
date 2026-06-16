// eslint.config.mjs
import globals from "globals";
import tsparser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
    globalIgnores([
        ".claude/",
        "bridge/",
        "build/",
        "test/",
        "vitest.config.ts",
        "package.json",
        "*.mjs",
    ]),
    ...obsidianmd.configs.recommended,
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                project: "./tsconfig.json",
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.node,
                window: "readonly",
            }
        },
        // Optional project overrides
        rules: {
            "obsidianmd/no-unsupported-api": "warn",
            "@typescript-eslint/no-deprecated": "warn",
            "obsidianmd/ui/sentence-case": [
                "warn",
                {
                    brands: ["Open WebUI", "notes/**\ndrafts/**", "archive/**\ntemplates/**", "private/**\nsecrets.md"],
                    acronyms: ["VMCP", "MCP", "URL", "ACL"],
                    enforceCamelCaseLower: true,
                }
            ]
        }
    }
]);
