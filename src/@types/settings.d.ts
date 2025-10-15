export interface VaultAsMCPSettings {
    serverPort: number;
    autoStart: boolean;
    logLevel: "debug" | "info" | "warn" | "error";
}

export type ServerStatus = "stopped" | "running" | "error";

export interface MCPRequest {
    jsonrpc: "2.0";
    id?: string | number;
    method: string;
    params?: Record<string, unknown>;
}

export interface MCPResponse {
    jsonrpc: "2.0";
    id?: string | number;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}

export interface MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
}
