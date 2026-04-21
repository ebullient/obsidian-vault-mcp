// eslint.config.mjs
import globals from "globals";
import tsparser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
    ...obsidianmd.configs.recommended,
    globalIgnores([
        "tests/",
        "package.json",
        "*.mjs",
    ]),
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
