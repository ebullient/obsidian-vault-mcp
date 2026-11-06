import type { FastifyInstance } from "fastify";
import type { Logger } from "../@types/settings";
import { type OAuthTokenStore, verifyPkceChallenge } from "./oauth-token-store";

interface TokenRequestBody {
    grant_type?: string;
    code?: string;
    redirect_uri?: string;
    client_id?: string;
    code_verifier?: string;
    refresh_token?: string;
    resource?: string;
}

export function registerOAuthTokenRoutes(
    server: FastifyInstance,
    store: OAuthTokenStore,
    logger: Logger,
): void {
    server.post("/token", async (request, reply) => {
        const body = (request.body ?? {}) as TokenRequestBody;
        const grantType = body.grant_type?.trim();

        reply.header("Cache-Control", "no-store");
        reply.header("Pragma", "no-cache");

        if (grantType === "authorization_code") {
            const code = body.code?.trim();
            const codeVerifier = body.code_verifier?.trim();
            const clientId = body.client_id?.trim();
            const redirectUri = body.redirect_uri?.trim();

            if (!code || !codeVerifier) {
                reply.code(400).send({
                    error: "invalid_request",
                    error_description:
                        "Missing required parameters: code and code_verifier",
                });
                return;
            }

            const record = store.consumeAuthorizationCode(code);
            if (!record) {
                logger.warn("OAuth token request with invalid or expired code");
                reply.code(400).send({
                    error: "invalid_grant",
                    error_description:
                        "Authorization code is invalid or expired",
                });
                return;
            }

            if (clientId && clientId !== record.clientId) {
                logger.warn("OAuth token request client_id mismatch");
                reply.code(400).send({
                    error: "invalid_grant",
                    error_description:
                        "client_id does not match authorization code",
                });
                return;
            }

            if (redirectUri && redirectUri !== record.redirectUri) {
                logger.warn("OAuth token request redirect_uri mismatch");
                reply.code(400).send({
                    error: "invalid_grant",
                    error_description:
                        "redirect_uri does not match authorization code",
                });
                return;
            }

            if (
                !verifyPkceChallenge(
                    codeVerifier,
                    record.codeChallenge,
                    record.codeChallengeMethod,
                )
            ) {
                logger.warn("OAuth token request failed PKCE verification");
                reply.code(400).send({
                    error: "invalid_grant",
                    error_description: "PKCE code_verifier verification failed",
                });
                return;
            }

            const tokens = store.issueTokenPair({
                clientId: record.clientId,
                scope: record.scope,
                resource: body.resource?.trim() || record.resource,
            });
            reply.code(200).send(tokens);
            return;
        }

        if (grantType === "refresh_token") {
            const refreshToken = body.refresh_token?.trim();
            const clientId = body.client_id?.trim();

            if (!refreshToken) {
                reply.code(400).send({
                    error: "invalid_request",
                    error_description:
                        "Missing required parameter: refresh_token",
                });
                return;
            }

            const verified = store.consumeRefreshToken(refreshToken, clientId);
            if (!verified) {
                logger.warn(
                    "OAuth refresh_token is invalid, expired, or already used",
                );
                reply.code(400).send({
                    error: "invalid_grant",
                    error_description:
                        "Refresh token is invalid, expired, or already used",
                });
                return;
            }

            const tokens = store.issueTokenPair({
                clientId: verified.clientId,
                scope: verified.scope,
                resource: body.resource?.trim() || verified.resource,
            });
            reply.code(200).send(tokens);
            return;
        }

        reply.code(400).send({
            error: "unsupported_grant_type",
            error_description:
                "Supported grant_types are authorization_code and refresh_token",
        });
    });
}
