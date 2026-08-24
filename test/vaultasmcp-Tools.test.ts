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

describe("read_note tool surface", () => {
    it("declares pagination and metadata-only output fields in the tool schema", () => {
        const { tools } = makeTools({});
        const readNote = tools
            .getToolDefinitions()
            .find((tool) => tool.name === "read_note");

        expect(readNote).toBeDefined();
        if (!readNote) {
            throw new Error("read_note tool definition not found");
        }
        if (!readNote.outputSchema) {
            throw new Error("read_note outputSchema not found");
        }

        const inputProperties = readNote.inputSchema.properties as Record<
            string,
            { type?: string; description?: string }
        >;
        const outputProperties = readNote.outputSchema.properties as Record<
            string,
            { type?: string; description?: string }
        >;

        expect(inputProperties.lineLimit).toMatchObject({
            type: "number",
        });
        expect(inputProperties.heading?.description).toContain(
            "Cannot be combined with lineLimit",
        );
        expect(inputProperties.lineOffset?.description).toContain(
            "When heading is absent, start a whole-document read",
        );
        expect(outputProperties.startLine).toMatchObject({
            type: "number",
        });
        expect(outputProperties.endLine).toMatchObject({
            type: "number",
        });
        expect(outputProperties.totalLines).toMatchObject({
            type: "number",
        });
        expect(outputProperties.truncated).toMatchObject({
            type: "boolean",
        });
        expect(outputProperties.sizeBytes).toMatchObject({
            type: "number",
        });
    });

    it("passes lineLimit through executeTool for whole-document pagination", async () => {
        const { tools } = makeTools({
            "notes/doc.md": "# Intro\nalpha\n# Details\nbeta",
        });

        const result = await tools.executeTool("read_note", {
            path: "notes/doc.md",
            lineOffset: 2,
            lineLimit: 2,
        });

        expect(result).toMatchObject({
            content: "# Details\nbeta",
            startLine: 2,
            endLine: 3,
            totalLines: 4,
            truncated: false,
        });
    });

    it("returns sizeBytes for metadata-only reads through executeTool", async () => {
        const { tools } = makeTools({
            "notes/doc.md": "# Intro\nalpha\n# Details\nbeta",
        });

        const result = await tools.executeTool("read_note", {
            path: "notes/doc.md",
            metadataOnly: true,
        });

        expect(result.content).toBeUndefined();
        expect(typeof result.sizeBytes).toBe("number");
    });
});

describe("read_multiple_notes tool surface", () => {
    it("returns sizeBytes for metadata-only reads", async () => {
        const { tools } = makeTools({
            "notes/a.md": "# A\nalpha",
            "notes/b.md": "# B\nbeta",
        });

        const result = await tools.executeTool("read_multiple_notes", {
            paths: ["notes/a.md", "notes/b.md"],
            metadataOnly: true,
        });

        expect(result.notes["notes/a.md"].content).toBeUndefined();
        expect(result.notes["notes/b.md"].content).toBeUndefined();
        expect(typeof result.notes["notes/a.md"].sizeBytes).toBe("number");
        expect(typeof result.notes["notes/b.md"].sizeBytes).toBe("number");
    });
});

describe("patch_note tool surface", () => {
    it("exposes exact find/replace inputs with optional lineOffset", () => {
        const { tools } = makeTools({});
        const patchNote = tools
            .getToolDefinitions()
            .find((tool) => tool.name === "patch_note");

        expect(patchNote).toBeDefined();
        if (!patchNote) {
            throw new Error("patch_note tool definition not found");
        }

        const inputProperties = patchNote.inputSchema.properties as Record<
            string,
            { type?: string; description?: string }
        >;

        expect(inputProperties.path).toMatchObject({ type: "string" });
        expect(inputProperties.old_text).toMatchObject({ type: "string" });
        expect(inputProperties.new_text).toMatchObject({ type: "string" });
        expect(inputProperties.lineOffset).toMatchObject({ type: "number" });
        expect(inputProperties.heading).toBeUndefined();
        expect(inputProperties.lineOffset?.description).toContain(
            "0-based file line",
        );
        expect(patchNote.inputSchema.required).toEqual([
            "path",
            "old_text",
            "new_text",
        ]);
    });
});

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
