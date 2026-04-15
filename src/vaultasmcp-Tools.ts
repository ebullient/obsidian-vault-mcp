import {
    type App,
    getAllTags,
    moment,
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
                content: {
                    type: "string",
                    description: "The markdown content of the note",
                },
            },
            required: ["content"],
        };

        const pathSchema = {
            type: "object" as const,
            properties: {
                path: {
                    type: "string",
                    description: "The path to the note in the vault",
                },
            },
            required: ["path"],
        };

        const notesListSchema = {
            type: "object" as const,
            properties: {
                notes: {
                    type: "array",
                    items: { type: "string" },
                    description: "Array of note paths",
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
                    description: "Array of paths to linked notes",
                },
            },
            required: ["links"],
        };

        return [
            {
                name: "read_note",
                description:
                    "Read the content of a note by its path. " +
                    "Returns raw markdown; optionally " +
                    "filtered to named sections.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description:
                                "The path to the note within the vault " +
                                "(e.g., 'folder/note.md')",
                        },
                        sections: {
                            type: "array",
                            items: { type: "string" },
                            description:
                                "Return only the content of the " +
                                "named sections (by heading text, " +
                                "case-insensitive, including " +
                                "subheadings); omit all other " +
                                "note content.",
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
                    "Read the content of multiple notes in a single request. " +
                    "Returns an object mapping each path to its content or " +
                    "error message. More efficient than multiple read_note " +
                    "calls for batch operations.",
                inputSchema: {
                    type: "object",
                    properties: {
                        paths: {
                            type: "array",
                            items: { type: "string" },
                            description:
                                "Array of note paths to read " +
                                "(e.g., ['folder/note1.md', 'folder/note2.md'])",
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
                                    content: {
                                        type: "string",
                                        description: "The markdown content",
                                    },
                                    error: {
                                        type: "string",
                                        description:
                                            "Error message if read failed",
                                    },
                                },
                            },
                            description:
                                "Object mapping paths to content or error",
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
                    "Search for notes by folder path, tag, frontmatter attribute, file mtime, or text content. " +
                    "Multiple parameters narrow results (AND logic). " +
                    "Returns paths of matching notes.",
                inputSchema: {
                    type: "object",
                    properties: {
                        tag: {
                            type: "string",
                            description:
                                "Tag to search for (without #, e.g., 'daily' or 'project/work')",
                        },
                        folder: {
                            type: "string",
                            description:
                                "Folder path to search within (e.g., 'Daily Notes')",
                        },
                        text: {
                            type: "string",
                            description:
                                "Text to search for in note content; " +
                                "space-separated words must all appear " +
                                "in the note (in any order); wrap a " +
                                "phrase in double quotes for an exact " +
                                'match, e.g. `meeting "action items"`.',
                        },
                        mtime: {
                            type: "object",
                            description:
                                "Filter by modification time. " +
                                "Use 'before' and/or 'after' with ISO dates " +
                                "(e.g., '2025-01-01').",
                            properties: {
                                before: {
                                    type: "string",
                                    description:
                                        "Include notes modified on or before " +
                                        "this date (inclusive; ISO format).",
                                },
                                after: {
                                    type: "string",
                                    description:
                                        "Include notes modified on or after " +
                                        "this date (inclusive; ISO format).",
                                },
                            },
                        },
                        frontmatter: {
                            type: "object",
                            description:
                                "Filter by frontmatter properties. " +
                                "Keys are property names, values are strings " +
                                "to match (case-insensitive). " +
                                'Example: {"sphere": "work", "status": "active"}',
                            additionalProperties: {
                                type: "string",
                            },
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
                    "Get all notes linked from a specific note (outgoing links). Returns paths of linked notes.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description:
                                "The path to the note (e.g., 'folder/note.md')",
                        },
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
                    "List notes and folders in a directory. " +
                    "Returns paths of immediate children only (non-recursive). " +
                    "Use to explore vault structure incrementally.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description:
                                "Directory path to list from " +
                                "(e.g., 'Daily Notes'). " +
                                "Use empty string for vault root.",
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
                            description: "Array of note paths in the directory",
                        },
                        folders: {
                            type: "array",
                            items: { type: "string" },
                            description:
                                "Array of subfolder paths in the directory",
                        },
                    },
                    required: ["notes", "folders"],
                },
                annotations: {
                    readOnlyHint: true,
                },
            },
            {
                name: "list_notes_by_tag",
                description:
                    "Return paths for all notes that have specific tag(s).",
                inputSchema: {
                    type: "object",
                    properties: {
                        tags: {
                            type: "array",
                            items: { type: "string" },
                            description:
                                "Array of tags to search for (without #)",
                        },
                    },
                    required: ["tags"],
                },
                outputSchema: notesListSchema,
                annotations: {
                    readOnlyHint: true,
                },
            },
            {
                name: "read_note_with_embeds",
                description:
                    "Read a note with embedded content expanded inline. " +
                    "Recursively expands embeds up to 2 levels deep, " +
                    "preventing circular references. " +
                    "Optionally include regular links and exclude patterns.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description:
                                "The path to the note (e.g., 'folder/note.md')",
                        },
                        includeLinks: {
                            type: "boolean",
                            description:
                                "Include regular links in addition to embeds (default: false)",
                        },
                        excludePatterns: {
                            type: "array",
                            items: { type: "string" },
                            description:
                                "Regex patterns to exclude links " +
                                "(matches against '[display](link)' format)",
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
                name: "create_note",
                description:
                    "Create a new note or binary file. Can create from " +
                    "template or with direct content. " +
                    "Automatically creates parent folders if needed. " +
                    "Fails if file already exists.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description:
                                "The path for the new file " +
                                "(e.g., 'folder/note.md' or 'assets/image.png'). " +
                                ".md extension added automatically for text notes.",
                        },
                        content: {
                            type: "string",
                            description:
                                "The content for the file. " +
                                "For text notes: markdown content. " +
                                "For binary files: base64-encoded data. " +
                                "If a template is also provided, this content is " +
                                "appended after the template.",
                        },
                        template: {
                            type: "string",
                            description:
                                "Optional template path to use " +
                                "(e.g., 'templates/daily.md'). " +
                                "list_templates will show available templates. " +
                                "Requires Templater plugin to be installed. " +
                                "If specified with content, template is applied " +
                                "first, then content is appended.",
                        },
                        binary: {
                            type: "boolean",
                            description:
                                "Set to true for binary files (images, PDFs). " +
                                "Content must be base64-encoded. Default: false.",
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
                    "Append content to an existing note. " +
                    "Can append to end of file or after a specific heading. " +
                    "Fails if note does not exist.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description:
                                "The path to the note " +
                                "(e.g., 'folder/note.md')",
                        },
                        content: {
                            type: "string",
                            description: "The content to append",
                        },
                        heading: {
                            type: "string",
                            description:
                                "Optional heading to append after " +
                                "(e.g., '## Tasks'). If not specified, appends " +
                                "to end of file.",
                        },
                        separator: {
                            type: "string",
                            description:
                                "Separator between existing content and new " +
                                "content (default: '\\n')",
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
                    "Update an existing note by replacing its entire content. " +
                    "Fails if note does not exist.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description:
                                "The path to the note " +
                                "(e.g., 'folder/note.md')",
                        },
                        content: {
                            type: "string",
                            description:
                                "The new content that will replace " +
                                "the entire file content",
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
                name: "delete_note",
                description:
                    "Delete a note by moving it to the system trash. " +
                    "This is safer than permanent deletion as the file can " +
                    "be recovered from trash. Fails if note does not exist.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description:
                                "The path to the note to delete " +
                                "(e.g., 'folder/note.md')",
                        },
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
                    "Rename or move a note to a new path. " +
                    "Updates all internal vault links that reference " +
                    "the note. Fails if the note does not exist or " +
                    "the destination path already exists.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description:
                                "Current path to the note " +
                                "(e.g., 'folder/old-name.md')",
                        },
                        new_path: {
                            type: "string",
                            description:
                                "New path for the note; use a " +
                                "different folder to move it " +
                                "(e.g., 'other-folder/new-name.md')",
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
                    "Get the current date and time information. " +
                    "Returns the current date in ISO format, timestamp, " +
                    "and formatted date string. Use this to determine " +
                    "what date to use for periodic notes or date-based operations.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
                outputSchema: {
                    type: "object",
                    properties: {
                        iso: {
                            type: "string",
                            description: "Date in ISO format (YYYY-MM-DD)",
                        },
                        formatted: {
                            type: "string",
                            description:
                                "Human-readable date (e.g., 'January 20, 2025')",
                        },
                        timestamp: {
                            type: "number",
                            description: "Unix timestamp in milliseconds",
                        },
                        year: {
                            type: "number",
                            description: "Year (e.g., 2025)",
                        },
                        month: { type: "number", description: "Month (1-12)" },
                        day: {
                            type: "number",
                            description: "Day of month (1-31)",
                        },
                        dayOfWeek: {
                            type: "string",
                            description: "Day name (e.g., 'Monday')",
                        },
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
                    "Get the file path for a periodic note " +
                    "(daily, weekly, monthly, quarterly, yearly). " +
                    "Checks for Periodic Notes plugin, falls back to " +
                    "Daily Notes plugin for 'daily' period. " +
                    "Returns path based on user's configured format and folder.",
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
                            description: "The period type for the note",
                        },
                        date: {
                            type: "string",
                            description:
                                "Optional date in ISO format " +
                                "(e.g., '2025-01-18'). Defaults to current date.",
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
                    "List available note templates and Templater " +
                    "plugin status. " +
                    "Returns path of templates folder, list of templates, " +
                    "and whether or not the Templater plugin is enabled.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
                outputSchema: {
                    type: "object",
                    properties: {
                        templates_folder: {
                            type: "string",
                            description:
                                "Path to the templates folder (if Templater enabled)",
                        },
                        templates: {
                            type: "array",
                            items: { type: "string" },
                            description:
                                "List of template file paths (if Templater enabled)",
                        },
                        templater_enabled: {
                            type: "boolean",
                            description: "Whether Templater plugin is enabled",
                        },
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
                );
            case "get_linked_notes":
                return this.getLinkedNotes(args.path as string);
            case "list_notes":
                return this.listNotes(args.path as string);
            case "list_notes_by_tag":
                return this.listNotesByTag(args.tags as string[]);
            case "read_note_with_embeds":
                return await this.noteHandler.readNoteWithEmbeds(
                    args.path as string,
                    args.excludePatterns as string[] | undefined,
                    args.includeLinks as boolean | undefined,
                );
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
        const now = moment();
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

        const targetDate = date ? window.moment(date) : window.moment();

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
        date: moment.Moment,
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
                ? window.moment(mtime.before).endOf("day")
                : undefined;
            const after = mtime.after
                ? window.moment(mtime.after).startOf("day")
                : undefined;
            files = files.filter((f) => {
                const cache = this.app.metadataCache.getFileCache(f);
                const lastModified: unknown = cache?.frontmatter?.last_modified;
                let date = window.moment(f.stat.mtime);
                if (
                    typeof lastModified === "string" ||
                    typeof lastModified === "number"
                ) {
                    // Use frontmatter date (YYYY-MM-DD comparison)
                    date = window.moment(lastModified);
                }
                if (before && date.isAfter(before, "day")) {
                    return false;
                }
                if (after && date.isBefore(after, "day")) {
                    return false;
                }
                return true;
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

    private listNotesByTag(tags: string[]): { notes: string[] } {
        const normalizedTags = tags.map((t) => this.normalizeTag(t));

        // Filter by ACL first, then process metadata
        const matchingFiles = this.filterAccessibleFiles(
            this.app.vault.getMarkdownFiles(),
        ).filter((f) => {
            const cache = this.app.metadataCache.getFileCache(f);
            if (!cache) {
                return false;
            }
            const allTags = (getAllTags(cache) || []).map((t) =>
                this.normalizeTag(t),
            );

            return normalizedTags.some((tag) => allTags.includes(tag));
        });

        return {
            notes: matchingFiles.map((f) => f.path).sort(),
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
