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
    error: vi.fn(),
};

const openSettings: CurrentSettings = {
    pathACL: () => ({ forbidden: [], readOnly: [], writable: [] }),
    bearerToken: () => undefined,
    serverPort: () => 3000,
    serverHost: () => "localhost",
    serverVersion: () => "1",
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
});

describe("NoteHandler.readNote with sections", () => {
    it("returns only the requested section", async () => {
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
        const result = await handler.readNote("notes/doc.md", ["Details"]);
        expect(result.content).toContain("world");
        expect(result.content).not.toContain("hello");
    });

    it("returns multiple sections when requested", async () => {
        // "# Intro\n\nhello\n\n# Body\n\nworld\n\n# Footer\n\nbye"
        //  0      7 8 9    14 15 16  22 23 24 30 31 32    40 41
        const content = "# Intro\n\nhello\n\n# Body\n\nworld\n\n# Footer\n\nbye";
        const { handler, app } = makeHandler(openSettings, {
            "notes/doc.md": content,
        });
        (app.metadataCache as unknown as MetadataCache).setCache__(
            "notes/doc.md",
            makeCache(
                [
                    { text: "Intro",  level: 1, start: 0,  end: 7,  line: 0 },
                    { text: "Body",   level: 1, start: 16, end: 22, line: 4 },
                    { text: "Footer", level: 1, start: 31, end: 39, line: 8 },
                ],
                [
                    { type: "heading",   start: 0,  end: 7,  line: 0 },
                    { type: "paragraph", start: 9,  end: 14, line: 2 },
                    { type: "heading",   start: 16, end: 22, line: 4 },
                    { type: "paragraph", start: 24, end: 29, line: 6 },
                    { type: "heading",   start: 31, end: 39, line: 8 },
                    { type: "paragraph", start: 41, end: 43, line: 10 },
                ],
            ),
        );
        const result = await handler.readNote("notes/doc.md", [
            "Intro",
            "Footer",
        ]);
        expect(result.content).toContain("hello");
        expect(result.content).toContain("bye");
        expect(result.content).not.toContain("world");
    });

    it("returns empty string when section not found", async () => {
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
        const result = await handler.readNote("notes/doc.md", ["Missing"]);
        expect(result.content).toBe("");
    });
});

describe("NoteHandler.readNoteWithEmbeds", () => {
    // Vault layout:
    //   main.md        — embeds allowed.md, forbidden.md, section-note.md#Target
    //                    links to linked.md
    //   allowed.md     — embeds depth2.md (depth 1)
    //   depth2.md      — embeds depth3.md (depth 2, at MAX_DEPTH limit)
    //   depth3.md      — would be depth 3, never followed
    //   forbidden.md   — ACL blocked, silently skipped
    //   section-note.md — two headings; only #Target content appears via subpath embed
    //   linked.md      — only included when includeLinks: true

    function makeEmbedHandler() {
        const files = {
            "main.md":
                "main content\n" +
                "![[allowed.md]]\n" +
                "![[forbidden.md]]\n" +
                "![[section-note.md#Target]]\n" +
                "[[linked.md]]",
            "allowed.md":       "allowed content\n![[depth2.md]]",
            "depth2.md":        "depth2 content\n![[depth3.md]]",
            "depth3.md":        "depth3 content",
            "forbidden.md":     "forbidden content",
            "section-note.md":  "# Introduction\nsome intro\n# Target\ntarget content",
            "linked.md":        "linked content",
        };
        const settings: CurrentSettings = {
            ...openSettings,
            pathACL: () => ({
                forbidden: ["forbidden.md"],
                readOnly: [],
                writable: [],
            }),
        };
        const { handler, app } = makeHandler(settings, files);
        const mc = app.metadataCache as unknown as MetadataCache;

        // main.md: embeds + one link
        mc.setCache__("main.md", {
            embeds: [
                { link: "allowed.md",             displayText: "allowed.md",            original: "![[allowed.md]]",            position: { start: { offset: 13, line: 1, col: 0 }, end: { offset: 27, line: 1, col: 14 } } },
                { link: "forbidden.md",           displayText: "forbidden.md",          original: "![[forbidden.md]]",          position: { start: { offset: 29, line: 2, col: 0 }, end: { offset: 45, line: 2, col: 16 } } },
                { link: "section-note.md#Target", displayText: "section-note.md#Target",original: "![[section-note.md#Target]]",position: { start: { offset: 47, line: 3, col: 0 }, end: { offset: 73, line: 3, col: 26 } } },
            ],
            links: [
                { link: "linked.md", displayText: "linked.md", original: "[[linked.md]]", position: { start: { offset: 75, line: 4, col: 0 }, end: { offset: 87, line: 4, col: 12 } } },
            ],
        });

        // allowed.md: embeds depth2.md
        mc.setCache__("allowed.md", {
            embeds: [
                { link: "depth2.md", displayText: "depth2.md", original: "![[depth2.md]]", position: { start: { offset: 16, line: 1, col: 0 }, end: { offset: 29, line: 1, col: 13 } } },
            ],
        });

        // depth2.md: embeds depth3.md — at MAX_DEPTH, not followed
        mc.setCache__("depth2.md", {
            embeds: [
                { link: "depth3.md", displayText: "depth3.md", original: "![[depth3.md]]", position: { start: { offset: 15, line: 1, col: 0 }, end: { offset: 28, line: 1, col: 13 } } },
            ],
        });

        // section-note.md: headings needed for subpath extraction
        // "# Introduction\nsome intro\n# Target\ntarget content"
        //  0              14 15       25 26     34 35
        mc.setCache__("section-note.md", makeCache(
            [
                { text: "Introduction", level: 1, start: 0,  end: 14, line: 0 },
                { text: "Target",       level: 1, start: 26, end: 34, line: 2 },
            ],
            [
                { type: "heading",   start: 0,  end: 14, line: 0 },
                { type: "paragraph", start: 15, end: 25, line: 1 },
                { type: "heading",   start: 26, end: 34, line: 2 },
                { type: "paragraph", start: 35, end: 48, line: 3 },
            ],
        ));

        return { handler, app };
    }

    it("expands embeds and respects ACL, depth limit, and subpath", async () => {
        const { handler } = makeEmbedHandler();
        const { content } = await handler.readNoteWithEmbeds("main.md");

        expect(content).toContain("main content");
        // allowed.md and its transitive embed are included
        expect(content).toContain("allowed content");
        expect(content).toContain("depth2 content");
        // depth3 is beyond MAX_DEPTH — not included
        expect(content).not.toContain("depth3 content");
        // forbidden is silently skipped
        expect(content).not.toContain("forbidden content");
        // subpath embed: only Target section, not Introduction
        expect(content).toContain("target content");
        expect(content).not.toContain("some intro");
        // linked.md excluded when includeLinks is false (default)
        expect(content).not.toContain("linked content");
    });

    it("includes linked notes when includeLinks is true", async () => {
        const { handler } = makeEmbedHandler();
        const { content } = await handler.readNoteWithEmbeds(
            "main.md",
            undefined,
            true,
        );
        expect(content).toContain("linked content");
    });
});
