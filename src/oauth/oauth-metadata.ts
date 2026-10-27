import type { FastifyInstance } from "fastify";
import type { CurrentSettings } from "../@types/settings";
import { SUPPORTED_OAUTH_SCOPES } from "./oauth-token-store";

/**
 * Resolve the external Base URL for OAuth metadata and WWW-Authenticate headers.
 * Never trusts X-Forwarded-Host / Host headers to prevent Host Header Injection.
 */
export function resolveBaseUrl(current: CurrentSettings): string {
    const configured = current.oauthPublicUrl()?.trim();
    if (configured) {
        return configured.replace(/\/mcp\/?$/, "").replace(/\/+$/, "");
    }

    const protocol = current.tlsEnabled() ? "https" : "http";
    const configuredHost = current.serverHost();
    const host =
        configuredHost === "127.0.0.1" || configuredHost === "0.0.0.0"
            ? "localhost"
            : configuredHost;

    return `${protocol}://${host}:${current.serverPort()}`;
}

export function resolveResourceUrl(current: CurrentSettings): string {
    const baseUrl = resolveBaseUrl(current);
    try {
        const parsed = new URL(baseUrl);
        if (parsed.pathname && parsed.pathname !== "/") {
            return baseUrl;
        }
    } catch {
        // Ignore URL parse error
    }
    return `${baseUrl}/mcp`;
}

export function registerOAuthMetadataRoutes(
    server: FastifyInstance,
    current: CurrentSettings,
): void {
    const protectedResourceHandler = async () => {
        const baseUrl = resolveBaseUrl(current);
        const resourceUrl = resolveResourceUrl(current);
        return {
            resource: resourceUrl,
            authorization_servers: [baseUrl],
            bearer_methods_supported: ["header"],
            scopes_supported: [...SUPPORTED_OAUTH_SCOPES],
        };
    };

    server.get(
        "/.well-known/oauth-protected-resource",
        protectedResourceHandler,
    );
    server.get(
        "/.well-known/oauth-protected-resource/mcp",
        protectedResourceHandler,
    );

    server.get("/.well-known/oauth-authorization-server", async () => {
        const baseUrl = resolveBaseUrl(current);
        return {
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/authorize`,
            token_endpoint: `${baseUrl}/token`,
            registration_endpoint: `${baseUrl}/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            token_endpoint_auth_methods_supported: ["none"],
            code_challenge_methods_supported: ["S256"],
            scopes_supported: [...SUPPORTED_OAUTH_SCOPES],
        };
    });
}
