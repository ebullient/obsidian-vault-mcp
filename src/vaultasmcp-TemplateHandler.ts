import { type App, normalizePath, TFile, TFolder } from "obsidian";
import type { Logger } from "./@types/settings";
import type { PathACLChecker } from "./vaultasmcp-PathACL";

declare module "obsidian" {
    interface App {
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
    templater_enabled: boolean;
}

export class TemplateHandler {
    constructor(
        private app: App,
        private aclChecker?: PathACLChecker,
        private logger?: Logger,
    ) {}

    /**
     * Get information about available templates and Templater plugin
     */
    listTemplates(): TemplateInfo {
        const templaterEnabled = this.isTemplaterEnabled();

        if (templaterEnabled) {
            const templatesFolder = this.getTemplatesFolder();
            const templates = this.getTemplateFiles(templatesFolder);
            return {
                templates_folder: templatesFolder,
                templates,
                templater_enabled: true,
            };
        }

        return {
            templater_enabled: false,
        };
    }

    /**
     * Create a note from a template using Templater plugin
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

        if (!this.isTemplaterEnabled()) {
            throw new Error(
                "Templater plugin is required for template support. " +
                    "Please install and enable the Templater plugin.",
            );
        }

        return await this.createWithTemplater(
            templateFile,
            targetPath,
            targetFolder,
        );
    }

    /**
     * Check if Templater plugin is enabled
     */
    private isTemplaterEnabled(): boolean {
        const plugin = this.app.plugins.getPlugin("templater-obsidian");
        return plugin != null;
    }

    /**
     * Get templates folder path from Templater settings
     */
    private getTemplatesFolder(): string {
        const templater = this.app.plugins.getPlugin("templater-obsidian");
        if (templater?.settings?.templates_folder) {
            return templater.settings.templates_folder;
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
                    // Filter by ACL if checker is available
                    if (this.aclChecker) {
                        try {
                            this.aclChecker.checkReadAccess(child.path);
                            templates.push(child.path);
                        } catch {
                            // Silently skip forbidden templates
                        }
                    } else {
                        templates.push(child.path);
                    }
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
            throw new Error(
                `Failed to create note from template: ${templateFile.path}`,
            );
        }

        this.logger?.debug(
            `Created note from template: ${templateFile.path} -> ${createdFile.path}`,
        );
        return createdFile;
    }
}
