import type { VaultAsMCPSettings } from "./@types/settings";

export const DEFAULT_SETTINGS: VaultAsMCPSettings = {
    serverPort: 8765,
    autoStart: true,
    logLevel: "info",
};

export const MCP_VERSION = "2024-11-05";
export const SERVER_NAME = "obsidian-vault-mcp";
export const SERVER_VERSION = "0.1.0";
