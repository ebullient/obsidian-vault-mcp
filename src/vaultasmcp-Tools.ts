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
import type { Logger, MCPTool } from "./@types/settings";
import { TemplateHandler } from "./vaultasmcp-TemplateHandler";

const MAX_DEPTH = 2;
type EmbeddedLink = {
    subpaths: Set<string>; // headings, blockrefs
    hasFullReference: boolean;
    file: TFile | null; // null for unresolved links
    depth: number;
};
type EmbeddedNotes = Map<string, EmbeddedLink>;

export class MCPTools {
    private templateHandler: TemplateHandler;

    constructor(
        private app: App,
        private logger: Logger,
    ) {
        this.templateHandler = new TemplateHandler(app);
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
                    "List all notes in a directory path. Returns note paths.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description:
                                "Directory path to list notes from (e.g., 'Daily Notes'). Use empty string for root.",
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
                                "Not required if template is specified.",
                        },
                        template: {
                            type: "string",
                            description:
                                "Optional template path to use " +
                                "(e.g., 'templates/daily.md'). " +
                                "list_templates will show available templates. " +
                                "Requires Core Templates or Templater plugin. " +
                                "If specified, content parameter is ignored.",
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
                    "List available note templates and which " +
                    "templating plugins are enabled. " +
                    "Returns templates folder path, list of templates, " +
                    "and plugin availability (Core Templates, Templater).",
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
                return await this.readNoteWithEmbeds(
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
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            throw new Error(`Note not found: ${path}`);
        }

        const content = await this.app.vault.cachedRead(file);
        return { content };
    }

    private async createNote(
        path: string,
        content?: string,
        template?: string,
        binary = false,
    ): Promise<{ path: string }> {
        // If template is provided, use template handler
        if (template) {
            const file = await this.templateHandler.createFromTemplate(
                template,
                path,
            );
            return { path: file.path };
        }

        // Otherwise, create from content
        if (!content) {
            throw new Error("Either content or template must be provided");
        }

        // Normalize path and add .md extension for text notes
        let normalizedPath = normalizePath(path);
        if (!binary && !normalizedPath.endsWith(".md")) {
            normalizedPath = `${normalizedPath}.md`;
        }

        // Check if file already exists
        const existing = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (existing) {
            throw new Error(`File already exists: ${normalizedPath}`);
        }

        // Create parent folders if needed (following Advanced URI pattern)
        const parts = normalizedPath.split("/");
        const dir = parts.slice(0, parts.length - 1).join("/");
        if (
            parts.length > 1 &&
            !(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)
        ) {
            await this.app.vault.createFolder(dir);
        }

        // Create the file (binary or text)
        let file: TFile;
        if (binary) {
            const arrayBuffer = this.base64ToArrayBuffer(content);
            file = await this.app.vault.createBinary(
                normalizedPath,
                arrayBuffer,
            );
        } else {
            file = await this.app.vault.create(normalizedPath, content);
        }

        return { path: file.path };
    }

    private async appendToNote(
        path: string,
        content: string,
        heading?: string,
        separator = "\n",
    ): Promise<{ path: string }> {
        const normalizedPath = normalizePath(path);
        const file = this.app.vault.getAbstractFileByPath(normalizedPath);

        if (!(file instanceof TFile)) {
            throw new Error(`Note not found: ${normalizedPath}`);
        }

        // Read existing content
        const existingContent = await this.app.vault.read(file);
        if (heading) {
            // Heading-based insertion
            const insertOffset = this.findHeadingEndOffset(file, heading);
            if (insertOffset === undefined) {
                throw new Error(`Heading not found: ${heading}`);
            }

            const before = existingContent.slice(0, insertOffset);
            const after = existingContent.slice(insertOffset);
            const addition = `${separator}${content}`;
            const newContent = `${before}${addition}${after}`;
            await this.app.vault.modify(file, newContent);
        } else {
            // Append to end of file
            const newContent = existingContent + separator + content;
            await this.app.vault.modify(file, newContent);
        }

        return { path: file.path };
    }

    private async updateNote(
        path: string,
        content: string,
    ): Promise<{ path: string }> {
        const normalizedPath = normalizePath(path);
        const file = this.app.vault.getAbstractFileByPath(normalizedPath);

        if (!(file instanceof TFile)) {
            throw new Error(`Note not found: ${normalizedPath}`);
        }

        // Replace entire content
        await this.app.vault.modify(file, content);

        return { path: file.path };
    }

    private async deleteNote(path: string): Promise<{ path: string }> {
        const normalizedPath = normalizePath(path);
        const file = this.app.vault.getAbstractFileByPath(normalizedPath);

        if (!(file instanceof TFile)) {
            throw new Error(`Note not found: ${normalizedPath}`);
        }

        // Move to system trash (recoverable)
        await this.app.fileManager.trashFile(file);

        return { path: normalizedPath };
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

    private findHeadingEndOffset(
        file: TFile,
        heading: string,
    ): number | undefined {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache?.sections || !cache.headings) return undefined;

        const sections = cache.sections;
        const foundHeading = cache.headings.find((h) => h.heading === heading);

        if (!foundHeading) return undefined;

        // Find the section for this heading
        const foundSectionIndex = sections.findIndex(
            (section) =>
                section.type === "heading" &&
                section.position.start.line ===
                    foundHeading.position.start.line,
        );

        if (foundSectionIndex === -1) {
            return undefined;
        }

        const restSections = sections.slice(foundSectionIndex + 1);

        // Find the next heading to determine section boundary
        const nextHeadingIndex = restSections.findIndex(
            (section) => section.type === "heading",
        );

        const relevantSections =
            nextHeadingIndex === -1
                ? restSections
                : restSections.slice(0, nextHeadingIndex);

        const lastSection =
            relevantSections[relevantSections.length - 1] ??
            sections[foundSectionIndex];

        return lastSection.position.end.offset;
    }

    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    private async searchNotes(
        tag?: string,
        folder?: string,
        text?: string,
    ): Promise<{ notes: string[] }> {
        let files = this.app.vault.getMarkdownFiles();

        if (folder) {
            files = files.filter((f) => f.path.startsWith(folder));
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
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            throw new Error(`Note not found: ${path}`);
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
                path,
            );
            if (targetFile) {
                links.add(targetFile.path);
            }
        }

        // Process embeds
        for (const embed of cache.embeds || []) {
            const targetFile = this.app.metadataCache.getFirstLinkpathDest(
                embed.link,
                path,
            );
            if (targetFile) {
                links.add(targetFile.path);
            }
        }

        return { links: Array.from(links).sort() };
    }

    private listNotes(path: string): { notes: string[] } {
        const allFiles = this.app.vault.getMarkdownFiles();
        const files = path
            ? allFiles.filter((f) => f.path.startsWith(path))
            : allFiles;

        return {
            notes: files.map((f) => f.path).sort(),
        };
    }

    private listNotesByTag(tags: string[]): { notes: string[] } {
        const normalizedTags = tags.map((t) => this.normalizeTag(t));
        const files = this.app.vault.getMarkdownFiles();

        const matchingFiles = files.filter((f) => {
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

    private async readNoteWithEmbeds(
        path: string,
        excludePatterns: string[] | undefined,
        includeLinks = false,
    ): Promise<{ content: string }> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            throw new Error(`Note not found: ${path}`);
        }

        const content = await this.app.vault.cachedRead(file);
        const compiledPatterns = this.compileExcludePatterns(
            excludePatterns || [],
        );
        const expandedContent = await this.expandLinkedFiles(
            file,
            content,
            compiledPatterns,
            includeLinks,
        );

        return { content: expandedContent };
    }

    private normalizeTag(tag: string): string {
        return tag.startsWith("#") ? tag.substring(1) : tag;
    }

    private compileExcludePatterns(patterns: string[]): RegExp[] {
        const compiled: RegExp[] = [];
        for (const pattern of patterns) {
            try {
                compiled.push(new RegExp(pattern));
            } catch (error) {
                this.logger.warn(`Invalid exclude pattern: ${pattern}`, error);
            }
        }
        return compiled;
    }

    private shouldExcludeLink(
        linkCache: { link: string; displayText?: string },
        excludePatterns: RegExp[],
    ): boolean {
        const textToCheck = `[${linkCache.displayText}](${linkCache.link})`;
        return excludePatterns.some((pattern) => pattern.test(textToCheck));
    }

    private parseLinkReference(link: string): {
        path: string;
        subpath: string | null;
    } {
        const anchorPos = link.indexOf("#");
        if (anchorPos < 0) {
            return { path: link, subpath: null };
        }
        return {
            path: link.substring(0, anchorPos),
            subpath: link.substring(anchorPos + 1),
        };
    }

    private async expandLinkedFiles(
        sourceFile: TFile,
        content: string,
        excludePatterns: RegExp[] = [],
        includeLinks = false,
    ): Promise<string> {
        let fileCache = this.app.metadataCache.getFileCache(sourceFile);
        if (!fileCache) {
            return content;
        }

        const seenLinks: EmbeddedNotes = new Map();
        const fileQueue: EmbeddedLink[] = [];

        // Track seen files to prevent duplicates (using normalized TFile paths)
        const origin = {
            hasFullReference: true,
            subpaths: new Set<string>(),
            file: sourceFile,
            depth: 0,
        };
        seenLinks.set(sourceFile.path, origin);
        fileQueue.push(origin);

        // Phase 1: Process queue breadth-first
        // We are not gathering content at this time: we're only resolving
        // files and links.
        let embeddedLink = fileQueue.shift();
        while (embeddedLink) {
            // Skip if file wasn't found (null) or max depth reached
            if (!embeddedLink.file || embeddedLink.depth >= MAX_DEPTH) {
                embeddedLink = fileQueue.shift();
                continue;
            }

            fileCache = this.app.metadataCache.getFileCache(embeddedLink.file);
            if (fileCache) {
                // Process both links and embeds
                // Only include regular links if includeLinks is true
                const allLinks = [
                    ...(includeLinks ? fileCache.links || [] : []),
                    ...(fileCache.embeds || []),
                ].filter((link) => link);

                for (const cachedLink of allLinks) {
                    // Skip if link matches exclusion patterns
                    if (this.shouldExcludeLink(cachedLink, excludePatterns)) {
                        continue;
                    }

                    // Skip duplicate unresolved links (resolved links are
                    // deduplicated later by file path)
                    const linkKey = cachedLink.link;
                    if (seenLinks.has(linkKey)) {
                        continue; // unresolved link seen before
                    }

                    // Parse link to extract path and subpath
                    const { path, subpath } = this.parseLinkReference(
                        cachedLink.link,
                    );
                    const targetFile =
                        this.app.metadataCache.getFirstLinkpathDest(
                            path,
                            embeddedLink.file.path,
                        );

                    if (!targetFile) {
                        this.logger.debug(
                            `Link target not found: ${cachedLink.link} ` +
                                `(from ${embeddedLink.file.path})`,
                        );
                        // Add to seen list to avoid checking again (but don't queue)
                        seenLinks.set(linkKey, {
                            hasFullReference: false,
                            subpaths: new Set<string>(),
                            file: null,
                            depth: embeddedLink.depth + 1,
                        });
                        continue; // to next link
                    }

                    const key = targetFile.path;
                    let ref = seenLinks.get(key);
                    if (!ref) {
                        // create ref if missing
                        ref = {
                            hasFullReference: false,
                            subpaths: new Set<string>(),
                            file: targetFile,
                            depth: embeddedLink.depth + 1,
                        };
                        seenLinks.set(key, ref);
                        fileQueue.push(ref); // new link to visit
                        this.logger.debug(
                            "Link",
                            embeddedLink.file.path,
                            " ➡ ",
                            targetFile.path,
                        );
                    }

                    // Track subpath or full file reference
                    if (!subpath) {
                        ref.hasFullReference = true;
                    } else {
                        ref.subpaths.add(subpath);
                    }
                }
            }
            embeddedLink = fileQueue.shift();
        }

        // Phase 2: Collect content.
        // Read each referenced file, and append
        const expandedContent = [];
        seenLinks.delete(sourceFile.path); // remove sourcefile
        this.logger.debug(
            `Collecting content from ${seenLinks.size} linked files`,
        );
        for (const link of seenLinks.values()) {
            // Skip null file entries (unresolved links)
            // and non-markdown files
            if (!link.file || link.file.extension !== "md") {
                continue;
            }

            const fileContent = await this.app.vault.cachedRead(link.file);
            if (link.hasFullReference) {
                // emit whole file once
                expandedContent.push(
                    `===== BEGIN ENTRY: ${link.file.path} =====`,
                );
                expandedContent.push(fileContent);
                expandedContent.push("===== END ENTRY =====\n");
            } else {
                // emit each subpath snippet
                for (const subpath of link.subpaths) {
                    expandedContent.push(
                        `===== BEGIN ENTRY: ${link.file.path}#${subpath} =====`,
                    );
                    expandedContent.push(
                        this.extractSubpathContent(
                            link.file,
                            fileContent,
                            subpath,
                        ),
                    );
                    expandedContent.push("===== END ENTRY =====\n");
                }
            }
        }

        if (expandedContent.length) {
            return (
                content +
                "\n----- EMBEDDED/LINKED CONTENT -----\n" +
                expandedContent.join("\n")
            );
        }
        return content;
    }

    // Subset of full document content.
    // If the subpath isn't found, return empty.
    private extractSubpathContent(
        file: TFile,
        fileContent: string,
        subpath: string,
    ): string {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache) {
            return "";
        }

        // Check for block reference (^block-id)
        if (subpath.startsWith("^")) {
            const blockId = subpath.substring(1);
            const block = cache.blocks?.[blockId];
            if (block) {
                // Extract the full block content using offsets
                const start = block.position.start.offset;
                const end = block.position.end.offset;
                return fileContent.substring(start, end).trim();
            }
            this.logger.debug(
                `Block reference not found: ^${blockId} in ${file.path}`,
            );
            return "";
        }

        // Check for heading reference
        const targetHeading = subpath.replace(/%20/g, " ");
        const heading = cache.headings?.find(
            (h) => h.heading === targetHeading,
        );

        if (heading && cache.headings) {
            // Find the end of this section
            const start = heading.position.end.offset;
            let end = fileContent.length;

            // Find next heading at same or higher level
            const headingIndex = cache.headings.indexOf(heading);
            for (const h of cache.headings.slice(headingIndex + 1)) {
                if (h.level <= heading.level) {
                    end = h.position.start.offset;
                    break;
                }
            }

            return fileContent.substring(start, end).trim();
        }

        // If no matching subpath found, return empty
        this.logger.debug(`Subpath not found: #${subpath} in ${file.path}`);
        return "";
    }
}
