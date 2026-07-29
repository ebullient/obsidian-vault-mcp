import {
    type App,
    type CachedMetadata,
    type HeadingCache,
    normalizePath,
    TFile,
} from "obsidian";
import type { CurrentSettings, Logger } from "./@types/settings";
import type { PathACLChecker } from "./vaultasmcp-PathACL";
import type { TemplateHandler } from "./vaultasmcp-TemplateHandler";

type LinkRef = { path: string; subpath?: string };
type OutlineEntry = { text: string; level: number; index: number };

/**
 * Handles all note CRUD operations with ACL enforcement
 */
export class NoteHandler {
    constructor(
        private app: App,
        private templateHandler: TemplateHandler,
        private aclChecker: PathACLChecker,
        private logger: Logger,
        private current: CurrentSettings,
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
     * Read a note's content, plus its links/embeds/outline/frontmatter.
     * ACL: Requires read access
     */
    async readNote(
        path: string,
        headings?: string[],
        metadataOnly = false,
        headingIndexes?: Record<string, number | number[]>,
        excludePatterns?: string[],
    ): Promise<{
        content?: string;
        embeds?: LinkRef[];
        links?: LinkRef[];
        outline?: OutlineEntry[];
        frontmatter?: Record<string, unknown>;
    }> {
        const file = this.getFileWithAclCheck(path);
        const cache = this.app.metadataCache.getFileCache(file);
        const compiledPatterns = this.compileExcludePatterns(
            excludePatterns || [],
        );
        const embeds = this.getDirectLinkRefs(
            file,
            cache?.embeds,
            compiledPatterns,
        );
        const links = this.getDirectLinkRefs(
            file,
            cache?.links,
            compiledPatterns,
        );
        const frontmatter = cache?.frontmatter ?? undefined;

        if (metadataOnly) {
            return {
                embeds,
                links,
                outline: this.getOutline(cache),
                frontmatter,
            };
        }

        const content = await this.app.vault.cachedRead(file);

        if (headings && headings.length > 0) {
            return {
                content: this.extractSections(
                    file,
                    content,
                    headings,
                    headingIndexes,
                ),
                embeds,
                links,
                frontmatter,
            };
        }

        return {
            content,
            embeds,
            links,
            outline: this.getOutline(cache),
            frontmatter,
        };
    }

    /**
     * Resolve a heading by name (case-insensitive) to its index in
     * cache.headings. Throws if the name matches more than once, unless
     * `index` (0-based, among same-named matches) disambiguates which
     * occurrence to use. `paramName` names the caller's disambiguation
     * parameter (e.g. "headingIndex") so error messages point at the
     * right one for the tool that's actually being called.
     */
    private resolveHeadingIndex(
        headings: HeadingCache[],
        name: string,
        index: number | undefined,
        paramName: string,
    ): number {
        const normalizedName = this.normalizeHeading(name);
        const matches: number[] = [];
        headings.forEach((h, i) => {
            if (this.normalizeHeading(h.heading) === normalizedName) {
                matches.push(i);
            }
        });

        if (matches.length === 0) {
            throw new Error(`Heading not found: ${name}`);
        }

        if (index !== undefined) {
            if (index < 0 || index >= matches.length) {
                throw new Error(
                    `Heading index ${index} out of range for "${name}" ` +
                        `(${matches.length} match(es), valid range ` +
                        `0-${matches.length - 1})`,
                );
            }
            return matches[index];
        }

        if (matches.length > 1) {
            throw new Error(
                `Heading "${name}" is ambiguous (${matches.length} ` +
                    "matches). Use metadataOnly to inspect outline " +
                    `indices, then pass ${paramName} to select a ` +
                    "specific occurrence.",
            );
        }

        return matches[0];
    }

    /**
     * Direct (depth-1) link/embed targets of a note, resolved to vault
     * paths. Broken/unresolved targets and targets the caller lacks
     * read access to are silently omitted. `entries` is `cache.embeds`
     * or `cache.links`; `excludePatterns` matches against
     * `[display](link)` text, same as embed expansion used to.
     */
    private getDirectLinkRefs(
        sourceFile: TFile,
        entries: { link: string; displayText?: string }[] | undefined,
        excludePatterns: RegExp[],
    ): LinkRef[] | undefined {
        if (!entries?.length) {
            return undefined;
        }

        const seen = new Set<string>();
        const result: LinkRef[] = [];

        for (const entry of entries) {
            if (this.shouldExcludeLink(entry, excludePatterns)) {
                continue;
            }
            const { path, subpath } = this.parseLinkReference(entry.link);
            const targetFile = this.app.metadataCache.getFirstLinkpathDest(
                path,
                sourceFile.path,
            );
            if (!targetFile) {
                continue;
            }
            try {
                this.aclChecker.checkReadAccess(targetFile.path);
            } catch {
                continue;
            }

            const key = subpath
                ? `${targetFile.path}#${subpath}`
                : targetFile.path;
            if (seen.has(key)) continue;
            seen.add(key);

            result.push(
                subpath
                    ? { path: targetFile.path, subpath }
                    : { path: targetFile.path },
            );
        }

        return result.length ? result : undefined;
    }

    /**
     * Heading outline for a note. `index` is the 0-based occurrence
     * count among same-named headings (matches resolveHeadingIndex's
     * numbering), so a caller can pass it back to disambiguate.
     */
    private getOutline(
        cache: CachedMetadata | null,
    ): OutlineEntry[] | undefined {
        if (!cache?.headings?.length) {
            return undefined;
        }
        const countByName = new Map<string, number>();
        return cache.headings.map((h) => {
            const key = this.normalizeHeading(h.heading);
            const index = countByName.get(key) ?? 0;
            countByName.set(key, index + 1);
            return { text: h.heading, level: h.level, index };
        });
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
        const dir = normalizedPath.split("/").slice(0, -1).join("/");
        if (dir) {
            const dirItem = this.app.vault.getAbstractFileByPath(dir);
            if (dirItem instanceof TFile) {
                throw new Error(`Path exists as a file, not a folder: ${dir}`);
            }
            if (!dirItem) {
                await this.app.vault.createFolder(dir);
            }
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
        headingIndex?: number,
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
                const insertOffset = this.findHeadingEndOffset(
                    file,
                    heading,
                    headingIndex,
                );

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
     * Patch a note by replacing an exact string with new text.
     * Optionally scoped to a named heading's section (heading + its
     * content). Errors if old_text is not found, or found more than once.
     * ACL: Requires write access
     */
    async patchNote(
        path: string,
        oldText: string,
        newText: string,
        heading?: string,
        headingIndex?: number,
    ): Promise<{ path: string }> {
        if (!path) throw new Error("path is required");
        if (!oldText) throw new Error("old_text is required");
        if (newText === undefined || newText === null)
            throw new Error("new_text is required");
        const file = this.getFileWithAclCheck(path, true);

        await this.app.vault.process(file, (data) => {
            const hasCRLF = data.includes("\r\n");
            const normalizedData = this.normalize(data);
            const normalizedOldText = this.normalize(oldText);

            let searchIn = normalizedData;
            let searchOffset = 0;

            if (heading) {
                const cache = this.app.metadataCache.getFileCache(file);
                if (!cache?.headings) {
                    throw new Error(
                        "Section lookup unavailable: note metadata not " +
                            "indexed yet. Retry in a moment.",
                    );
                }
                const resolvedIndex = this.resolveHeadingIndex(
                    cache.headings,
                    heading,
                    headingIndex,
                    "headingIndex",
                );
                const start =
                    cache.headings[resolvedIndex].position.start.offset;
                const end = this.findSectionEnd(
                    cache.headings,
                    resolvedIndex,
                    normalizedData.length,
                );
                searchIn = normalizedData.substring(start, end);
                searchOffset = start;
            }

            const idx = searchIn.indexOf(normalizedOldText);
            if (idx === -1) {
                throw new Error(
                    heading
                        ? `Text not found in section "${heading}"`
                        : "Text not found in note",
                );
            }
            if (searchIn.indexOf(normalizedOldText, idx + 1) !== -1) {
                throw new Error(
                    heading
                        ? `Text appears more than once in section "${heading}"; ` +
                              "provide more context to make it unique"
                        : "Text appears more than once in note; " +
                              "provide more context to make it unique",
                );
            }

            const absIdx = searchOffset + idx;
            const result =
                normalizedData.substring(0, absIdx) +
                newText +
                normalizedData.substring(absIdx + normalizedOldText.length);
            return hasCRLF ? result.replace(/\n/g, "\r\n") : result;
        });

        this.logger.debug(`Patched note: ${file.path}`);
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

    /**
     * Rename or move a note
     * ACL: Requires write access to both old and new paths
     */
    async renameNote(path: string, newPath: string): Promise<{ path: string }> {
        // Write ACL check on source (write=true); also fetches the TFile
        const file = this.getFileWithAclCheck(path, true);

        // Auto-append .md only if source is a markdown file
        let normalizedNew = normalizePath(newPath);
        if (file.extension === "md" && !normalizedNew.endsWith(".md")) {
            normalizedNew = `${normalizedNew}.md`;
        }

        // Write ACL check on destination
        this.aclChecker.checkWriteAccess(normalizedNew);

        // Fail fast if destination already exists
        const existing = this.app.vault.getAbstractFileByPath(normalizedNew);
        if (existing) {
            throw new Error(`File already exists: ${normalizedNew}`);
        }

        // Create parent folders if needed
        const dir = normalizedNew.split("/").slice(0, -1).join("/");
        if (dir) {
            const dirItem = this.app.vault.getAbstractFileByPath(dir);
            if (dirItem instanceof TFile) {
                throw new Error(`Path exists as a file, not a folder: ${dir}`);
            }
            if (!dirItem) {
                await this.app.vault.createFolder(dir);
            }
        }

        // fileManager.renameFile also updates all internal links
        await this.app.fileManager.renameFile(file, normalizedNew);

        this.logger.debug(`Renamed note: ${file.path} → ${normalizedNew}`);
        return { path: normalizedNew };
    }

    private findHeadingEndOffset(
        file: TFile,
        heading: string,
        headingIndex?: number,
    ): number {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache?.sections || !cache.headings) {
            throw new Error(
                "Heading lookup unavailable: note metadata not " +
                    "indexed yet. Retry in a moment.",
            );
        }

        const sections = cache.sections;
        const resolvedIndex = this.resolveHeadingIndex(
            cache.headings,
            heading,
            headingIndex,
            "headingIndex",
        );
        const foundHeading = cache.headings[resolvedIndex];

        // Find the section for this heading
        const foundSectionIndex = sections.findIndex(
            (section) =>
                section.type === "heading" &&
                section.position.start.line ===
                    foundHeading.position.start.line,
        );

        if (foundSectionIndex === -1) {
            throw new Error(`Heading not found: ${heading}`);
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
     * Find the end offset of a heading's section
     * (up to the next heading at same or higher level).
     */
    private findSectionEnd(
        headings: { level: number; position: { start: { offset: number } } }[],
        headingIndex: number,
        fileLength: number,
    ): number {
        const level = headings[headingIndex].level;
        for (const h of headings.slice(headingIndex + 1)) {
            if (h.level <= level) {
                return h.position.start.offset;
            }
        }
        return fileLength;
    }

    /**
     * Extract content for named sections (by heading text).
     * Case-insensitive match; includes subheadings. Throws if a name
     * matches more than one heading, unless disambiguated via
     * `headingIndexes` (name -> 0-based occurrence index, or an array
     * of indices to return more than one occurrence of the same name).
     */
    private extractSections(
        file: TFile,
        fileContent: string,
        headings: string[],
        headingIndexes?: Record<string, number | number[]>,
    ): string {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache?.headings || cache.headings.length === 0) {
            return "";
        }

        const cacheHeadings = cache.headings;
        const parts: string[] = [];

        for (const name of headings) {
            const requested = headingIndexes?.[name];
            const indexes = Array.isArray(requested) ? requested : [requested];

            for (const index of indexes) {
                const resolvedIndex = this.resolveHeadingIndex(
                    cacheHeadings,
                    name,
                    index,
                    "headingIndexes",
                );
                const start =
                    cacheHeadings[resolvedIndex].position.start.offset;
                const end = this.findSectionEnd(
                    cacheHeadings,
                    resolvedIndex,
                    fileContent.length,
                );
                parts.push(fileContent.substring(start, end).trim());
            }
        }

        return parts.join("\n\n");
    }

    private normalize = (value: string): string => {
        let result = value.replace(/\r\n/g, "\n");
        if (this.current.normalizeQuotes()) {
            result = result
                .replace(/[\u2018\u2019\u201a\u201b\u2032\u2035]/g, "'")
                .replace(/[\u201c\u201d\u201e\u201f\u2033\u2036]/g, '"');
        }
        return result;
    };

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
