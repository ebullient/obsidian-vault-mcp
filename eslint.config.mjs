// eslint.config.mjs
import globals from "globals";
import tsparser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
    ...obsidianmd.configs.recommended,
    globalIgnores([
        "tests/",
        "package.json"
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
                    brands: ["Open WebUI"],
                    acronyms: ["VMCP", "MCP", "URL"],
                    enforceCamelCaseLower: true,
                },
            ],
        },
    },
    {
        // Config files - no type checking, just basic linting
        files: ["**/*.mjs"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.node,
                console: "readonly",
                URL: "readonly",
            }
        },
    },
]);
