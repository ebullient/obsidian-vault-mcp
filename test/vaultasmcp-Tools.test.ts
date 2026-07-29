import { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSettings, Logger } from "../src/@types/settings.js";
import { MCPTools } from "../src/vaultasmcp-Tools.js";

const logger: Logger = {
    debug: vi.fn(),
    warn: vi.fn(),
    warnAcl: vi.fn(),
    error: vi.fn(),
};

const openSettings: CurrentSettings = {
    pathACL: () => ({ forbidden: [], readOnly: [], writable: [] }),
    bearerToken: () => undefined,
    serverPort: () => 3000,
    serverHost: () => "localhost",
    serverVersion: () => "1",
    normalizeQuotes: () => true,
};

const dailyNotes = vi.hoisted(() => ({
    appHasDailyNotesPluginLoaded: vi.fn(() => true),
    appHasWeeklyNotesPluginLoaded: vi.fn(() => true),
    appHasMonthlyNotesPluginLoaded: vi.fn(() => true),
    appHasQuarterlyNotesPluginLoaded: vi.fn(() => true),
    appHasYearlyNotesPluginLoaded: vi.fn(() => true),
    createDailyNote: vi.fn(),
    createWeeklyNote: vi.fn(),
    createMonthlyNote: vi.fn(),
    createQuarterlyNote: vi.fn(),
    createYearlyNote: vi.fn(),
    getAllWeeklyNotes: vi.fn(() => ({})),
    getWeeklyNote: vi.fn(() => undefined),
    getPeriodicNoteSettings: vi.fn(() => ({
        format: "YYYY-MM-DD",
        folder: "",
    })),
}));

vi.mock("obsidian-daily-notes-interface", () => dailyNotes);

function makeTools(files: Record<string, string> = {}): {
    tools: MCPTools;
    app: App;
} {
    const app = App.createConfigured__({ files });
    const tools = new MCPTools(
        app.asOriginalType__(),
        logger,
        openSettings,
    );
    return { tools, app };
}

describe("readPeriodicNote", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dailyNotes.appHasDailyNotesPluginLoaded.mockReturnValue(true);
        dailyNotes.appHasWeeklyNotesPluginLoaded.mockReturnValue(true);
        dailyNotes.getPeriodicNoteSettings.mockReturnValue({
            format: "YYYY-MM-DD",
            folder: "",
        });
        dailyNotes.getAllWeeklyNotes.mockReturnValue({});
        dailyNotes.getWeeklyNote.mockReturnValue(undefined);
    });

    it("returns existing daily note content without creating", async () => {
        const { tools } = makeTools({ "2026-07-29.md": "hello" });

        const result = await tools.executeTool("read_periodic_note", {
            period: "daily",
            date: "2026-07-29",
        });

        expect(result).toMatchObject({
            path: "2026-07-29.md",
            content: "hello",
        });
        expect(dailyNotes.createDailyNote).not.toHaveBeenCalled();
    });

    it("returns only the path when the note is missing and create is falsy", async () => {
        const { tools } = makeTools({});

        const result = await tools.executeTool("read_periodic_note", {
            period: "daily",
            date: "2026-07-29",
        });

        expect(result).toEqual({ path: "2026-07-29.md" });
        expect(dailyNotes.createDailyNote).not.toHaveBeenCalled();
    });

    it("creates the note when missing and create is true", async () => {
        const { tools, app } = makeTools({});
        dailyNotes.createDailyNote.mockImplementation(async () => {
            return app.vault.createSync__(
                "2026-07-29.md",
                "created content",
            );
        });

        const result = await tools.executeTool("read_periodic_note", {
            period: "daily",
            date: "2026-07-29",
            create: true,
        });

        expect(result).toMatchObject({
            path: "2026-07-29.md",
            content: "created content",
        });
        expect(dailyNotes.createDailyNote).toHaveBeenCalledTimes(1);
    });

    it("falls back to path-only if creation returns undefined", async () => {
        const { tools } = makeTools({});
        dailyNotes.createDailyNote.mockResolvedValue(undefined);

        const result = await tools.executeTool("read_periodic_note", {
            period: "daily",
            date: "2026-07-29",
            create: true,
        });

        expect(result).toEqual({ path: "2026-07-29.md" });
    });

    it("uses getWeeklyNote for weekly granularity", async () => {
        const { tools, app } = makeTools({ "2026-W31.md": "week content" });
        const file = app.asOriginalType__().vault.getFileByPath(
            "2026-W31.md",
        );
        dailyNotes.getAllWeeklyNotes.mockReturnValue({ "2026-W31": file });
        dailyNotes.getWeeklyNote.mockReturnValue(file);

        const result = await tools.executeTool("read_periodic_note", {
            period: "weekly",
            date: "2026-07-29",
        });

        expect(result).toMatchObject({
            path: "2026-W31.md",
            content: "week content",
        });
    });

    it("throws when the period is invalid", async () => {
        const { tools } = makeTools({});

        await expect(
            tools.executeTool("read_periodic_note", {
                period: "bogus",
            }),
        ).rejects.toThrow("Invalid period type: bogus");
    });

    it("throws when the required plugin is not loaded", async () => {
        const { tools } = makeTools({});
        dailyNotes.appHasDailyNotesPluginLoaded.mockReturnValue(false);

        await expect(
            tools.executeTool("read_periodic_note", {
                period: "daily",
            }),
        ).rejects.toThrow(/Daily notes are not configured/);
    });
});
