import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import type { App } from "obsidian";
import type { CurrentSettings, Logger, MCPRequest } from "./@types/settings";
import { MCPHandler } from "./vaultasmcp-MCPHandler";

export class MCPServer {
    private server: FastifyInstance | null = null;
    private mcpHandler: MCPHandler;
    port: number;

    constructor(
        app: App,
        private logger: Logger,
        private current: CurrentSettings,
    ) {
        this.mcpHandler = new MCPHandler(app, logger, current);
        this.port = current.serverPort();
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

        this.server.addHook("preHandler", async (request, reply) => {
            // Skip auth for health check
            if (request.url === "/health") {
                return;
            }

            const bearerToken = this.current.bearerToken();
            if (bearerToken) {
                const auth = request.headers.authorization;
                if (!auth || !auth.startsWith("Bearer ")) {
                    this.logger.warn("Request missing bearer token");
                    reply.code(401).send({ error: "Missing bearer token" });
                    return;
                }

                const token = auth.substring(7);
                if (token !== bearerToken) {
                    this.logger.warn("Request with invalid bearer token");
                    reply.code(401).send({ error: "Invalid bearer token" });
                    return;
                }
            }
        });

        // Health check endpoint
        this.server.get("/health", async () => {
            return { status: "ok" };
        });

        // MCP protocol endpoint
        this.server.post("/mcp", async (request, reply) => {
            const body = request.body;

            // Validate request structure
            if (
                !body ||
                typeof body !== "object" ||
                !("jsonrpc" in body) ||
                body.jsonrpc !== "2.0" ||
                !("method" in body) ||
                typeof body.method !== "string"
            ) {
                this.logger.warn("Invalid request structure:", body);
                reply
                    .code(400)
                    .header("Content-Type", "application/json")
                    .send({
                        jsonrpc: "2.0",
                        error: {
                            code: -32600,
                            message: "Invalid Request",
                        },
                    });
                return;
            }

            const mcpRequest = body as MCPRequest;
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

        // get current port and host before listening
        this.port = this.current.serverPort();
        const host = this.current.serverHost();
        try {
            await this.server.listen({
                port: this.port,
                host: host,
            });
            this.logger.debug("Server started on", `${host}:${this.port}`);
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
            this.logger.debug("Server stopped");
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
}
