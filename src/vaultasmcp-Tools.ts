import {
    type App,
    getAllTags,
    moment,
    normalizePath,
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
        return [
            {
                name: "read_note",
                description:
                    "Read the full content of a note by its path. Returns the raw markdown content.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description:
                                "The path to the note within the vault (e.g., 'folder/note.md')",
                        },
                    },
                    required: ["path"],
                },
            },
            {
                name: "search_notes",
                description:
                    "Search for notes by tag, folder path, or text content. Returns matching note paths.",
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
                            description: "Text to search for in note content",
                        },
                    },
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
            },
            {
                name: "list_notes",
                description:
                    "List notes and folders in a directory. " +
                    "Returns immediate children only (non-recursive). " +
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
            },
            {
                name: "list_notes_by_tag",
                description:
                    "Get all notes that have specific tag(s). Returns matching note paths.",
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
            },
            {
                name: "list_templates",
                description:
                    "List available note templates and Templater " +
                    "plugin status. " +
                    "Returns templates folder path, list of templates, " +
                    "and whether Templater plugin is enabled.",
                inputSchema: {
                    type: "object",
                    properties: {},
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
                return await this.readNote(args.path as string);
            case "search_notes":
                return await this.searchNotes(
                    args.tag as string | undefined,
                    args.folder as string | undefined,
                    args.text as string | undefined,
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

    private async readNote(path: string): Promise<{ content: string }> {
        return await this.noteHandler.readNote(path);
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

        const targetDate = date ? moment(date) : moment();

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

        if (text) {
            const matchingFiles: TFile[] = [];
            for (const file of files) {
                const content = await this.app.vault.cachedRead(file);
                if (content.toLowerCase().includes(text.toLowerCase())) {
                    matchingFiles.push(file);
                }
            }
            files = matchingFiles;
        }

        return {
            notes: files.map((f) => f.path).sort(),
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
}
