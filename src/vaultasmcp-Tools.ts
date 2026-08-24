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
    createDailyNote,
    createMonthlyNote,
    createQuarterlyNote,
    createWeeklyNote,
    createYearlyNote,
    getAllWeeklyNotes,
    getPeriodicNoteSettings,
    getWeeklyNote,
    type IGranularity,
} from "obsidian-daily-notes-interface";
import type { NoteReadResult } from "./@types/notes";
import type { CurrentSettings, Logger, MCPTool } from "./@types/settings";
import { momentFn } from "./vaultasmcp-moment";
import { NoteHandler } from "./vaultasmcp-NoteHandler";
import { PathACLChecker } from "./vaultasmcp-PathACL";
import { TemplateHandler } from "./vaultasmcp-TemplateHandler";

// Cap read_multiple_notes to avoid flooding callers with content
const MAX_READ_MULTIPLE_PATHS = 25;

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
            current,
        );
    }

    getToolDefinitions(): MCPTool[] {
        // Common output schemas
        const contentSchema = {
            type: "object" as const,
            properties: {
                content: { type: "string" },
                embeds: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            path: { type: "string" },
                            subpath: { type: "string" },
                        },
                        required: ["path"],
                    },
                },
                links: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            path: { type: "string" },
                            subpath: { type: "string" },
                        },
                        required: ["path"],
                    },
                },
                outline: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            text: { type: "string" },
                            level: { type: "number" },
                            line: {
                                type: "number",
                                description:
                                    "0-based start line of this heading; " +
                                    "pass as lineOffset to select or " +
                                    "disambiguate it.",
                            },
                        },
                        required: ["text", "level", "line"],
                    },
                },
                frontmatter: { type: "object" },
                startLine: {
                    type: "number",
                    description:
                        "0-based file-relative line number of the " +
                        "first returned line when whole-document " +
                        "pagination is used.",
                },
                endLine: {
                    type: "number",
                    description:
                        "0-based file-relative line number of the " +
                        "last returned line when whole-document " +
                        "pagination is used.",
                },
                totalLines: {
                    type: "number",
                    description:
                        "Total line count of the whole document when " +
                        "whole-document pagination is used.",
                },
                truncated: {
                    type: "boolean",
                    description:
                        "Whether additional whole-document lines exist " +
                        "beyond the returned pagination window.",
                },
                sizeBytes: {
                    type: "number",
                    description:
                        "File size in bytes, on disk. Only returned " +
                        "when metadataOnly is true.",
                },
            },
            required: [],
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

        return [
            {
                name: "read_note",
                description:
                    "Read note content by path. Returns raw markdown by " +
                    "default, optionally filtered to one section or " +
                    "windowed by file-relative lines; also returns embeds " +
                    "(direct embed targets), links (direct outgoing " +
                    "wikilinks), frontmatter, and, when not filtering to " +
                    "a section, outline (heading list). Pass metadataOnly: " +
                    "true to inspect a note's structure and size without " +
                    "reading its content.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description:
                                "Path to the note (e.g., 'folder/note.md')",
                        },
                        heading: {
                            type: "string",
                            description:
                                "Return only the section under this " +
                                "heading, by heading text " +
                                "(case-insensitive, includes subheadings). " +
                                "Throws if it matches more than one " +
                                "heading in the note — use lineOffset to " +
                                "disambiguate. Returns the whole resolved " +
                                "section. Cannot be combined with lineLimit. " +
                                "Ignored when metadataOnly is true.",
                        },
                        lineOffset: {
                            type: "number",
                            description:
                                "When heading is absent, start a whole-" +
                                "document read at this 0-based file-relative " +
                                "line. When heading is present, select or " +
                                "disambiguate the section by that heading's " +
                                "0-based start line from outline[].line; " +
                                "heading and lineOffset must agree or the " +
                                "call throws. Ignored when metadataOnly is true.",
                        },
                        lineLimit: {
                            type: "number",
                            description:
                                "Number of whole-document lines to return, " +
                                "starting at lineOffset or line 0 if " +
                                "lineOffset is omitted. Cannot be combined " +
                                "with heading. Ignored when metadataOnly is true.",
                        },
                        metadataOnly: {
                            type: "boolean",
                            description:
                                "Skip content and return only embeds/" +
                                "links/outline/frontmatter/sizeBytes. " +
                                "Use to check a note's size before " +
                                "deciding whether to read it in full or " +
                                "in chunks (lineOffset/lineLimit). " +
                                "Default: false.",
                        },
                        excludePatterns: {
                            type: "array",
                            items: { type: "string" },
                            description:
                                "Regex patterns to exclude certain " +
                                "embeds/links from the returned embeds " +
                                "and links arrays; matched against " +
                                "'[display](link)'.",
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
                    "Returns a map of path to content or error. " +
                    `Max ${MAX_READ_MULTIPLE_PATHS} paths per call. ` +
                    "Pass metadataOnly: true to inspect each note's " +
                    "structure and size without reading its content.",
                inputSchema: {
                    type: "object",
                    properties: {
                        paths: {
                            type: "array",
                            items: { type: "string" },
                            description:
                                "Array of note paths to read " +
                                `(max ${MAX_READ_MULTIPLE_PATHS}).`,
                        },
                        metadataOnly: {
                            type: "boolean",
                            description:
                                "Skip content and return only embeds/" +
                                "links/outline/frontmatter/sizeBytes for " +
                                "each note. Use to triage many candidate " +
                                "notes cheaply before deciding which to " +
                                "read in full. Default: false.",
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
                                    embeds: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                path: { type: "string" },
                                                subpath: { type: "string" },
                                            },
                                            required: ["path"],
                                        },
                                    },
                                    links: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                path: { type: "string" },
                                                subpath: { type: "string" },
                                            },
                                            required: ["path"],
                                        },
                                    },
                                    outline: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                text: { type: "string" },
                                                level: { type: "number" },
                                                line: { type: "number" },
                                            },
                                            required: ["text", "level", "line"],
                                        },
                                    },
                                    frontmatter: { type: "object" },
                                    sizeBytes: {
                                        type: "number",
                                        description:
                                            "File size in bytes, on disk. " +
                                            "Only returned when " +
                                            "metadataOnly is true.",
                                    },
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
                    "use list_notes to browse directories.",
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
                    "Fails if the file already exists. " +
                    "Without a template, content is required. " +
                    "With a template, Templater must be installed; " +
                    "content is optional and appended after the rendered template.",
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
                    "at end of file or after a heading. " +
                    "Throws if heading matches more than one heading in " +
                    "the note — see lineOffset. " +
                    "Use patch_note instead when replacing existing content.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        content: { type: "string" },
                        heading: {
                            type: "string",
                            description:
                                "Append after this heading, by heading " +
                                "text without '#' markers (e.g., 'Tasks'); " +
                                "case-insensitive; defaults to end of " +
                                "file. Throws if the text matches more " +
                                "than one heading — use lineOffset to " +
                                "disambiguate.",
                        },
                        lineOffset: {
                            type: "number",
                            description:
                                "Select the heading by its 0-based start " +
                                "line, from outline[].line. Usable alone " +
                                "or with heading, in which case they must " +
                                "agree or the call throws (refetch the " +
                                "outline via metadataOnly and retry).",
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
                name: "patch_note",
                description:
                    "Replace an exact string in a note; " +
                    "prefer over update_note for surgical edits. " +
                    "Fails if old_text is not found or is not unique " +
                    "(include surrounding context to disambiguate).",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        old_text: {
                            type: "string",
                            description:
                                "Exact string to replace; must appear exactly once.",
                        },
                        new_text: {
                            type: "string",
                            description: "Replacement text.",
                        },
                        lineOffset: {
                            type: "number",
                            description:
                                "Optional 0-based file line used to " +
                                "disambiguate duplicate exact matches by " +
                                "choosing the nearest occurrence.",
                        },
                    },
                    required: ["path", "old_text", "new_text"],
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
                description:
                    "Move a note to the system trash (recoverable). " +
                    "If the goal is to rename or move, use rename_note instead to preserve vault links.",
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
                description:
                    "Rename or move a note; prefer this over delete+create " +
                    "because it automatically rewrites all [[wikilinks]] and " +
                    "markdown links in the vault that pointed to the old path. " +
                    "delete+create leaves those links broken.",
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
                name: "read_periodic_note",
                description:
                    "Reads or creates a periodic note; pass create:true to create it from the template if missing.",
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
                        create: {
                            type: "boolean",
                            description:
                                "Create the note if it does not exist; defaults to false.",
                        },
                    },
                    required: ["period"],
                },
                outputSchema: {
                    type: "object" as const,
                    properties: {
                        path: { type: "string" },
                        content: { type: "string" },
                    },
                    required: ["path"],
                },
                annotations: {
                    readOnlyHint: false,
                    idempotentHint: false,
                    destructiveHint: false,
                },
            },
            {
                name: "list_templates",
                description:
                    "List available Templater templates; call before create_note " +
                    "to discover valid template paths. " +
                    "Returns templater_enabled: false when Templater is not installed; " +
                    "templates and templates_folder are only present when it is enabled.",
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
                return await this.readNote(
                    args.path as string,
                    args.heading as string | undefined,
                    args.metadataOnly as boolean | undefined,
                    args.lineOffset as number | undefined,
                    args.excludePatterns as string[] | undefined,
                    args.lineLimit as number | undefined,
                );
            case "read_multiple_notes":
                return await this.readMultipleNotes(
                    args.paths as string[],
                    args.metadataOnly as boolean | undefined,
                );
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
                    args.lineOffset as number | undefined,
                );
            case "patch_note":
                return await this.noteHandler.patchNote(
                    args.path as string,
                    args.old_text as string,
                    args.new_text as string,
                    args.lineOffset as number | undefined,
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
            case "read_periodic_note":
                return await this.readPeriodicNote(
                    args.period as string,
                    args.date as string | undefined,
                    args.create as boolean | undefined,
                );
            case "list_templates":
                return this.templateHandler.listTemplates();
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    private async readNote(
        path: string,
        heading?: string,
        metadataOnly?: boolean,
        lineOffset?: number,
        excludePatterns?: string[],
        lineLimit?: number,
    ): Promise<NoteReadResult> {
        return await this.noteHandler.readNote(
            path,
            heading,
            metadataOnly,
            lineOffset,
            excludePatterns,
            lineLimit,
        );
    }

    private async readMultipleNotes(
        paths: string[],
        metadataOnly?: boolean,
    ): Promise<{
        notes: Record<string, NoteReadResult & { error?: string }>;
    }> {
        if (paths.length > MAX_READ_MULTIPLE_PATHS) {
            throw new Error(
                `Too many paths requested (${paths.length}); ` +
                    `max is ${MAX_READ_MULTIPLE_PATHS}. ` +
                    "Split into multiple calls.",
            );
        }

        const results: Record<string, NoteReadResult & { error?: string }> = {};

        for (const path of paths) {
            try {
                results[path] = await this.noteHandler.readNote(
                    path,
                    undefined,
                    metadataOnly,
                );
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
        lineOffset?: number,
    ): Promise<{ path: string }> {
        return await this.noteHandler.appendToNote(
            path,
            content,
            heading,
            separator,
            lineOffset,
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

    private async readPeriodicNote(
        period: string,
        date?: string,
        create?: boolean,
    ): Promise<{ path: string; content?: string }> {
        const periodToGranularity: Record<string, IGranularity> = {
            daily: "day",
            day: "day",
            weekly: "week",
            week: "week",
            monthly: "month",
            month: "month",
            quarterly: "quarter",
            quarter: "quarter",
            yearly: "year",
            year: "year",
        };

        const granularity = periodToGranularity[period];
        if (!granularity) {
            throw new Error(`Invalid period type: ${period}`);
        }

        const createNote: Record<
            IGranularity,
            (d: ReturnType<typeof momentFn>) => Promise<TFile | undefined>
        > = {
            day: createDailyNote,
            week: createWeeklyNote,
            month: createMonthlyNote,
            quarter: createQuarterlyNote,
            year: createYearlyNote,
        };

        const settings = this.getPeriodicSettings(period, granularity);
        const targetDate = (date ? momentFn(date) : momentFn()).startOf(
            granularity,
        );
        const { path } = this.buildPeriodicPath(targetDate, settings);

        let file: TFile | undefined =
            granularity === "week"
                ? getWeeklyNote(targetDate, getAllWeeklyNotes())
                : (this.app.vault.getFileByPath(path) ?? undefined);
        if (!file) {
            if (!create) {
                return { path };
            }
            file = await createNote[granularity](targetDate);
            if (!file) {
                return { path };
            }
        }

        const { content } = await this.noteHandler.readNote(file.path);
        return { path: file.path, content };
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
        return { path: normalizePath(`${folder}/${filename}`) };
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
