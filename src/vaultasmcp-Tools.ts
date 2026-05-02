import {
    type App,
    getAllTags,
    normalizePath,
    prepareSimpleSearch,
    type SearchResultContainer,
    sortSearchResults,
    TFile,
    TFolder,
} from "obsidian";
import {
    appHasDailyNotesPluginLoaded,
    appHasMonthlyNotesPluginLoaded,
    appHasQuarterlyNotesPluginLoaded,
    appHasWeeklyNotesPluginLoaded,
    appHasYearlyNotesPluginLoaded,
    getPeriodicNoteSettings,
    type IGranularity,
} from "obsidian-daily-notes-interface";
import type { CurrentSettings, Logger, MCPTool } from "./@types/settings";
import { momentFn } from "./vaultasmcp-moment";
import { NoteHandler } from "./vaultasmcp-NoteHandler";
import { PathACLChecker } from "./vaultasmcp-PathACL";
import { TemplateHandler } from "./vaultasmcp-TemplateHandler";

export class MCPTools {
    private noteHandler: NoteHandler;
    private templateHandler: TemplateHandler;
    private aclChecker: PathACLChecker;

    constructor(
        private app: App,
        logger: Logger,
        current: CurrentSettings,
    ) {
        this.aclChecker = new PathACLChecker(current, logger);
        this.templateHandler = new TemplateHandler(
            app,
            this.aclChecker,
            logger,
        );
        this.noteHandler = new NoteHandler(
            app,
            this.templateHandler,
            this.aclChecker,
            logger,
        );
    }

    getToolDefinitions(): MCPTool[] {
        // Common output schemas
        const contentSchema = {
            type: "object" as const,
            properties: {
                content: { type: "string" },
            },
            required: ["content"],
        };

        const pathSchema = {
            type: "object" as const,
            properties: {
                path: { type: "string" },
            },
            required: ["path"],
        };

        const notesListSchema = {
            type: "object" as const,
            properties: {
                notes: {
                    type: "array",
                    items: { type: "string" },
                },
            },
            required: ["notes"],
        };

        const linksListSchema = {
            type: "object" as const,
            properties: {
                links: {
                    type: "array",
                    items: { type: "string" },
                },
            },
            required: ["links"],
        };

        return [
            {
                name: "read_note",
                description:
                    "Read note content by path. Returns raw markdown by default; " +
                    "optionally filtered to named sections. " +
                    "Pass includeEmbeds: true only when embedded content was " +
                    "explicitly requested — embed expansion is expensive.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description:
                                "Path to the note (e.g., 'folder/note.md')",
                        },
                        sections: {
                            type: "array",
                            items: { type: "string" },
                            description:
                                "Return only these sections by heading text " +
                                "(case-insensitive, includes subheadings).",
                        },
                        includeEmbeds: {
                            type: "boolean",
                            description:
                                "Expand ![[embed]] blocks inline " +
                                "(up to 2 levels deep, no circular refs). " +
                                "Default: false.",
                        },
                        includeLinks: {
                            type: "boolean",
                            description:
                                "Also expand regular [[links]] inline. " +
                                "Only relevant when includeEmbeds is true. " +
                                "Default: false.",
                        },
                        excludePatterns: {
                            type: "array",
                            items: { type: "string" },
                            description:
                                "Regex patterns to skip certain embeds; " +
                                "matched against '[display](link)'. " +
                                "Only relevant when includeEmbeds is true.",
                        },
                    },
                    required: ["path"],
                },
                outputSchema: contentSchema,
                annotations: {
                    readOnlyHint: true,
                },
            },
            {
                name: "read_multiple_notes",
                description:
                    "Read multiple notes in one request. " +
                    "Returns a map of path to content or error.",
                inputSchema: {
                    type: "object",
                    properties: {
                        paths: {
                            type: "array",
                            items: { type: "string" },
                            description: "Array of note paths to read",
                        },
                    },
                    required: ["paths"],
                },
                outputSchema: {
                    type: "object" as const,
                    properties: {
                        notes: {
                            type: "object",
                            additionalProperties: {
                                type: "object",
                                properties: {
                                    content: { type: "string" },
                                    error: { type: "string" },
                                },
                            },
                        },
                    },
                    required: ["notes"],
                },
                annotations: {
                    readOnlyHint: true,
                },
            },
            {
                name: "search_notes",
                description:
                    "Find notes across the vault by folder, tag, frontmatter, " +
                    "modification time, or text content. " +
                    "All parameters are optional and combine with AND logic, " +
                    "except tags[] which is OR within the tag dimension. " +
                    "Returns note paths only — not folder structure; " +
                    "use list_notes to browse directories. " +
                    "Use sort: 'recent' with limit to find recently changed notes.",
                inputSchema: {
                    type: "object",
                    properties: {
                        folder: {
                            type: "string",
                            description:
                                "Restrict to notes under this folder path " +
                                "(recursive).",
                        },
                        tag: {
                            type: "string",
                            description:
                                "Single tag filter, combined with AND logic " +
                                "alongside other params (e.g., 'project/work'). " +
                                "Use tags[] for OR matching across multiple tags.",
                        },
                        tags: {
                            type: "array",
                            items: { type: "string" },
                            description:
                                "Return notes that have ANY of these tags (OR logic). " +
                                "Tags without #. " +
                                "Cannot be combined with tag.",
                        },
                        text: {
                            type: "string",
                            description:
                                "Words must all appear (any order); " +
                                'quote phrases for exact match: `meeting "action items"`.',
                        },
                        mtime: {
                            type: "object",
                            description:
                                "Filter by modification time. " +
                                "Each value is an ISO date ('2026-04-25') " +
                                "or relative days ('7d' = 7 days ago).",
                            properties: {
                                before: {
                                    type: "string",
                                    description:
                                        "On or before this date (inclusive). " +
                                        "ISO date or relative (e.g., '7d').",
                                },
                                after: {
                                    type: "string",
                                    description:
                                        "On or after this date (inclusive). " +
                                        "ISO date or relative (e.g., '7d').",
                                },
                            },
                        },
                        frontmatter: {
                            type: "object",
                            description:
                                "Filter by frontmatter key/value (case-insensitive). " +
                                'E.g., {"status": "active"}',
                            additionalProperties: { type: "string" },
                        },
                        sort: {
                            type: "string",
                            enum: ["alpha", "recent"],
                            description:
                                "Sort order: 'alpha' (default, alphabetical) or " +
                                "'recent' (newest modified first). " +
                                "Use 'recent' with limit to get recently changed notes.",
                        },
                        limit: {
                            type: "number",
                            description:
                                "Max notes to return. " +
                                "Only applied when sort is 'recent' " +
                                "(default: 20, max: 50).",
                        },
                    },
                },
                outputSchema: notesListSchema,
                annotations: {
                    readOnlyHint: true,
                },
            },
            {
                name: "get_linked_notes",
                description:
                    "Get outgoing links from a note. " +
                    "Returns links and embeds; does not return backlinks.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                    },
                    required: ["path"],
                },
                outputSchema: linksListSchema,
                annotations: {
                    readOnlyHint: true,
                },
            },
            {
                name: "list_notes",
                description:
                    "List notes and subfolders in a directory (non-recursive). " +
                    "Use for vault navigation when folder structure matters. " +
                    "Use search_notes with a folder parameter to find notes " +
                    "recursively without folder structure.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description:
                                "Directory path; empty string for vault root.",
                        },
                    },
                    required: ["path"],
                },
                outputSchema: {
                    type: "object",
                    properties: {
                        notes: {
                            type: "array",
                            items: { type: "string" },
                        },
                        folders: {
                            type: "array",
                            items: { type: "string" },
                        },
                    },
                    required: ["notes", "folders"],
                },
                annotations: {
                    readOnlyHint: true,
                },
            },
            {
                name: "create_note",
                description:
                    "Create a note or binary file; creates parent folders as needed. " +
                    "Fails if file already exists.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description:
                                "Path for the new file; .md added automatically for text notes.",
                        },
                        content: {
                            type: "string",
                            description:
                                "Markdown content, or base64 for binary. " +
                                "Appended after template if both are given.",
                        },
                        template: {
                            type: "string",
                            description:
                                "Template path (requires Templater). " +
                                "Use list_templates to see available options.",
                        },
                        binary: {
                            type: "boolean",
                            description:
                                "True for binary files; content must be base64. Default: false.",
                        },
                    },
                    required: ["path"],
                },
                outputSchema: pathSchema,
                annotations: {
                    readOnlyHint: false,
                    idempotentHint: false,
                },
            },
            {
                name: "append_to_note",
                description:
                    "Append content to an existing note, " +
                    "at end of file or after a heading.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        content: { type: "string" },
                        heading: {
                            type: "string",
                            description:
                                "Append after this heading (e.g., '## Tasks'); " +
                                "defaults to end of file.",
                        },
                        separator: {
                            type: "string",
                            description:
                                "Separator before new content (default: '\\n')",
                        },
                    },
                    required: ["path", "content"],
                },
                outputSchema: pathSchema,
                annotations: {
                    readOnlyHint: false,
                    idempotentHint: false,
                    destructiveHint: true,
                },
            },
            {
                name: "update_note",
                description:
                    "Replace the entire content of an existing note. " +
                    "Use append_to_note for additive changes to avoid data loss.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        content: { type: "string" },
                    },
                    required: ["path", "content"],
                },
                outputSchema: pathSchema,
                annotations: {
                    readOnlyHint: false,
                    idempotentHint: false,
                    destructiveHint: true,
                },
            },
            {
                name: "delete_note",
                description: "Move a note to the system trash (recoverable).",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                    },
                    required: ["path"],
                },
                outputSchema: pathSchema,
                annotations: {
                    readOnlyHint: false,
                    idempotentHint: false,
                    destructiveHint: true,
                },
            },
            {
                name: "rename_note",
                description: "Rename or move a note; updates all vault links.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        new_path: {
                            type: "string",
                            description:
                                "New path; use a different folder to move.",
                        },
                    },
                    required: ["path", "new_path"],
                },
                outputSchema: pathSchema,
                annotations: {
                    readOnlyHint: false,
                    idempotentHint: false,
                    destructiveHint: false,
                },
            },
            {
                name: "get_current_date",
                description:
                    "Get the current date; use for periodic notes and date-based operations.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
                outputSchema: {
                    type: "object",
                    properties: {
                        iso: { type: "string" },
                        formatted: { type: "string" },
                        timestamp: { type: "number" },
                        year: { type: "number" },
                        month: { type: "number" },
                        day: { type: "number" },
                        dayOfWeek: { type: "string" },
                    },
                    required: [
                        "iso",
                        "formatted",
                        "timestamp",
                        "year",
                        "month",
                        "day",
                        "dayOfWeek",
                    ],
                },
                annotations: {
                    readOnlyHint: true,
                },
            },
            {
                name: "get_periodic_note_path",
                description:
                    "Get the configured path for a periodic note " +
                    "(daily/weekly/monthly/quarterly/yearly).",
                inputSchema: {
                    type: "object",
                    properties: {
                        period: {
                            type: "string",
                            enum: [
                                "daily",
                                "weekly",
                                "monthly",
                                "quarterly",
                                "yearly",
                            ],
                        },
                        date: {
                            type: "string",
                            description:
                                "ISO date (e.g., '2025-01-18'); defaults to today.",
                        },
                    },
                    required: ["period"],
                },
                outputSchema: pathSchema,
                annotations: {
                    readOnlyHint: true,
                },
            },
            {
                name: "list_templates",
                description:
                    "List available templates and Templater plugin status.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
                outputSchema: {
                    type: "object",
                    properties: {
                        templates_folder: { type: "string" },
                        templates: {
                            type: "array",
                            items: { type: "string" },
                        },
                        templater_enabled: { type: "boolean" },
                    },
                    required: ["templater_enabled"],
                },
                annotations: {
                    readOnlyHint: true,
                },
            },
        ];
    }

    async executeTool(
        toolName: string,
        args: Record<string, unknown>,
    ): Promise<unknown> {
        switch (toolName) {
            case "read_note":
                if (args.includeEmbeds) {
                    return await this.noteHandler.readNoteWithEmbeds(
                        args.path as string,
                        args.excludePatterns as string[] | undefined,
                        args.includeLinks as boolean | undefined,
                    );
                }
                return await this.readNote(
                    args.path as string,
                    args.sections as string[] | undefined,
                );
            case "read_multiple_notes":
                return await this.readMultipleNotes(args.paths as string[]);
            case "search_notes":
                return await this.searchNotes(
                    args.tag as string | undefined,
                    args.folder as string | undefined,
                    args.text as string | undefined,
                    args.mtime as
                        | { before?: string; after?: string }
                        | undefined,
                    args.frontmatter as Record<string, string> | undefined,
                    args.tags as string[] | undefined,
                    args.sort as "alpha" | "recent" | undefined,
                    args.limit as number | undefined,
                );
            case "get_linked_notes":
                return this.getLinkedNotes(args.path as string);
            case "list_notes":
                return this.listNotes(args.path as string);
            case "create_note":
                return await this.createNote(
                    args.path as string,
                    args.content as string | undefined,
                    args.template as string | undefined,
                    args.binary as boolean | undefined,
                );
            case "append_to_note":
                return await this.appendToNote(
                    args.path as string,
                    args.content as string,
                    args.heading as string | undefined,
                    args.separator as string | undefined,
                );
            case "update_note":
                return await this.updateNote(
                    args.path as string,
                    args.content as string,
                );
            case "delete_note":
                return await this.deleteNote(args.path as string);
            case "rename_note":
                return await this.noteHandler.renameNote(
                    args.path as string,
                    args.new_path as string,
                );
            case "get_current_date":
                return this.getCurrentDate();
            case "get_periodic_note_path":
                return this.getPeriodicNotePath(
                    args.period as string,
                    args.date as string | undefined,
                );
            case "list_templates":
                return this.templateHandler.listTemplates();
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    private async readNote(
        path: string,
        sections?: string[],
    ): Promise<{ content: string }> {
        return await this.noteHandler.readNote(path, sections);
    }

    private async readMultipleNotes(paths: string[]): Promise<{
        notes: Record<string, { content?: string; error?: string }>;
    }> {
        const results: Record<string, { content?: string; error?: string }> =
            {};

        for (const path of paths) {
            try {
                const result = await this.noteHandler.readNote(path);
                results[path] = { content: result.content };
            } catch (e) {
                results[path] = {
                    error: e instanceof Error ? e.message : String(e),
                };
            }
        }

        return { notes: results };
    }

    private async createNote(
        path: string,
        content?: string,
        template?: string,
        binary = false,
    ): Promise<{ path: string }> {
        return await this.noteHandler.createNote(
            path,
            content,
            template,
            binary,
        );
    }

    private async appendToNote(
        path: string,
        content: string,
        heading?: string,
        separator = "\n",
    ): Promise<{ path: string }> {
        return await this.noteHandler.appendToNote(
            path,
            content,
            heading,
            separator,
        );
    }

    private async updateNote(
        path: string,
        content: string,
    ): Promise<{ path: string }> {
        return await this.noteHandler.updateNote(path, content);
    }

    private async deleteNote(path: string): Promise<{ path: string }> {
        return await this.noteHandler.deleteNote(path);
    }

    private getCurrentDate(): {
        iso: string;
        formatted: string;
        timestamp: number;
        year: number;
        month: number;
        day: number;
        dayOfWeek: string;
    } {
        const now = momentFn();
        return {
            iso: now.format("YYYY-MM-DD"),
            formatted: now.format("MMMM D, YYYY"),
            timestamp: now.valueOf(),
            year: now.year(),
            month: now.month() + 1, // moment months are 0-indexed
            day: now.date(),
            dayOfWeek: now.format("dddd"),
        };
    }

    private getPeriodicNotePath(
        period: string,
        date?: string,
    ): { path: string } {
        // Map period names to granularity
        const periodToGranularity: Record<string, IGranularity> = {
            daily: "day",
            weekly: "week",
            monthly: "month",
            quarterly: "quarter",
            yearly: "year",
        };

        const granularity = periodToGranularity[period];
        if (!granularity) {
            throw new Error(`Invalid period type: ${period}`);
        }

        const targetDate = date ? momentFn(date) : momentFn();

        const settings = this.getPeriodicSettings(period, granularity);

        return this.buildPeriodicPath(targetDate, settings);
    }

    private getPeriodicSettings(
        period: string,
        granularity: IGranularity,
    ): { format?: string; folder?: string } {
        const pluginChecks: Record<IGranularity, () => boolean> = {
            day: appHasDailyNotesPluginLoaded,
            week: appHasWeeklyNotesPluginLoaded,
            month: appHasMonthlyNotesPluginLoaded,
            quarter: appHasQuarterlyNotesPluginLoaded,
            year: appHasYearlyNotesPluginLoaded,
        };

        const pluginAvailable = pluginChecks[granularity]?.() ?? false;
        if (!pluginAvailable) {
            throw new Error(this.periodicSupportMessage(period));
        }

        const settings = getPeriodicNoteSettings(granularity);
        if (!settings) {
            throw new Error(this.periodicSupportMessage(period));
        }

        return settings;
    }

    private periodicSupportMessage(period: string): string {
        if (period === "daily") {
            return (
                "Daily notes are not configured. " +
                "Enable the Daily Notes core plugin or Periodic Notes."
            );
        }

        const label = period.charAt(0).toUpperCase() + period.slice(1);
        return (
            `${label} notes are not configured. ` +
            "Enable the Periodic Notes plugin for this period."
        );
    }

    private buildPeriodicPath(
        date: ReturnType<typeof momentFn>,
        settings: { format?: string; folder?: string },
    ): { path: string } {
        const format = settings.format || "YYYY-MM-DD";
        const folder = settings.folder || "";

        let filename = date.format(format);
        if (!filename.endsWith(".md")) {
            filename += ".md";
        }
        return { path: normalizePath(this.join(folder, filename)) };
    }

    private join(...partSegments: string[]): string {
        // Split the inputs into a list of path commands.
        let parts: string[] = [];
        for (let i = 0, l = partSegments.length; i < l; i++) {
            parts = parts.concat(partSegments[i].split("/"));
        }
        // Interpret the path commands to get the new resolved path.
        const newParts = [];
        for (let i = 0, l = parts.length; i < l; i++) {
            const part = parts[i];
            // Remove leading and trailing slashes
            // Also remove "." segments
            if (!part || part === ".") continue;
            // Push new path segments.
            newParts.push(part);
        }
        // Preserve the initial slash if there was one.
        if (parts[0] === "") newParts.unshift("");
        // Turn back into a single string path.
        return newParts.join("/");
    }

    /**
     * Filter files by ACL read access, silently excluding forbidden files
     */
    private filterAccessibleFiles(files: TFile[]): TFile[] {
        return files.filter((f) => {
            try {
                this.aclChecker.checkReadAccess(f.path);
                return true;
            } catch {
                return false;
            }
        });
    }

    private async searchNotes(
        tag?: string,
        folder?: string,
        text?: string,
        mtime?: { before?: string; after?: string },
        frontmatter?: Record<string, string>,
        tags?: string[],
        sort?: "alpha" | "recent",
        limit?: number,
    ): Promise<{ notes: string[] }> {
        let files = this.filterAccessibleFiles(
            this.app.vault.getMarkdownFiles(),
        );

        if (folder) {
            const testFolder = normalizePath(folder);
            files = files.filter((f) => f.path.startsWith(testFolder));
        }
        if (tag) {
            const normalizedTag = this.normalizeTag(tag);
            files = files.filter((f) => {
                const cache = this.app.metadataCache.getFileCache(f);
                if (!cache) {
                    return false;
                }
                const allTags = getAllTags(cache) || [];
                return allTags.some(
                    (t) => this.normalizeTag(t) === normalizedTag,
                );
            });
        }
        if (frontmatter && Object.keys(frontmatter).length > 0) {
            files = files.filter((f) => {
                const cache = this.app.metadataCache.getFileCache(f);
                const fm = cache?.frontmatter;
                if (!fm) {
                    return false;
                }
                return Object.entries(frontmatter).every(([key, value]) => {
                    const fmValue: unknown = fm[key];
                    if (
                        fmValue === undefined ||
                        fmValue === null ||
                        typeof fmValue === "object"
                    ) {
                        return false;
                    }
                    const fmStr = fmValue as string | number | boolean;
                    return String(fmStr).toLowerCase() === value.toLowerCase();
                });
            });
        }
        if (mtime) {
            const before = mtime.before
                ? this.parseDateParam(mtime.before).endOf("day")
                : undefined;
            const after = mtime.after
                ? this.parseDateParam(mtime.after).startOf("day")
                : undefined;
            files = files.filter((f) => {
                const date = this.getEffectiveMtime(f);
                if (before && date.isAfter(before, "day")) return false;
                if (after && date.isBefore(after, "day")) return false;
                return true;
            });
        }
        if (tags && tags.length > 0) {
            const normalizedTags = tags.map((t) => this.normalizeTag(t));
            files = files.filter((f) => {
                const cache = this.app.metadataCache.getFileCache(f);
                if (!cache) return false;
                const allTags = (getAllTags(cache) || []).map((t) =>
                    this.normalizeTag(t),
                );
                return normalizedTags.some((tag) => allTags.includes(tag));
            });
        }
        if (text) {
            const { phrases, words } = this.parseTextQuery(text);
            const searcher = words ? prepareSimpleSearch(words) : null;
            type ScoredFile = SearchResultContainer & { file: TFile };
            const scored: ScoredFile[] = [];
            for (const file of files) {
                const content = await this.app.vault.cachedRead(file);
                const lower = content.toLowerCase();
                if (phrases.some((p) => !lower.includes(p.toLowerCase()))) {
                    continue;
                }
                if (searcher) {
                    const result = searcher(content);
                    if (result === null) continue;
                    scored.push({ file, match: result });
                } else {
                    scored.push({ file, match: { score: 0, matches: [] } });
                }
            }
            sortSearchResults(scored);
            files = scored.map((r) => r.file);
        }

        if (sort === "recent") {
            const maxResults = Math.min(limit ?? 20, 50);
            files.sort((a, b) => {
                const diff =
                    this.getEffectiveMtime(b).valueOf() -
                    this.getEffectiveMtime(a).valueOf();
                return diff !== 0 ? diff : b.stat.mtime - a.stat.mtime;
            });
            return { notes: files.slice(0, maxResults).map((f) => f.path) };
        }
        return {
            notes: text
                ? files.map((f) => f.path)
                : files.map((f) => f.path).sort(),
        };
    }

    private getLinkedNotes(path: string): { links: string[] } {
        const normalizedPath = path ? normalizePath(path) : "";
        this.aclChecker.checkReadAccess(normalizedPath);

        const file = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (!(file instanceof TFile)) {
            throw new Error(`Note not found: ${normalizedPath}`);
        }

        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache) {
            return { links: [] };
        }

        const links = new Set<string>();

        // Process regular links
        for (const link of cache.links || []) {
            const targetFile = this.app.metadataCache.getFirstLinkpathDest(
                link.link,
                normalizedPath,
            );
            if (targetFile) {
                try {
                    this.aclChecker.checkReadAccess(targetFile.path);
                    links.add(targetFile.path);
                } catch {
                    // Silently skip forbidden links
                }
            }
        }

        // Process embeds
        for (const embed of cache.embeds || []) {
            const targetFile = this.app.metadataCache.getFirstLinkpathDest(
                embed.link,
                normalizedPath,
            );
            if (targetFile) {
                try {
                    this.aclChecker.checkReadAccess(targetFile.path);
                    links.add(targetFile.path);
                } catch {
                    // Silently skip forbidden embeds
                }
            }
        }

        return { links: Array.from(links).sort() };
    }

    private listNotes(path: string): {
        notes: string[];
        folders: string[];
    } {
        const normalizedPath = path ? normalizePath(path) : "";

        // Check read access for the directory
        if (normalizedPath) {
            this.aclChecker.checkReadAccess(normalizedPath);
        }

        const vault = this.app.vault;

        // Get the parent folder
        const parentFolder = normalizedPath
            ? vault.getAbstractFileByPath(normalizedPath)
            : vault.getRoot();

        if (!(parentFolder instanceof TFolder)) {
            throw new Error(`Directory not found: ${normalizedPath || "root"}`);
        }

        const notes: string[] = [];
        const folders: string[] = [];

        // List immediate children only (non-recursive)
        for (const child of parentFolder.children) {
            try {
                this.aclChecker.checkReadAccess(child.path);
                if (child instanceof TFile && child.extension === "md") {
                    notes.push(child.path);
                } else if (child instanceof TFolder) {
                    folders.push(child.path);
                }
            } catch {
                // Silently skip forbidden children
            }
        }

        return {
            notes: notes.sort(),
            folders: folders.sort(),
        };
    }

    private normalizeTag(tag: string): string {
        return tag.startsWith("#") ? tag.substring(1) : tag;
    }

    /**
     * Parse a text query into exact phrases (quoted) and
     * remaining unquoted words for use with prepareSimpleSearch.
     * e.g. `meeting "action items"` →
     *   phrases: ["action items"], words: "meeting"
     */
    private getEffectiveMtime(file: TFile): ReturnType<typeof momentFn> {
        const cache = this.app.metadataCache.getFileCache(file);
        const lm: unknown = cache?.frontmatter?.last_modified;
        if (typeof lm === "string" || typeof lm === "number") {
            return momentFn(lm);
        }
        return momentFn(file.stat.mtime);
    }

    private parseDateParam(value: string): ReturnType<typeof momentFn> {
        const rel = value.match(/^(\d+)d$/i);
        return rel
            ? momentFn().subtract(Number(rel[1]), "days")
            : momentFn(value);
    }

    private parseTextQuery(query: string): {
        phrases: string[];
        words: string;
    } {
        const phrases: string[] = [];
        const remaining = query
            .replace(/"([^"]*)"/g, (_, p: string) => {
                if (p.trim()) phrases.push(p);
                return " ";
            })
            .trim();
        return { phrases, words: remaining };
    }
}
