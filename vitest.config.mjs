import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            obsidian: "obsidian-test-mocks/obsidian",
        },
    },
    test: {
        include: ["test/**/*.test.ts"],
        environment: "happy-dom",
        setupFiles: ["obsidian-test-mocks/vitest-setup"],
    },
});
