import type { VaultAsMCPSettings } from "./@types/settings";

export const DEFAULT_SETTINGS: VaultAsMCPSettings = {
    serverPort: 8765,
    serverHost: "127.0.0.1",
    autoStart: true,
    debug: false,
    logPermissionMessages: true,
    normalizeQuotes: true,
    pathACL: {
        forbidden: [],
        readOnly: [],
        writable: [],
    },
    tlsEnabled: false,
};

export const MCP_VERSION = "2025-06-18"; // Claude Desktop sends 2025-06-18, but our implementation is based on 2025-06-18
export const SERVER_NAME = "obsidian-vault-mcp";
export const TLS_PRIVATE_KEY_SECRET_ID = "vault-as-mcp-ssl-private-key";
