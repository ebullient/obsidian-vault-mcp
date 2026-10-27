import type { App } from "obsidian";
import type {
    CurrentSettings,
    Logger,
    MCPAuthContext,
    MCPRequest,
    MCPResponse,
} from "./@types/settings";
import { READ_ONLY_OAUTH_SCOPE } from "./oauth/oauth-token-store";
import { AuditLogStore } from "./vaultasmcp-AuditLog";
import { MCP_VERSION, SERVER_NAME } from "./vaultasmcp-Constants";
import { NoteHandler } from "./vaultasmcp-NoteHandler";
import { PathACLChecker } from "./vaultasmcp-PathACL";
import { TemplateHandler } from "./vaultasmcp-TemplateHandler";
import { MCPTools } from "./vaultasmcp-Tools";

export class MCPHandler {
    private tools: MCPTools;
    private aclChecker: PathACLChecker;
    private noteHandler: NoteHandler;
    private templateHandler: TemplateHandler;
    private auditLog: AuditLogStore;
    private logger: Logger;
    private version: string;

    constructor(
        private app: App,
        logger: Logger,
        current: CurrentSettings,
        auditLog?: AuditLogStore,
    ) {
        this.logger = logger;
        this.tools = new MCPTools(app, logger, current);
        this.aclChecker = new PathACLChecker(current, logger);
        this.templateHandler = new TemplateHandler(
            app,
            this.aclChecker,
            logger,
        );
        this.noteHandler = new NoteHandler(
            app,
            this.templateHandler,
            this.aclChecker,
            logger,
            current,
        );
        this.auditLog = auditLog ?? new AuditLogStore();
        this.version = current.serverVersion();
    }

    getAuditLog(): AuditLogStore {
        return this.auditLog;
    }

    async handleRequest(
        request: MCPRequest,
        authContext?: MCPAuthContext,
    ): Promise<MCPResponse | null> {
        this.logger.debug("Received MCP request:", request);

        try {
            switch (request.method) {
                case "initialize":
                    return this.handleInitialize(request);
                case "notifications/initialized":
                case "notifications/roots/list_changed":
                    // Notifications don't get responses
                    this.logger.debug(
                        `Received notification: ${request.method}`,
                    );
                    return null;
                case "tools/list":
                    return this.handleToolsList(request);
                case "tools/call":
                    return await this.handleToolsCall(request, authContext);
                case "resources/list":
                    return this.handleResourcesList(request);
                case "resources/templates/list":
                    return this.handleResourceTemplatesList(request);
                case "resources/read":
                    return await this.handleResourcesRead(request, authContext);
                case "prompts/list":
                    return this.handlePromptsList(request);
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
            if (request.id !== undefined && error instanceof Error) {
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
                version: this.version,
            },
            capabilities: {
                tools: {},
                resources: {},
                prompts: {},
            },
        });
    }

    private handleToolsList(request: MCPRequest): MCPResponse {
        const toolDefinitions = this.tools.getToolDefinitions();
        return this.createResponse(request.id, {
            tools: toolDefinitions,
        });
    }

    private handleResourcesList(request: MCPRequest): MCPResponse {
        const files = this.app.vault.getMarkdownFiles().filter((file) => {
            try {
                this.aclChecker.checkReadAccess(file.path);
                return true;
            } catch {
                return false;
            }
        });
        const resources = files
            .map((file) => ({
                uri: `obsidian://vault/${file.path}`,
                name: file.basename || file.path,
                mimeType: "text/markdown",
            }))
            .sort((a, b) => a.uri.localeCompare(b.uri));
        return this.createResponse(request.id, { resources });
    }

    private handleResourceTemplatesList(request: MCPRequest): MCPResponse {
        return this.createResponse(request.id, {
            resourceTemplates: [
                {
                    uriTemplate: "obsidian://vault/{+path}",
                    name: "Obsidian Vault Note",
                    description:
                        "Read any accessible Markdown note in the vault by its relative path.",
                    mimeType: "text/markdown",
                },
            ],
        });
    }

    private async handleResourcesRead(
        request: MCPRequest,
        authContext?: MCPAuthContext,
    ): Promise<MCPResponse> {
        const params = request.params ?? {};
        const rawUri = typeof params.uri === "string" ? params.uri.trim() : "";
        if (!rawUri) {
            return this.createError(
                request.id,
                -32602,
                "Missing required parameter: uri",
            );
        }
        const prefix = "obsidian://vault/";
        const notePath = rawUri.startsWith(prefix)
            ? decodeURIComponent(rawUri.slice(prefix.length))
            : rawUri;
        try {
            const note = await this.noteHandler.readNote(notePath);
            this.auditLog.record({
                authType: authContext?.authType ?? "anonymous",
                clientId: authContext?.clientId,
                method: "resources/read",
                target: notePath,
                status: "success",
            });
            return this.createResponse(request.id, {
                contents: [
                    {
                        uri: `obsidian://vault/${notePath}`,
                        mimeType: "text/markdown",
                        text: note.content ?? "",
                    },
                ],
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            this.auditLog.record({
                authType: authContext?.authType ?? "anonymous",
                clientId: authContext?.clientId,
                method: "resources/read",
                target: notePath,
                status: "error",
                detail: message,
            });
            return this.createError(request.id, -32002, message);
        }
    }

    private handlePromptsList(request: MCPRequest): MCPResponse {
        return this.createResponse(request.id, {
            prompts: [
                {
                    name: "summarize_note",
                    description:
                        "Read and summarize an Obsidian note by its vault path.",
                    arguments: [
                        {
                            name: "path",
                            description:
                                "Relative path to the note in the vault.",
                            required: true,
                        },
                    ],
                },
            ],
        });
    }

    private async handleToolsCall(
        request: MCPRequest,
        authContext?: MCPAuthContext,
    ): Promise<MCPResponse> {
        const params = request.params ?? {};
        const toolName = params.name as string;
        const args = (params.arguments as Record<string, unknown>) ?? {};

        this.logger.debug("Calling tool:", toolName, args);

        if (!toolName) {
            return this.createError(
                request.id,
                -32602,
                "Missing tool name in parameters",
            );
        }

        const tool = this.tools
            .getToolDefinitions()
            .find((t) => t.name === toolName);
        if (tool) {
            const scopes = (authContext?.scope ?? "")
                .split(/\s+/)
                .filter(Boolean);
            const isReadOnlyScope =
                authContext?.authType === "oauth" &&
                scopes.includes(READ_ONLY_OAUTH_SCOPE) &&
                !scopes.includes("vault.access");
            if (isReadOnlyScope && tool.annotations?.readOnlyHint !== true) {
                this.logger.warnAcl(
                    `OAuth read-only scope denied write tool: ${toolName}`,
                );
                return this.createError(
                    request.id,
                    -32001,
                    `Insufficient OAuth scope: tool "${toolName}" requires "vault.access" scope`,
                );
            }
            const unknownKey = Object.keys(args).find(
                (key) => !(key in tool.inputSchema.properties),
            );
            if (unknownKey) {
                return this.createError(
                    request.id,
                    -32602,
                    `Unknown argument "${unknownKey}" for tool "${toolName}"`,
                );
            }
        }

        try {
            const result = await this.tools.executeTool(toolName, args);
            this.logger.debug("Tool", toolName, "succeeded:", result);
            this.auditLog.record({
                authType: authContext?.authType ?? "anonymous",
                clientId: authContext?.clientId,
                method: `tools/call:${toolName}`,
                target: typeof args.path === "string" ? args.path : undefined,
                status: "success",
            });
            return this.createResponse(request.id, {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
                structuredContent: result,
                isError: false,
            });
        } catch (error) {
            this.logger.error(error, `Tool ${toolName} failed`, args);
            const message =
                error instanceof Error ? error.message : String(error);
            // Return tool execution error in content, not as JSON-RPC error
            // This allows the LLM to see and handle the error
            return this.createResponse(request.id, {
                content: [
                    {
                        type: "text",
                        text: `Tool execution failed: ${message}`,
                    },
                ],
                isError: true,
            });
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
