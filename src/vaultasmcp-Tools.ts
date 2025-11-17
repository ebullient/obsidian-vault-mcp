import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { Logger, MCPTool } from "./@types/settings";

export class MCPTools {
    constructor(
        private app: App,
        private logger: Logger,
    ) {}

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
                return await this.getLinkedNotes(args.path as string);
            case "list_notes":
                return await this.listNotes(args.path as string);
            case "list_notes_by_tag":
                return await this.listNotesByTag(args.tags as string[]);
            case "read_note_with_embeds":
                return await this.readNoteWithEmbeds(
                    args.path as string,
                    args.excludePatterns as string[] | undefined,
                    args.includeLinks as boolean | undefined,
                );
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
            const normalizedTag = tag.startsWith("#") ? tag.substring(1) : tag;
            files = files.filter((f) => {
                const cache = this.app.metadataCache.getFileCache(f);
                const tags = cache?.tags?.map((t) => t.tag.substring(1)) || [];
                const frontmatterTags =
                    (cache?.frontmatter?.tags as string[]) || [];
                const allTags = [...tags, ...frontmatterTags];
                return allTags.includes(normalizedTag);
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

    private async getLinkedNotes(path: string): Promise<{ links: string[] }> {
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

    private async listNotes(path: string): Promise<{ notes: string[] }> {
        const allFiles = this.app.vault.getMarkdownFiles();
        const files = path
            ? allFiles.filter((f) => f.path.startsWith(path))
            : allFiles;

        return {
            notes: files.map((f) => f.path).sort(),
        };
    }

    private async listNotesByTag(tags: string[]): Promise<{ notes: string[] }> {
        const normalizedTags = tags.map((t) =>
            t.startsWith("#") ? t.substring(1) : t,
        );
        const files = this.app.vault.getMarkdownFiles();

        const matchingFiles = files.filter((f) => {
            const cache = this.app.metadataCache.getFileCache(f);
            const fileTags = cache?.tags?.map((t) => t.tag.substring(1)) || [];
            const frontmatterTags =
                (cache?.frontmatter?.tags as string[]) || [];
            const allTags = [...fileTags, ...frontmatterTags];

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
        const expandedContent = await this.expandEmbeds(
            file,
            content,
            compiledPatterns,
            includeLinks,
        );

        return { content: expandedContent };
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

    private async expandEmbeds(
        sourceFile: TFile,
        content: string,
        excludePatterns: RegExp[] = [],
        includeLinks = false,
        depth = 0,
        processedFiles = new Set<string>(),
    ): Promise<string> {
        // Limit nesting to 2 levels
        if (depth >= 2) {
            return content;
        }

        // Mark this file as processed to prevent circular references
        processedFiles.add(sourceFile.path);

        let expandedContent = content;
        const fileCache = this.app.metadataCache.getFileCache(sourceFile);

        if (!fileCache) {
            return content;
        }

        const processedLinks = new Set<string>();

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

            // Skip if we've already processed this link target
            if (processedLinks.has(cachedLink.link)) {
                continue;
            }
            processedLinks.add(cachedLink.link);

            // Parse link to extract path and subpath
            const { path, subpath } = this.parseLinkReference(cachedLink.link);

            const targetFile = this.app.metadataCache.getFirstLinkpathDest(
                path,
                sourceFile.path,
            );

            if (targetFile) {
                // Skip if circular reference
                if (processedFiles.has(targetFile.path)) {
                    continue;
                }

                try {
                    const linkedContent =
                        await this.app.vault.cachedRead(targetFile);
                    const extractedContent = subpath
                        ? this.extractSubpathContent(
                              targetFile,
                              linkedContent,
                              subpath,
                          )
                        : linkedContent;

                    // Recursively expand embeds in the embedded content
                    const fullyExpandedContent = await this.expandEmbeds(
                        targetFile,
                        extractedContent,
                        excludePatterns,
                        includeLinks,
                        depth + 1,
                        processedFiles,
                    );

                    // Format as markdown section
                    const quotedContent = this.formatAsEmbedSection(
                        fullyExpandedContent,
                        cachedLink.link,
                        depth,
                    );
                    expandedContent += `\n\n${quotedContent}`;
                } catch (error) {
                    this.logger.error(
                        error,
                        "Could not read linked file:",
                        cachedLink.link,
                    );
                }
            }
        }

        return expandedContent;
    }

    private extractSubpathContent(
        file: TFile,
        fileContent: string,
        subpath: string,
    ): string {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache) {
            return fileContent;
        }

        // Check for block reference (^block-id)
        if (subpath.startsWith("^")) {
            const blockId = subpath.substring(1);
            const block = cache.blocks?.[blockId];
            if (block) {
                const lines = fileContent.split("\n");
                return lines[block.position.start.line] || "";
            }
            return fileContent;
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

        return fileContent;
    }

    private formatAsEmbedSection(
        content: string,
        linkTarget: string,
        depth: number,
    ): string {
        const prefix = ">".repeat(depth + 1);
        const lines = content
            .split("\n")
            .map((line) => `${prefix} ${line}`)
            .join("\n");
        const header = `${prefix} **Embedded: ${linkTarget}**`;
        return `${header}\n${lines}`;
    }
}
