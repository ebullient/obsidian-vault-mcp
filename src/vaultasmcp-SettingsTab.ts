import { type App, PluginSettingTab, Setting } from "obsidian";
import type { VaultAsMCPSettings } from "./@types/settings";
import type { VaultAsMCPPlugin } from "./vaultasmcp-Plugin";

export class VaultAsMCPSettingsTab extends PluginSettingTab {
    plugin: VaultAsMCPPlugin;
    newSettings!: VaultAsMCPSettings;

    constructor(app: App, plugin: VaultAsMCPPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async save() {
        const needsRestart =
            this.plugin.settings.serverPort !== this.newSettings.serverPort;

        this.plugin.settings = this.newSettings;
        await this.plugin.saveSettings();

        if (needsRestart && this.plugin.getServerStatus() === "running") {
            await this.plugin.restartServer();
        }
    }

    private cloneSettings(): VaultAsMCPSettings {
        return JSON.parse(JSON.stringify(this.plugin.settings));
    }

    async reset() {
        this.newSettings = this.cloneSettings();
        this.display();
    }

    display(): void {
        if (!this.newSettings) {
            this.newSettings = this.cloneSettings();
        }

        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl).setName("Vault as MCP").setHeading();

        new Setting(containerEl)
            .setName("Save settings")
            .setClass("vault-mcp-save-reset")
            .addButton((button) =>
                button
                    .setButtonText("Reset")
                    .setTooltip("Reset to current saved settings")
                    .onClick(() => {
                        this.reset();
                    }),
            )
            .addButton((button) =>
                button
                    .setButtonText("Save")
                    .setCta()
                    .setTooltip("Save all changes")
                    .onClick(async () => {
                        await this.save();
                    }),
            );

        // Server Port
        new Setting(containerEl)
            .setName("Server port")
            .setDesc("Port number for the MCP server (requires restart)")
            .addText((text) =>
                text
                    .setPlaceholder("8765")
                    .setValue(String(this.newSettings.serverPort))
                    .onChange((value) => {
                        const port = Number.parseInt(value, 10);
                        if (!Number.isNaN(port) && port > 0 && port < 65536) {
                            this.newSettings.serverPort = port;
                        }
                    }),
            );

        // Auto-start
        new Setting(containerEl)
            .setName("Auto-start server")
            .setDesc("Automatically start the MCP server when Obsidian loads")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.newSettings.autoStart)
                    .onChange((value) => {
                        this.newSettings.autoStart = value;
                    }),
            );

        new Setting(this.containerEl)
            .setName("Debug")
            .setDesc("Enable debug messages")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.newSettings.debug)
                    .onChange(async (value) => {
                        this.newSettings.debug = value;
                    }),
            );

        // Server Status Display
        new Setting(containerEl).setName("Server status").setHeading();

        const statusContainer = containerEl.createDiv("vault-mcp-status-info");

        const updateStatusDisplay = () => {
            statusContainer.empty();

            const status = this.plugin.getServerStatus();
            const statusText = statusContainer.createEl("p");

            switch (status) {
                case "running":
                    statusText.setText(
                        `✓ Server is running on port ${this.plugin.settings.serverPort}`,
                    );
                    statusText.addClass("vault-mcp-status-running");
                    break;
                case "error":
                    statusText.setText("✕ Server encountered an error");
                    statusText.addClass("vault-mcp-status-error");
                    break;
                case "stopped":
                    statusText.setText("○ Server is stopped");
                    statusText.addClass("vault-mcp-status-stopped");
                    break;
            }

            // Add connection info for Open WebUI
            if (status === "running") {
                const infoDiv = statusContainer.createDiv();
                infoDiv.createEl("p", {
                    text: "Connection URL for Open WebUI:",
                });
                const codeEl = infoDiv.createEl("code");
                codeEl.setText(
                    `http://localhost:${this.plugin.settings.serverPort}/mcp`,
                );
                codeEl.addClass("vault-mcp-connection-url");
            }
        };

        updateStatusDisplay();

        // Control Buttons
        const buttonContainer = containerEl.createDiv();
        buttonContainer.addClass("vault-mcp-button-container");

        new Setting(buttonContainer)
            .addButton((button) =>
                button.setButtonText("Start Server").onClick(async () => {
                    await this.plugin.startServer();
                    updateStatusDisplay();
                }),
            )
            .addButton((button) =>
                button.setButtonText("Stop Server").onClick(async () => {
                    await this.plugin.stopServer();
                    updateStatusDisplay();
                }),
            )
            .addButton((button) =>
                button.setButtonText("Restart Server").onClick(async () => {
                    await this.plugin.restartServer();
                    updateStatusDisplay();
                }),
            );

        // Documentation
        new Setting(containerEl).setName("Available MCP tools").setHeading();

        const toolsList = containerEl.createEl("ul");
        const tools = [
            {
                name: "read_note",
                desc: "Read the full content of a note by path",
            },
            {
                name: "search_notes",
                desc: "Search notes by tag, folder, or text content",
            },
            {
                name: "get_linked_notes",
                desc: "Get all notes linked from a specific note",
            },
            {
                name: "list_incomplete_tasks",
                desc: "Find incomplete tasks in a note or folder",
            },
            {
                name: "list_notes_by_tag",
                desc: "Get all notes with specific tag(s)",
            },
        ];

        for (const tool of tools) {
            const li = toolsList.createEl("li");
            li.createEl("strong", { text: tool.name });
            li.appendText(`: ${tool.desc}`);
        }
    }

    /** Save on exit */
    hide(): void {
        this.save();
    }
}
