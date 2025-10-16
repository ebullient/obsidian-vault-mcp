import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { MCPTool } from "./@types/settings";

export class MCPTools {
    constructor(private app: App) {}

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
}
