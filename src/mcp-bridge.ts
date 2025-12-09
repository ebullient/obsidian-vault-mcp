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
 *
 * This does not run in Obsidian itself, but as a separate process
 * launched and managed by Claude Desktop.
 */

import { stdin, stdout } from "node:process";
import { StringDecoder } from "node:string_decoder";

// Version injected at build time
declare const __VERSION__: string;

// Config from environment
const MCP_URL = process.env.VAULT_MCP_URL || "http://localhost:8765/mcp";
const BEARER_TOKEN = process.env.VAULT_MCP_TOKEN;
const TIMEOUT = 30000; // 30 seconds
const INITIAL_RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 30000; // 30 seconds
const MAX_RETRIES = 10; // Try for up to ~2 minutes on startup

// Connection state
let connectionHealthy = false;
let consecutiveFailures = 0;

// Log to stderr only (stdout is for protocol messages)
function log(level: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [mcp-bridge] [${level}]`, ...args);
}

// Sleep helper
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Check if server is available
async function checkHealth(): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // Short timeout for health check

        // eslint-disable-next-line no-restricted-globals
        const response = await fetch(MCP_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(BEARER_TOKEN && {
                    Authorization: `Bearer ${BEARER_TOKEN}`,
                }),
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "ping",
                id: 0,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);
        return response.ok || response.status === 204;
    } catch {
        return false;
    }
}

// Wait for server to become available with exponential backoff
async function waitForServer(): Promise<void> {
    let retries = 0;
    let delay = INITIAL_RETRY_DELAY;

    while (retries < MAX_RETRIES) {
        if (await checkHealth()) {
            connectionHealthy = true;
            consecutiveFailures = 0;
            log("info", "Successfully connected to Obsidian plugin");
            return;
        }

        retries++;
        if (retries === 1) {
            log("warn", `Cannot connect to ${MCP_URL}, will retry...`);
        }

        if (retries < MAX_RETRIES) {
            log("debug", `Retry ${retries}/${MAX_RETRIES} in ${delay}ms...`);
            await sleep(delay);
            // Exponential backoff with jitter
            delay = Math.min(delay * 2, MAX_RETRY_DELAY);
        }
    }

    log(
        "error",
        `Failed to connect after ${MAX_RETRIES} attempts. The bridge will continue running and retry on each request.`,
    );
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

        // eslint-disable-next-line no-restricted-globals
        const response = await fetch(MCP_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(BEARER_TOKEN && {
                    Authorization: `Bearer ${BEARER_TOKEN}`,
                }),
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

        const data = (await response.json()) as unknown;
        log("debug", `Response received for ${request.method}`);

        // Connection successful - reset failure counter
        if (!connectionHealthy) {
            log("info", "Connection restored");
            connectionHealthy = true;
        }
        consecutiveFailures = 0;

        return data;
    } catch (error) {
        let message = error instanceof Error ? error.message : String(error);
        let diagnostic = "";

        // Provide specific diagnostics for common errors
        if (error instanceof Error) {
            // Connection refused - most common issue
            if (
                error.message.includes("ECONNREFUSED") ||
                error.message.includes("fetch failed")
            ) {
                diagnostic = `\n\nCannot connect to Obsidian plugin at ${MCP_URL}.\nPossible causes:\n  1. Obsidian is not running\n  2. The Vault MCP plugin is not enabled in Obsidian\n  3. The plugin is configured to use a different port\n  4. The plugin hasn't finished starting up yet\n\nPlease verify:\n  - Obsidian is open\n  - The vault containing the plugin is open\n  - The Vault MCP plugin is enabled in Settings → Community Plugins\n  - The port in the plugin settings matches the port in your Claude Desktop config (currently: ${MCP_URL})`;
                message = "Connection refused";
            }
            // Timeout
            else if (
                error.message.includes("aborted") ||
                error.message.includes("timeout")
            ) {
                diagnostic = `\n\nConnection timed out after ${TIMEOUT / 1000}s.\nThe plugin may be responding slowly or overloaded.`;
                message = "Request timeout";
            }
            // Auth errors
            else if (
                error.message.includes("401") ||
                error.message.includes("403")
            ) {
                diagnostic = `\n\nAuthentication failed.\nIf you've enabled authentication in the plugin, make sure VAULT_MCP_TOKEN is set correctly in your Claude Desktop config.`;
                message = "Authentication failed";
            }
        }

        log("error", `Request failed: ${message}${diagnostic}`);

        // Track connection health
        const isConnectionError =
            error instanceof Error &&
            (error.message.includes("ECONNREFUSED") ||
                error.message.includes("fetch failed") ||
                error.message.includes("ECONNRESET"));

        if (isConnectionError) {
            consecutiveFailures++;
            if (connectionHealthy) {
                connectionHealthy = false;
                log(
                    "warn",
                    "Connection lost, will attempt to reconnect on next request",
                );
            }

            // Try to reconnect if we've had multiple failures
            if (consecutiveFailures >= 3) {
                log("info", "Attempting to reconnect...");
                if (await checkHealth()) {
                    connectionHealthy = true;
                    consecutiveFailures = 0;
                    log("info", "Reconnection successful, retrying request...");
                    // Retry the request once
                    return forwardRequest(request);
                }
            }
        }

        // Don't send responses for notifications
        if (request.id === undefined) {
            return null;
        }

        // Return JSON-RPC error response
        return {
            jsonrpc: "2.0",
            id: request.id,
            error: {
                code: -32603,
                message: `Bridge error: ${message}${diagnostic}`,
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
        buffer += decoder.write(chunk as Buffer);

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
                const parsed = JSON.parse(line) as JsonRpcMessage;
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

    // Wait for server to be available before processing requests
    await waitForServer();

    if (!connectionHealthy) {
        log(
            "warn",
            "Starting in degraded mode - requests will be retried automatically when connection is restored",
        );
    }

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
void main();
