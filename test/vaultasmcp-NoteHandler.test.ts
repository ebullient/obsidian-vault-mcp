import type { CachedMetadata } from "obsidian";
import { App } from "obsidian";
import type { MetadataCache } from "obsidian-test-mocks/obsidian";
import { describe, expect, it, vi } from "vitest";
import type { CurrentSettings, Logger } from "../src/@types/settings.js";
import { PathACLChecker } from "../src/vaultasmcp-PathACL.js";
import { NoteHandler } from "../src/vaultasmcp-NoteHandler.js";
import type { TemplateHandler } from "../src/vaultasmcp-TemplateHandler.js";

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

// Minimal stub — tests here don't exercise template creation
const templateHandler = {} as TemplateHandler;

function makeHandler(
    settings: CurrentSettings = openSettings,
    files: Record<string, string> = {},
): { handler: NoteHandler; app: App } {
    const app = App.createConfigured__({ files });
    const acl = new PathACLChecker(settings, logger);
    const handler = new NoteHandler(
        app.asOriginalType__(),
        templateHandler,
        acl,
        logger,
        settings,
    );
    return { handler, app };
}

type SectionDef = { type: string; start: number; end: number; line: number };
type HeadingDef = { text: string; level: number; start: number; end: number; line: number };

// Build a CachedMetadata object with real Obsidian-style offsets (end.offset
// is the inclusive index of the last character, which for a line is the \n).
function makeCache(
    headings: HeadingDef[],
    sections: SectionDef[],
): CachedMetadata {
    return {
        headings: headings.map((h) => ({
            heading: h.text,
            level: h.level,
            position: {
                start: { offset: h.start, line: h.line, col: 0 },
                end: { offset: h.end, line: h.line, col: h.end - h.start },
            },
        })),
        sections: sections.map((s) => ({
            type: s.type,
            id: undefined,
            position: {
                start: { offset: s.start, line: s.line, col: 0 },
                end: { offset: s.end, line: s.line, col: s.end - s.start },
            },
        })),
    };
}

function forbidden(patterns: string[]): CurrentSettings {
    return {
        ...openSettings,
        pathACL: () => ({ forbidden: patterns, readOnly: [], writable: [] }),
    };
}

function readOnly(patterns: string[]): CurrentSettings {
    return {
        ...openSettings,
        pathACL: () => ({ forbidden: [], readOnly: patterns, writable: [] }),
    };
}

describe("NoteHandler.readNote", () => {
    it("reads an existing note", async () => {
        const { handler } = makeHandler(openSettings, {
            "notes/hello.md": "# Hello\nworld",
        });
        const result = await handler.readNote("notes/hello.md");
        expect(result.content).toBe("# Hello\nworld");
    });

    it("throws for a missing note", async () => {
        const { handler } = makeHandler();
        await expect(
            handler.readNote("notes/missing.md"),
        ).rejects.toThrow("Note not found");
    });

    it("throws for a forbidden path", async () => {
        const { handler } = makeHandler(forbidden(["private/**"]), {
            "private/secret.md": "secret",
        });
        await expect(
            handler.readNote("private/secret.md"),
        ).rejects.toThrow("Access forbidden");
    });

    it("omits embeds/outline/frontmatter when there is no cache", async () => {
        const { handler } = makeHandler(openSettings, {
            "notes/plain.md": "just text",
        });
        const result = await handler.readNote("notes/plain.md");
        expect(result.content).toBe("just text");
        expect(result.embeds).toBeUndefined();
        expect(result.outline).toBeUndefined();
        expect(result.frontmatter).toBeUndefined();
    });

    it("includes outline when a section is not requested", async () => {
        const { handler, app } = makeHandler(openSettings, {
            "notes/doc.md": "# Intro\nhello\n# Details\nmore",
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/doc.md",
            makeCache(
                [
                    { text: "Intro", level: 1, start: 0, end: 8, line: 0 },
                    { text: "Details", level: 1, start: 14, end: 23, line: 2 },
                ],
                [],
            ),
        );
        const result = await handler.readNote("notes/doc.md");
        expect(result.outline).toEqual([
            { text: "Intro", level: 1, line: 0 },
            { text: "Details", level: 1, line: 2 },
        ]);
    });

    it("omits outline when a section is requested", async () => {
        const { handler, app } = makeHandler(openSettings, {
            "notes/doc.md": "# Intro\nhello\n# Details\nmore",
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/doc.md",
            makeCache(
                [
                    { text: "Intro", level: 1, start: 0, end: 8, line: 0 },
                    { text: "Details", level: 1, start: 14, end: 23, line: 2 },
                ],
                [],
            ),
        );
        const result = await handler.readNote("notes/doc.md", "Intro");
        expect(result.outline).toBeUndefined();
    });

    it("reports each duplicate-named heading's own line, not an occurrence index", async () => {
        const { handler, app } = makeHandler(openSettings, {
            "notes/doc.md": "# Notes\na\n# Intro\nb\n# Notes\nc",
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/doc.md",
            makeCache(
                [
                    { text: "Notes", level: 1, start: 0,  end: 7,  line: 0 },
                    { text: "Intro", level: 1, start: 10, end: 17, line: 2 },
                    { text: "Notes", level: 1, start: 20, end: 27, line: 4 },
                ],
                [],
            ),
        );
        const result = await handler.readNote("notes/doc.md");
        expect(result.outline).toEqual([
            { text: "Notes", level: 1, line: 0 },
            { text: "Intro", level: 1, line: 2 },
            { text: "Notes", level: 1, line: 4 },
        ]);
    });

    it("includes frontmatter when present", async () => {
        const { handler, app } = makeHandler(openSettings, {
            "notes/fm.md": "---\nstatus: active\n---\nbody",
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/fm.md",
            { frontmatter: { status: "active" } } as CachedMetadata,
        );
        const result = await handler.readNote("notes/fm.md");
        expect(result.frontmatter).toEqual({ status: "active" });
    });

    describe("embeds", () => {
        function makeEmbedsHandler() {
            const files = {
                "notes/main.md":
                    "main\n![[img.png]]\n![[note-b.md]]\n" +
                    "![[note-b.md#Section]]\n![[missing.md]]\n![[secret.md]]",
                "notes/img.png": "",
                "notes/note-b.md": "# Section\ncontent",
                "notes/secret.md": "secret content",
            };
            const settings: CurrentSettings = {
                ...openSettings,
                pathACL: () => ({
                    forbidden: ["notes/secret.md"],
                    readOnly: [],
                    writable: [],
                }),
            };
            const { handler, app } = makeHandler(settings, files);
            const mc = app.metadataCache as unknown as MetadataCache;

            mc.setCache__("notes/main.md", {
                embeds: [
                    {
                        link: "img.png",
                        displayText: "img.png",
                        original: "![[img.png]]",
                        position: {
                            start: { offset: 5, line: 1, col: 0 },
                            end: { offset: 17, line: 1, col: 12 },
                        },
                    },
                    {
                        link: "note-b.md",
                        displayText: "note-b.md",
                        original: "![[note-b.md]]",
                        position: {
                            start: { offset: 18, line: 2, col: 0 },
                            end: { offset: 33, line: 2, col: 15 },
                        },
                    },
                    {
                        link: "note-b.md#Section",
                        displayText: "note-b.md#Section",
                        original: "![[note-b.md#Section]]",
                        position: {
                            start: { offset: 34, line: 3, col: 0 },
                            end: { offset: 57, line: 3, col: 23 },
                        },
                    },
                    {
                        link: "missing.md",
                        displayText: "missing.md",
                        original: "![[missing.md]]",
                        position: {
                            start: { offset: 58, line: 4, col: 0 },
                            end: { offset: 74, line: 4, col: 16 },
                        },
                    },
                    {
                        link: "secret.md",
                        displayText: "secret.md",
                        original: "![[secret.md]]",
                        position: {
                            start: { offset: 75, line: 5, col: 0 },
                            end: { offset: 90, line: 5, col: 15 },
                        },
                    },
                ],
            } as CachedMetadata);

            return { handler, app };
        }

        it("lists resolved embeds, including non-markdown, with subpaths", async () => {
            const { handler } = makeEmbedsHandler();
            const result = await handler.readNote("notes/main.md");
            expect(result.embeds).toEqual([
                { path: "notes/img.png" },
                { path: "notes/note-b.md" },
                { path: "notes/note-b.md", subpath: "Section" },
            ]);
        });

        it("omits broken embeds", async () => {
            const { handler } = makeEmbedsHandler();
            const result = await handler.readNote("notes/main.md");
            expect(result.embeds).not.toContainEqual(
                expect.objectContaining({ path: expect.stringContaining("missing") }),
            );
        });

        it("omits embeds the caller lacks ACL read access to", async () => {
            const { handler } = makeEmbedsHandler();
            const result = await handler.readNote("notes/main.md");
            expect(result.embeds).not.toContainEqual(
                expect.objectContaining({ path: "notes/secret.md" }),
            );
        });
    });

    describe("links", () => {
        function makeLinksHandler() {
            const files = {
                "notes/main.md":
                    "main [[note-b.md]] [[note-b.md#Section]] " +
                    "[[missing.md]] [[secret.md]]",
                "notes/note-b.md": "# Section\ncontent",
                "notes/secret.md": "secret content",
            };
            const settings: CurrentSettings = {
                ...openSettings,
                pathACL: () => ({
                    forbidden: ["notes/secret.md"],
                    readOnly: [],
                    writable: [],
                }),
            };
            const { handler, app } = makeHandler(settings, files);
            const mc = app.metadataCache as unknown as MetadataCache;

            mc.setCache__("notes/main.md", {
                links: [
                    {
                        link: "note-b.md",
                        displayText: "note-b.md",
                        original: "[[note-b.md]]",
                        position: {
                            start: { offset: 5, line: 0, col: 5 },
                            end: { offset: 19, line: 0, col: 19 },
                        },
                    },
                    {
                        link: "note-b.md#Section",
                        displayText: "note-b.md#Section",
                        original: "[[note-b.md#Section]]",
                        position: {
                            start: { offset: 20, line: 0, col: 20 },
                            end: { offset: 42, line: 0, col: 42 },
                        },
                    },
                    {
                        link: "missing.md",
                        displayText: "missing.md",
                        original: "[[missing.md]]",
                        position: {
                            start: { offset: 43, line: 0, col: 43 },
                            end: { offset: 58, line: 0, col: 58 },
                        },
                    },
                    {
                        link: "secret.md",
                        displayText: "secret.md",
                        original: "[[secret.md]]",
                        position: {
                            start: { offset: 59, line: 0, col: 59 },
                            end: { offset: 73, line: 0, col: 73 },
                        },
                    },
                ],
            } as CachedMetadata);

            return { handler, app };
        }

        it("lists resolved links with subpaths", async () => {
            const { handler } = makeLinksHandler();
            const result = await handler.readNote("notes/main.md");
            expect(result.links).toEqual([
                { path: "notes/note-b.md" },
                { path: "notes/note-b.md", subpath: "Section" },
            ]);
        });

        it("omits broken links", async () => {
            const { handler } = makeLinksHandler();
            const result = await handler.readNote("notes/main.md");
            expect(result.links).not.toContainEqual(
                expect.objectContaining({ path: expect.stringContaining("missing") }),
            );
        });

        it("omits links the caller lacks ACL read access to", async () => {
            const { handler } = makeLinksHandler();
            const result = await handler.readNote("notes/main.md");
            expect(result.links).not.toContainEqual(
                expect.objectContaining({ path: "notes/secret.md" }),
            );
        });
    });

    describe("excludePatterns", () => {
        function makeExcludeHandler() {
            const files = {
                "notes/main.md":
                    "main ![[keep.md]] ![[skip.md]] [[keep-link.md]] " +
                    "[[skip-link.md]]",
                "notes/keep.md": "keep content",
                "notes/skip.md": "skip content",
                "notes/keep-link.md": "keep link content",
                "notes/skip-link.md": "skip link content",
            };
            const { handler, app } = makeHandler(openSettings, files);
            const mc = app.metadataCache as unknown as MetadataCache;

            mc.setCache__("notes/main.md", {
                embeds: [
                    {
                        link: "keep.md",
                        displayText: "keep.md",
                        original: "![[keep.md]]",
                        position: {
                            start: { offset: 5, line: 0, col: 5 },
                            end: { offset: 18, line: 0, col: 18 },
                        },
                    },
                    {
                        link: "skip.md",
                        displayText: "skip.md",
                        original: "![[skip.md]]",
                        position: {
                            start: { offset: 19, line: 0, col: 19 },
                            end: { offset: 32, line: 0, col: 32 },
                        },
                    },
                ],
                links: [
                    {
                        link: "keep-link.md",
                        displayText: "keep-link.md",
                        original: "[[keep-link.md]]",
                        position: {
                            start: { offset: 33, line: 0, col: 33 },
                            end: { offset: 50, line: 0, col: 50 },
                        },
                    },
                    {
                        link: "skip-link.md",
                        displayText: "skip-link.md",
                        original: "[[skip-link.md]]",
                        position: {
                            start: { offset: 51, line: 0, col: 51 },
                            end: { offset: 68, line: 0, col: 68 },
                        },
                    },
                ],
            } as CachedMetadata);

            return { handler, app };
        }

        it("excludes matching entries from embeds and links", async () => {
            const { handler } = makeExcludeHandler();
            const result = await handler.readNote(
                "notes/main.md",
                undefined,
                false,
                undefined,
                ["skip"],
            );
            expect(result.embeds).toEqual([{ path: "notes/keep.md" }]);
            expect(result.links).toEqual([{ path: "notes/keep-link.md" }]);
        });
    });

    describe("metadataOnly", () => {
        it("returns embeds/outline/frontmatter without content", async () => {
            const { handler, app } = makeHandler(openSettings, {
                "notes/doc.md": "# Intro\nhello",
            });
            const mc = app.metadataCache as unknown as MetadataCache;
            mc.setCache__("notes/doc.md", {
                ...makeCache(
                    [{ text: "Intro", level: 1, start: 0, end: 8, line: 0 }],
                    [],
                ),
                frontmatter: { status: "active" },
            } as CachedMetadata);

            const result = await handler.readNote(
                "notes/doc.md",
                undefined,
                true,
            );
            expect(result.content).toBeUndefined();
            expect(result.outline).toEqual([
                { text: "Intro", level: 1, line: 0 },
            ]);
            expect(result.frontmatter).toEqual({ status: "active" });
        });

        it("does not read file content when metadataOnly is true", async () => {
            const { handler, app } = makeHandler(openSettings, {
                "notes/doc.md": "hello",
            });
            const spy = vi.spyOn(app.vault, "cachedRead");
            await handler.readNote("notes/doc.md", undefined, true);
            expect(spy).not.toHaveBeenCalled();
        });

        it("ignores sections when metadataOnly is true", async () => {
            const { handler, app } = makeHandler(openSettings, {
                "notes/doc.md": "# Intro\nhello\n# Details\nmore",
            });
            (app.metadataCache as unknown as MetadataCache).setCache__(
                "notes/doc.md",
                makeCache(
                    [
                        { text: "Intro", level: 1, start: 0, end: 8, line: 0 },
                        { text: "Details", level: 1, start: 14, end: 23, line: 2 },
                    ],
                    [],
                ),
            );
            const result = await handler.readNote(
                "notes/doc.md",
                "Intro",
                true,
            );
            expect(result.outline).toEqual([
                { text: "Intro", level: 1, line: 0 },
                { text: "Details", level: 1, line: 2 },
            ]);
        });
    });
});

describe("NoteHandler.createNote", () => {
    it("creates a new note and auto-appends .md", async () => {
        const { handler } = makeHandler();
        const result = await handler.createNote("inbox/new", "initial content");
        expect(result.path).toBe("inbox/new.md");

        const readBack = await handler.readNote("inbox/new.md");
        expect(readBack.content).toBe("initial content");
    });

    it("throws when file already exists", async () => {
        const { handler } = makeHandler(openSettings, {
            "notes/existing.md": "already here",
        });
        await expect(
            handler.createNote("notes/existing.md", "new content"),
        ).rejects.toThrow("File already exists");
    });

    it("throws when path is read-only", async () => {
        const { handler } = makeHandler(readOnly(["templates/**"]));
        await expect(
            handler.createNote("templates/daily.md", "content"),
        ).rejects.toThrow("read-only");
    });
});

describe("NoteHandler.updateNote", () => {
    it("replaces note content", async () => {
        const { handler } = makeHandler(openSettings, {
            "notes/foo.md": "old content",
        });
        await handler.updateNote("notes/foo.md", "new content");
        const result = await handler.readNote("notes/foo.md");
        expect(result.content).toBe("new content");
    });

});

describe("NoteHandler.deleteNote", () => {
    it("removes the file from the vault", async () => {
        const { handler, app } = makeHandler(openSettings, {
            "notes/bye.md": "goodbye",
        });
        await handler.deleteNote("notes/bye.md");
        expect(app.vault.getFileByPath("notes/bye.md")).toBeNull();
    });

});

describe("NoteHandler.renameNote", () => {
    it("moves the file to the new path", async () => {
        const { handler, app } = makeHandler(openSettings, {
            "notes/old.md": "content",
        });
        const result = await handler.renameNote("notes/old.md", "notes/new.md");
        expect(result.path).toBe("notes/new.md");
        expect(app.vault.getFileByPath("notes/old.md")).toBeNull();
        expect(app.vault.getFileByPath("notes/new.md")).not.toBeNull();
    });

    it("auto-appends .md for markdown source", async () => {
        const { handler } = makeHandler(openSettings, {
            "notes/old.md": "content",
        });
        const result = await handler.renameNote("notes/old.md", "notes/new");
        expect(result.path).toBe("notes/new.md");
    });

    it("throws when destination already exists", async () => {
        const { handler } = makeHandler(openSettings, {
            "notes/a.md": "a",
            "notes/b.md": "b",
        });
        await expect(
            handler.renameNote("notes/a.md", "notes/b.md"),
        ).rejects.toThrow("File already exists");
    });

    it("throws when destination is read-only", async () => {
        const { handler } = makeHandler(readOnly(["archive/**"]), {
            "notes/a.md": "content",
        });
        await expect(
            handler.renameNote("notes/a.md", "archive/a.md"),
        ).rejects.toThrow("read-only");
    });
});

describe("NoteHandler.appendToNote", () => {
    it("appends content with default separator", async () => {
        const { handler } = makeHandler(openSettings, {
            "notes/log.md": "first",
        });
        await handler.appendToNote("notes/log.md", "second");
        const result = await handler.readNote("notes/log.md");
        expect(result.content).toBe("first\nsecond");
    });

    it("inserts content under a heading before the next heading", async () => {
        // "# Tasks\n- item 1\n# Notes\nsome note"
        //  0      7 8       16 17     24 25
        // end.offset is the \n (inclusive), matching real Obsidian behavior
        const content = "# Tasks\n- item 1\n# Notes\nsome note";
        const { handler, app } = makeHandler(openSettings, {
            "notes/log.md": content,
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/log.md",
            makeCache(
                [
                    { text: "Tasks", level: 1, start: 0,  end: 7,  line: 0 },
                    { text: "Notes", level: 1, start: 17, end: 24, line: 2 },
                ],
                [
                    { type: "heading",   start: 0,  end: 7,  line: 0 },
                    { type: "list",      start: 8,  end: 16, line: 1 },
                    { type: "heading",   start: 17, end: 24, line: 2 },
                    { type: "paragraph", start: 25, end: 33, line: 3 },
                ],
            ),
        );
        await handler.appendToNote("notes/log.md", "- item 2", "Tasks");
        const result = await handler.readNote("notes/log.md");
        expect(result.content).toBe(
            "# Tasks\n- item 1\n- item 2\n# Notes\nsome note",
        );
    });

    it("throws when heading is not found", async () => {
        // "# Tasks\n\n- item 1"
        //  0      7 8 9
        const content = "# Tasks\n\n- item 1";
        const { handler, app } = makeHandler(openSettings, {
            "notes/log.md": content,
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/log.md",
            makeCache(
                [{ text: "Tasks", level: 1, start: 0, end: 7, line: 0 }],
                [
                    { type: "heading",   start: 0, end: 7,  line: 0 },
                    { type: "list",      start: 9, end: 16, line: 2 },
                ],
            ),
        );
        await expect(
            handler.appendToNote("notes/log.md", "x", "Missing Heading"),
        ).rejects.toThrow("Heading not found");
    });

    it("matches heading text case-insensitively", async () => {
        // "# Tasks\n- item 1"
        //  0      7 8
        const content = "# Tasks\n- item 1";
        const { handler, app } = makeHandler(openSettings, {
            "notes/log.md": content,
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/log.md",
            makeCache(
                [{ text: "Tasks", level: 1, start: 0, end: 7, line: 0 }],
                [
                    { type: "heading", start: 0, end: 7,  line: 0 },
                    { type: "list",    start: 8, end: 16, line: 1 },
                ],
            ),
        );
        await handler.appendToNote("notes/log.md", "- item 2", "TASKS");
        const result = await handler.readNote("notes/log.md");
        expect(result.content).toBe("# Tasks\n- item 1\n- item 2");
    });

    it("stops at the next heading of any level, not level-aware", async () => {
        // "# Intro\nhello\n## Sub\nnested\n# Details\nworld"
        //  0      7 8    13 14 20 21   27 28    37 38
        const content = "# Intro\nhello\n## Sub\nnested\n# Details\nworld";
        const { handler, app } = makeHandler(openSettings, {
            "notes/doc.md": content,
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/doc.md",
            makeCache(
                [
                    { text: "Intro",   level: 1, start: 0,  end: 7,  line: 0 },
                    { text: "Sub",     level: 2, start: 14, end: 20, line: 2 },
                    { text: "Details", level: 1, start: 28, end: 37, line: 4 },
                ],
                [
                    { type: "heading",   start: 0,  end: 7,  line: 0 },
                    { type: "paragraph", start: 8,  end: 13, line: 1 },
                    { type: "heading",   start: 14, end: 20, line: 2 },
                    { type: "paragraph", start: 21, end: 27, line: 3 },
                    { type: "heading",   start: 28, end: 37, line: 4 },
                    { type: "paragraph", start: 38, end: 43, line: 5 },
                ],
            ),
        );
        await handler.appendToNote("notes/doc.md", "added", "Intro");
        const result = await handler.readNote("notes/doc.md");
        expect(result.content).toBe(
            "# Intro\nhello\nadded\n## Sub\nnested\n# Details\nworld",
        );
    });

    describe("with a duplicate heading", () => {
        // "# Notes\nfirst\n# Notes\nsecond"
        //  0      7 8    13 14    21 22
        const content = "# Notes\nfirst\n# Notes\nsecond";

        function makeDuplicateHandler() {
            const { handler, app } = makeHandler(openSettings, {
                "notes/log.md": content,
            });
            (app.metadataCache as unknown as MetadataCache).setCache__(
                "notes/log.md",
                makeCache(
                    [
                        { text: "Notes", level: 1, start: 0,  end: 7,  line: 0 },
                        { text: "Notes", level: 1, start: 14, end: 21, line: 2 },
                    ],
                    [
                        { type: "heading",   start: 0,  end: 7,  line: 0 },
                        { type: "paragraph", start: 8,  end: 13, line: 1 },
                        { type: "heading",   start: 14, end: 21, line: 2 },
                        { type: "paragraph", start: 22, end: 28, line: 3 },
                    ],
                ),
            );
            return handler;
        }

        it("throws when heading matches more than one occurrence", async () => {
            const handler = makeDuplicateHandler();
            await expect(
                handler.appendToNote("notes/log.md", "x", "Notes"),
            ).rejects.toThrow('Heading "Notes" is ambiguous (2 matches)');
        });

        it("names lineOffset in the ambiguity error", async () => {
            const handler = makeDuplicateHandler();
            await expect(
                handler.appendToNote("notes/log.md", "x", "Notes"),
            ).rejects.toThrow("pass lineOffset");
        });

        it("appends after the occurrence selected via lineOffset", async () => {
            const handler = makeDuplicateHandler();
            await handler.appendToNote(
                "notes/log.md",
                "added",
                "Notes",
                "\n",
                2,
            );
            const result = await handler.readNote("notes/log.md");
            expect(result.content).toBe(
                "# Notes\nfirst\n# Notes\nsecond\nadded",
            );
        });

        it("appends after the section selected via lineOffset alone", async () => {
            const handler = makeDuplicateHandler();
            await handler.appendToNote(
                "notes/log.md",
                "added",
                undefined,
                "\n",
                0,
            );
            const result = await handler.readNote("notes/log.md");
            expect(result.content).toBe(
                "# Notes\nfirst\nadded\n# Notes\nsecond",
            );
        });

        it("throws when no heading exists at the given lineOffset", async () => {
            const handler = makeDuplicateHandler();
            await expect(
                handler.appendToNote("notes/log.md", "x", "Notes", "\n", 99),
            ).rejects.toThrow("No heading found at line 99");
        });
    });
});

describe("NoteHandler.readNote with a section selector", () => {
    it("returns only the requested section, by heading name", async () => {
        // "# Introduction\n\nhello\n\n# Details\n\nworld"
        //  0             14 15 16 21 22 23     32 33 34
        const content = "# Introduction\n\nhello\n\n# Details\n\nworld";
        const { handler, app } = makeHandler(openSettings, {
            "notes/doc.md": content,
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/doc.md",
            makeCache(
                [
                    { text: "Introduction", level: 1, start: 0,  end: 14, line: 0 },
                    { text: "Details",      level: 1, start: 23, end: 32, line: 4 },
                ],
                [
                    { type: "heading",   start: 0,  end: 14, line: 0 },
                    { type: "paragraph", start: 16, end: 21, line: 2 },
                    { type: "heading",   start: 23, end: 32, line: 4 },
                    { type: "paragraph", start: 34, end: 38, line: 6 },
                ],
            ),
        );
        const result = await handler.readNote("notes/doc.md", "Details");
        expect(result.content).toContain("world");
        expect(result.content).not.toContain("hello");
    });

    it("returns a whole-document line window by lineOffset alone", async () => {
        // "# Introduction\n\nhello\n\n# Details\n\nworld"
        //  0             14 15 16 21 22 23     32 33 34
        const content = "# Introduction\n\nhello\n\n# Details\n\nworld";
        const { handler, app } = makeHandler(openSettings, {
            "notes/doc.md": content,
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/doc.md",
            makeCache(
                [
                    { text: "Introduction", level: 1, start: 0,  end: 14, line: 0 },
                    { text: "Details",      level: 1, start: 23, end: 32, line: 4 },
                ],
                [
                    { type: "heading",   start: 0,  end: 14, line: 0 },
                    { type: "paragraph", start: 16, end: 21, line: 2 },
                    { type: "heading",   start: 23, end: 32, line: 4 },
                    { type: "paragraph", start: 34, end: 38, line: 6 },
                ],
            ),
        );
        const result = await handler.readNote(
            "notes/doc.md",
            undefined,
            false,
            4,
        );
        expect(result.content).toBe("# Details\n\nworld");
        expect(result.startLine).toBe(4);
        expect(result.endLine).toBe(6);
        expect(result.totalLines).toBe(7);
        expect(result.truncated).toBe(false);
        expect(result.outline).toEqual([
            { text: "Introduction", level: 1, line: 0 },
            { text: "Details", level: 1, line: 4 },
        ]);
    });

    it("returns a bounded whole-document line window by lineLimit alone", async () => {
        const content = "# Intro\nalpha\n# Details\nbeta";
        const { handler, app } = makeHandler(openSettings, {
            "notes/doc.md": content,
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/doc.md",
            makeCache(
                [
                    { text: "Intro", level: 1, start: 0, end: 7, line: 0 },
                    { text: "Details", level: 1, start: 14, end: 23, line: 2 },
                ],
                [],
            ),
        );

        const result = await handler.readNote(
            "notes/doc.md",
            undefined,
            false,
            undefined,
            undefined,
            2,
        );

        expect(result.content).toBe("# Intro\nalpha\n");
        expect(result.startLine).toBe(0);
        expect(result.endLine).toBe(1);
        expect(result.totalLines).toBe(4);
        expect(result.truncated).toBe(true);
        expect(result.outline).toEqual([
            { text: "Intro", level: 1, line: 0 },
            { text: "Details", level: 1, line: 2 },
        ]);
    });

    it("returns a bounded whole-document line window by lineOffset and lineLimit", async () => {
        const content = "# Intro\nalpha\n# Details\nbeta\n# Tail\ngamma";
        const { handler, app } = makeHandler(openSettings, {
            "notes/doc.md": content,
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/doc.md",
            makeCache(
                [
                    { text: "Intro", level: 1, start: 0, end: 7, line: 0 },
                    { text: "Details", level: 1, start: 14, end: 23, line: 2 },
                    { text: "Tail", level: 1, start: 29, end: 35, line: 4 },
                ],
                [],
            ),
        );

        const result = await handler.readNote(
            "notes/doc.md",
            undefined,
            false,
            2,
            undefined,
            2,
        );

        expect(result.content).toBe("# Details\nbeta\n");
        expect(result.startLine).toBe(2);
        expect(result.endLine).toBe(3);
        expect(result.totalLines).toBe(6);
        expect(result.truncated).toBe(true);
    });

    it("includes frontmatter lines in whole-document pagination", async () => {
        const content = "---\nstatus: active\n---\nbody";
        const { handler, app } = makeHandler(openSettings, {
            "notes/fm.md": content,
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/fm.md",
            { frontmatter: { status: "active" } } as CachedMetadata,
        );

        const result = await handler.readNote(
            "notes/fm.md",
            undefined,
            false,
            0,
            undefined,
            2,
        );

        expect(result.content).toBe("---\nstatus: active\n");
        expect(result.frontmatter).toEqual({ status: "active" });
        expect(result.startLine).toBe(0);
        expect(result.endLine).toBe(1);
        expect(result.totalLines).toBe(4);
        expect(result.truncated).toBe(true);
    });

    it("throws when heading and lineOffset disagree (stale outline)", async () => {
        // "# Introduction\n\nhello\n\n# Details\n\nworld"
        //  0             14 15 16 21 22 23     32 33 34
        const content = "# Introduction\n\nhello\n\n# Details\n\nworld";
        const { handler, app } = makeHandler(openSettings, {
            "notes/doc.md": content,
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/doc.md",
            makeCache(
                [
                    { text: "Introduction", level: 1, start: 0,  end: 14, line: 0 },
                    { text: "Details",      level: 1, start: 23, end: 32, line: 4 },
                ],
                [
                    { type: "heading",   start: 0,  end: 14, line: 0 },
                    { type: "paragraph", start: 16, end: 21, line: 2 },
                    { type: "heading",   start: 23, end: 32, line: 4 },
                    { type: "paragraph", start: 34, end: 38, line: 6 },
                ],
            ),
        );
        await expect(
            handler.readNote("notes/doc.md", "Details", false, 0),
        ).rejects.toThrow(
            'Heading at line 0 is "Introduction", not "Details"',
        );
    });

    it("includes nested subheadings' content in the resolved section", async () => {
        // "# Intro\nhello\n## Sub\nnested\n# Details\nworld"
        //  0      7 8    13 14 20 21   27 28     37 38
        const content = "# Intro\nhello\n## Sub\nnested\n# Details\nworld";
        const { handler, app } = makeHandler(openSettings, {
            "notes/doc.md": content,
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/doc.md",
            makeCache(
                [
                    { text: "Intro",   level: 1, start: 0,  end: 7,  line: 0 },
                    { text: "Sub",     level: 2, start: 14, end: 20, line: 2 },
                    { text: "Details", level: 1, start: 28, end: 37, line: 4 },
                ],
                [
                    { type: "heading",   start: 0,  end: 7,  line: 0 },
                    { type: "paragraph", start: 8,  end: 13, line: 1 },
                    { type: "heading",   start: 14, end: 20, line: 2 },
                    { type: "paragraph", start: 21, end: 27, line: 3 },
                    { type: "heading",   start: 28, end: 37, line: 4 },
                    { type: "paragraph", start: 38, end: 43, line: 5 },
                ],
            ),
        );
        const result = await handler.readNote("notes/doc.md", "Intro");
        expect(result.content).toContain("hello");
        expect(result.content).toContain("## Sub");
        expect(result.content).toContain("nested");
        expect(result.content).not.toContain("world");
    });

    it("returns a section at the end of the file through end-of-file", async () => {
        // "# Intro\nhello\n# Details\nworld"
        //  0      7 8    13 14    23 24
        const content = "# Intro\nhello\n# Details\nworld";
        const { handler, app } = makeHandler(openSettings, {
            "notes/doc.md": content,
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/doc.md",
            makeCache(
                [
                    { text: "Intro",   level: 1, start: 0,  end: 7,  line: 0 },
                    { text: "Details", level: 1, start: 14, end: 23, line: 2 },
                ],
                [
                    { type: "heading",   start: 0,  end: 7,  line: 0 },
                    { type: "paragraph", start: 8,  end: 13, line: 1 },
                    { type: "heading",   start: 14, end: 23, line: 2 },
                    { type: "paragraph", start: 24, end: 29, line: 3 },
                ],
            ),
        );
        const result = await handler.readNote("notes/doc.md", "Details");
        expect(result.content).toBe("# Details\nworld");
    });

    it("omits pagination metadata on heading-scoped reads", async () => {
        const content = "# Intro\nhello\n# Details\nworld";
        const { handler, app } = makeHandler(openSettings, {
            "notes/doc.md": content,
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/doc.md",
            makeCache(
                [
                    { text: "Intro", level: 1, start: 0, end: 7, line: 0 },
                    { text: "Details", level: 1, start: 14, end: 23, line: 2 },
                ],
                [],
            ),
        );

        const result = await handler.readNote(
            "notes/doc.md",
            "Details",
            false,
            2,
        );
        expect(result.outline).toBeUndefined();
        expect(result.startLine).toBeUndefined();
        expect(result.endLine).toBeUndefined();
        expect(result.totalLines).toBeUndefined();
        expect(result.truncated).toBeUndefined();
    });

    it("throws when a requested section heading does not exist", async () => {
        // "# Intro\n\nhello"
        //  0      7 8 9
        const content = "# Intro\n\nhello";
        const { handler, app } = makeHandler(openSettings, {
            "notes/doc.md": content,
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/doc.md",
            makeCache(
                [{ text: "Intro", level: 1, start: 0, end: 7, line: 0 }],
                [
                    { type: "heading",   start: 0, end: 7,  line: 0 },
                    { type: "paragraph", start: 9, end: 13, line: 2 },
                ],
            ),
        );
        await expect(
            handler.readNote("notes/doc.md", "Missing"),
        ).rejects.toThrow("Heading not found: Missing");
    });

    it("throws when a heading is requested on a note with no headings at all", async () => {
        const { handler, app } = makeHandler(openSettings, {
            "notes/plain.md": "just text, no headings",
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/plain.md",
            makeCache([], []),
        );
        await expect(
            handler.readNote("notes/plain.md", "Missing"),
        ).rejects.toThrow("Heading not found: Missing");
    });

    it("throws a line-based error when lineOffset is requested on a note with no headings at all", async () => {
        const { handler, app } = makeHandler(openSettings, {
            "notes/plain.md": "just text, no headings",
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/plain.md",
            makeCache([], []),
        );
        await expect(
            handler.readNote("notes/plain.md", undefined, false, 12),
        ).rejects.toThrow("lineOffset 12 is out of range for 1 lines");
    });

    it("throws a line-based error when lineOffset is requested on an empty note", async () => {
        const { handler, app } = makeHandler(openSettings, {
            "notes/empty.md": "",
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/empty.md",
            makeCache([], []),
        );
        await expect(
            handler.readNote("notes/empty.md", undefined, false, 0),
        ).rejects.toThrow("lineOffset 0 is out of range for 0 lines");
    });

    it("rejects heading and lineLimit together", async () => {
        const { handler, app } = makeHandler(openSettings, {
            "notes/doc.md": "# Intro\nhello",
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/doc.md",
            makeCache(
                [{ text: "Intro", level: 1, start: 0, end: 7, line: 0 }],
                [],
            ),
        );
        await expect(
            handler.readNote("notes/doc.md", "Intro", false, undefined, undefined, 1),
        ).rejects.toThrow("lineLimit cannot be used together with heading");
    });

    it("rejects invalid lineOffset values", async () => {
        const { handler } = makeHandler(openSettings, {
            "notes/doc.md": "one line",
        });
        await expect(
            handler.readNote("notes/doc.md", undefined, false, -1),
        ).rejects.toThrow("lineOffset must be a non-negative integer: -1");
        await expect(
            handler.readNote("notes/doc.md", undefined, false, 1.5),
        ).rejects.toThrow("lineOffset must be a non-negative integer: 1.5");
    });

    it("rejects invalid lineLimit values", async () => {
        const { handler } = makeHandler(openSettings, {
            "notes/doc.md": "one line",
        });
        await expect(
            handler.readNote(
                "notes/doc.md",
                undefined,
                false,
                undefined,
                undefined,
                0,
            ),
        ).rejects.toThrow("lineLimit must be a positive integer: 0");
        await expect(
            handler.readNote(
                "notes/doc.md",
                undefined,
                false,
                undefined,
                undefined,
                1.5,
            ),
        ).rejects.toThrow("lineLimit must be a positive integer: 1.5");
    });

    describe("with duplicate heading names", () => {
        // "# Notes\nfirst\n# Notes\nsecond"
        //  0      7 8    13 14    21 22
        const content = "# Notes\nfirst\n# Notes\nsecond";

        function makeDuplicateHandler() {
            const { handler, app } = makeHandler(openSettings, {
                "notes/doc.md": content,
            });
            (app.metadataCache as unknown as MetadataCache).setCache__(
                "notes/doc.md",
                makeCache(
                    [
                        { text: "Notes", level: 1, start: 0,  end: 7,  line: 0 },
                        { text: "Notes", level: 1, start: 14, end: 21, line: 2 },
                    ],
                    [],
                ),
            );
            return handler;
        }

        it("throws when a name matches more than one heading", async () => {
            const handler = makeDuplicateHandler();
            await expect(
                handler.readNote("notes/doc.md", "Notes"),
            ).rejects.toThrow('Heading "Notes" is ambiguous (2 matches)');
        });

        it("names lineOffset in the ambiguity error", async () => {
            const handler = makeDuplicateHandler();
            await expect(
                handler.readNote("notes/doc.md", "Notes"),
            ).rejects.toThrow("pass lineOffset");
        });

        it("resolves to the targeted occurrence via lineOffset", async () => {
            const handler = makeDuplicateHandler();
            const first = await handler.readNote(
                "notes/doc.md",
                "Notes",
                false,
                0,
            );
            expect(first.content).toContain("first");
            expect(first.content).not.toContain("second");

            const second = await handler.readNote(
                "notes/doc.md",
                "Notes",
                false,
                2,
            );
            expect(second.content).toContain("second");
            expect(second.content).not.toContain("first");
        });
    });
});

describe("NoteHandler.patchNote", () => {
    it("replaces exact text", async () => {
        const { handler } = makeHandler(openSettings, {
            "notes/doc.md": "hello world",
        });
        await handler.patchNote("notes/doc.md", "world", "there");
        const result = await handler.readNote("notes/doc.md");
        expect(result.content).toBe("hello there");
    });

    it("throws when text is not found", async () => {
        const { handler } = makeHandler(openSettings, {
            "notes/doc.md": "hello world",
        });
        await expect(
            handler.patchNote("notes/doc.md", "missing", "x"),
        ).rejects.toThrow("Text not found in note");
    });

    it("throws when text appears more than once", async () => {
        const { handler } = makeHandler(openSettings, {
            "notes/doc.md": "foo foo",
        });
        await expect(
            handler.patchNote("notes/doc.md", "foo", "bar"),
        ).rejects.toThrow("Text appears more than once");
    });

    it("names the resolved section, not the note, when scoped by lineOffset alone", async () => {
        // "# Intro\nhello\n# Details\nfoo foo"
        //  0      7 8    13 14      23 24
        const content = "# Intro\nhello\n# Details\nfoo foo";
        const { handler, app } = makeHandler(openSettings, {
            "notes/doc.md": content,
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/doc.md",
            makeCache(
                [
                    { text: "Intro",   level: 1, start: 0,  end: 7,  line: 0 },
                    { text: "Details", level: 1, start: 14, end: 23, line: 2 },
                ],
                [],
            ),
        );
        await expect(
            handler.patchNote("notes/doc.md", "missing", "x", undefined, 2),
        ).rejects.toThrow('Text not found in section "Details"');
        await expect(
            handler.patchNote("notes/doc.md", "foo", "x", undefined, 2),
        ).rejects.toThrow(
            'Text appears more than once in section "Details"',
        );
    });

    it("normalizes CRLF in file and old_text before matching", async () => {
        const { handler } = makeHandler(openSettings, {
            "notes/doc.md": "line one\r\nline two\r\nline three",
        });
        await handler.patchNote(
            "notes/doc.md",
            "line one\nline two",
            "replaced",
        );
        const result = await handler.readNote("notes/doc.md");
        expect(result.content).toBe("replaced\r\nline three");
    });

    it("preserves CRLF in unchanged parts of the file", async () => {
        const { handler } = makeHandler(openSettings, {
            "notes/doc.md": "before\r\nTARGET\r\nafter",
        });
        await handler.patchNote("notes/doc.md", "TARGET", "REPLACED");
        const result = await handler.readNote("notes/doc.md");
        expect(result.content).toBe("before\r\nREPLACED\r\nafter");
    });

    it("matches curly quotes against straight quotes when normalizeQuotes is on", async () => {
        const { handler } = makeHandler(openSettings, {
            "notes/doc.md": "She said “hello” and ‘goodbye’",
        });
        await handler.patchNote(
            "notes/doc.md",
            'She said "hello" and \'goodbye\'',
            "redacted",
        );
        const result = await handler.readNote("notes/doc.md");
        expect(result.content).toBe("redacted");
    });

    it("does not match curly quotes when normalizeQuotes is off", async () => {
        const noNormSettings: CurrentSettings = {
            ...openSettings,
            normalizeQuotes: () => false,
        };
        const { handler } = makeHandler(noNormSettings, {
            "notes/doc.md": "She said “hello”",
        });
        await expect(
            handler.patchNote("notes/doc.md", 'She said "hello"', "x"),
        ).rejects.toThrow("Text not found in note");
    });

    describe("with a duplicate heading", () => {
        // "# Notes\ntarget\n# Notes\ntarget"
        //  0      7 8     14 15   22 23
        const content = "# Notes\ntarget\n# Notes\ntarget";

        function makeDuplicateHandler() {
            const { handler, app } = makeHandler(openSettings, {
                "notes/doc.md": content,
            });
            (app.metadataCache as unknown as MetadataCache).setCache__(
                "notes/doc.md",
                makeCache(
                    [
                        { text: "Notes", level: 1, start: 0,  end: 7,  line: 0 },
                        { text: "Notes", level: 1, start: 15, end: 22, line: 2 },
                    ],
                    [],
                ),
            );
            return handler;
        }

        it("throws when section matches more than one heading", async () => {
            const handler = makeDuplicateHandler();
            await expect(
                handler.patchNote("notes/doc.md", "target", "x", "Notes"),
            ).rejects.toThrow('Heading "Notes" is ambiguous (2 matches)');
        });

        it("names lineOffset in the ambiguity error", async () => {
            const handler = makeDuplicateHandler();
            await expect(
                handler.patchNote("notes/doc.md", "target", "x", "Notes"),
            ).rejects.toThrow("pass lineOffset to select");
        });

        it("patches the occurrence selected via lineOffset", async () => {
            const handler = makeDuplicateHandler();
            await handler.patchNote(
                "notes/doc.md",
                "target",
                "patched",
                "Notes",
                2,
            );
            const result = await handler.readNote("notes/doc.md");
            expect(result.content).toBe("# Notes\ntarget\n# Notes\npatched");
        });

        it("patches the section selected via lineOffset alone", async () => {
            const handler = makeDuplicateHandler();
            await handler.patchNote(
                "notes/doc.md",
                "target",
                "patched",
                undefined,
                0,
            );
            const result = await handler.readNote("notes/doc.md");
            expect(result.content).toBe("# Notes\npatched\n# Notes\ntarget");
        });

        it("throws when heading and lineOffset disagree (stale outline)", async () => {
            const handler = makeDuplicateHandler();
            await expect(
                handler.patchNote(
                    "notes/doc.md",
                    "target",
                    "x",
                    "Wrong",
                    0,
                ),
            ).rejects.toThrow('Heading at line 0 is "Notes", not "Wrong"');
        });
    });
});
