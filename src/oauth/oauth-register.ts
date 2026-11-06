import type { FastifyInstance } from "fastify";
import type { OAuthTokenStore } from "./oauth-token-store";

interface RegisterRequestBody {
    client_name?: string;
    redirect_uris?: unknown;
    grant_types?: unknown;
    response_types?: unknown;
    token_endpoint_auth_method?: string;
}

function isValidRedirectUri(uri: unknown): uri is string {
    if (typeof uri !== "string" || !uri.trim()) {
        return false;
    }
    try {
        const parsed = new URL(uri);
        return Boolean(parsed.protocol);
    } catch {
        return false;
    }
}

export function registerOAuthRegisterRoutes(
    server: FastifyInstance,
    store: OAuthTokenStore,
): void {
    server.post("/register", async (request, reply) => {
        const body = (request.body ?? {}) as RegisterRequestBody;
        const rawUris = body.redirect_uris;

        if (
            !Array.isArray(rawUris) ||
            rawUris.length === 0 ||
            !rawUris.every(isValidRedirectUri)
        ) {
            reply.code(400).send({
                error: "invalid_redirect_uri",
                error_description:
                    "redirect_uris must be a non-empty array of valid URLs.",
            });
            return;
        }

        const grantTypes =
            Array.isArray(body.grant_types) &&
            body.grant_types.every((g): g is string => typeof g === "string")
                ? body.grant_types
                : ["authorization_code", "refresh_token"];

        const responseTypes =
            Array.isArray(body.response_types) &&
            body.response_types.every((r): r is string => typeof r === "string")
                ? body.response_types
                : ["code"];

        const client = store.registerClient({
            client_name:
                typeof body.client_name === "string"
                    ? body.client_name
                    : undefined,
            redirect_uris: rawUris,
            grant_types: grantTypes,
            response_types: responseTypes,
            token_endpoint_auth_method:
                typeof body.token_endpoint_auth_method === "string"
                    ? body.token_endpoint_auth_method
                    : "none",
        });

        reply.code(201).send(client);
    });
}
