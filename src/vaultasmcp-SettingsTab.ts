import { randomBytes } from "node:crypto";
import { type App, Notice, PluginSettingTab, Setting } from "obsidian";
import type { VaultAsMCPSettings } from "./@types/settings";
import { PathACLTestModal } from "./vaultasmcp-PathACLTestModal";
import type { VaultAsMCPPlugin } from "./vaultasmcp-Plugin";
import { MCPTools } from "./vaultasmcp-Tools";

export class VaultAsMCPSettingsTab extends PluginSettingTab {
    plugin: VaultAsMCPPlugin;
    newSettings!: VaultAsMCPSettings;
    private showBearerToken = false;

    constructor(app: App, plugin: VaultAsMCPPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async save() {
        try {
            const needsRestart =
                this.plugin.settings.serverPort !==
                    this.newSettings.serverPort ||
                this.plugin.settings.serverHost !== this.newSettings.serverHost;

            this.plugin.settings = this.newSettings;
            await this.plugin.saveSettings();

            if (needsRestart && this.plugin.getServerStatus() === "running") {
                await this.plugin.restartServer();
            }
        } catch (error) {
            new Notice("Failed to save settings");
            this.plugin.error(error, "Save settings error");
        }
    }

    private cloneSettings(): VaultAsMCPSettings {
        return JSON.parse(
            JSON.stringify(this.plugin.settings),
        ) as VaultAsMCPSettings;
    }

    reset() {
        this.newSettings = this.cloneSettings();
        this.display();
    }

    display(): void {
        if (!this.newSettings) {
            this.newSettings = this.cloneSettings();
        }

        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName("Save settings")
            .setClass("vault-mcp-save-reset")
            .addButton((button) =>
                button
                    .setIcon("rotate-ccw")
                    .setTooltip("Reset to current saved settings")
                    .onClick(() => {
                        this.reset();
                    }),
            )
            .addButton((button) =>
                button
                    .setIcon("save")
                    .setCta()
                    .setTooltip("Save all changes")
                    .onClick(async () => {
                        await this.save();
                    }),
            );

        // Server Port
        new Setting(containerEl)
            .setName("Server port")
            .setDesc("Port number for the MCP server (requires restart).")
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
            .setDesc("Automatically start the MCP server on startup.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.newSettings.autoStart)
                    .onChange((value) => {
                        this.newSettings.autoStart = value;
                    }),
            );

        // Path Access Control (ACL)
        new Setting(containerEl).setName("Path access control").setHeading();

        new Setting(containerEl)
            .setName("Forbidden paths")
            .setDesc(
                "Glob patterns for paths that cannot be read or written; one pattern per line.",
            )
            .addTextArea((text) => {
                text.setPlaceholder(".obsidian/**\nprivate/**\nsecrets.md")
                    .setValue(this.newSettings.pathACL.forbidden.join("\n"))
                    .onChange((value) => {
                        this.newSettings.pathACL.forbidden = value
                            .split("\n")
                            .map((p) => p.trim())
                            .filter((p) => p.length > 0);
                    });
                text.inputEl.rows = 4;
                text.inputEl.cols = 50;
            });

        new Setting(containerEl)
            .setName("Read-only paths")
            .setDesc(
                "Glob patterns for paths that can be read but not written; one pattern per line.",
            )
            .addTextArea((text) => {
                text.setPlaceholder("archive/**\ntemplates/**")
                    .setValue(this.newSettings.pathACL.readOnly.join("\n"))
                    .onChange((value) => {
                        this.newSettings.pathACL.readOnly = value
                            .split("\n")
                            .map((p) => p.trim())
                            .filter((p) => p.length > 0);
                    });
                text.inputEl.rows = 4;
                text.inputEl.cols = 50;
            });

        new Setting(containerEl)
            .setName("Writable paths")
            .setDesc(
                "Glob patterns for paths that can be written; " +
                    "leave empty to allow all except forbidden and read-only paths; " +
                    "one pattern per line.",
            )
            .addTextArea((text) => {
                text.setPlaceholder("notes/**\ndrafts/**")
                    .setValue(this.newSettings.pathACL.writable.join("\n"))
                    .onChange((value) => {
                        this.newSettings.pathACL.writable = value
                            .split("\n")
                            .map((p) => p.trim())
                            .filter((p) => p.length > 0);
                    });
                text.inputEl.rows = 4;
                text.inputEl.cols = 50;
            });

        new Setting(containerEl)
            .setName("Test ACL patterns")
            .setDesc(
                "Open a dialog to test your ACL patterns against sample vault paths.",
            )
            .addButton((button) =>
                button.setButtonText("Test patterns").onClick(() => {
                    new PathACLTestModal(
                        this.app,
                        this.newSettings.pathACL,
                    ).open();
                }),
            );

        // Advanced Settings
        new Setting(containerEl).setName("Advanced").setHeading();

        // Debug
        new Setting(containerEl)
            .setName("Debug")
            .setDesc("Enable debug messages.")
            .addToggle((toggle) =>
                toggle.setValue(this.newSettings.debug).onChange((value) => {
                    this.newSettings.debug = value;
                }),
            );

        // Server Host
        new Setting(containerEl)
            .setName("Server host")
            .setDesc(
                "Network interface to bind the server to; " +
                    "localhost (127.0.0.1) is recommended for security; " +
                    "use 0.0.0.0 with a bearer token only if you need network access.",
            )
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("127.0.0.1", "Localhost only (recommended)")
                    .addOption("0.0.0.0", "All interfaces (network access)")
                    .setValue(this.newSettings.serverHost)
                    .onChange((value) => {
                        // Warn if selecting network access without token
                        if (
                            value === "0.0.0.0" &&
                            !this.newSettings.bearerToken
                        ) {
                            new Notice(
                                "⚠️ Network access without authentication is unsafe. " +
                                    "Generate a bearer token first.",
                                5000,
                            );
                        }
                        this.newSettings.serverHost = value;
                    }),
            );

        // Bearer Token
        new Setting(containerEl)
            .setName("Bearer token")
            .setDesc(
                "Optional authentication token; " +
                    "required when using network access; " +
                    "leave empty to disable authentication.",
            )
            .addText((text) => {
                text.setPlaceholder("Leave empty to disable")
                    .setValue(this.newSettings.bearerToken || "")
                    .onChange((value) => {
                        this.newSettings.bearerToken =
                            value.trim() || undefined;
                    });
                text.inputEl.type = this.showBearerToken ? "text" : "password";
                return text;
            })
            .addButton((button) =>
                button
                    .setIcon(this.showBearerToken ? "eye-off" : "eye")
                    .setTooltip(
                        this.showBearerToken
                            ? "Hide bearer token"
                            : "Show bearer token",
                    )
                    .onClick(() => {
                        this.showBearerToken = !this.showBearerToken;
                        this.display();
                    }),
            )
            .addButton((button) =>
                button
                    .setIcon("dice")
                    .setTooltip("Generate a secure random token")
                    .onClick(() => {
                        const token = randomBytes(32).toString("base64url");
                        this.newSettings.bearerToken = token;
                        this.display();
                    }),
            )
            .addButton((button) =>
                button
                    .setIcon("trash")
                    .setTooltip("Remove authentication token")
                    .onClick(() => {
                        this.newSettings.bearerToken = undefined;
                        this.display();
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
                        `🟢 server is running on port ${this.plugin.settings.serverPort}`,
                    );
                    statusText.addClass("vault-mcp-status-running");
                    break;
                case "error":
                    statusText.setText("🔴 server encountered an error");
                    statusText.addClass("vault-mcp-status-error");
                    break;
                case "stopped":
                    statusText.setText("⚪️ server is stopped");
                    statusText.addClass("vault-mcp-status-stopped");
                    break;
            }

            // Add connection info for Open WebUI
            if (status === "running") {
                const infoDiv = statusContainer.createDiv();
                const p = infoDiv.createEl("p");
                p.createSpan({
                    text: "Connection URL for Open WebUI:",
                });
                const codeEl = p.createEl("code");
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
                button.setButtonText("Start server").onClick(async () => {
                    await this.plugin.startServer();
                    updateStatusDisplay();
                }),
            )
            .addButton((button) =>
                button.setButtonText("Stop server").onClick(async () => {
                    await this.plugin.stopServer();
                    updateStatusDisplay();
                }),
            )
            .addButton((button) =>
                button.setButtonText("Restart server").onClick(async () => {
                    await this.plugin.restartServer();
                    updateStatusDisplay();
                }),
            );

        // Documentation
        new Setting(containerEl).setName("Available MCP tools").setHeading();

        const toolsList = containerEl.createEl("ul");

        // Fetch tool definitions dynamically from MCPTools
        const mcpTools = new MCPTools(this.app, this.plugin, this.plugin);
        const tools = mcpTools.getToolDefinitions();

        for (const tool of tools) {
            const li = toolsList.createEl("li");
            li.createEl("strong", { text: tool.name });
            li.appendText(`: ${tool.description}`);
        }

        const div = this.containerEl.createDiv("vault-mcp-coffee");
        div.createEl("a", {
            href: "https://www.buymeacoffee.com/ebullient",
        }).createEl("img", {
            attr: {
                src: "https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=☕&slug=ebullient&button_colour=8e6787&font_colour=ebebeb&font_family=Inter&outline_colour=392a37&coffee_colour=ecc986",
            },
        });
    }

    /** Save on exit */
    hide(): void {
        // trigger save, but don't wait for it
        void this.save();
    }
}
