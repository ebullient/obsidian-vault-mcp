export interface PathACL {
    forbidden: string[];
    readOnly: string[];
    writable: string[];
}

export interface VaultAsMCPSettings {
    serverPort: number;
    autoStart: boolean;
    debug: boolean;
    bearerToken?: string;
    pathACL: PathACL;
}

export type ServerStatus = "stopped" | "running" | "error";

export interface Logger {
    debug(message: string, ...params: unknown[]): void;
    warn(message: string, ...params: unknown[]): void;
    error(error: unknown, message?: string, ...params: unknown[]): string;
}

// From Fastify
export interface ConnectionError extends Error {
    code: string;
}

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
