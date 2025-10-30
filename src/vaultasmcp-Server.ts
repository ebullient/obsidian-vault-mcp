import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import type { App } from "obsidian";
import type { MCPRequest } from "./@types/settings";
import { MCPHandler } from "./vaultasmcp-MCPHandler";

export class MCPServer {
    private server: FastifyInstance | null = null;
    private mcpHandler: MCPHandler;
    private port: number;

    constructor(
        app: App,
        port: number,
        logLevel: "debug" | "info" | "warn" | "error",
    ) {
        this.port = port;
        this.mcpHandler = new MCPHandler(app, logLevel);
    }

    async start(): Promise<void> {
        if (this.server) {
            throw new Error("Server is already running");
        }

        this.server = Fastify({
            logger: false,
        });

        // Register CORS for Tailscale network access
        await this.server.register(cors, {
            origin: true,
            credentials: true,
        });

        // Health check endpoint
        this.server.get("/health", async () => {
            return { status: "ok" };
        });

        // MCP protocol endpoint
        this.server.post("/mcp", async (request, reply) => {
            const mcpRequest = request.body as MCPRequest;
            console.log(
                "[VaultAsMCP] Received request:",
                mcpRequest.method,
                mcpRequest.id !== undefined ? `(id: ${mcpRequest.id})` : "",
            );

            const response = await this.mcpHandler.handleRequest(mcpRequest);

            // Notifications don't get responses
            if (response === null) {
                console.log(
                    "[VaultAsMCP] Sending 204 for notification:",
                    mcpRequest.method,
                );
                reply.code(204).send();
                return;
            }

            console.log(
                "[VaultAsMCP] Sending response for:",
                mcpRequest.method,
                mcpRequest.id,
            );
            reply
                .code(200)
                .header("Content-Type", "application/json")
                .send(response);
        });

        try {
            await this.server.listen({
                port: this.port,
                host: "0.0.0.0",
            });
            console.log(`[VaultAsMCP] Server started on port ${this.port}`);
        } catch (error) {
            this.server = null;
            throw error;
        }
    }

    async stop(): Promise<void> {
        if (!this.server) {
            return;
        }

        try {
            await this.server.close();
            console.log("[VaultAsMCP] Server stopped");
        } finally {
            this.server = null;
        }
    }

    isRunning(): boolean {
        return this.server !== null;
    }

    getPort(): number {
        return this.port;
    }

    updatePort(newPort: number): void {
        this.port = newPort;
    }
}
