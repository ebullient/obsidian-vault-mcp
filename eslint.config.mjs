// eslint.config.mjs
import globals from "globals";
import tsparser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
    ...obsidianmd.configs.recommended,
    globalIgnores([
        "test/",
        "vitest.config.ts",
        "package.json",
        "*.mjs",
    ]),
    {
        files: ["bridge-src/**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                project: "./tsconfig.bridge.json"
            },
            globals: {
                ...globals.node,
            },
        },
        rules: {
            "obsidianmd/prefer-active-window-timers": "off",
            "obsidianmd/no-nodejs-modules": "off",
        },
    },
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                project: "./tsconfig.json"
            },
            globals: {
                ...globals.node,
                window: "readonly",
            },
        },
        // Optional project overrides
        rules: {
            "obsidianmd/ui/sentence-case": [
                "warn",
                {
                    brands: ["Open WebUI", "notes/**\ndrafts/**", "archive/**\ntemplates/**", "private/**\nsecrets.md"],
                    acronyms: ["VMCP", "MCP", "URL", "ACL"],
                    enforceCamelCaseLower: true,
                },
            ],
        },
    },
]);
