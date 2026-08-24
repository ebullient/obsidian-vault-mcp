import {
    type App,
    type CachedMetadata,
    type HeadingCache,
    normalizePath,
    TFile,
} from "obsidian";
import type { LinkRef, NoteReadResult, OutlineEntry } from "./@types/notes";
import type { CurrentSettings, Logger } from "./@types/settings";
import type { PathACLChecker } from "./vaultasmcp-PathACL";
import type { TemplateHandler } from "./vaultasmcp-TemplateHandler";

type LineWindow = {
    content: string;
    startLine: number;
    endLine: number;
    totalLines: number;
    truncated: boolean;
};

const SINGLE_QUOTE_VARIANTS = "\u2018\u2019\u201a\u201b\u2032\u2035";
const DOUBLE_QUOTE_VARIANTS = "\u201c\u201d\u201e\u201f\u2033\u2036";
const SINGLE_QUOTE_VARIANTS_RE = new RegExp(`[${SINGLE_QUOTE_VARIANTS}]`, "g");
const DOUBLE_QUOTE_VARIANTS_RE = new RegExp(`[${DOUBLE_QUOTE_VARIANTS}]`, "g");
const SINGLE_QUOTE_VARIANTS_SET = new Set(SINGLE_QUOTE_VARIANTS);
const DOUBLE_QUOTE_VARIANTS_SET = new Set(DOUBLE_QUOTE_VARIANTS);

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
        heading?: string,
        metadataOnly = false,
        lineOffset?: number,
        excludePatterns?: string[],
        lineLimit?: number,
    ): Promise<NoteReadResult> {
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
                sizeBytes: file.stat.size,
            };
        }

        this.validateReadNotePaginationInputs(heading, lineOffset, lineLimit);

        const content = await this.app.vault.cachedRead(file);

        if (heading !== undefined) {
            return {
                content: this.extractSection(
                    file,
                    content,
                    heading,
                    lineOffset,
                ),
                embeds,
                links,
                frontmatter,
            };
        }

        if (lineOffset !== undefined || lineLimit !== undefined) {
            const window = this.getLineWindow(
                content,
                lineOffset ?? 0,
                lineLimit,
            );
            return {
                content: window.content,
                embeds,
                links,
                outline: this.getOutline(cache),
                frontmatter,
                startLine: window.startLine,
                endLine: window.endLine,
                totalLines: window.totalLines,
                truncated: window.truncated,
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
     * Resolve a heading selector (`name` and/or `lineOffset`) to its
     * index in cache.headings.
     *
     * - `lineOffset` only: resolves directly by exact
     *   `position.start.line` match, regardless of name.
     * - `name` only: resolves by case-insensitive, normalized name
     *   match. Throws if the name matches more than once.
     * - `name` + `lineOffset`: resolves by `lineOffset`, then
     *   validates the resolved heading's normalized text matches
     *   `name` — guards against the file having changed since the
     *   caller last read the outline.
     */
    private resolveHeadingIndex(
        headings: HeadingCache[],
        name: string | undefined,
        lineOffset: number | undefined,
    ): number {
        if (lineOffset !== undefined) {
            const index = headings.findIndex(
                (h) => h.position.start.line === lineOffset,
            );
            if (index === -1) {
                throw new Error(`No heading found at line ${lineOffset}`);
            }
            if (name !== undefined) {
                const normalizedName = this.normalizeHeading(name);
                if (
                    this.normalizeHeading(headings[index].heading) !==
                    normalizedName
                ) {
                    throw new Error(
                        `Heading at line ${lineOffset} is ` +
                            `"${headings[index].heading}", not "${name}". ` +
                            "The outline may be stale — refresh it with " +
                            "metadataOnly and retry.",
                    );
                }
            }
            return index;
        }

        const normalizedName = this.normalizeHeading(name ?? "");
        const matches: number[] = [];
        headings.forEach((h, i) => {
            if (this.normalizeHeading(h.heading) === normalizedName) {
                matches.push(i);
            }
        });

        if (matches.length === 0) {
            throw new Error(`Heading not found: ${name}`);
        }

        if (matches.length > 1) {
            throw new Error(
                `Heading "${name}" is ambiguous (${matches.length} ` +
                    "matches). Use metadataOnly to inspect the " +
                    "outline's line numbers, then pass lineOffset " +
                    "to select a specific occurrence.",
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
     * Heading outline for a note. `line` is the heading's
     * file-relative start line (0-based), so a caller can pass it
     * back as `lineOffset` to select or disambiguate a heading.
     */
    private getOutline(
        cache: CachedMetadata | null,
    ): OutlineEntry[] | undefined {
        if (!cache?.headings?.length) {
            return undefined;
        }
        return cache.headings.map((h) => ({
            text: h.heading,
            level: h.level,
            line: h.position.start.line,
        }));
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
        lineOffset?: number,
    ): Promise<{ path: string }> {
        const file = this.getFileWithAclCheck(path, true);

        if (heading !== undefined || lineOffset !== undefined) {
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
                    lineOffset,
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
     * Replace exact text in a note. Errors if old_text is not found,
     * or found more than once.
     * ACL: Requires write access
     */
    async patchNote(
        path: string,
        oldText: string,
        newText: string,
        lineOffset?: number,
    ): Promise<{ path: string }> {
        if (!path) throw new Error("path is required");
        if (!oldText) throw new Error("old_text is required");
        if (newText === undefined || newText === null)
            throw new Error("new_text is required");
        if (lineOffset !== undefined && lineOffset < 0) {
            throw new Error(
                "lineOffset must be a non-negative 0-based file line",
            );
        }
        const file = this.getFileWithAclCheck(path, true);

        await this.app.vault.process(file, (data) => {
            const hasCRLF = data.includes("\r\n");
            const normalizedData = this.normalizeWithOffsetMap(data);
            const normalizedOldText = this.normalize(oldText);

            const matches: { idx: number; line: number }[] = [];
            let searchFrom = 0;
            let scanFrom = 0;
            let currentLine = 0;
            while (searchFrom <= normalizedData.content.length) {
                const idx = normalizedData.content.indexOf(
                    normalizedOldText,
                    searchFrom,
                );
                if (idx === -1) {
                    break;
                }

                for (let i = scanFrom; i < idx; i++) {
                    if (normalizedData.content[i] === "\n") {
                        currentLine++;
                    }
                }

                matches.push({ idx, line: currentLine });
                scanFrom = idx;
                searchFrom = idx + 1;
            }

            if (matches.length === 0) {
                throw new Error("Text not found in note");
            }

            let idx = matches[0].idx;
            if (matches.length > 1) {
                if (lineOffset === undefined) {
                    throw new Error(
                        "Text appears more than once in note; " +
                            "provide more context to make it unique",
                    );
                }

                let bestMatch = matches[0];
                let bestDistance = Math.abs(bestMatch.line - lineOffset);
                let tied = false;

                for (const match of matches.slice(1)) {
                    const distance = Math.abs(match.line - lineOffset);
                    if (distance < bestDistance) {
                        bestMatch = match;
                        bestDistance = distance;
                        tied = false;
                    } else if (distance === bestDistance) {
                        tied = true;
                    }
                }

                if (tied) {
                    throw new Error(
                        "Text appears more than once in note; " +
                            "provide more context to make it unique",
                    );
                }
                idx = bestMatch.idx;
            }

            const originalStart = normalizedData.offsets[idx];
            const originalEnd =
                normalizedData.offsets[idx + normalizedOldText.length];
            const replacement = this.withLineEndings(newText, hasCRLF);

            return (
                data.substring(0, originalStart) +
                replacement +
                data.substring(originalEnd)
            );
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
        heading: string | undefined,
        lineOffset?: number,
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
            lineOffset,
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
     * Extract content for one section (by heading text and/or
     * lineOffset). Case-insensitive match; includes subheadings.
     * Throws if `heading` matches more than one heading and no
     * `lineOffset` disambiguates, if neither selector resolves to a
     * heading (including when the note has no headings at all), or if
     * both are given but disagree (stale outline).
     */
    private extractSection(
        file: TFile,
        fileContent: string,
        heading: string | undefined,
        lineOffset: number | undefined,
    ): string {
        const cache = this.app.metadataCache.getFileCache(file);
        const cacheHeadings = cache?.headings ?? [];
        const resolvedIndex = this.resolveHeadingIndex(
            cacheHeadings,
            heading,
            lineOffset,
        );
        const start = cacheHeadings[resolvedIndex].position.start.offset;
        const end = this.findSectionEnd(
            cacheHeadings,
            resolvedIndex,
            fileContent.length,
        );
        return fileContent.substring(start, end);
    }

    private validateReadNotePaginationInputs(
        heading: string | undefined,
        lineOffset: number | undefined,
        lineLimit: number | undefined,
    ): void {
        if (heading !== undefined && lineLimit !== undefined) {
            throw new Error("lineLimit cannot be used together with heading");
        }

        if (
            lineOffset !== undefined &&
            !this.isNonNegativeInteger(lineOffset)
        ) {
            throw new Error(
                `lineOffset must be a non-negative integer: ${lineOffset}`,
            );
        }

        if (lineLimit !== undefined && !this.isPositiveInteger(lineLimit)) {
            throw new Error(
                `lineLimit must be a positive integer: ${lineLimit}`,
            );
        }
    }

    /**
     * Return the raw file-content window for the requested line range.
     * Trailing newlines terminate the final real line but do not create
     * an extra empty one.
     */
    private getLineWindow(
        fileContent: string,
        lineOffset = 0,
        lineLimit?: number,
    ): LineWindow {
        const lineStarts = this.getLineStartOffsets(fileContent);
        const totalLines = lineStarts.length;

        if (lineOffset < 0 || lineOffset >= totalLines) {
            throw new Error(
                `lineOffset ${lineOffset} is out of range for ${totalLines} lines`,
            );
        }

        const endLine =
            lineLimit === undefined
                ? totalLines - 1
                : Math.min(lineOffset + lineLimit - 1, totalLines - 1);
        const startOffset = lineStarts[lineOffset];
        const endOffset =
            endLine + 1 < totalLines
                ? lineStarts[endLine + 1]
                : fileContent.length;

        return {
            content: fileContent.slice(startOffset, endOffset),
            startLine: lineOffset,
            endLine,
            totalLines,
            truncated: endLine < totalLines - 1,
        };
    }

    /**
     * Compute the start offset of each logical line in a file.
     * For files ending in "\n", the trailing newline belongs to the
     * last line rather than creating an empty extra line.
     */
    private getLineStartOffsets(fileContent: string): number[] {
        if (fileContent.length === 0) {
            return [];
        }

        const starts = [0];
        for (let i = 0; i < fileContent.length; i++) {
            if (fileContent[i] === "\n" && i + 1 < fileContent.length) {
                starts.push(i + 1);
            }
        }
        return starts;
    }

    private isNonNegativeInteger(value: number): boolean {
        return Number.isInteger(value) && value >= 0;
    }

    private isPositiveInteger(value: number): boolean {
        return Number.isInteger(value) && value > 0;
    }

    private normalize = (value: string): string => {
        let result = value.replace(/\r\n/g, "\n");
        if (this.current.normalizeQuotes()) {
            result = result
                .replace(SINGLE_QUOTE_VARIANTS_RE, "'")
                .replace(DOUBLE_QUOTE_VARIANTS_RE, '"');
        }
        return result;
    };

    private normalizeWithOffsetMap(value: string): {
        content: string;
        offsets: number[];
    } {
        let content = "";
        const offsets: number[] = [];

        for (let i = 0; i < value.length; i++) {
            const char = value[i];
            let normalizedChar = char;

            if (char === "\r" && value[i + 1] === "\n") {
                normalizedChar = "\n";
                offsets.push(i);
                content += normalizedChar;
                i++;
                continue;
            }

            if (this.current.normalizeQuotes()) {
                normalizedChar = this.normalizeQuoteChar(char);
            }

            offsets.push(i);
            content += normalizedChar;
        }

        offsets.push(value.length);
        return { content, offsets };
    }

    private withLineEndings(value: string, useCRLF: boolean): string {
        const normalized = value.replace(/\r\n/g, "\n");
        return useCRLF ? normalized.replace(/\n/g, "\r\n") : normalized;
    }

    private normalizeQuoteChar(char: string): string {
        if (SINGLE_QUOTE_VARIANTS_SET.has(char)) {
            return "'";
        }
        if (DOUBLE_QUOTE_VARIANTS_SET.has(char)) {
            return '"';
        }
        return char;
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
