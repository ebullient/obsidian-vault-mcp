import { type App, normalizePath, TFile, TFolder } from "obsidian";

declare module "obsidian" {
    interface App {
        internalPlugins: {
            getPluginById(id: "templates"): {
                enabled: boolean;
                instance?: {
                    options?: {
                        folder?: string;
                    };
                    insertTemplate(file: TFile): Promise<void>;
                };
            };
        };
        plugins: {
            getPlugin(id: "templater-obsidian"): {
                settings?: {
                    templates_folder?: string;
                };
                templater?: {
                    create_new_note_from_template(
                        template: TFile,
                        folder?: TFolder | string,
                        filename?: string,
                        open_new_note?: boolean,
                    ): Promise<TFile | undefined>;
                };
            };
        };
    }
}

export interface TemplateInfo {
    templates_folder?: string;
    templates?: string[];
    core_templates_enabled: boolean;
    templater_enabled: boolean;
}

export class TemplateHandler {
    constructor(private app: App) {}

    /**
     * Get information about available templates and enabled plugins
     */
    listTemplates(): TemplateInfo {
        const templaterEnabled = this.isTemplaterEnabled();
        const coreTemplatesEnabled = this.isCoreTemplatesEnabled();

        if (templaterEnabled || coreTemplatesEnabled) {
            // Get templates folder (prefer Templater, fall back to Core)
            const templatesFolder = this.getTemplatesFolder();

            // List all .md files in templates folder
            const templates = this.getTemplateFiles(templatesFolder);
            return {
                templates_folder: templatesFolder,
                templates,
                core_templates_enabled: coreTemplatesEnabled,
                templater_enabled: templaterEnabled,
            };
        }

        return {
            core_templates_enabled: false,
            templater_enabled: false,
        };
    }

    /**
     * Create a note from a template
     */
    async createFromTemplate(
        templatePath: string,
        targetPath: string,
        targetFolder?: string,
    ): Promise<TFile> {
        const normalizedTemplate = normalizePath(templatePath);
        const templateFile =
            this.app.vault.getAbstractFileByPath(normalizedTemplate);

        if (!(templateFile instanceof TFile)) {
            throw new Error(`Template not found: ${normalizedTemplate}`);
        }

        // Try Templater first (more powerful)
        if (this.isTemplaterEnabled()) {
            return await this.createWithTemplater(
                templateFile,
                targetPath,
                targetFolder,
            );
        }

        // Fall back to Core Templates (simpler)
        if (this.isCoreTemplatesEnabled()) {
            return await this.createWithCoreTemplates(
                templateFile,
                targetPath,
                targetFolder,
            );
        }

        throw new Error(
            "No template plugin available. " +
                "Enable Core Templates or Templater plugin.",
        );
    }

    /**
     * Check if Core Templates plugin is enabled
     */
    private isCoreTemplatesEnabled(): boolean {
        const plugin = this.app.internalPlugins.getPluginById("templates");
        return plugin?.enabled ?? false;
    }

    /**
     * Check if Templater plugin is enabled
     */
    private isTemplaterEnabled(): boolean {
        const plugin = this.app.plugins.getPlugin("templater-obsidian");
        return plugin != null;
    }

    /**
     * Get templates folder path
     */
    private getTemplatesFolder(): string {
        // Try Templater settings first
        const templater = this.app.plugins.getPlugin("templater-obsidian");
        if (templater?.settings?.templates_folder) {
            return templater.settings.templates_folder;
        }

        // Fall back to Core Templates settings
        const coreTemplates =
            this.app.internalPlugins.getPluginById("templates");
        if (coreTemplates?.instance?.options?.folder) {
            return coreTemplates.instance.options.folder;
        }

        // Default fallback
        return "templates";
    }

    /**
     * Get list of template files in folder
     */
    private getTemplateFiles(folderPath: string): string[] {
        const normalizedPath = normalizePath(folderPath);
        const folder = this.app.vault.getAbstractFileByPath(normalizedPath);

        if (!(folder instanceof TFolder)) {
            return [];
        }

        const templates: string[] = [];
        const collectTemplates = (currentFolder: TFolder) => {
            for (const child of currentFolder.children) {
                if (child instanceof TFile && child.extension === "md") {
                    templates.push(child.path);
                } else if (child instanceof TFolder) {
                    collectTemplates(child);
                }
            }
        };

        collectTemplates(folder);
        return templates.sort();
    }

    /**
     * Create note using Templater plugin
     */
    private async createWithTemplater(
        templateFile: TFile,
        targetPath: string,
        targetFolder?: string,
    ): Promise<TFile> {
        const templater = this.app.plugins.getPlugin("templater-obsidian");
        if (!templater?.templater) {
            throw new Error("Templater plugin not available");
        }

        // Parse path into folder and filename
        const normalizedPath = normalizePath(targetPath);
        let folder: TFolder | string | undefined;
        let filename: string;

        if (targetFolder) {
            folder = targetFolder;
            filename = normalizedPath;
        } else {
            const parts = normalizedPath.split("/");
            if (parts.length > 1) {
                folder = parts.slice(0, -1).join("/");
                filename = parts[parts.length - 1];
            } else {
                filename = normalizedPath;
            }
        }

        // Remove .md extension if present (Templater adds it)
        if (filename.endsWith(".md")) {
            filename = filename.slice(0, -3);
        }

        const createdFile =
            await templater.templater.create_new_note_from_template(
                templateFile,
                folder,
                filename,
                false, // don't open file
            );

        if (!createdFile) {
            throw new Error("Failed to create note from template");
        }

        return createdFile;
    }

    /**
     * Create note using Core Templates plugin
     */
    private async createWithCoreTemplates(
        templateFile: TFile,
        targetPath: string,
        targetFolder?: string,
    ): Promise<TFile> {
        const coreTemplates =
            this.app.internalPlugins.getPluginById("templates");
        if (!coreTemplates?.instance) {
            throw new Error("Core Templates plugin not available");
        }

        // Build full path
        let normalizedPath = normalizePath(targetPath);
        if (targetFolder) {
            normalizedPath = normalizePath(`${targetFolder}/${normalizedPath}`);
        }

        // Ensure .md extension
        if (!normalizedPath.endsWith(".md")) {
            normalizedPath = `${normalizedPath}.md`;
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

        // Create empty file
        const file = await this.app.vault.create(normalizedPath, "");

        // Open the file to make it active
        const leaf = this.app.workspace.getLeaf(false);
        if (!leaf) {
            throw new Error("Could not get workspace leaf");
        }
        await leaf.openFile(file);

        // Insert template using Core Templates API
        await coreTemplates.instance.insertTemplate(templateFile);

        return file;
    }
}
