import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { MCPRequest } from "../src/@types/settings.js";
import { MCPHandler } from "../src/vaultasmcp-MCPHandler.js";
import { logger, openSettings } from "./vaultasmcp-TestFixtures.js";

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

function makeHandler(files: Record<string, string> = {}): {
    handler: MCPHandler;
} {
    const app = App.createConfigured__({ files });
    const handler = new MCPHandler(
        app.asOriginalType__(),
        logger,
        openSettings,
    );
    return { handler };
}

function callTool(
    handler: MCPHandler,
    name: string,
    args: Record<string, unknown>,
) {
    const request: MCPRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
    };
    return handler.handleRequest(request);
}

async function readNoteContent(
    handler: MCPHandler,
    path: string,
): Promise<string> {
    const response = await callTool(handler, "read_note", { path });
    const result = response?.result as
        | { structuredContent?: { content?: string } }
        | undefined;
    return result?.structuredContent?.content ?? "";
}

describe("MCPHandler.handleToolsCall argument validation", () => {
    it("succeeds for update_note called with only its declared arguments", async () => {
        const { handler } = makeHandler({
            "notes/foo.md": "old content",
        });

        const response = await callTool(handler, "update_note", {
            path: "notes/foo.md",
            content: "new content",
        });

        expect(response?.error).toBeUndefined();
        expect(await readNoteContent(handler, "notes/foo.md")).toBe(
            "new content",
        );
    });

    it("rejects update_note called with an undeclared argument and performs no write", async () => {
        const { handler } = makeHandler({
            "notes/foo.md": "old content",
        });

        const response = await callTool(handler, "update_note", {
            path: "notes/foo.md",
            content: "new content",
            mode: "patch",
        });

        expect(response?.error).toBeDefined();
        expect(response?.error?.code).toBe(-32602);
        expect(response?.error?.message).toContain("mode");
        expect(response?.error?.message).toContain("update_note");

        expect(await readNoteContent(handler, "notes/foo.md")).toBe(
            "old content",
        );
    });

    it("succeeds for patch_note called without its optional lineOffset", async () => {
        const { handler } = makeHandler({
            "notes/foo.md": "target text",
        });

        const response = await callTool(handler, "patch_note", {
            path: "notes/foo.md",
            old_text: "target",
            new_text: "replaced",
        });

        expect(response?.error).toBeUndefined();
    });
});


describe("MCPHandler resources, prompts, and audit log", () => {
    it("lists accessible resources, reads resource content, enforces ACL, and records audit log entries", async () => {
        const app = App.createConfigured__({
            files: {
                "notes/public.md": "# Public Note\nHello",
                "private/secret.md": "# Secret",
            },
        });
        const aclSettings = {
            ...openSettings,
            pathACL: () => ({
                forbidden: ["private/**"],
                readOnly: [],
                writable: [],
            }),
        };
        const handler = new MCPHandler(
            app.asOriginalType__(),
            logger,
            aclSettings,
        );

        const listRes = await handler.handleRequest({
            jsonrpc: "2.0",
            id: 1,
            method: "resources/list",
        });
        const resources = (
            listRes?.result as { resources: Array<{ uri: string }> }
        ).resources;
        expect(resources.map((r) => r.uri)).toEqual([
            "obsidian://vault/notes/public.md",
        ]);

        const tplRes = await handler.handleRequest({
            jsonrpc: "2.0",
            id: 2,
            method: "resources/templates/list",
        });
        expect(
            (
                tplRes?.result as {
                    resourceTemplates: Array<{ uriTemplate: string }>;
                }
            ).resourceTemplates[0]?.uriTemplate,
        ).toBe("obsidian://vault/{+path}");

        const readRes = await handler.handleRequest(
            {
                jsonrpc: "2.0",
                id: 3,
                method: "resources/read",
                params: { uri: "obsidian://vault/notes/public.md" },
            },
            { authType: "oauth", clientId: "client-1" },
        );
        const contents = (
            readRes?.result as { contents: Array<{ text: string }> }
        ).contents;
        expect(contents[0]?.text).toContain("# Public Note");

        const deniedRes = await handler.handleRequest(
            {
                jsonrpc: "2.0",
                id: 4,
                method: "resources/read",
                params: { uri: "obsidian://vault/private/secret.md" },
            },
            { authType: "oauth", clientId: "client-1" },
        );
        expect(deniedRes?.error?.code).toBe(-32002);

        const entries = handler.getAuditLog().getEntries();
        expect(entries.length).toBe(2);
        expect(entries[0]?.status).toBe("error");
        expect(entries[1]?.status).toBe("success");
    });
});
