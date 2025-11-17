import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import type { App } from "obsidian";
import type { Logger, MCPRequest } from "./@types/settings";
import { MCPHandler } from "./vaultasmcp-MCPHandler";

export class MCPServer {
    private server: FastifyInstance | null = null;
    private mcpHandler: MCPHandler;
    private port: number;
    private logger: Logger;

    constructor(app: App, port: number, logger: Logger) {
        this.port = port;
        this.logger = logger;
        this.mcpHandler = new MCPHandler(app, logger);
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
            this.logger.debug(
                "Received request:",
                mcpRequest.method,
                mcpRequest.id !== undefined ? `(id: ${mcpRequest.id})` : "",
            );

            const response = await this.mcpHandler.handleRequest(mcpRequest);

            // Notifications don't get responses
            if (response === null) {
                this.logger.debug(
                    "Sending 204 for notification:",
                    mcpRequest.method,
                );
                reply.code(204).send();
                return;
            }

            this.logger.debug(
                "Sending response for:",
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
            this.logger.info("Server started on port", this.port);
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
            this.logger.info("Server stopped");
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
