import { createHash } from "node:crypto";
import { App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentSettings } from "../src/@types/settings.js";
import type { OAuthConsentPrompt } from "../src/oauth/oauth-consent-modal.js";
import { OAuthTokenStore } from "../src/oauth/oauth-token-store.js";
import { MCPServer } from "../src/vaultasmcp-Server.js";
import { logger, openSettings } from "./vaultasmcp-TestFixtures.js";

const dailyNotes = vi.hoisted(() => ({
    appHasDailyNotesPluginLoaded: vi.fn(() => true),
    appHasWeeklyNotesPluginLoaded: vi.fn(() => true),
    appHasMonthlyNotesPluginLoaded: vi.fn(() => true),
    appHasQuarterlyNotesPluginLoaded: vi.fn(() => true),
    appHasYearlyNotesPluginLoaded: vi.fn(() => true),
    createDailyNote: vi.fn(),
    createWeeklyNote: vi.fn(),
    createMonthlyNote: vi.fn(),
    createQuarterlyNote: vi.fn(),
    createYearlyNote: vi.fn(),
    getAllWeeklyNotes: vi.fn(() => ({})),
    getWeeklyNote: vi.fn(() => undefined),
    getPeriodicNoteSettings: vi.fn(() => ({
        format: "YYYY-MM-DD",
        folder: "",
    })),
}));

vi.mock("obsidian-daily-notes-interface", () => dailyNotes);

function createPkcePair(
    verifier = "test-code-verifier-0123456789abcdef0123456789",
) {
    const challenge = createHash("sha256")
        .update(verifier, "ascii")
        .digest("base64url");
    return { verifier, challenge };
}

describe("OAuth 2.1 + Static Bearer Token Coexistence", () => {
    let activeServer: MCPServer | null = null;

    afterEach(async () => {
        if (activeServer?.isRunning()) {
            await activeServer.stop();
        }
        activeServer = null;
    });

    async function startTestServer(overrides: Partial<CurrentSettings> = {}) {
        const app = App.createConfigured__({
            files: { "notes/hello.md": "# Hello\nWorld" },
        });
        const settings: CurrentSettings = {
            ...openSettings,
            serverPort: () => 0,
            serverHost: () => "127.0.0.1",
            oauthEnabled: () => true,
            bearerToken: () => "static-secret-token",
            oauthPublicUrl: () => "https://mcp.example.com",
            ...overrides,
        };
        const server = new MCPServer(app.asOriginalType__(), logger, settings);
        await server.start();
        activeServer = server;
        const baseUrl = `http://127.0.0.1:${server.getPort()}`;
        return { server, baseUrl };
    }

    it("serves RFC 9728 Protected Resource and RFC 8414 Authorization Server metadata and resists Host Header Injection", async () => {
        const { baseUrl } = await startTestServer();

        const prRes = await fetch(
            `${baseUrl}/.well-known/oauth-protected-resource`,
            {
                headers: {
                    "X-Forwarded-Host": "evil.attacker.com",
                    "X-Forwarded-Proto": "http",
                },
            },
        );
        expect(prRes.status).toBe(200);
        const prBody = (await prRes.json()) as Record<string, unknown>;
        expect(prBody.resource).toBe("https://mcp.example.com/mcp");
        expect(prBody.authorization_servers).toEqual([
            "https://mcp.example.com",
        ]);
        expect(prBody.scopes_supported).toEqual(["vault.access"]);

        const asRes = await fetch(
            `${baseUrl}/.well-known/oauth-authorization-server`,
            {
                headers: {
                    "X-Forwarded-Host": "evil.attacker.com",
                },
            },
        );
        expect(asRes.status).toBe(200);
        const asBody = (await asRes.json()) as Record<string, unknown>;
        expect(asBody.issuer).toBe("https://mcp.example.com");
        expect(asBody.authorization_endpoint).toBe(
            "https://mcp.example.com/authorize",
        );
        expect(asBody.token_endpoint).toBe("https://mcp.example.com/token");
        expect(asBody.registration_endpoint).toBe(
            "https://mcp.example.com/register",
        );
        expect(asBody.token_endpoint_auth_methods_supported).toEqual(["none"]);
        expect(asBody.code_challenge_methods_supported).toEqual(["S256"]);
        expect(asBody.scopes_supported).toEqual(["vault.access"]);
    });

    it("returns 401 with WWW-Authenticate resource_metadata when unauthenticated, while allowing static Bearer token", async () => {
        const { baseUrl } = await startTestServer();

        const unauthRes = await fetch(`${baseUrl}/mcp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
        });
        expect(unauthRes.status).toBe(401);
        expect(unauthRes.headers.get("www-authenticate")).toBe(
            'Bearer realm="mcp", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
        );

        const staticRes = await fetch(`${baseUrl}/mcp`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer static-secret-token",
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
        });
        expect(staticRes.status).toBe(200);
        const staticJson = (await staticRes.json()) as {
            result?: { status?: string };
        };
        expect(staticJson.result?.status).toBe("ok");
    });

    it("completes full DCR + Authorization Code (via Modal & /authorize/status polling) + PKCE + Refresh Token rotation flow", async () => {
        let capturedPrompt: OAuthConsentPrompt | undefined;
        let promptCallCount = 0;
        const { baseUrl } = await startTestServer({
            onOAuthAuthorizeRequest: (prompt) => {
                capturedPrompt = prompt;
                promptCallCount += 1;
            },
        });

        // 1. Dynamic Client Registration (/register)
        const regRes = await fetch(`${baseUrl}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_name: "Remote Web MCP Client",
                redirect_uris: ["https://client.example.com/oauth/callback"],
            }),
        });
        expect(regRes.status).toBe(201);
        const client = (await regRes.json()) as {
            client_id: string;
            client_name: string;
        };
        expect(client.client_id).toMatch(/^mcp_/);
        expect(client.client_name).toBe("Remote Web MCP Client");

        // Verify stateless client_id survives a fresh OAuthTokenStore instance with the same secret
        const secondStore = new OAuthTokenStore(
            openSettings.getOAuthSigningSecret(),
        );
        expect(secondStore.getClient(client.client_id)?.redirect_uris).toEqual([
            "https://client.example.com/oauth/callback",
        ]);

        // 2. GET /authorize (renders non-blocking HTML consent page and triggers Obsidian prompt with 8-digit PIN)
        const { verifier, challenge } = createPkcePair();
        const authQuery = new URLSearchParams({
            client_id: client.client_id,
            redirect_uri: "https://client.example.com/oauth/callback",
            response_type: "code",
            state: "xyz-state",
            code_challenge: challenge,
            code_challenge_method: "S256",
        });
        const getAuthRes = await fetch(
            `${baseUrl}/authorize?${authQuery.toString()}`,
        );
        expect(getAuthRes.status).toBe(200);
        const html = await getAuthRes.text();
        expect(html).toContain("Remote Web MCP Client");
        expect(capturedPrompt).toBeDefined();
        expect(capturedPrompt?.pin).toMatch(/^\d{8}$/);
        expect(promptCallCount).toBe(1);
        const originalSessionId = capturedPrompt?.sessionId ?? "";

        // 3. Rejects POST /authorize with wrong key while reusing the same session without re-triggering Modal
        const badPostRes = await fetch(`${baseUrl}/authorize`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: client.client_id,
                redirect_uri: "https://client.example.com/oauth/callback",
                response_type: "code",
                state: "xyz-state",
                code_challenge: challenge,
                code_challenge_method: "S256",
                session_id: originalSessionId,
                access_key: "wrong-key",
                decision: "approve",
            }).toString(),
            redirect: "manual",
        });
        expect(badPostRes.status).toBe(403);
        const badHtml = await badPostRes.text();
        expect(badHtml).toContain(`value="${originalSessionId}"`);
        expect(promptCallCount).toBe(1);

        // 4. Approving via Obsidian Modal callback & polling /authorize/status
        capturedPrompt?.approve();
        const statusRes = await fetch(
            `${baseUrl}/authorize/status?session_id=${encodeURIComponent(originalSessionId)}`,
        );
        expect(statusRes.status).toBe(200);
        const statusBody = (await statusRes.json()) as {
            status: string;
            redirect_url: string;
        };
        expect(statusBody.status).toBe("approved");
        const redirectedUrl = new URL(statusBody.redirect_url);
        expect(redirectedUrl.origin + redirectedUrl.pathname).toBe(
            "https://client.example.com/oauth/callback",
        );
        expect(redirectedUrl.searchParams.get("state")).toBe("xyz-state");
        const code = redirectedUrl.searchParams.get("code");
        expect(code).toBeTruthy();

        // 5. Exchange code from /authorize/status for tokens via POST /token (application/x-www-form-urlencoded)
        const tokenRes = await fetch(`${baseUrl}/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code: code ?? "",
                client_id: client.client_id,
                redirect_uri: "https://client.example.com/oauth/callback",
                code_verifier: verifier,
            }).toString(),
        });
        expect(tokenRes.status).toBe(200);
        const tokenData = (await tokenRes.json()) as {
            access_token: string;
            refresh_token: string;
            token_type: string;
            scope: string;
        };
        expect(tokenData.token_type).toBe("Bearer");
        expect(tokenData.scope).toBe("vault.access");
        expect(tokenData.access_token).toMatch(/^at_/);
        expect(tokenData.refresh_token).toMatch(/^rt_/);

        // 6. Access /mcp using OAuth access_token
        const mcpRes = await fetch(`${baseUrl}/mcp`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${tokenData.access_token}`,
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
        });
        expect(mcpRes.status).toBe(200);

        // 7. Refresh token rotation: first refresh succeeds, replaying old refresh_token fails
        const refreshRes1 = await fetch(`${baseUrl}/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: tokenData.refresh_token,
                client_id: client.client_id,
            }).toString(),
        });
        expect(refreshRes1.status).toBe(200);
        const refreshed = (await refreshRes1.json()) as {
            access_token: string;
            refresh_token: string;
        };
        expect(refreshed.access_token).toMatch(/^at_/);

        const refreshReplayRes = await fetch(`${baseUrl}/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: tokenData.refresh_token,
                client_id: client.client_id,
            }).toString(),
        });
        expect(refreshReplayRes.status).toBe(400);
        const replayErr = (await refreshReplayRes.json()) as { error: string };
        expect(replayErr.error).toBe("invalid_grant");
    });

    it("locks out the 8-digit PIN after 3 failed attempts while still allowing Bearer Token or Obsidian Modal approval", async () => {
        let capturedPrompt: OAuthConsentPrompt | undefined;
        let promptCallCount = 0;
        const { baseUrl } = await startTestServer({
            onOAuthAuthorizeRequest: (prompt) => {
                capturedPrompt = prompt;
                promptCallCount += 1;
            },
        });

        const regRes = await fetch(`${baseUrl}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_name: "PIN Lockout Test Client",
                redirect_uris: ["https://client.example.com/oauth/callback"],
            }),
        });
        const client = (await regRes.json()) as { client_id: string };
        const { verifier, challenge } = createPkcePair();

        const authQuery = new URLSearchParams({
            client_id: client.client_id,
            redirect_uri: "https://client.example.com/oauth/callback",
            response_type: "code",
            state: "lockout-state",
            code_challenge: challenge,
            code_challenge_method: "S256",
        });
        await fetch(`${baseUrl}/authorize?${authQuery.toString()}`);
        expect(capturedPrompt).toBeDefined();
        expect(promptCallCount).toBe(1);
        const sessionId = capturedPrompt?.sessionId ?? "";
        const realPin = capturedPrompt?.pin ?? "";

        // 3 failed PIN attempts
        for (let i = 0; i < 3; i++) {
            const failRes = await fetch(`${baseUrl}/authorize`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    client_id: client.client_id,
                    redirect_uri: "https://client.example.com/oauth/callback",
                    response_type: "code",
                    state: "lockout-state",
                    code_challenge: challenge,
                    code_challenge_method: "S256",
                    session_id: sessionId,
                    access_key: "00000000",
                    decision: "approve",
                }).toString(),
                redirect: "manual",
            });
            expect(failRes.status).toBe(403);
        }

        // No extra modal prompts were triggered during failed attempts
        expect(promptCallCount).toBe(1);

        // 4th attempt with the CORRECT 8-digit PIN is still rejected because PIN channel is locked
        const lockedPinRes = await fetch(`${baseUrl}/authorize`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: client.client_id,
                redirect_uri: "https://client.example.com/oauth/callback",
                response_type: "code",
                state: "lockout-state",
                code_challenge: challenge,
                code_challenge_method: "S256",
                session_id: sessionId,
                access_key: realPin,
                decision: "approve",
            }).toString(),
            redirect: "manual",
        });
        expect(lockedPinRes.status).toBe(403);
        const lockedHtml = await lockedPinRes.text();
        expect(lockedHtml).toContain("PIN approval is locked");

        // However, static Bearer token still succeeds and redirects with a valid code
        const bearerApproveRes = await fetch(`${baseUrl}/authorize`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: client.client_id,
                redirect_uri: "https://client.example.com/oauth/callback",
                response_type: "code",
                state: "lockout-state",
                code_challenge: challenge,
                code_challenge_method: "S256",
                session_id: sessionId,
                access_key: "static-secret-token",
                decision: "approve",
            }).toString(),
            redirect: "manual",
        });
        expect(bearerApproveRes.status).toBe(302);
        const location = bearerApproveRes.headers.get("location") ?? "";
        const code = new URL(location).searchParams.get("code") ?? "";
        expect(code).toBeTruthy();

        const tokenRes = await fetch(`${baseUrl}/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                client_id: client.client_id,
                redirect_uri: "https://client.example.com/oauth/callback",
                code_verifier: verifier,
            }).toString(),
        });
        expect(tokenRes.status).toBe(200);
    });

    it("supports reverse-proxy subpath rewriting (/mcp/* and custom oauthPublicUrl prefix) and manual client_id without DCR", async () => {
        const publicSubpathUrl =
            "https://ctserver.016881.xyz/mcp/ob-mcp-novel/49188a3cf5ba0ca06007";
        const { baseUrl } = await startTestServer({
            oauthPublicUrl: () => publicSubpathUrl,
        });

        // 1. Subpath discovery via /mcp/.well-known/oauth-authorization-server
        const asRes = await fetch(
            `${baseUrl}/mcp/.well-known/oauth-authorization-server`,
        );
        expect(asRes.status).toBe(200);
        const asBody = (await asRes.json()) as Record<string, unknown>;
        expect(asBody.issuer).toBe(publicSubpathUrl);
        expect(asBody.authorization_endpoint).toBe(
            `${publicSubpathUrl}/authorize`,
        );
        expect(asBody.token_endpoint).toBe(`${publicSubpathUrl}/token`);

        // 2. Protected resource metadata under subpath returns the subpath as resource
        const prRes = await fetch(
            `${baseUrl}/mcp/.well-known/oauth-protected-resource`,
        );
        expect(prRes.status).toBe(200);
        const prBody = (await prRes.json()) as Record<string, unknown>;
        expect(prBody.resource).toBe(publicSubpathUrl);

        // 3. Manual client_id ("obsidian-mcp") without calling /register, accessed via /mcp/authorize
        const { verifier, challenge } = createPkcePair();
        const authQuery = new URLSearchParams({
            client_id: "obsidian-mcp",
            redirect_uri: "https://client.example.com/api/mcp/auth_callback",
            response_type: "code",
            state: "subpath-state",
            code_challenge: challenge,
            code_challenge_method: "S256",
        });

        const getAuthRes = await fetch(
            `${baseUrl}/mcp/authorize?${authQuery.toString()}`,
        );
        expect(getAuthRes.status).toBe(200);
        const html = await getAuthRes.text();
        // Form action and status polling URL include full publicSubpathUrl
        expect(html).toContain(`action="${publicSubpathUrl}/authorize"`);
        expect(html).toContain(`${publicSubpathUrl}/authorize/status`);

        // Forged mcp_ client_id is still rejected
        const forgedQuery = new URLSearchParams({
            client_id: "mcp_forged.invalid",
            redirect_uri: "https://client.example.com/api/mcp/auth_callback",
            response_type: "code",
            code_challenge: challenge,
            code_challenge_method: "S256",
        });
        const forgedRes = await fetch(
            `${baseUrl}/mcp/authorize?${forgedQuery.toString()}`,
        );
        expect(forgedRes.status).toBe(400);

        // 4. Approve manual client_id via POST /mcp/authorize and exchange via POST /mcp/token
        const postAuthRes = await fetch(`${baseUrl}/mcp/authorize`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: "obsidian-mcp",
                redirect_uri: "https://client.example.com/api/mcp/auth_callback",
                response_type: "code",
                state: "subpath-state",
                code_challenge: challenge,
                code_challenge_method: "S256",
                access_key: "static-secret-token",
                decision: "approve",
            }).toString(),
            redirect: "manual",
        });
        expect(postAuthRes.status).toBe(302);
        const code =
            new URL(
                postAuthRes.headers.get("location") ?? "",
            ).searchParams.get("code") ?? "";
        expect(code).toBeTruthy();

        const tokenRes = await fetch(`${baseUrl}/mcp/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                client_id: "obsidian-mcp",
                redirect_uri: "https://client.example.com/api/mcp/auth_callback",
                code_verifier: verifier,
            }).toString(),
        });
        expect(tokenRes.status).toBe(200);
        const tokens = (await tokenRes.json()) as { access_token: string };
        expect(tokens.access_token).toMatch(/^at_/);

        // 5. Call MCP endpoint via full publicPrefix path rewrite
        const mcpRes = await fetch(
            `${baseUrl}/mcp/ob-mcp-novel/49188a3cf5ba0ca06007`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${tokens.access_token}`,
                },
                body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "ping" }),
            },
        );
        expect(mcpRes.status).toBe(200);
    });
});
