import type { CachedMetadata } from "obsidian";
import { App } from "obsidian";
import type { MetadataCache } from "obsidian-test-mocks/obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentSettings, Logger } from "../src/@types/settings.js";
import { momentFn } from "../src/vaultasmcp-moment.js";
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

// Search matches on heading name and never slices content by position, so
// unlike NoteHandler's makeCache, no character offsets are needed here.
type SearchHeading = { text: string; level: number };
type SearchFixture = {
    headings?: SearchHeading[];
    frontmatter?: Record<string, unknown>;
    tags?: string[];
};

// Seeds the metadata cache for a set of fixture notes so search_notes'
// heading, frontmatter, and tag filters have something to match against.
function seedSearchCache(
    app: App,
    fixtures: Record<string, SearchFixture>,
): void {
    const mc = app.metadataCache as unknown as MetadataCache;
    for (const [path, fixture] of Object.entries(fixtures)) {
        const cache: CachedMetadata = {};
        if (fixture.headings) {
            cache.headings = fixture.headings.map((h) => ({
                heading: h.text,
                level: h.level,
                position: {
                    start: { offset: 0, line: 0, col: 0 },
                    end: { offset: 0, line: 0, col: 0 },
                },
            }));
        }
        if (fixture.frontmatter) {
            cache.frontmatter = fixture.frontmatter;
        }
        if (fixture.tags) {
            cache.tags = fixture.tags.map((tag) => ({
                tag,
                position: {
                    start: { offset: 0, line: 0, col: 0 },
                    end: { offset: 0, line: 0, col: 0 },
                },
            }));
        }
        mc.setCache__(path, cache);
    }
}

// Removes a note's cache entry so getFileCache returns null, modelling a
// note Obsidian has not indexed. Files created through the vault mock are
// parsed into the cache automatically, so "unreadable" must be explicit.
function clearSearchCache(app: App, ...paths: string[]): void {
    const mc = app.metadataCache as unknown as MetadataCache;
    for (const path of paths) {
        mc.cache__.delete(path);
    }
}

describe("search_notes cache seeding", () => {
    it("makes a seeded note's cache visible through the app mock", () => {
        const { app } = makeTools({ "notes/a.md": "# Intro\nhello" });
        seedSearchCache(app, {
            "notes/a.md": {
                headings: [{ text: "Intro", level: 1 }],
                frontmatter: { status: "active" },
                tags: ["project"],
            },
        });

        const file = app.asOriginalType__().vault.getFileByPath(
            "notes/a.md",
        );
        if (!file) {
            throw new Error("fixture file not found");
        }
        const cache = app.asOriginalType__().metadataCache.getFileCache(
            file,
        );

        expect(cache?.headings).toEqual([
            expect.objectContaining({ heading: "Intro", level: 1 }),
        ]);
        expect(cache?.frontmatter).toEqual({ status: "active" });
        expect(cache?.tags).toEqual([
            expect.objectContaining({ tag: "project" }),
        ]);
    });
});

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

describe("search_notes tool schema", () => {
    it("declares headings, anyHeadings, and withoutHeadings as string arrays", () => {
        const { tools } = makeTools({});
        const searchNotes = tools
            .getToolDefinitions()
            .find((tool) => tool.name === "search_notes");

        expect(searchNotes).toBeDefined();
        if (!searchNotes) {
            throw new Error("search_notes tool definition not found");
        }

        const inputProperties = searchNotes.inputSchema.properties as Record<
            string,
            { type?: string; items?: { type?: string } }
        >;

        for (const key of ["headings", "anyHeadings", "withoutHeadings"]) {
            expect(inputProperties[key]).toMatchObject({
                type: "array",
                items: { type: "string" },
            });
        }
    });

    it("removes the singular tag property and declares tags/anyTags/withoutTags with all/any/none descriptions", () => {
        const { tools } = makeTools({});
        const searchNotes = tools
            .getToolDefinitions()
            .find((tool) => tool.name === "search_notes");

        expect(searchNotes).toBeDefined();
        if (!searchNotes) {
            throw new Error("search_notes tool definition not found");
        }

        const inputProperties = searchNotes.inputSchema.properties as Record<
            string,
            { type?: string; items?: { type?: string }; description?: string }
        >;

        expect(inputProperties.tag).toBeUndefined();

        expect(inputProperties.tags).toMatchObject({
            type: "array",
            items: { type: "string" },
        });
        expect(inputProperties.tags?.description).toMatch(/ALL/);

        expect(inputProperties.anyTags).toMatchObject({
            type: "array",
            items: { type: "string" },
        });
        expect(inputProperties.anyTags?.description).toMatch(/ANY/);

        expect(inputProperties.withoutTags).toMatchObject({
            type: "array",
            items: { type: "string" },
        });
        expect(inputProperties.withoutTags?.description).toMatch(/NONE/);
    });
});

describe("search_notes heading predicates", () => {
    it("matches a parsed heading but not the same words only in prose", async () => {
        const { tools, app } = makeTools({
            "notes/a.md": "# Key Claims\nsome text",
            "notes/b.md": "# Intro\nKey Claims are discussed below",
        });
        seedSearchCache(app, {
            "notes/a.md": { headings: [{ text: "Key Claims", level: 1 }] },
            "notes/b.md": { headings: [{ text: "Intro", level: 1 }] },
        });

        const result = await tools.executeTool("search_notes", {
            headings: ["Key Claims"],
        });

        expect(result.notes).toEqual(["notes/a.md"]);
    });

    it("requires the complete heading name, not a similar one", async () => {
        const { tools, app } = makeTools({
            "notes/a.md": "# Key Claims",
            "notes/b.md": "# Key Claims Summary",
        });
        seedSearchCache(app, {
            "notes/a.md": { headings: [{ text: "Key Claims", level: 1 }] },
            "notes/b.md": {
                headings: [{ text: "Key Claims Summary", level: 1 }],
            },
        });

        const result = await tools.executeTool("search_notes", {
            headings: ["Key Claims"],
        });

        expect(result.notes).toEqual(["notes/a.md"]);
    });

    it("headings requires all listed headings (AND)", async () => {
        const { tools, app } = makeTools({
            "notes/both.md": "a",
            "notes/one.md": "b",
        });
        seedSearchCache(app, {
            "notes/both.md": {
                headings: [
                    { text: "Key Claims", level: 1 },
                    { text: "Sources", level: 1 },
                ],
            },
            "notes/one.md": {
                headings: [{ text: "Key Claims", level: 1 }],
            },
        });

        const result = await tools.executeTool("search_notes", {
            headings: ["Key Claims", "Sources"],
        });

        expect(result.notes).toEqual(["notes/both.md"]);
    });

    it("anyHeadings requires at least one listed heading (OR)", async () => {
        const { tools, app } = makeTools({
            "notes/a.md": "a",
            "notes/b.md": "b",
            "notes/c.md": "c",
        });
        seedSearchCache(app, {
            "notes/a.md": { headings: [{ text: "Key Claims", level: 1 }] },
            "notes/b.md": { headings: [{ text: "Sources", level: 1 }] },
            "notes/c.md": { headings: [{ text: "Unrelated", level: 1 }] },
        });

        const result = await tools.executeTool("search_notes", {
            anyHeadings: ["Key Claims", "Sources"],
        });

        expect(result.notes).toEqual(["notes/a.md", "notes/b.md"]);
    });

    it("headings and anyHeadings are unaffected by duplicate occurrences, in the note or the query", async () => {
        const { tools, app } = makeTools({ "notes/a.md": "a" });
        seedSearchCache(app, {
            "notes/a.md": {
                headings: [
                    { text: "Key Claims", level: 1 },
                    { text: "Key Claims", level: 2 },
                ],
            },
        });

        const viaHeadings = await tools.executeTool("search_notes", {
            headings: ["Key Claims", "Key Claims"],
        });
        const viaAnyHeadings = await tools.executeTool("search_notes", {
            anyHeadings: ["Key Claims", "Key Claims"],
        });

        expect(viaHeadings.notes).toEqual(["notes/a.md"]);
        expect(viaAnyHeadings.notes).toEqual(["notes/a.md"]);
    });

    it("withoutHeadings rejects any note containing a listed heading, including duplicates", async () => {
        const { tools, app } = makeTools({
            "notes/has-it.md": "a",
            "notes/has-it-twice.md": "b",
            "notes/lacks-it.md": "c",
        });
        seedSearchCache(app, {
            "notes/has-it.md": {
                headings: [{ text: "Draft", level: 1 }],
            },
            "notes/has-it-twice.md": {
                headings: [
                    { text: "Draft", level: 1 },
                    { text: "Draft", level: 2 },
                ],
            },
            "notes/lacks-it.md": {
                headings: [{ text: "Final", level: 1 }],
            },
        });

        const result = await tools.executeTool("search_notes", {
            withoutHeadings: ["Draft"],
        });

        expect(result.notes).toEqual(["notes/lacks-it.md"]);
    });

    it("is level-insensitive: ### satisfies the same as ##", async () => {
        const { tools, app } = makeTools({ "notes/a.md": "a" });
        seedSearchCache(app, {
            "notes/a.md": {
                headings: [{ text: "Key Claims", level: 3 }],
            },
        });

        const result = await tools.executeTool("search_notes", {
            headings: ["Key Claims"],
        });

        expect(result.notes).toEqual(["notes/a.md"]);
    });

    it("a note with unreadable metadata matches neither presence nor absence", async () => {
        const { tools, app } = makeTools({ "notes/unreadable.md": "a" });
        clearSearchCache(app, "notes/unreadable.md");

        const presence = await tools.executeTool("search_notes", {
            headings: ["Key Claims"],
        });
        const absence = await tools.executeTool("search_notes", {
            withoutHeadings: ["Key Claims"],
        });

        expect(presence.notes).toEqual([]);
        expect(absence.notes).toEqual([]);
    });

    it("a cached note with no headings key matches neither presence nor absence, distinct from the entirely-unavailable case", async () => {
        const { tools, app } = makeTools({ "notes/no-outline.md": "a" });
        // Cache exists (other fields are seeded) but headings is omitted,
        // unlike the entirely-unseeded case above.
        seedSearchCache(app, {
            "notes/no-outline.md": { frontmatter: { status: "active" } },
        });

        const presence = await tools.executeTool("search_notes", {
            headings: ["Key Claims"],
        });
        const absence = await tools.executeTool("search_notes", {
            withoutHeadings: ["Key Claims"],
        });

        expect(presence.notes).toEqual([]);
        expect(absence.notes).toEqual([]);
    });

    it("a cached note with an empty headings array is treated as having zero headings", async () => {
        const { tools, app } = makeTools({ "notes/empty-outline.md": "a" });
        seedSearchCache(app, {
            "notes/empty-outline.md": { headings: [] },
        });

        const presence = await tools.executeTool("search_notes", {
            headings: ["Key Claims"],
        });
        const absence = await tools.executeTool("search_notes", {
            withoutHeadings: ["Key Claims"],
        });

        expect(presence.notes).toEqual([]);
        expect(absence.notes).toEqual(["notes/empty-outline.md"]);
    });
});

describe("search_notes withoutFrontmatter", () => {
    it("matches a note where the listed key is absent", async () => {
        const { tools, app } = makeTools({
            "notes/absent.md": "a",
            "notes/present.md": "b",
        });
        seedSearchCache(app, {
            "notes/absent.md": { frontmatter: { other: "x" } },
            "notes/present.md": { frontmatter: { claims_verified: true } },
        });

        const result = await tools.executeTool("search_notes", {
            withoutFrontmatter: ["claims_verified"],
        });

        expect(result.notes).toEqual(["notes/absent.md"]);
    });

    it("does not match when the key is present with a null-like, empty, false, or zero value", async () => {
        const { tools, app } = makeTools({
            "notes/null.md": "a",
            "notes/empty.md": "b",
            "notes/false.md": "c",
            "notes/zero.md": "d",
        });
        seedSearchCache(app, {
            "notes/null.md": { frontmatter: { claims_verified: null } },
            "notes/empty.md": { frontmatter: { claims_verified: "" } },
            "notes/false.md": { frontmatter: { claims_verified: false } },
            "notes/zero.md": { frontmatter: { claims_verified: 0 } },
        });

        const result = await tools.executeTool("search_notes", {
            withoutFrontmatter: ["claims_verified"],
        });

        expect(result.notes).toEqual([]);
    });

    it("matches inherited Object keys that are not own frontmatter keys", async () => {
        const { tools, app } = makeTools({ "notes/a.md": "a" });
        seedSearchCache(app, {
            "notes/a.md": { frontmatter: { status: "active" } },
        });

        // `toString` and `constructor` exist on Object.prototype but are
        // not keys of this note's frontmatter, so the note matches.
        const result = await tools.executeTool("search_notes", {
            withoutFrontmatter: ["toString", "constructor"],
        });

        expect(result.notes).toEqual(["notes/a.md"]);
    });

    it("matches a note with no frontmatter block at all", async () => {
        const { tools, app } = makeTools({
            "notes/no-frontmatter.md": "a",
        });
        // Cache is seeded (so metadata is "readable") but has no
        // frontmatter key at all — distinct from an unseeded/unreadable
        // cache, which must not match.
        seedSearchCache(app, { "notes/no-frontmatter.md": { headings: [] } });

        const result = await tools.executeTool("search_notes", {
            withoutFrontmatter: ["claims_verified"],
        });

        expect(result.notes).toEqual(["notes/no-frontmatter.md"]);
    });

    it("does not match when metadata is unreadable (no cache entry at all)", async () => {
        const { tools, app } = makeTools({ "notes/unreadable.md": "a" });
        clearSearchCache(app, "notes/unreadable.md");

        const result = await tools.executeTool("search_notes", {
            withoutFrontmatter: ["claims_verified"],
        });

        expect(result.notes).toEqual([]);
    });

    it("composes with frontmatter equality on other keys", async () => {
        const { tools, app } = makeTools({
            "notes/eligible.md": "a",
            "notes/wrong-status.md": "b",
            "notes/already-verified.md": "c",
        });
        seedSearchCache(app, {
            "notes/eligible.md": { frontmatter: { status: "active" } },
            "notes/wrong-status.md": {
                frontmatter: { status: "archived" },
            },
            "notes/already-verified.md": {
                frontmatter: { status: "active", claims_verified: true },
            },
        });

        const result = await tools.executeTool("search_notes", {
            frontmatterValues: { status: "active" },
            withoutFrontmatter: ["claims_verified"],
        });

        expect(result.notes).toEqual(["notes/eligible.md"]);
    });

    it("contradictory predicates yield an empty result rather than broadening", async () => {
        const { tools, app } = makeTools({ "notes/a.md": "a" });
        seedSearchCache(app, {
            "notes/a.md": { frontmatter: { status: "active" } },
        });

        const result = await tools.executeTool("search_notes", {
            frontmatterValues: { status: "active" },
            withoutFrontmatter: ["status"],
        });

        expect(result.notes).toEqual([]);
    });

    it("expresses the motivating claims-lint eligibility query in one call", async () => {
        const { tools, app } = makeTools({
            "references/eligible.md": "# Key Claims\ncontent",
            "references/already-verified.md": "# Key Claims\ncontent",
            "references/no-heading.md": "# Intro\ncontent",
            "other/eligible-but-wrong-folder.md": "# Key Claims\ncontent",
        });
        seedSearchCache(app, {
            "references/eligible.md": {
                headings: [{ text: "Key Claims", level: 1 }],
            },
            "references/already-verified.md": {
                headings: [{ text: "Key Claims", level: 1 }],
                frontmatter: { claims_verified: true },
            },
            "references/no-heading.md": {
                headings: [{ text: "Intro", level: 1 }],
            },
            "other/eligible-but-wrong-folder.md": {
                headings: [{ text: "Key Claims", level: 1 }],
            },
        });

        const result = await tools.executeTool("search_notes", {
            folder: "references",
            headings: ["Key Claims"],
            withoutFrontmatter: ["claims_verified"],
        });

        expect(result.notes).toEqual(["references/eligible.md"]);
    });
});

describe("search_notes array filter validation", () => {
    const arrayFilters = [
        "headings",
        "anyHeadings",
        "withoutHeadings",
        "tags",
        "anyTags",
        "withoutTags",
        "withoutFrontmatter",
    ];

    for (const name of arrayFilters) {
        it(`rejects a bare string for ${name}`, async () => {
            const { tools } = makeTools({ "notes/a.md": "a" });

            await expect(
                tools.executeTool("search_notes", { [name]: "Key Claims" }),
            ).rejects.toThrow(`\`${name}\` must be an array of strings.`);
        });

        it(`rejects a non-string array entry for ${name}`, async () => {
            const { tools } = makeTools({ "notes/a.md": "a" });

            await expect(
                tools.executeTool("search_notes", { [name]: [42] }),
            ).rejects.toThrow(`\`${name}\` must be an array of strings.`);
        });

        it(`rejects an object for ${name} rather than skipping the filter`, async () => {
            const { tools } = makeTools({ "notes/a.md": "a" });

            // An object has no .length, so an unvalidated filter would
            // fall through and silently return a broader result set.
            await expect(
                tools.executeTool("search_notes", { [name]: { a: 1 } }),
            ).rejects.toThrow(`\`${name}\` must be an array of strings.`);
        });

        it(`accepts an omitted ${name}`, async () => {
            const { tools, app } = makeTools({ "notes/a.md": "a" });
            seedSearchCache(app, { "notes/a.md": { headings: [] } });

            const result = await tools.executeTool("search_notes", {
                [name]: undefined,
            });

            expect(result.notes).toEqual(["notes/a.md"]);
        });

        it(`accepts an empty array for ${name} as an omitted filter`, async () => {
            const { tools, app } = makeTools({ "notes/a.md": "a" });
            seedSearchCache(app, { "notes/a.md": { headings: [] } });

            const result = await tools.executeTool("search_notes", {
                [name]: [],
            });

            expect(result.notes).toEqual(["notes/a.md"]);
        });
    }
});

describe("search_notes filters (characterization, pre-enhanced-search)", () => {
    describe("folder", () => {
        it("matches by string prefix with no separator boundary", async () => {
            const { tools } = makeTools({
                "notes/a.md": "a",
                "notes-extra/b.md": "b",
                "other/c.md": "c",
            });

            const result = await tools.executeTool("search_notes", {
                folder: "notes",
            });

            // "notes-extra/b.md" matches too: folder is a raw string
            // prefix, not a path-segment boundary.
            expect(result.notes).toEqual([
                "notes-extra/b.md",
                "notes/a.md",
            ]);
        });
    });

    describe("frontmatterValues", () => {
        it("matches values case-insensitively", async () => {
            const { tools, app } = makeTools({
                "notes/a.md": "a",
                "notes/b.md": "b",
            });
            seedSearchCache(app, {
                "notes/a.md": { frontmatter: { status: "Active" } },
                "notes/b.md": { frontmatter: { status: "archived" } },
            });

            const result = await tools.executeTool("search_notes", {
                frontmatterValues: { status: "active" },
            });

            expect(result.notes).toEqual(["notes/a.md"]);
        });

        it("rejects a note when the key is missing, null, or an object", async () => {
            const { tools, app } = makeTools({
                "notes/missing.md": "a",
                "notes/null.md": "b",
                "notes/object.md": "c",
            });
            seedSearchCache(app, {
                "notes/missing.md": { frontmatter: { other: "x" } },
                "notes/null.md": { frontmatter: { status: null } },
                "notes/object.md": {
                    frontmatter: { status: { nested: true } },
                },
            });

            const result = await tools.executeTool("search_notes", {
                frontmatterValues: { status: "active" },
            });

            expect(result.notes).toEqual([]);
        });

        it("rejects every note when there is no frontmatter cache at all", async () => {
            const { tools } = makeTools({ "notes/a.md": "a" });

            const result = await tools.executeTool("search_notes", {
                frontmatterValues: { status: "active" },
            });

            expect(result.notes).toEqual([]);
        });

        it("rejects the removed key/value object shape", async () => {
            const { tools } = makeTools({ "notes/a.md": "a" });

            await expect(
                tools.executeTool("search_notes", {
                    frontmatter: { status: "active" },
                }),
            ).rejects.toThrow(/array of keys/);
        });
    });

    describe("frontmatter presence", () => {
        it("requires ALL listed keys", async () => {
            const { tools, app } = makeTools({
                "notes/both.md": "a",
                "notes/one.md": "b",
                "notes/neither.md": "c",
            });
            seedSearchCache(app, {
                "notes/both.md": {
                    frontmatter: { status: "active", due: "2026-01-01" },
                },
                "notes/one.md": { frontmatter: { status: "active" } },
                "notes/neither.md": { frontmatter: { other: "x" } },
            });

            const result = await tools.executeTool("search_notes", {
                frontmatter: ["status", "due"],
            });

            expect(result.notes).toEqual(["notes/both.md"]);
        });

        it("counts null, empty, false, zero, list, and map values as present", async () => {
            const { tools, app } = makeTools({
                "notes/null.md": "a",
                "notes/empty.md": "b",
                "notes/false.md": "c",
                "notes/zero.md": "d",
                "notes/list.md": "e",
                "notes/map.md": "f",
            });
            seedSearchCache(app, {
                "notes/null.md": { frontmatter: { status: null } },
                "notes/empty.md": { frontmatter: { status: "" } },
                "notes/false.md": { frontmatter: { status: false } },
                "notes/zero.md": { frontmatter: { status: 0 } },
                "notes/list.md": { frontmatter: { status: ["a", "b"] } },
                "notes/map.md": { frontmatter: { status: { nested: true } } },
            });

            const result = await tools.executeTool("search_notes", {
                frontmatter: ["status"],
            });

            expect(result.notes).toEqual([
                "notes/empty.md",
                "notes/false.md",
                "notes/list.md",
                "notes/map.md",
                "notes/null.md",
                "notes/zero.md",
            ]);
        });

        it("does not treat inherited keys as present", async () => {
            const { tools, app } = makeTools({ "notes/a.md": "a" });
            seedSearchCache(app, {
                "notes/a.md": { frontmatter: { status: "active" } },
            });

            const result = await tools.executeTool("search_notes", {
                frontmatter: ["toString"],
            });

            expect(result.notes).toEqual([]);
        });

        it("rejects notes with no frontmatter cache at all", async () => {
            const { tools } = makeTools({ "notes/a.md": "a" });

            const result = await tools.executeTool("search_notes", {
                frontmatter: ["status"],
            });

            expect(result.notes).toEqual([]);
        });

        it("anyFrontmatter requires at least one listed key", async () => {
            const { tools, app } = makeTools({
                "notes/status.md": "a",
                "notes/due.md": "b",
                "notes/neither.md": "c",
            });
            seedSearchCache(app, {
                "notes/status.md": { frontmatter: { status: "active" } },
                "notes/due.md": { frontmatter: { due: "2026-01-01" } },
                "notes/neither.md": { frontmatter: { other: "x" } },
            });

            const result = await tools.executeTool("search_notes", {
                anyFrontmatter: ["status", "due"],
            });

            expect(result.notes).toEqual(["notes/due.md", "notes/status.md"]);
        });

        it("combines presence with frontmatterValues", async () => {
            const { tools, app } = makeTools({
                "notes/match.md": "a",
                "notes/wrong-status.md": "b",
                "notes/no-due.md": "c",
            });
            seedSearchCache(app, {
                "notes/match.md": {
                    frontmatter: { status: "active", due: "2026-01-01" },
                },
                "notes/wrong-status.md": {
                    frontmatter: { status: "archived", due: "2026-01-01" },
                },
                "notes/no-due.md": { frontmatter: { status: "active" } },
            });

            const result = await tools.executeTool("search_notes", {
                frontmatter: ["due"],
                frontmatterValues: { status: "active" },
            });

            expect(result.notes).toEqual(["notes/match.md"]);
        });
    });

    describe("mtime", () => {
        it("is inclusive and compares at day precision", async () => {
            const { tools, app } = makeTools({
                "notes/on-boundary.md": "a",
                "notes/after-boundary.md": "b",
                "notes/before-window.md": "c",
            });
            const original = app.asOriginalType__();
            const onBoundary = original.vault.getFileByPath(
                "notes/on-boundary.md",
            );
            const afterBoundary = original.vault.getFileByPath(
                "notes/after-boundary.md",
            );
            const beforeWindow = original.vault.getFileByPath(
                "notes/before-window.md",
            );
            if (!onBoundary || !afterBoundary || !beforeWindow) {
                throw new Error("fixture file not found");
            }
            // Comparisons use moment's local-time day boundaries, so these
            // timestamps are expressed as local-time moments (via
            // momentFn(...).valueOf()) rather than fixed UTC instants, to
            // stay unambiguous regardless of the test runner's timezone.
            onBoundary.stat.mtime = momentFn("2026-04-25T23:00:00")
                .valueOf();
            afterBoundary.stat.mtime = momentFn("2026-04-26T00:00:01")
                .valueOf();
            beforeWindow.stat.mtime = momentFn("2026-04-01T00:00:00")
                .valueOf();

            const result = await tools.executeTool("search_notes", {
                mtime: { before: "2026-04-25", after: "2026-04-20" },
            });

            expect(result.notes).toEqual(["notes/on-boundary.md"]);
        });
    });

    describe("text", () => {
        it("requires quoted phrases as exact substrings and words in any order", async () => {
            const { tools } = makeTools({
                "notes/match.md": "the action items from the meeting",
                "notes/wrong-phrase.md": "items and actions from the meeting",
                "notes/missing-word.md": "action items from last week",
            });

            const result = await tools.executeTool("search_notes", {
                text: 'meeting "action items"',
            });

            expect(result.notes).toEqual(["notes/match.md"]);
        });
    });

    // Phase 4 deliberately inverted tags from OR to AND and removed the
    // singular tag parameter entirely. This block replaces the prior
    // characterization of that contract (which asserted tag as a single
    // AND filter and tags as OR) with the revised all/any/none contract,
    // so the change reads as intentional rather than as a regression.
    describe("tags / anyTags / withoutTags", () => {
        it("tags requires all listed tags (AND)", async () => {
            const { tools, app } = makeTools({
                "notes/both.md": "a",
                "notes/one.md": "b",
            });
            seedSearchCache(app, {
                "notes/both.md": { tags: ["project", "personal"] },
                "notes/one.md": { tags: ["project"] },
            });

            const result = await tools.executeTool("search_notes", {
                tags: ["project", "personal"],
            });

            expect(result.notes).toEqual(["notes/both.md"]);
        });

        it("anyTags requires at least one listed tag (OR)", async () => {
            const { tools, app } = makeTools({
                "notes/a.md": "a",
                "notes/b.md": "b",
                "notes/c.md": "c",
            });
            seedSearchCache(app, {
                "notes/a.md": { tags: ["project"] },
                "notes/b.md": { tags: ["personal"] },
                "notes/c.md": { tags: ["archive"] },
            });

            const result = await tools.executeTool("search_notes", {
                anyTags: ["project", "personal"],
            });

            expect(result.notes).toEqual(["notes/a.md", "notes/b.md"]);
        });

        it("withoutTags rejects notes containing any listed tag", async () => {
            const { tools, app } = makeTools({
                "notes/has-it.md": "a",
                "notes/lacks-it.md": "b",
            });
            seedSearchCache(app, {
                "notes/has-it.md": { tags: ["draft"] },
                "notes/lacks-it.md": { tags: ["final"] },
            });

            const result = await tools.executeTool("search_notes", {
                withoutTags: ["draft"],
            });

            expect(result.notes).toEqual(["notes/lacks-it.md"]);
        });

        it("a supplied tag is rejected with an error naming tags and anyTags, rather than being ignored", async () => {
            const { tools } = makeTools({ "notes/a.md": "a" });

            await expect(
                tools.executeTool("search_notes", { tag: "project" }),
            ).rejects.toThrow(/tags.*anyTags|anyTags.*tags/);
        });

        it("tag filters compose with heading predicates", async () => {
            const { tools, app } = makeTools({
                "notes/eligible.md": "a",
                "notes/wrong-tag.md": "b",
                "notes/no-heading.md": "c",
            });
            seedSearchCache(app, {
                "notes/eligible.md": {
                    headings: [{ text: "Key Claims", level: 1 }],
                    tags: ["project"],
                },
                "notes/wrong-tag.md": {
                    headings: [{ text: "Key Claims", level: 1 }],
                    tags: ["personal"],
                },
                "notes/no-heading.md": {
                    headings: [{ text: "Intro", level: 1 }],
                    tags: ["project"],
                },
            });

            const result = await tools.executeTool("search_notes", {
                headings: ["Key Claims"],
                tags: ["project"],
            });

            expect(result.notes).toEqual(["notes/eligible.md"]);
        });

        it("tag filters compose with frontmatter equality predicates", async () => {
            const { tools, app } = makeTools({
                "notes/eligible.md": "a",
                "notes/wrong-tag.md": "b",
                "notes/wrong-status.md": "c",
            });
            seedSearchCache(app, {
                "notes/eligible.md": {
                    frontmatter: { status: "active" },
                    tags: ["project"],
                },
                "notes/wrong-tag.md": {
                    frontmatter: { status: "active" },
                    tags: ["personal"],
                },
                "notes/wrong-status.md": {
                    frontmatter: { status: "archived" },
                    tags: ["project"],
                },
            });

            const result = await tools.executeTool("search_notes", {
                frontmatterValues: { status: "active" },
                tags: ["project"],
            });

            expect(result.notes).toEqual(["notes/eligible.md"]);
        });

        it("withoutTags does not false-positive on unreadable metadata", async () => {
            const { tools, app } = makeTools({ "notes/unreadable.md": "a" });
            clearSearchCache(app, "notes/unreadable.md");

            const result = await tools.executeTool("search_notes", {
                withoutTags: ["draft"],
            });

            expect(result.notes).toEqual([]);
        });

        it("the same tag in tags and withoutTags is a contradictory predicate yielding no matches", async () => {
            const { tools, app } = makeTools({ "notes/a.md": "a" });
            seedSearchCache(app, {
                "notes/a.md": { tags: ["project"] },
            });

            const result = await tools.executeTool("search_notes", {
                tags: ["project"],
                withoutTags: ["project"],
            });

            expect(result.notes).toEqual([]);
        });
    });

    describe("sort and limit (vaultasmcp-Tools.ts:1123-1137)", () => {
        it("caps sort:recent at min(limit, 50)", async () => {
            const { tools, app } = makeTools({
                "notes/a.md": "a",
                "notes/b.md": "b",
                "notes/c.md": "c",
            });
            const original = app.asOriginalType__();
            const files = ["a", "b", "c"].map((n) => {
                const f = original.vault.getFileByPath(`notes/${n}.md`);
                if (!f) throw new Error("fixture file not found");
                return f;
            });
            files[0].stat.mtime = 1000;
            files[1].stat.mtime = 2000;
            files[2].stat.mtime = 3000;

            const result = await tools.executeTool("search_notes", {
                sort: "recent",
                limit: 2,
            });

            expect(result.notes).toEqual(["notes/c.md", "notes/b.md"]);
        });

        it("defaults sort:recent's limit to 20 when omitted", async () => {
            const files: Record<string, string> = {};
            for (let i = 0; i < 25; i++) {
                files[`notes/n${i}.md`] = "x";
            }
            const { tools } = makeTools(files);

            const result = await tools.executeTool("search_notes", {
                sort: "recent",
            });

            expect(result.notes).toHaveLength(20);
        });

        it("rejects limit when sort is omitted rather than ignoring it", async () => {
            const files: Record<string, string> = {};
            for (let i = 0; i < 55; i++) {
                files[`notes/n${i}.md`] = "x";
            }
            const { tools } = makeTools(files);

            await expect(
                tools.executeTool("search_notes", { limit: 2 }),
            ).rejects.toThrow(/`limit` requires `sort: "recent"`/);
        });

        it("rejects limit when sort is 'alpha'", async () => {
            const { tools } = makeTools({ "notes/a.md": "x" });

            await expect(
                tools.executeTool("search_notes", {
                    sort: "alpha",
                    limit: 2,
                }),
            ).rejects.toThrow(/`limit` requires `sort: "recent"`/);
        });
    });
});

describe("search_notes result size", () => {
    it("a structural search matching more notes than any default cap returns all of them, uncapped", async () => {
        const files: Record<string, string> = {};
        for (let i = 0; i < 60; i++) {
            files[`notes/n${i}.md`] = "a";
        }
        const { tools, app } = makeTools(files);
        const fixtures: Record<string, { headings: SearchHeading[] }> = {};
        for (let i = 0; i < 60; i++) {
            fixtures[`notes/n${i}.md`] = {
                headings: [{ text: "Key Claims", level: 1 }],
            };
        }
        seedSearchCache(app, fixtures);

        const result = await tools.executeTool("search_notes", {
            headings: ["Key Claims"],
        });

        expect(result.notes).toHaveLength(60);
    });

    it("sort: recent still slices a structural search's results, unlike the default uncapped path", async () => {
        const files: Record<string, string> = {};
        for (let i = 0; i < 10; i++) {
            files[`notes/n${i}.md`] = "a";
        }
        const { tools, app } = makeTools(files);
        const fixtures: Record<string, { headings: SearchHeading[] }> = {};
        for (let i = 0; i < 10; i++) {
            fixtures[`notes/n${i}.md`] = {
                headings: [{ text: "Key Claims", level: 1 }],
            };
        }
        seedSearchCache(app, fixtures);

        const result = await tools.executeTool("search_notes", {
            headings: ["Key Claims"],
            sort: "recent",
            limit: 3,
        });

        expect(result.notes).toHaveLength(3);
    });

    it("the output shape carries only notes, with no cursor, count, or truncation field", async () => {
        const { tools } = makeTools({ "notes/a.md": "a" });

        const result = await tools.executeTool("search_notes", {});

        expect(Object.keys(result)).toEqual(["notes"]);
    });
});
