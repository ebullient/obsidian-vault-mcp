import { randomBytes } from "node:crypto";
import {
    type App,
    Notice,
    PluginSettingTab,
    type Setting,
    type SettingDefinitionItem,
} from "obsidian";
import { PathACLTestModal } from "./vaultasmcp-PathACLTestModal";
import type { VaultAsMCPPlugin } from "./vaultasmcp-Plugin";
import { MCPTools } from "./vaultasmcp-Tools";

export class VaultAsMCPSettingsTab extends PluginSettingTab {
    plugin: VaultAsMCPPlugin;
    private showBearerToken = false;

    constructor(app: App, plugin: VaultAsMCPPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.icon = "brain-circuit";
    }

    private async saveAndMaybeRestart(
        prevPort: number,
        prevHost: string,
    ): Promise<void> {
        try {
            await this.plugin.saveSettings();
            const portChanged = this.plugin.settings.serverPort !== prevPort;
            const hostChanged = this.plugin.settings.serverHost !== prevHost;
            if (
                (portChanged || hostChanged) &&
                this.plugin.getServerStatus() === "running"
            ) {
                await this.plugin.restartServer();
            }
        } catch (error) {
            new Notice("Failed to save settings.");
            this.plugin.error(error, "Save settings error");
        }
    }

    // ----------------------------------------------------------------
    // 1.13.0+ declarative API
    // ----------------------------------------------------------------

    getSettingDefinitions(): SettingDefinitionItem[] {
        const s = this.plugin.settings;
        return [
            // Server group
            {
                type: "group",
                heading: "Server",
                items: [
                    {
                        name: "Auto-start server",
                        desc: "Automatically start the MCP server on startup.",
                        control: { type: "toggle", key: "autoStart" },
                    },
                    {
                        name: "Server status",
                        render: (setting: Setting) => {
                            setting.settingEl.addClass(
                                "vault-mcp-status-setting",
                            );
                            const statusContainer = setting.descEl.createDiv(
                                "vault-mcp-status-info",
                            );
                            this.renderStatusDisplay(statusContainer);

                            setting
                                .addButton((button) =>
                                    button
                                        .setButtonText("Start")
                                        .onClick(async () => {
                                            await this.plugin.startServer();
                                            statusContainer.empty();
                                            this.renderStatusDisplay(
                                                statusContainer,
                                            );
                                        }),
                                )
                                .addButton((button) =>
                                    button
                                        .setButtonText("Stop")
                                        .onClick(async () => {
                                            await this.plugin.stopServer();
                                            statusContainer.empty();
                                            this.renderStatusDisplay(
                                                statusContainer,
                                            );
                                        }),
                                )
                                .addButton((button) =>
                                    button
                                        .setButtonText("Restart")
                                        .onClick(async () => {
                                            await this.plugin.restartServer();
                                            statusContainer.empty();
                                            this.renderStatusDisplay(
                                                statusContainer,
                                            );
                                        }),
                                );
                        },
                    },
                    {
                        name: "Server host",
                        desc: "Network interface to bind the server to; localhost (127.0.0.1) is recommended for security; use 0.0.0.0 with a bearer token only if you need network access.",
                        render: (setting: Setting) => {
                            setting.addDropdown((dropdown) =>
                                dropdown
                                    .addOption(
                                        "127.0.0.1",
                                        "Localhost only (recommended)",
                                    )
                                    .addOption(
                                        "0.0.0.0",
                                        "All interfaces (network access)",
                                    )
                                    .setValue(s.serverHost)
                                    .onChange(async (value) => {
                                        if (
                                            value === "0.0.0.0" &&
                                            !s.bearerToken
                                        ) {
                                            new Notice(
                                                "⚠️ Network access without authentication is unsafe. " +
                                                    "Generate a bearer token first.",
                                                5000,
                                            );
                                        }
                                        const prev = s.serverHost;
                                        s.serverHost = value;
                                        await this.saveAndMaybeRestart(
                                            s.serverPort,
                                            prev,
                                        );
                                    }),
                            );
                        },
                    },
                    {
                        name: "Server port",
                        desc: "Port number for the MCP server; requires restart.",
                        render: (setting: Setting) => {
                            setting.addText((text) =>
                                text
                                    .setPlaceholder("8765")
                                    .setValue(String(s.serverPort))
                                    .onChange(async (value) => {
                                        const port = Number.parseInt(value, 10);
                                        if (
                                            !Number.isNaN(port) &&
                                            port > 0 &&
                                            port < 65536
                                        ) {
                                            const prev = s.serverPort;
                                            s.serverPort = port;
                                            await this.saveAndMaybeRestart(
                                                prev,
                                                s.serverHost,
                                            );
                                        }
                                    }),
                            );
                        },
                    },
                    {
                        name: "Bearer token",
                        desc: "Optional authentication token; required when using network access; leave empty to disable authentication.",
                        render: (setting: Setting) => {
                            setting
                                .addText((text) => {
                                    text.setPlaceholder(
                                        "Leave empty to disable",
                                    )
                                        .setValue(s.bearerToken ?? "")
                                        .onChange(async (value) => {
                                            s.bearerToken =
                                                value.trim() || undefined;
                                            await this.plugin.saveSettings();
                                        });
                                    text.inputEl.type = this.showBearerToken
                                        ? "text"
                                        : "password";
                                    return text;
                                })
                                .addButton((button) =>
                                    button
                                        .setIcon(
                                            this.showBearerToken
                                                ? "eye-off"
                                                : "eye",
                                        )
                                        .setTooltip(
                                            this.showBearerToken
                                                ? "Hide bearer token"
                                                : "Show bearer token",
                                        )
                                        .onClick(() => {
                                            this.showBearerToken =
                                                !this.showBearerToken;
                                            this.update();
                                        }),
                                )
                                .addButton((button) =>
                                    button
                                        .setIcon("dice")
                                        .setTooltip(
                                            "Generate a secure random token",
                                        )
                                        .onClick(async () => {
                                            const token =
                                                randomBytes(32).toString(
                                                    "base64url",
                                                );
                                            s.bearerToken = token;
                                            await this.plugin.saveSettings();
                                            this.update();
                                        }),
                                )
                                .addButton((button) =>
                                    button
                                        .setIcon("trash")
                                        .setTooltip(
                                            "Remove authentication token",
                                        )
                                        .onClick(async () => {
                                            s.bearerToken = undefined;
                                            await this.plugin.saveSettings();
                                            this.update();
                                        }),
                                );
                        },
                    },
                ],
            },

            // Path access control
            {
                type: "group",
                heading: "Path access control",
                items: [
                    {
                        name: "Forbidden paths",
                        desc: "Glob patterns for paths that cannot be read or written; one pattern per line.",
                        render: (setting: Setting) => {
                            setting.addTextArea((text) => {
                                text.setPlaceholder("private/**\nsecrets.md")
                                    .setValue(s.pathACL.forbidden.join("\n"))
                                    .onChange(async (value) => {
                                        s.pathACL.forbidden = value
                                            .split("\n")
                                            .map((p) => p.trim())
                                            .filter((p) => p.length > 0);
                                        await this.plugin.saveSettings();
                                    });
                                text.inputEl.rows = 4;
                                text.inputEl.cols = 50;
                            });
                        },
                    },
                    {
                        name: "Read-only paths",
                        desc: "Glob patterns for paths that can be read but not written; one pattern per line.",
                        render: (setting: Setting) => {
                            setting.addTextArea((text) => {
                                text.setPlaceholder("archive/**\ntemplates/**")
                                    .setValue(s.pathACL.readOnly.join("\n"))
                                    .onChange(async (value) => {
                                        s.pathACL.readOnly = value
                                            .split("\n")
                                            .map((p) => p.trim())
                                            .filter((p) => p.length > 0);
                                        await this.plugin.saveSettings();
                                    });
                                text.inputEl.rows = 4;
                                text.inputEl.cols = 50;
                            });
                        },
                    },
                    {
                        name: "Writable paths",
                        desc: "Glob patterns for paths that can be written; leave empty to allow all except forbidden and read-only paths; one pattern per line.",
                        render: (setting: Setting) => {
                            setting.addTextArea((text) => {
                                text.setPlaceholder("notes/**\ndrafts/**")
                                    .setValue(s.pathACL.writable.join("\n"))
                                    .onChange(async (value) => {
                                        s.pathACL.writable = value
                                            .split("\n")
                                            .map((p) => p.trim())
                                            .filter((p) => p.length > 0);
                                        await this.plugin.saveSettings();
                                    });
                                text.inputEl.rows = 4;
                                text.inputEl.cols = 50;
                            });
                        },
                    },
                    {
                        name: "Test ACL patterns",
                        desc: "Open a dialog to test your ACL patterns against sample vault paths.",
                        render: (setting: Setting) => {
                            setting.addButton((button) =>
                                button
                                    .setButtonText("Test patterns")
                                    .onClick(() => {
                                        new PathACLTestModal(
                                            this.app,
                                            s.pathACL,
                                        ).open();
                                    }),
                            );
                        },
                    },
                ],
            },

            // Advanced
            {
                type: "group",
                heading: "Advanced",
                items: [
                    {
                        name: "Debug",
                        desc: "Enable debug messages.",
                        control: { type: "toggle", key: "debug" },
                    },
                    {
                        name: "Normalize quotes in patch_note",
                        desc: "Treat curly quotes as equivalent to straight quotes when matching text in patch_note; useful when AI clients send straight quotes for content that uses curly quotes.",
                        control: { type: "toggle", key: "normalizeQuotes" },
                    },
                ],
            },

            // MCP tools list
            {
                name: "Available MCP tools",
                desc: createFragment((el) => {
                    const ul = el.createEl("ul");
                    const tools = new MCPTools(
                        this.app,
                        this.plugin,
                        this.plugin,
                    ).getToolDefinitions();
                    for (const tool of tools) {
                        const li = ul.createEl("li");
                        li.createEl("strong", { text: tool.name });
                        li.appendText(`: ${tool.description}`);
                    }
                }),
            },
            {
                name: "",
                render: (setting: Setting) => {
                    setting.descEl.addClass("vault-mcp-coffee");
                    setting.descEl
                        .createEl("a", {
                            href: "https://www.buymeacoffee.com/ebullient",
                        })
                        .createEl("img", {
                            attr: {
                                src: "https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=☕&slug=ebullient&button_colour=8e6787&font_colour=ebebeb&font_family=Inter&outline_colour=392a37&coffee_colour=ecc986",
                            },
                        });
                },
            },
        ];
    }

    private renderStatusDisplay(container: HTMLElement): void {
        const status = this.plugin.getServerStatus();
        const statusText = container.createEl("p");

        switch (status) {
            case "running":
                statusText.setText(
                    `🟢 Server is running on port ${this.plugin.settings.serverPort}.`,
                );
                statusText.addClass("vault-mcp-status-running");
                break;
            case "error":
                statusText.setText("🔴 Server encountered an error.");
                statusText.addClass("vault-mcp-status-error");
                break;
            case "stopped":
                statusText.setText("⚪️ Server stopped.");
                statusText.addClass("vault-mcp-status-stopped");
                break;
        }

        if (status === "running") {
            const infoDiv = container.createDiv();
            const p = infoDiv.createEl("p");
            p.createSpan({ text: "Connection URL for Open WebUI:" });
            const codeEl = p.createEl("code");
            codeEl.setText(
                `http://localhost:${this.plugin.settings.serverPort}/mcp`,
            );
            codeEl.addClass("vault-mcp-connection-url");
        }
    }
}
