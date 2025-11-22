import { type App, normalizePath, TFile, TFolder } from "obsidian";
import type { Logger } from "./@types/settings";
import type { PathACLChecker } from "./vaultasmcp-PathACL";
import type { TemplateHandler } from "./vaultasmcp-TemplateHandler";

// Limit embed expansion depth to prevent performance issues and circular refs
const MAX_DEPTH = 2;
type EmbeddedLink = {
    subpaths: Set<string>; // headings, blockrefs
    hasFullReference: boolean;
    file: TFile | null; // null for unresolved links
    depth: number;
};
type EmbeddedNotes = Map<string, EmbeddedLink>;

/**
 * Handles all note CRUD operations with ACL enforcement
 */
export class NoteHandler {
    constructor(
        private app: App,
        private templateHandler: TemplateHandler,
        private aclChecker: PathACLChecker,
        private logger: Logger,
    ) {}

    /**
     * Get file with ACL check (read or write)
     * Consolidates: normalize → ACL check → fetch → validate
     */
    private getFileWithAclCheck(path: string, write = false): TFile {
        const normalizedPath = normalizePath(path);

        if (write) {
            this.aclChecker.checkWriteAccess(normalizedPath);
        } else {
            this.aclChecker.checkReadAccess(normalizedPath);
        }

        const file = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (!(file instanceof TFile)) {
            throw new Error(`Note not found: ${normalizedPath}`);
        }

        return file;
    }

    /**
     * Read a note's content
     * ACL: Requires read access
     */
    async readNote(path: string): Promise<{ content: string }> {
        const file = this.getFileWithAclCheck(path);
        const content = await this.app.vault.cachedRead(file);
        return { content };
    }

    /**
     * Create a new note
     * ACL: Requires write access
     */
    async createNote(
        path: string,
        content?: string,
        template?: string,
        binary = false,
    ): Promise<{ path: string }> {
        // Normalize path first for ACL check
        let normalizedPath = normalizePath(path);
        if (!binary && !normalizedPath.endsWith(".md")) {
            normalizedPath = `${normalizedPath}.md`;
        }

        this.aclChecker.checkWriteAccess(normalizedPath);

        // If template is provided, use template handler
        if (template) {
            const normalizedTemplate = normalizePath(template);
            this.aclChecker.checkReadAccess(normalizedTemplate);
            const file = await this.templateHandler.createFromTemplate(
                normalizedTemplate,
                normalizedPath,
            );
            if (content) {
                await this.appendToNote(file.path, content);
            }
            return { path: file.path };
        }

        // Otherwise, create from content
        if (!content) {
            throw new Error("Either content or template must be provided");
        }

        // Check if file already exists
        const existing = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (existing) {
            throw new Error(`File already exists: ${normalizedPath}`);
        }

        // Create parent folders if needed
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

        this.logger.debug(`Created note: ${file.path}`);
        return { path: file.path };
    }

    /**
     * Append content to an existing note
     * ACL: Requires write access
     */
    async appendToNote(
        path: string,
        content: string,
        heading?: string,
        separator = "\n",
    ): Promise<{ path: string }> {
        const file = this.getFileWithAclCheck(path, true);

        if (heading) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache?.sections || !cache.headings) {
                throw new Error(
                    "Heading lookup unavailable: note metadata not " +
                        "indexed yet. Retry in a moment.",
                );
            }

            // Heading-based insertion
            await this.app.vault.process(file, (data) => {
                const insertOffset = this.findHeadingEndOffset(file, heading);
                if (insertOffset === undefined) {
                    throw new Error(`Heading not found: ${heading}`);
                }

                const before = data.slice(0, insertOffset);
                const after = data.slice(insertOffset);
                const addition = `${separator}${content}`;
                return `${before}${addition}${after}`;
            });
        } else {
            // Append to end of file
            await this.app.vault.process(file, (data) => {
                return data + separator + content;
            });
        }

        this.logger.debug(`Appended to note: ${file.path}`);
        return { path: file.path };
    }

    /**
     * Update (replace) note content
     * ACL: Requires write access
     */
    async updateNote(path: string, content: string): Promise<{ path: string }> {
        const file = this.getFileWithAclCheck(path, true);

        // Replace entire content using process for safety
        await this.app.vault.process(file, () => {
            return content;
        });

        this.logger.debug(`Updated note: ${file.path}`);
        return { path: file.path };
    }

    /**
     * Delete a note (move to trash)
     * ACL: Requires write access
     */
    async deleteNote(path: string): Promise<{ path: string }> {
        const file = this.getFileWithAclCheck(path, true);

        // Move to system trash (recoverable)
        await this.app.fileManager.trashFile(file);

        this.logger.debug(`Deleted note: ${file.path}`);
        return { path: file.path };
    }

    private findHeadingEndOffset(
        file: TFile,
        heading: string,
    ): number | undefined {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache?.sections || !cache.headings) {
            return undefined;
        }

        const sections = cache.sections;
        const foundHeading = cache.headings.find((h) => h.heading === heading);

        if (!foundHeading) {
            return undefined;
        }

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

    /**
     * Read note with embedded content expanded inline
     * ACL: Requires read access to main note and all embedded files
     */
    async readNoteWithEmbeds(
        path: string,
        excludePatterns?: string[],
        includeLinks = false,
    ): Promise<{ content: string }> {
        const file = this.getFileWithAclCheck(path);
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

    /**
     * Expand linked/embedded files inline with the main content
     */
    private async expandLinkedFiles(
        sourceFile: TFile,
        content: string,
        excludePatterns: RegExp[] = [],
        includeLinks = false,
    ): Promise<string> {
        const fileCache = this.app.metadataCache.getFileCache(sourceFile);
        if (!fileCache) {
            return content;
        }

        // Phase 1: Collect all linked files via breadth-first traversal
        const linkedFiles = this.collectLinkedFiles(
            sourceFile,
            excludePatterns,
            includeLinks,
        );

        // Remove source file from expansion (already in main content)
        linkedFiles.delete(sourceFile.path);

        // Phase 2: Expand content from collected files
        const expandedContent = await this.expandCollectedContent(linkedFiles);

        if (expandedContent.length) {
            return (
                content +
                "\n----- EMBEDDED/LINKED CONTENT -----\n" +
                expandedContent.join("\n")
            );
        }
        return content;
    }

    /**
     * Phase 1: Collect linked files via breadth-first traversal
     * Respects MAX_DEPTH and ACL permissions
     */
    private collectLinkedFiles(
        sourceFile: TFile,
        excludePatterns: RegExp[],
        includeLinks: boolean,
    ): EmbeddedNotes {
        const seenLinks: EmbeddedNotes = new Map();
        const fileQueue: EmbeddedLink[] = [];

        // Track source file to prevent duplicates
        const origin = {
            hasFullReference: true,
            subpaths: new Set<string>(),
            file: sourceFile,
            depth: 0,
        };
        seenLinks.set(sourceFile.path, origin);
        fileQueue.push(origin);

        // Process queue breadth-first
        let embeddedLink = fileQueue.shift();
        while (embeddedLink) {
            // Skip if file wasn't found (null) or max depth reached
            if (!embeddedLink.file || embeddedLink.depth >= MAX_DEPTH) {
                embeddedLink = fileQueue.shift();
                continue;
            }

            const fileCache = this.app.metadataCache.getFileCache(
                embeddedLink.file,
            );
            if (fileCache) {
                // Process both links and embeds
                const allLinks = [
                    ...(includeLinks ? fileCache.links || [] : []),
                    ...(fileCache.embeds || []),
                ].filter((link) => link);

                for (const cachedLink of allLinks) {
                    // Skip if link matches exclusion patterns
                    if (this.shouldExcludeLink(cachedLink, excludePatterns)) {
                        continue;
                    }

                    // Skip duplicate unresolved links
                    const linkKey = cachedLink.link;
                    if (seenLinks.has(linkKey)) {
                        continue;
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
                        // Add to seen list to avoid checking again
                        seenLinks.set(linkKey, {
                            hasFullReference: false,
                            subpaths: new Set<string>(),
                            file: null,
                            depth: embeddedLink.depth + 1,
                        });
                        continue;
                    }

                    // Check ACL for target file
                    try {
                        this.aclChecker.checkReadAccess(targetFile.path);
                    } catch {
                        this.logger.debug(
                            `Access denied to linked file: ${targetFile.path}`,
                        );
                        // Skip forbidden files silently
                        seenLinks.set(linkKey, {
                            hasFullReference: false,
                            subpaths: new Set<string>(),
                            file: null,
                            depth: embeddedLink.depth + 1,
                        });
                        continue;
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
                        fileQueue.push(ref);
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

        return seenLinks;
    }

    /**
     * Phase 2: Expand content from collected linked files
     * Formats each file with markers and handles subpath references
     */
    private async expandCollectedContent(
        linkedFiles: EmbeddedNotes,
    ): Promise<string[]> {
        const expandedContent: string[] = [];

        this.logger.debug(
            `Collecting content from ${linkedFiles.size} linked files`,
        );

        for (const link of linkedFiles.values()) {
            // Skip null file entries and non-markdown files
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

        return expandedContent;
    }

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
        const targetNormalized = this.normalizeHeading(subpath);
        const heading = cache.headings?.find(
            (h) => this.normalizeHeading(h.heading) === targetNormalized,
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

    private normalizeHeading = (value: string): string => {
        let decoded = value;
        try {
            decoded = decodeURIComponent(value);
        } catch {
            decoded = value.replace(/%20/g, " ");
        }
        return decoded
            .trim()
            .toLowerCase()
            .replace(/[^\w\s-]/g, "") // drop punctuation
            .replace(/[\s_]+/g, "-"); // collapse spaces/underscores
    };

    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        try {
            const binaryString = atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes.buffer;
        } catch (error) {
            throw new Error(
                `Invalid base64 content: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }
}
