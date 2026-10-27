import type { FastifyInstance } from "fastify";
import type { CurrentSettings, Logger } from "../@types/settings";
import { timingSafeTokenEqual } from "../vaultasmcp-Security";
import { resolveBaseUrl } from "./oauth-metadata";
import { DEFAULT_OAUTH_SCOPE, type OAuthTokenStore } from "./oauth-token-store";

interface AuthorizeParams {
    client_id?: string;
    redirect_uri?: string;
    response_type?: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    scope?: string;
    resource?: string;
    session_id?: string;
    access_key?: string;
    decision?: string;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function isValidUrl(uri: string): boolean {
    try {
        const parsed = new URL(uri);
        return Boolean(parsed.protocol);
    } catch {
        return false;
    }
}

function buildRedirectUrl(
    redirectUri: string,
    params: Record<string, string>,
): string {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) {
        if (value) {
            url.searchParams.set(key, value);
        }
    }
    return url.toString();
}

function renderConsentPage(params: {
    clientName: string;
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope: string;
    resource: string;
    sessionId: string;
    authorizeUrl: string;
    statusUrl: string;
    hasBearerToken: boolean;
    errorMessage?: string;
}): string {
    const promptHint = params.hasBearerToken
        ? "Click Approve in the Obsidian modal, or enter your Bearer Token / 8-digit PIN below:"
        : "Click Approve in the Obsidian modal, or enter the 8-digit PIN shown in Obsidian:";

    const errorHtml = params.errorMessage
        ? `<div class="error">${escapeHtml(params.errorMessage)}</div>`
        : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authorize MCP Access - Obsidian Vault</title>
    <style>
        :root {
            color-scheme: light dark;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: Canvas;
            color: CanvasText;
        }
        .card {
            max-width: 440px;
            width: 90%;
            padding: 24px;
            border-radius: 12px;
            border: 1px solid rgba(128, 128, 128, 0.3);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
        }
        h1 {
            font-size: 1.25rem;
            margin: 0 0 12px;
        }
        p {
            font-size: 0.92rem;
            line-height: 1.5;
            margin: 8px 0;
        }
        .meta {
            font-size: 0.85rem;
            padding: 10px 12px;
            border-radius: 8px;
            background: rgba(128, 128, 128, 0.1);
            word-break: break-all;
            margin: 12px 0;
        }
        .error {
            color: #d93025;
            background: rgba(217, 48, 37, 0.1);
            padding: 10px;
            border-radius: 6px;
            margin-bottom: 12px;
            font-size: 0.88rem;
        }
        .status {
            font-size: 0.82rem;
            opacity: 0.75;
            margin-top: 8px;
        }
        label {
            display: block;
            font-size: 0.88rem;
            font-weight: 600;
            margin: 14px 0 6px;
        }
        input[type="password"] {
            width: 100%;
            box-sizing: border-box;
            padding: 10px;
            border-radius: 6px;
            border: 1px solid rgba(128, 128, 128, 0.4);
            font-size: 0.95rem;
        }
        .actions {
            display: flex;
            gap: 10px;
            margin-top: 18px;
        }
        button {
            flex: 1;
            padding: 10px 14px;
            border-radius: 6px;
            border: none;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
        }
        .approve {
            background: #7c3aed;
            color: #ffffff;
        }
        .deny {
            background: rgba(128, 128, 128, 0.2);
            color: inherit;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>Authorize Obsidian Vault MCP</h1>
        <p><strong>${escapeHtml(params.clientName)}</strong> is requesting access to your Obsidian vault via Model Context Protocol.</p>
        <div class="meta">
            <div><strong>Redirect URI:</strong> ${escapeHtml(params.redirectUri)}</div>
            <div><strong>Scope:</strong> ${escapeHtml(params.scope)}</div>
        </div>
        ${errorHtml}
        <form method="POST" action="${escapeHtml(params.authorizeUrl)}">
            <input type="hidden" name="client_id" value="${escapeHtml(params.clientId)}" />
            <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}" />
            <input type="hidden" name="response_type" value="code" />
            <input type="hidden" name="state" value="${escapeHtml(params.state)}" />
            <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}" />
            <input type="hidden" name="code_challenge_method" value="${escapeHtml(params.codeChallengeMethod)}" />
            <input type="hidden" name="scope" value="${escapeHtml(params.scope)}" />
            <input type="hidden" name="resource" value="${escapeHtml(params.resource)}" />
            <input type="hidden" name="session_id" value="${escapeHtml(params.sessionId)}" />
            <label for="access_key">${escapeHtml(promptHint)}</label>
            <input id="access_key" name="access_key" type="password" autocomplete="off" placeholder="Bearer token or 8-digit PIN" />
            <div class="actions">
                <button type="submit" name="decision" value="deny" class="deny">Deny</button>
                <button type="submit" name="decision" value="approve" class="approve">Approve</button>
            </div>
            <div class="status">Waiting for approval in Obsidian or via key above...</div>
        </form>
    </div>
    <script>
        (function() {
            var sessionId = ${JSON.stringify(params.sessionId)};
            var statusUrl = ${JSON.stringify(params.statusUrl)};
            if (!sessionId) return;
            var timer = setInterval(function() {
                fetch(statusUrl + "?session_id=" + encodeURIComponent(sessionId))
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data && data.redirect_url) {
                            clearInterval(timer);
                            window.location.replace(data.redirect_url);
                        }
                    })
                    .catch(function() {});
            }, 2000);
        })();
    </script>
</body>
</html>`;
}

function validateAuthorizeRequest(
    params: AuthorizeParams,
    store: OAuthTokenStore,
):
    | {
          ok: true;
          clientName: string;
          clientId: string;
          redirectUri: string;
          codeChallenge: string;
          codeChallengeMethod: string;
          scope: string;
          state: string;
          resource: string;
      }
    | {
          ok: false;
          error: string;
          description: string;
      } {
    const clientId = params.client_id?.trim();
    const redirectUri = params.redirect_uri?.trim();
    const responseType = params.response_type?.trim();
    const codeChallenge = params.code_challenge?.trim();
    const codeChallengeMethod = params.code_challenge_method?.trim() || "S256";

    if (!clientId) {
        return {
            ok: false,
            error: "invalid_request",
            description: "Missing required parameter: client_id",
        };
    }

    if (!redirectUri || !isValidUrl(redirectUri)) {
        return {
            ok: false,
            error: "invalid_request",
            description: "Missing or invalid parameter: redirect_uri",
        };
    }

    const registered = store.getClient(clientId);
    if (registered) {
        if (!registered.redirect_uris.includes(redirectUri)) {
            return {
                ok: false,
                error: "invalid_request",
                description:
                    "redirect_uri does not match registered client redirect_uris",
            };
        }
    } else if (clientId.startsWith("mcp_")) {
        return {
            ok: false,
            error: "invalid_client",
            description:
                "Unknown or invalid client_id. Register via /register first.",
        };
    }

    if (responseType !== "code") {
        return {
            ok: false,
            error: "unsupported_response_type",
            description: "Only response_type=code is supported",
        };
    }

    if (!codeChallenge || codeChallengeMethod !== "S256") {
        return {
            ok: false,
            error: "invalid_request",
            description:
                "PKCE code_challenge with code_challenge_method=S256 is required",
        };
    }

    return {
        ok: true,
        clientName: registered?.client_name ?? clientId,
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        scope: params.scope?.trim() || DEFAULT_OAUTH_SCOPE,
        state: params.state ?? "",
        resource: params.resource?.trim() ?? "",
    };
}

export function registerOAuthAuthorizeRoutes(
    server: FastifyInstance,
    current: CurrentSettings,
    store: OAuthTokenStore,
    logger: Logger,
): void {
    server.get("/authorize", async (request, reply) => {
        const query = (request.query ?? {}) as AuthorizeParams;
        const validated = validateAuthorizeRequest(query, store);
        if (!validated.ok) {
            reply.code(400).send({
                error: validated.error,
                error_description: validated.description,
            });
            return;
        }

        const session = store.createAuthorizationSession({
            clientId: validated.clientId,
            clientName: validated.clientName,
            redirectUri: validated.redirectUri,
            codeChallenge: validated.codeChallenge,
            codeChallengeMethod: validated.codeChallengeMethod,
            scope: validated.scope,
            state: validated.state,
            resource: validated.resource || undefined,
        });

        current.onOAuthAuthorizeRequest?.({
            sessionId: session.sessionId,
            clientName: validated.clientName,
            clientId: validated.clientId,
            redirectUri: validated.redirectUri,
            scope: validated.scope,
            pin: session.pin,
            approve: () => {
                store.approveAuthorizationSession(session.sessionId);
            },
            deny: () => {
                store.denyAuthorizationSession(session.sessionId);
            },
        });

        logger.debug(
            `OAuth authorization requested by "${validated.clientName}". Approval PIN: ${session.pin}`,
        );

        const baseUrl = resolveBaseUrl(current);
        const html = renderConsentPage({
            clientName: validated.clientName,
            clientId: validated.clientId,
            redirectUri: validated.redirectUri,
            state: validated.state,
            codeChallenge: validated.codeChallenge,
            codeChallengeMethod: validated.codeChallengeMethod,
            scope: validated.scope,
            resource: validated.resource,
            sessionId: session.sessionId,
            authorizeUrl: `${baseUrl}/authorize`,
            statusUrl: `${baseUrl}/authorize/status`,
            hasBearerToken: Boolean(current.bearerToken()),
        });

        reply
            .code(200)
            .header("Content-Type", "text/html; charset=utf-8")
            .send(html);
    });

    server.get("/authorize/status", async (request, reply) => {
        const query = (request.query ?? {}) as { session_id?: string };
        const session = store.getAuthorizationSession(query.session_id);
        if (!session) {
            reply.code(404).send({ status: "expired" });
            return;
        }

        if (session.status === "approved") {
            const code = store.approveAuthorizationSession(session.sessionId);
            if (!code) {
                reply.code(404).send({ status: "expired" });
                return;
            }
            const redirectUrl = buildRedirectUrl(session.redirectUri, {
                code,
                state: session.state,
            });
            store.consumeAuthorizationSession(session.sessionId);
            reply.code(200).send({
                status: "approved",
                redirect_url: redirectUrl,
            });
            return;
        }

        if (session.status === "denied") {
            const redirectUrl = buildRedirectUrl(session.redirectUri, {
                error: "access_denied",
                state: session.state,
            });
            store.consumeAuthorizationSession(session.sessionId);
            reply.code(200).send({
                status: "denied",
                redirect_url: redirectUrl,
            });
            return;
        }

        reply.code(200).send({ status: "pending" });
    });

    server.post("/authorize", async (request, reply) => {
        const body = (request.body ?? {}) as AuthorizeParams;
        const validated = validateAuthorizeRequest(body, store);
        if (!validated.ok) {
            reply.code(400).send({
                error: validated.error,
                error_description: validated.description,
            });
            return;
        }

        if (body.decision === "deny") {
            store.consumeAuthorizationSession(body.session_id);
            const redirectUrl = buildRedirectUrl(validated.redirectUri, {
                error: "access_denied",
                state: validated.state,
            });
            reply.redirect(redirectUrl, 302);
            return;
        }

        // Check if already approved via Obsidian Modal
        const existingSession = store.getAuthorizationSession(body.session_id);
        if (
            existingSession &&
            existingSession.clientId === validated.clientId &&
            existingSession.status === "approved"
        ) {
            const code = store.approveAuthorizationSession(
                existingSession.sessionId,
            );
            store.consumeAuthorizationSession(existingSession.sessionId);
            if (code) {
                const redirectUrl = buildRedirectUrl(validated.redirectUri, {
                    code,
                    state: validated.state,
                });
                reply.redirect(redirectUrl, 302);
                return;
            }
        }

        const candidateKey = body.access_key?.trim() ?? "";
        const staticToken = current.bearerToken();
        const matchesBearerToken = Boolean(
            staticToken &&
                candidateKey &&
                timingSafeTokenEqual(candidateKey, staticToken),
        );
        const matchesPin = Boolean(
            candidateKey &&
                store.verifyAndConsumeSessionPin(
                    body.session_id,
                    validated.clientId,
                    candidateKey,
                ),
        );

        if (!matchesBearerToken && !matchesPin) {
            logger.warn(
                `OAuth authorization denied: invalid approval key for client ${validated.clientId}`,
            );
            const activeSession = store.getAuthorizationSession(
                body.session_id,
            );
            const errorMessage = activeSession?.pinLocked
                ? "Too many failed PIN attempts. PIN approval is locked for this session; please approve in the Obsidian modal or enter your Bearer Token."
                : "Invalid Bearer Token or approval PIN. Please try again or approve in the Obsidian modal.";

            const baseUrl = resolveBaseUrl(current);
            const html = renderConsentPage({
                clientName: validated.clientName,
                clientId: validated.clientId,
                redirectUri: validated.redirectUri,
                state: validated.state,
                codeChallenge: validated.codeChallenge,
                codeChallengeMethod: validated.codeChallengeMethod,
                scope: validated.scope,
                resource: validated.resource,
                sessionId: activeSession?.sessionId ?? "",
                authorizeUrl: `${baseUrl}/authorize`,
                statusUrl: `${baseUrl}/authorize/status`,
                hasBearerToken: Boolean(staticToken),
                errorMessage,
            });
            reply
                .code(403)
                .header("Content-Type", "text/html; charset=utf-8")
                .send(html);
            return;
        }

        store.consumeAuthorizationSession(body.session_id);
        const code = store.createAuthorizationCode({
            clientId: validated.clientId,
            redirectUri: validated.redirectUri,
            codeChallenge: validated.codeChallenge,
            codeChallengeMethod: validated.codeChallengeMethod,
            scope: validated.scope,
            resource: validated.resource || undefined,
        });

        const redirectUrl = buildRedirectUrl(validated.redirectUri, {
            code,
            state: validated.state,
        });
        reply.redirect(redirectUrl, 302);
    });
}
