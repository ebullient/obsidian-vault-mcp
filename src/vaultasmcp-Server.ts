import cors from "@fastify/cors";
import type { FastifyInstance, FastifyRequest } from "fastify";
import Fastify from "fastify";
import type { App } from "obsidian";
import type {
    CurrentSettings,
    Logger,
    MCPAuthContext,
    MCPRequest,
} from "./@types/settings";
import { registerOAuthAuthorizeRoutes } from "./oauth/oauth-authorize";
import {
    registerOAuthMetadataRoutes,
    resolveBaseUrl,
} from "./oauth/oauth-metadata";
import { OAuthRateLimiter } from "./oauth/oauth-rate-limiter";
import { registerOAuthRegisterRoutes } from "./oauth/oauth-register";
import { registerOAuthTokenRoutes } from "./oauth/oauth-token";
import { OAuthTokenStore } from "./oauth/oauth-token-store";
import { MCPHandler } from "./vaultasmcp-MCPHandler";
import {
    extractBearerToken,
    timingSafeTokenEqual,
} from "./vaultasmcp-Security";

export function normalizeMcpRequestUrl(
    rawUrl: string | undefined,
    oauthPublicUrl: string | undefined,
): string {
    const url = rawUrl || "/";
    const qIndex = url.indexOf("?");
    let pathname = qIndex >= 0 ? url.slice(0, qIndex) : url;
    const search = qIndex >= 0 ? url.slice(qIndex) : "";

    const configured = oauthPublicUrl?.trim();
    if (configured) {
        try {
            const parsed = new URL(configured);
            const publicPrefix = parsed.pathname.replace(/\/+$/, "");
            if (publicPrefix && publicPrefix !== "/mcp") {
                if (
                    pathname === publicPrefix ||
                    pathname === `${publicPrefix}/` ||
                    pathname === `${publicPrefix}/mcp`
                ) {
                    return `/mcp${search}`;
                }
                if (pathname.startsWith(`${publicPrefix}/`)) {
                    pathname = pathname.slice(publicPrefix.length);
                }
            }
        } catch {
            // Ignore malformed URL in settings
        }
    }

    if (pathname === "/mcp/health") {
        return `/health${search}`;
    }
    if (pathname.startsWith("/mcp/.well-known/")) {
        pathname = pathname.slice(4);
    }
    if (pathname.startsWith("/.well-known/oauth-protected-resource/")) {
        return `/.well-known/oauth-protected-resource${search}`;
    }
    if (pathname.startsWith("/.well-known/oauth-authorization-server/")) {
        return `/.well-known/oauth-authorization-server${search}`;
    }
    if (
        pathname === "/mcp/authorize" ||
        pathname === "/mcp/authorize/status" ||
        pathname === "/mcp/token" ||
        pathname === "/mcp/register"
    ) {
        return `${pathname.slice(4)}${search}`;
    }
    if (pathname === "/mcp/mcp" || pathname === "/mcp/") {
        return `/mcp${search}`;
    }

    return `${pathname}${search}`;
}

export class MCPServer {
    private server: FastifyInstance | null = null;
    private mcpHandler: MCPHandler;
    private oauthStore: OAuthTokenStore;
    private rateLimiter = new OAuthRateLimiter();
    private requestAuthContext = new WeakMap<FastifyRequest, MCPAuthContext>();
    port: number;

    constructor(
        app: App,
        private logger: Logger,
        private current: CurrentSettings,
    ) {
        this.mcpHandler = new MCPHandler(app, logger, current);
        this.oauthStore = new OAuthTokenStore(current.getOAuthSigningSecret());
        this.port = current.serverPort();
    }

    async start(): Promise<void> {
        if (this.server) {
            throw new Error("Server is already running");
        }

        const tlsEnabled = this.current.tlsEnabled();
        const tlsCertificatePem = this.current.tlsCertificatePem();
        const tlsPrivateKeyPem = this.current.getTlsPrivateKeyPem();

        this.server = Fastify({
            logger: false,
            rewriteUrl: (req) =>
                normalizeMcpRequestUrl(req.url, this.current.oauthPublicUrl()),
            ...(tlsEnabled
                ? {
                      https: {
                          cert: tlsCertificatePem,
                          key: tlsPrivateKeyPem,
                      },
                  }
                : {}),
        });

        // Support application/x-www-form-urlencoded for OAuth 2.1 /token and /authorize
        this.server.addContentTypeParser(
            "application/x-www-form-urlencoded",
            { parseAs: "string" },
            (_req, body, done) => {
                try {
                    const parsed = Object.fromEntries(
                        new URLSearchParams(body as string),
                    );
                    done(null, parsed);
                } catch (err) {
                    done(err as Error, undefined);
                }
            },
        );

        // Register CORS for Tailscale and web MCP client access
        await this.server.register(cors, {
            origin: true,
            credentials: true,
            exposedHeaders: ["WWW-Authenticate", "Retry-After"],
        });

        this.server.addHook("preHandler", async (request, reply) => {
            const pathname = request.url.split("?")[0];
            const oauthEnabled = this.current.oauthEnabled();

            // Skip auth for preflight and health check
            if (request.method === "OPTIONS" || pathname === "/health") {
                return;
            }

            // Skip auth for OAuth discovery, registration, authorization, and token endpoints
            if (
                oauthEnabled &&
                (pathname.startsWith("/.well-known/") ||
                    pathname === "/authorize" ||
                    pathname === "/authorize/status" ||
                    pathname === "/token" ||
                    pathname === "/register")
            ) {
                if (
                    pathname === "/authorize" ||
                    pathname === "/token" ||
                    pathname === "/register"
                ) {
                    const rateKey = `${request.ip || "local"}:${pathname}`;
                    this.rateLimiter.setMaxRequests(
                        this.current.oauthRateLimitMax(),
                    );
                    const check = this.rateLimiter.allow(rateKey);
                    if (!check.allowed) {
                        reply
                            .code(429)
                            .header(
                                "Retry-After",
                                String(check.retryAfterSeconds),
                            )
                            .send({
                                error: "too_many_requests",
                                error_description:
                                    "Rate limit exceeded for OAuth endpoint. Please try again later.",
                            });
                        return;
                    }
                }
                return;
            }

            const bearerToken = this.current.bearerToken();
            if (!bearerToken && !oauthEnabled) {
                return;
            }

            const token = extractBearerToken(request.headers.authorization);

            // 1. Check static Bearer token first
            if (
                bearerToken &&
                token &&
                timingSafeTokenEqual(token, bearerToken)
            ) {
                this.requestAuthContext.set(request, { authType: "bearer" });
                return;
            }

            // 2. Check OAuth 2.1 Access Token
            if (oauthEnabled && token) {
                const verified = this.oauthStore.verifyAccessToken(token);
                if (verified) {
                    this.requestAuthContext.set(request, {
                        authType: "oauth",
                        clientId: verified.clientId,
                        scope: verified.scope,
                    });
                    return;
                }
            }

            // 3. Authentication failed
            if (oauthEnabled) {
                const baseUrl = resolveBaseUrl(this.current);
                this.logger.warn(
                    token
                        ? "Request with invalid bearer or OAuth token"
                        : "Request missing bearer or OAuth token",
                );
                reply
                    .code(401)
                    .header(
                        "WWW-Authenticate",
                        `Bearer realm="mcp", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
                    )
                    .send({
                        error: "unauthorized",
                        error_description: token
                            ? "Invalid bearer token or OAuth access token"
                            : "Authentication required",
                    });
                return;
            }

            if (!token) {
                this.logger.warn("Request missing bearer token");
                reply.code(401).send({ error: "Missing bearer token" });
                return;
            }

            this.logger.warn("Request with invalid bearer token");
            reply.code(401).send({ error: "Invalid bearer token" });
        });

        // Health check endpoint
        this.server.get("/health", async () => {
            return { status: "ok" };
        });

        // Register OAuth 2.1 endpoints when enabled
        if (this.current.oauthEnabled()) {
            registerOAuthMetadataRoutes(this.server, this.current);
            registerOAuthRegisterRoutes(this.server, this.oauthStore);
            registerOAuthAuthorizeRoutes(
                this.server,
                this.current,
                this.oauthStore,
                this.logger,
            );
            registerOAuthTokenRoutes(this.server, this.oauthStore, this.logger);
        }

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

            const authContext = this.requestAuthContext.get(request);
            const response = await this.mcpHandler.handleRequest(
                mcpRequest,
                authContext,
            );

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
            const address = this.server.server.address();
            if (address && typeof address === "object") {
                this.port = address.port;
            }
            if (host === "127.0.0.1") {
                this.logger.debug(
                    "Server started on",
                    `${tlsEnabled ? "https" : "http"}://localhost:${this.port}`,
                );
            } else {
                this.logger.debug(
                    "Server started on",
                    `port ${this.port} using ${tlsEnabled ? "HTTPS" : "HTTP"} (bound to all interfaces)`,
                );
            }
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

    getOAuthStore(): OAuthTokenStore {
        return this.oauthStore;
    }

    resetOAuthStore(newSecret: string): void {
        this.oauthStore.resetSecret(newSecret);
        this.rateLimiter.reset();
    }
}
