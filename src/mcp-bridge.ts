/**
 * MCP HTTP Bridge for Claude Desktop
 *
 * Bridges stdio MCP protocol (used by Claude Desktop) to HTTP (used by VaultAsMCP plugin)
 *
 * Usage in Claude Desktop config:
 * {
 *   "mcpServers": {
 *     "obsidian-vault": {
 *       "command": "node",
 *       "args": ["/path/to/.obsidian/plugins/vault-as-mcp/mcp-bridge.js"],
 *       "env": {
 *         "VAULT_MCP_URL": "http://localhost:8765/mcp"
 *       }
 *     }
 *   }
 * }
 *
 * Requires Node 18+ (for native fetch)
 */

import { stdin, stdout } from "node:process";
import { StringDecoder } from "node:string_decoder";

// Version injected at build time
declare const __VERSION__: string;

// Config from environment
const MCP_URL = process.env.VAULT_MCP_URL || "http://localhost:8765/mcp";
const TIMEOUT = 30000; // 30 seconds

// Log to stderr only (stdout is for protocol messages)
function log(level: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [mcp-bridge] [${level}]`, ...args);
}

// Forward request to HTTP server
async function forwardRequest(request: {
    jsonrpc: string;
    method: string;
    id?: string | number;
    params?: unknown;
}): Promise<unknown> {
    try {
        log(
            "debug",
            `Forwarding ${request.method}`,
            request.id !== undefined ? `(id: ${request.id})` : "",
        );

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

        const response = await fetch(MCP_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle 204 No Content (notifications)
        if (response.status === 204) {
            log("debug", `Notification ${request.method} acknowledged`);
            return null;
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        log("debug", `Response received for ${request.method}`);
        return data;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("error", `Request failed: ${message}`);

        // Return JSON-RPC error response
        return {
            jsonrpc: "2.0",
            id: request.id,
            error: {
                code: -32603,
                message: `Bridge error: ${message}`,
            },
        };
    }
}

// Helper function to read newline-delimited JSON messages from stdin
// (MCP TypeScript SDK uses newline delimiters, not Content-Length framing)
type JsonRpcMessage =
    | { jsonrpc: "2.0"; id: number | string; method: string; params?: unknown }
    | { jsonrpc: "2.0"; method: string; params?: unknown };

async function* readMessages(): AsyncGenerator<JsonRpcMessage, void, void> {
    const decoder = new StringDecoder("utf8");
    let buffer = "";

    for await (const chunk of stdin) {
        buffer += decoder.write(chunk);

        while (true) {
            const newlineIndex = buffer.indexOf("\n");
            if (newlineIndex === -1) {
                // No complete message yet
                break;
            }

            let line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);

            // Remove trailing \r if present
            if (line.endsWith("\r")) {
                line = line.slice(0, -1);
            }

            // Skip empty lines
            if (line.trim().length === 0) {
                continue;
            }

            try {
                const parsed = JSON.parse(line);
                yield parsed;
            } catch (err) {
                log("error", "Failed to parse JSON message:", err);
            }
        }
    }
}

// Helper function to write newline-delimited JSON messages to stdout
// (MCP TypeScript SDK uses newline delimiters, not Content-Length framing)
function writeMessage(message: unknown): void {
    const json = JSON.stringify(message);
    stdout.write(`${json}\n`);
}

// Main event loop
async function main(): Promise<void> {
    log("info", `MCP HTTP Bridge v${__VERSION__} starting`);
    log("info", `Target: ${MCP_URL}`);
    log("debug", "Waiting for messages on stdin...");

    // Handle signals
    process.on("SIGINT", () => {
        log("info", "SIGINT received, exiting");
        process.exit(0);
    });

    process.on("SIGTERM", () => {
        log("info", "SIGTERM received, exiting");
        process.exit(0);
    });

    try {
        for await (const request of readMessages()) {
            log("debug", "Message received:", request.method);
            const response = await forwardRequest(request);
            if (response !== null) {
                log("debug", "Writing response to stdout");
                writeMessage(response);
            }
        }
        log("info", "stdin closed, exiting");
        process.exit(0);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("error", `Fatal: ${message}`);
        process.exit(1);
    }
}

// Start
main();
