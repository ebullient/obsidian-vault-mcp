import type { App } from "obsidian";
import type { Logger, MCPRequest, MCPResponse } from "./@types/settings";
import {
    MCP_VERSION,
    SERVER_NAME,
    SERVER_VERSION,
} from "./vaultasmcp-Constants";
import { MCPTools } from "./vaultasmcp-Tools";

export class MCPHandler {
    private tools: MCPTools;
    private logger: Logger;

    constructor(app: App, logger: Logger) {
        this.logger = logger;
        this.tools = new MCPTools(app, logger);
    }

    async handleRequest(request: MCPRequest): Promise<MCPResponse | null> {
        this.logger.debug("Received MCP request:", request);

        try {
            switch (request.method) {
                case "initialize":
                    return this.handleInitialize(request);
                case "notifications/initialized":
                    // Notifications don't get responses
                    this.logger.debug("Received initialized notification");
                    return null;
                case "tools/list":
                    return this.handleToolsList(request);
                case "tools/call":
                    return await this.handleToolsCall(request);
                case "ping":
                    return this.createResponse(request.id, { status: "ok" });
                default:
                    // Only respond to requests (with id), not notifications
                    if (request.id !== undefined) {
                        return this.createError(
                            request.id,
                            -32601,
                            `Method not found: ${request.method}`,
                        );
                    }
                    this.logger.warn(`Unknown notification: ${request.method}`);
                    return null;
            }
        } catch (error) {
            this.logger.error(error, "Error handling request");
            // Only respond to requests, not notifications
            if (request.id !== undefined) {
                return this.createError(
                    request.id,
                    -32603,
                    `Internal error: ${error.message}`,
                );
            }
            return null;
        }
    }

    private handleInitialize(request: MCPRequest): MCPResponse {
        return this.createResponse(request.id, {
            protocolVersion: MCP_VERSION,
            serverInfo: {
                name: SERVER_NAME,
                version: SERVER_VERSION,
            },
            capabilities: {
                tools: {},
            },
        });
    }

    private handleToolsList(request: MCPRequest): MCPResponse {
        const toolDefinitions = this.tools.getToolDefinitions();
        return this.createResponse(request.id, {
            tools: toolDefinitions,
        });
    }

    private async handleToolsCall(request: MCPRequest): Promise<MCPResponse> {
        const params = request.params || {};
        const toolName = params.name as string;
        const args = (params.arguments as Record<string, unknown>) || {};

        this.logger.debug("Calling tool:", toolName, args);

        if (!toolName) {
            return this.createError(
                request.id,
                -32602,
                "Missing tool name in parameters",
            );
        }

        try {
            const result = await this.tools.executeTool(toolName, args);
            this.logger.debug("Tool", toolName, "succeeded:", result);
            return this.createResponse(request.id, {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            });
        } catch (error) {
            this.logger.error(error, `Tool ${toolName} failed`);
            return this.createError(
                request.id,
                -32000,
                `Tool execution failed: ${error.message}`,
            );
        }
    }

    private createResponse(
        id: string | number | undefined,
        result: unknown,
    ): MCPResponse {
        return {
            jsonrpc: "2.0",
            id,
            result,
        };
    }

    private createError(
        id: string | number | undefined,
        code: number,
        message: string,
    ): MCPResponse {
        return {
            jsonrpc: "2.0",
            id,
            error: {
                code,
                message,
            },
        };
    }
}
