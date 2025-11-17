import { Notice, Plugin } from "obsidian";
import type {
    Logger,
    ServerStatus,
    VaultAsMCPSettings,
} from "./@types/settings";
import { DEFAULT_SETTINGS } from "./vaultasmcp-Constants";
import { MCPServer } from "./vaultasmcp-Server";
import { VaultAsMCPSettingsTab } from "./vaultasmcp-SettingsTab";

export class VaultAsMCPPlugin extends Plugin implements Logger {
    settings!: VaultAsMCPSettings;
    private server: MCPServer | null = null;
    private statusBarItem: HTMLElement | null = null;
    private serverStatus: ServerStatus = "stopped";

    async onload() {
        console.info(`loading Vault as MCP (VMCP) v${this.manifest.version}`);
        await this.loadSettings();

        this.addSettingTab(new VaultAsMCPSettingsTab(this.app, this));

        // Defer initialization until layout is ready
        this.app.workspace.onLayoutReady(() => {
            this.initializePlugin();
        });
    }

    private initializePlugin(): void {
        // Create status bar item
        this.statusBarItem = this.addStatusBarItem();
        this.statusBarItem.addClass("vault-mcp-status");
        this.updateStatusBar();

        // Make status bar clickable to toggle server
        this.statusBarItem.addEventListener("click", () => {
            this.toggleServer();
        });

        // Add commands
        this.addCommand({
            id: "start-server",
            name: "Start MCP Server",
            callback: () => {
                this.startServer();
            },
        });

        this.addCommand({
            id: "stop-server",
            name: "Stop MCP Server",
            callback: () => {
                this.stopServer();
            },
        });

        this.addCommand({
            id: "restart-server",
            name: "Restart MCP Server",
            callback: () => {
                this.restartServer();
            },
        });

        // Auto-start if enabled
        if (this.settings.autoStart) {
            this.startServer();
        }
    }

    onunload() {
        console.info(`unloading Vault as MCP (VMCP) v${this.manifest.version}`);
        this.stopServer();
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData(),
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private async toggleServer(): Promise<void> {
        if (this.server?.isRunning()) {
            await this.stopServer();
        } else {
            await this.startServer();
        }
    }

    async startServer(): Promise<void> {
        if (this.server?.isRunning()) {
            new Notice("MCP Server is already running");
            return;
        }

        try {
            this.server = new MCPServer(
                this.app,
                this.settings.serverPort,
                this,
            );

            await this.server.start();
            this.serverStatus = "running";
            this.updateStatusBar();

            new Notice(
                `MCP Server started on port ${this.settings.serverPort}`,
            );
        } catch (error) {
            this.serverStatus = "error";
            this.updateStatusBar();

            if (error.code === "EADDRINUSE") {
                new Notice(
                    `Port ${this.settings.serverPort} is already in use. Please change the port in settings.`,
                );
            } else {
                new Notice(`Failed to start MCP Server: ${error.message}`);
            }
            this.error(error, "Failed to start server");
        }
    }

    async stopServer(): Promise<void> {
        if (!this.server) {
            new Notice("MCP Server is not running");
            return;
        }

        try {
            await this.server.stop();
            this.server = null;
            this.serverStatus = "stopped";
            this.updateStatusBar();

            new Notice("MCP Server stopped");
        } catch (error) {
            new Notice(`Failed to stop MCP Server: ${error.message}`);
            this.error(error, "Failed to stop server");
        }
    }

    async restartServer(): Promise<void> {
        await this.stopServer();
        await this.startServer();
    }

    private updateStatusBar(): void {
        if (!this.statusBarItem) {
            return;
        }

        const port = this.server?.getPort() || this.settings.serverPort;

        // Remove previous status classes
        this.statusBarItem.removeClass("vault-mcp-status-running");
        this.statusBarItem.removeClass("vault-mcp-status-error");
        this.statusBarItem.removeClass("vault-mcp-status-stopped");

        switch (this.serverStatus) {
            case "running":
                this.statusBarItem.setText(`MCP:${port} ●`);
                this.statusBarItem.setAttribute(
                    "aria-label",
                    "MCP Server running. Click to stop.",
                );
                this.statusBarItem.addClass("vault-mcp-status-running");
                break;
            case "error":
                this.statusBarItem.setText(`MCP:${port} ✕`);
                this.statusBarItem.setAttribute(
                    "aria-label",
                    "MCP Server error. Click to retry.",
                );
                this.statusBarItem.addClass("vault-mcp-status-error");
                break;
            case "stopped":
                this.statusBarItem.setText(`MCP:${port} ○`);
                this.statusBarItem.setAttribute(
                    "aria-label",
                    "MCP Server stopped. Click to start.",
                );
                this.statusBarItem.addClass("vault-mcp-status-stopped");
                break;
        }
    }

    getServerStatus(): ServerStatus {
        return this.serverStatus;
    }

    debug(message: string, ...params: unknown[]): void {
        if (this.settings?.debug) {
            console.debug("(VMCP)", message, ...params);
        }
    }

    info(message: string, ...params: unknown[]): void {
        console.info("(VMCP)", message, ...params);
    }

    warn(message: string, ...params: unknown[]): void {
        console.warn("(VMCP)", message, ...params);
    }

    error(error: unknown, message = "", ...params: unknown[]): string {
        if (message) {
            console.error("(VMCP)", message, error, ...params);
            return message;
        }
        if (error instanceof Error) {
            console.error("(VMCP)", error.message, error, ...params);
            return error.message;
        }
        console.error("(VMCP)", error, ...params);
        return String(error);
    }
}
