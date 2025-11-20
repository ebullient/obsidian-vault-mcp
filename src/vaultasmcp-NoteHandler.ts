import { type App, normalizePath, TFile, TFolder } from "obsidian";
import type { PathACLChecker } from "./vaultasmcp-PathACL";
import type { TemplateHandler } from "./vaultasmcp-TemplateHandler";

/**
 * Handles all note CRUD operations with ACL enforcement
 */
export class NoteHandler {
    constructor(
        private app: App,
        private templateHandler: TemplateHandler,
        private aclChecker: PathACLChecker,
    ) {}

    /**
     * Read a note's content
     * ACL: Requires read access
     */
    async readNote(path: string): Promise<{ content: string }> {
        const normalizedPath = normalizePath(path);
        this.aclChecker.checkReadAccess(normalizedPath);

        const file = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (!(file instanceof TFile)) {
            throw new Error(`Note not found: ${normalizedPath}`);
        }

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
            const file = await this.templateHandler.createFromTemplate(
                template,
                normalizedPath,
            );
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
        const normalizedPath = normalizePath(path);
        this.aclChecker.checkWriteAccess(normalizedPath);

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

    /**
     * Update (replace) note content
     * ACL: Requires write access
     */
    async updateNote(path: string, content: string): Promise<{ path: string }> {
        const normalizedPath = normalizePath(path);
        this.aclChecker.checkWriteAccess(normalizedPath);

        const file = this.app.vault.getAbstractFileByPath(normalizedPath);

        if (!(file instanceof TFile)) {
            throw new Error(`Note not found: ${normalizedPath}`);
        }

        // Replace entire content
        await this.app.vault.modify(file, content);

        return { path: file.path };
    }

    /**
     * Delete a note (move to trash)
     * ACL: Requires write access
     */
    async deleteNote(path: string): Promise<{ path: string }> {
        const normalizedPath = normalizePath(path);
        this.aclChecker.checkWriteAccess(normalizedPath);

        const file = this.app.vault.getAbstractFileByPath(normalizedPath);

        if (!(file instanceof TFile)) {
            throw new Error(`Note not found: ${normalizedPath}`);
        }

        // Move to system trash (recoverable)
        await this.app.fileManager.trashFile(file);

        return { path: normalizedPath };
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
}
