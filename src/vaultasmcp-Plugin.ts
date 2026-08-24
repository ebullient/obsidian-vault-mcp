import { Notice, Plugin } from "obsidian";
import type {
    ConnectionError,
    CurrentSettings,
    Logger,
    PathACL,
    ServerStatus,
    VaultAsMCPSettings,
} from "./@types/settings";
import {
    DEFAULT_SETTINGS,
    TLS_PRIVATE_KEY_SECRET_ID,
} from "./vaultasmcp-Constants";
import {
    validateServerExposure,
    validateTlsConfiguration,
} from "./vaultasmcp-Security";
import { MCPServer } from "./vaultasmcp-Server";
import { VaultAsMCPSettingsTab } from "./vaultasmcp-SettingsTab";

export class VaultAsMCPPlugin
    extends Plugin
    implements Logger, CurrentSettings
{
    declare settings: VaultAsMCPSettings;
    private server: MCPServer | null = null;
    private statusBarItem: HTMLElement | null = null;
    private serverStatus: ServerStatus = "stopped";

    async onload() {
        console.debug(`loading Vault as MCP (VMCP) v${this.manifest.version}`);
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
            void this.toggleServer();
        });

        // Add commands
        this.addCommand({
            id: "start-server",
            name: "Start MCP server",
            callback: () => {
                void this.startServer();
            },
        });

        this.addCommand({
            id: "stop-server",
            name: "Stop MCP server",
            callback: () => {
                void this.stopServer();
            },
        });

        this.addCommand({
            id: "restart-server",
            name: "Restart MCP server",
            callback: () => {
                void this.restartServer();
            },
        });

        // Auto-start if enabled
        if (this.settings.autoStart) {
            void this.startServer();
        }
    }

    onunload() {
        console.debug(
            `unloading Vault as MCP (VMCP) v${this.manifest.version}`,
        );
        void this.stopServer();
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            (await this.loadData()) as VaultAsMCPSettings,
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    storeTlsPrivateKeyPem(privateKeyPem: string): void {
        this.app.secretStorage.setSecret(
            TLS_PRIVATE_KEY_SECRET_ID,
            privateKeyPem,
        );
    }

    clearStoredTlsPrivateKeyPem(): void {
        this.app.secretStorage.setSecret(TLS_PRIVATE_KEY_SECRET_ID, "");
    }

    hasStoredTlsPrivateKey(): boolean {
        return this.getTlsPrivateKeyPem() !== undefined;
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
            new Notice("MCP server is already running");
            return;
        }

        try {
            const exposureError = validateServerExposure(
                this.settings.serverHost,
                this.settings.bearerToken,
            );
            if (exposureError) {
                throw new Error(exposureError);
            }
            const tlsError = validateTlsConfiguration(
                this.settings.tlsEnabled,
                this.settings.tlsCertificatePem,
                this.getTlsPrivateKeyPem(),
            );
            if (tlsError) {
                throw new Error(tlsError);
            }

            this.server = new MCPServer(
                this.app,
                this, // as Logger
                this, // as CurrentSettings
            );

            await this.server.start();
            this.serverStatus = "running";
            this.updateStatusBar();

            new Notice(this.startupMessage());
        } catch (error) {
            this.serverStatus = "error";
            this.updateStatusBar();

            const errorMsg = this.error(error);
            const connError = error as ConnectionError;
            if (connError.code === "EADDRINUSE") {
                new Notice(
                    `Port ${this.settings.serverPort} is already in use. Please change the port in settings.`,
                );
            } else {
                new Notice(`Failed to start MCP server: ${errorMsg}`);
            }
        }
    }

    async stopServer(): Promise<void> {
        if (!this.server) {
            new Notice("MCP server is not running");
            return;
        }

        try {
            await this.server.stop();
            this.server = null;
            this.serverStatus = "stopped";
            this.updateStatusBar();

            new Notice("MCP server stopped");
        } catch (error) {
            const msg = this.error(error, "Failed to stop server");
            new Notice(msg);
        }
    }

    async restartServer(): Promise<void> {
        await this.stopServer();
        await this.startServer();
    }

    startupMessage(): string {
        if (this.settings.serverHost === "127.0.0.1") {
            return `MCP server started at ${this.protocol()}://localhost:${this.settings.serverPort}/mcp`;
        }

        return `MCP server started on port ${this.settings.serverPort} using ${this.protocol().toUpperCase()}`;
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
                this.statusBarItem.setText(`MCP:${port} 🟢`);
                this.statusBarItem.setAttribute(
                    "aria-label",
                    "MCP server running. Click to stop.",
                );
                this.statusBarItem.addClass("vault-mcp-status-running");
                break;
            case "error":
                this.statusBarItem.setText(`MCP:${port} 🔴`);
                this.statusBarItem.setAttribute(
                    "aria-label",
                    "MCP server error. Click to retry.",
                );
                this.statusBarItem.addClass("vault-mcp-status-error");
                break;
            case "stopped":
                this.statusBarItem.setText(`MCP:${port} ⚪️`);
                this.statusBarItem.setAttribute(
                    "aria-label",
                    "MCP server stopped. Click to start.",
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

    warn(message: string, ...params: unknown[]): void {
        console.debug("(VMCP ⚠️)", message, ...params);
    }

    warnAcl(message: string, ...params: unknown[]): void {
        if (this.settings?.logPermissionMessages) {
            console.debug("(VMCP ⚠️)", message, ...params);
        }
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

    pathACL(): PathACL {
        return this.settings.pathACL;
    }

    bearerToken(): string | undefined {
        return this.settings.bearerToken;
    }

    serverPort(): number {
        return this.settings.serverPort;
    }

    serverHost(): string {
        return this.settings.serverHost;
    }

    serverVersion(): string {
        return this.manifest.version;
    }

    normalizeQuotes(): boolean {
        return this.settings.normalizeQuotes ?? true;
    }

    tlsEnabled(): boolean {
        return this.settings.tlsEnabled ?? false;
    }

    tlsCertificatePem(): string | undefined {
        return this.settings.tlsCertificatePem?.trim() || undefined;
    }

    getTlsPrivateKeyPem(): string | undefined {
        if (!this.settings.tlsPrivateKeySecretId) {
            return undefined;
        }
        return (
            this.app.secretStorage
                .getSecret(this.settings.tlsPrivateKeySecretId)
                ?.trim() || undefined
        );
    }

    protocol(): "http" | "https" {
        return this.tlsEnabled() ? "https" : "http";
    }
}
