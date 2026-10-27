import {
    createHash,
    createHmac,
    randomBytes,
    timingSafeEqual,
} from "node:crypto";

export const DEFAULT_OAUTH_SCOPE = "vault.access";
export const READ_ONLY_OAUTH_SCOPE = "vault.read";
export const SUPPORTED_OAUTH_SCOPES = [
    DEFAULT_OAUTH_SCOPE,
    READ_ONLY_OAUTH_SCOPE,
] as const;

export interface VerifiedAccessToken {
    clientId: string;
    scope: string;
    resource?: string;
}
export const MAX_PIN_ATTEMPTS = 3;

export interface RegisteredClient {
    client_id: string;
    client_name: string;
    redirect_uris: string[];
    grant_types: string[];
    response_types: string[];
    token_endpoint_auth_method: string;
    client_id_issued_at: number;
}

export interface AuthorizationCodeRecord {
    code: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope: string;
    resource?: string;
    expiresAt: number;
}

export interface AuthorizationSessionRecord {
    sessionId: string;
    pin: string;
    pinAttempts: number;
    pinLocked: boolean;
    clientId: string;
    clientName: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope: string;
    state: string;
    resource?: string;
    status: "pending" | "approved" | "denied";
    code?: string;
    expiresAt: number;
}

interface SignedTokenPayload {
    typ: "at" | "rt";
    sub: string;
    scope: string;
    res?: string;
    iat: number;
    exp: number;
    jti: string;
}

interface SignedClientPayload {
    typ: "cli";
    name: string;
    uris: string[];
    iat: number;
}

const ACCESS_TOKEN_TTL_SECONDS = 3600; // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600; // 30 days
const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const AUTH_SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class OAuthTokenStore {
    private authCodes = new Map<string, AuthorizationCodeRecord>();
    private authSessions = new Map<string, AuthorizationSessionRecord>();
    private consumedRefreshJtis = new Map<string, number>();

    private signingSecret: string;

    constructor(signingSecret: string) {
        this.signingSecret = signingSecret;
    }

    resetSecret(newSecret: string): void {
        this.signingSecret = newSecret;
        this.authCodes.clear();
        this.authSessions.clear();
        this.consumedRefreshJtis.clear();
    }

    private sign(data: string): string {
        return createHmac("sha256", this.signingSecret)
            .update(data)
            .digest("base64url");
    }

    private verifySignature(data: string, signature: string): boolean {
        const expected = this.sign(data);
        const a = Buffer.from(expected, "utf8");
        const b = Buffer.from(signature, "utf8");
        if (a.length !== b.length) {
            return false;
        }
        return timingSafeEqual(a, b);
    }

    registerClient(input: {
        client_name?: string;
        redirect_uris: string[];
        grant_types?: string[];
        response_types?: string[];
        token_endpoint_auth_method?: string;
    }): RegisteredClient {
        const now = Math.floor(Date.now() / 1000);
        const clientName = input.client_name?.trim() || "MCP Client";
        const payload: SignedClientPayload = {
            typ: "cli",
            name: clientName,
            uris: input.redirect_uris,
            iat: now,
        };
        const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
            "base64url",
        );
        const sig = this.sign(encoded);
        const clientId = `mcp_${encoded}.${sig}`;

        return {
            client_id: clientId,
            client_name: clientName,
            redirect_uris: input.redirect_uris,
            grant_types: input.grant_types ?? [
                "authorization_code",
                "refresh_token",
            ],
            response_types: input.response_types ?? ["code"],
            token_endpoint_auth_method:
                input.token_endpoint_auth_method ?? "none",
            client_id_issued_at: now,
        };
    }

    getClient(clientId: string): RegisteredClient | undefined {
        if (!clientId.startsWith("mcp_")) {
            return undefined;
        }

        const raw = clientId.slice(4);
        const dotIndex = raw.indexOf(".");
        if (dotIndex <= 0) {
            return undefined;
        }

        const encoded = raw.slice(0, dotIndex);
        const sig = raw.slice(dotIndex + 1);
        if (!this.verifySignature(encoded, sig)) {
            return undefined;
        }

        try {
            const parsed = JSON.parse(
                Buffer.from(encoded, "base64url").toString("utf8"),
            ) as SignedClientPayload;
            if (parsed.typ !== "cli" || !Array.isArray(parsed.uris)) {
                return undefined;
            }
            return {
                client_id: clientId,
                client_name: parsed.name || "MCP Client",
                redirect_uris: parsed.uris,
                grant_types: ["authorization_code", "refresh_token"],
                response_types: ["code"],
                token_endpoint_auth_method: "none",
                client_id_issued_at: parsed.iat,
            };
        } catch {
            return undefined;
        }
    }

    createAuthorizationSession(params: {
        clientId: string;
        clientName: string;
        redirectUri: string;
        codeChallenge: string;
        codeChallengeMethod: string;
        scope?: string;
        state?: string;
        resource?: string;
    }): AuthorizationSessionRecord {
        this.pruneExpired();
        const sessionId = randomBytes(16).toString("base64url");
        const pin = String(randomBytes(4).readUInt32BE(0) % 100000000).padStart(
            8,
            "0",
        );
        const record: AuthorizationSessionRecord = {
            sessionId,
            pin,
            pinAttempts: 0,
            pinLocked: false,
            clientId: params.clientId,
            clientName: params.clientName,
            redirectUri: params.redirectUri,
            codeChallenge: params.codeChallenge,
            codeChallengeMethod: params.codeChallengeMethod,
            scope: params.scope || DEFAULT_OAUTH_SCOPE,
            state: params.state ?? "",
            resource: params.resource,
            status: "pending",
            expiresAt: Date.now() + AUTH_SESSION_TTL_MS,
        };
        this.authSessions.set(sessionId, record);
        return record;
    }

    getAuthorizationSession(
        sessionId: string | undefined,
    ): AuthorizationSessionRecord | undefined {
        if (!sessionId) {
            return undefined;
        }
        const record = this.authSessions.get(sessionId);
        if (!record) {
            return undefined;
        }
        if (record.expiresAt < Date.now()) {
            this.authSessions.delete(sessionId);
            return undefined;
        }
        return record;
    }

    approveAuthorizationSession(
        sessionId: string,
        grantedScope?: string,
    ): string | undefined {
        const record = this.getAuthorizationSession(sessionId);
        if (!record || record.status === "denied") {
            return undefined;
        }
        if (
            record.status === "approved" &&
            record.code &&
            this.authCodes.has(record.code)
        ) {
            return record.code;
        }
        if (grantedScope?.trim()) {
            record.scope = grantedScope.trim();
        }
        const code = this.createAuthorizationCode({
            clientId: record.clientId,
            redirectUri: record.redirectUri,
            codeChallenge: record.codeChallenge,
            codeChallengeMethod: record.codeChallengeMethod,
            scope: record.scope,
            resource: record.resource,
        });
        record.status = "approved";
        record.code = code;
        return code;
    }

    denyAuthorizationSession(sessionId: string): boolean {
        const record = this.getAuthorizationSession(sessionId);
        if (!record) {
            return false;
        }
        record.status = "denied";
        return true;
    }

    verifyAndConsumeSessionPin(
        sessionId: string | undefined,
        clientId: string,
        candidatePin: string,
    ): boolean {
        const record = this.getAuthorizationSession(sessionId);
        if (
            !record ||
            record.clientId !== clientId ||
            record.status === "denied" ||
            record.pinLocked
        ) {
            return false;
        }

        const a = Buffer.from(record.pin, "utf8");
        const b = Buffer.from(candidatePin.trim(), "utf8");
        const matched = a.length === b.length && timingSafeEqual(a, b);
        if (!matched) {
            record.pinAttempts += 1;
            if (record.pinAttempts >= MAX_PIN_ATTEMPTS) {
                record.pinLocked = true;
            }
            return false;
        }

        this.authSessions.delete(record.sessionId);
        return true;
    }

    consumeAuthorizationSession(sessionId: string | undefined): void {
        if (sessionId) {
            this.authSessions.delete(sessionId);
        }
    }

    createAuthorizationCode(params: {
        clientId: string;
        redirectUri: string;
        codeChallenge: string;
        codeChallengeMethod: string;
        scope?: string;
        resource?: string;
    }): string {
        this.pruneExpired();
        const code = randomBytes(32).toString("base64url");
        this.authCodes.set(code, {
            code,
            clientId: params.clientId,
            redirectUri: params.redirectUri,
            codeChallenge: params.codeChallenge,
            codeChallengeMethod: params.codeChallengeMethod,
            scope: params.scope || DEFAULT_OAUTH_SCOPE,
            resource: params.resource,
            expiresAt: Date.now() + AUTH_CODE_TTL_MS,
        });
        return code;
    }

    consumeAuthorizationCode(
        code: string,
    ): AuthorizationCodeRecord | undefined {
        const record = this.authCodes.get(code);
        if (!record) {
            return undefined;
        }
        this.authCodes.delete(code);
        if (record.expiresAt < Date.now()) {
            return undefined;
        }
        return record;
    }

    issueTokenPair(params: {
        clientId: string;
        scope?: string;
        resource?: string;
    }): {
        access_token: string;
        refresh_token: string;
        token_type: "Bearer";
        expires_in: number;
        scope: string;
    } {
        const scope = params.scope || DEFAULT_OAUTH_SCOPE;
        const accessToken = this.issueSignedToken(
            "at",
            params.clientId,
            scope,
            ACCESS_TOKEN_TTL_SECONDS,
            params.resource,
        );
        const refreshToken = this.issueSignedToken(
            "rt",
            params.clientId,
            scope,
            REFRESH_TOKEN_TTL_SECONDS,
            params.resource,
        );
        return {
            access_token: accessToken,
            refresh_token: refreshToken,
            token_type: "Bearer",
            expires_in: ACCESS_TOKEN_TTL_SECONDS,
            scope,
        };
    }

    private issueSignedToken(
        typ: "at" | "rt",
        clientId: string,
        scope: string,
        ttlSeconds: number,
        resource?: string,
    ): string {
        const now = Math.floor(Date.now() / 1000);
        const payload: SignedTokenPayload = {
            typ,
            sub: clientId,
            scope,
            res: resource,
            iat: now,
            exp: now + ttlSeconds,
            jti: randomBytes(12).toString("base64url"),
        };
        const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
            "base64url",
        );
        const sig = this.sign(encoded);
        return `${typ}_${encoded}.${sig}`;
    }

    private verifySignedToken(
        token: string,
        expectedType: "at" | "rt",
    ): SignedTokenPayload | undefined {
        const prefix = `${expectedType}_`;
        if (!token.startsWith(prefix)) {
            return undefined;
        }

        const raw = token.slice(prefix.length);
        const dotIndex = raw.indexOf(".");
        if (dotIndex <= 0) {
            return undefined;
        }

        const encoded = raw.slice(0, dotIndex);
        const sig = raw.slice(dotIndex + 1);
        if (!this.verifySignature(encoded, sig)) {
            return undefined;
        }

        try {
            const payload = JSON.parse(
                Buffer.from(encoded, "base64url").toString("utf8"),
            ) as SignedTokenPayload;
            const now = Math.floor(Date.now() / 1000);
            if (payload.typ !== expectedType || payload.exp <= now) {
                return undefined;
            }
            return payload;
        } catch {
            return undefined;
        }
    }

    verifyAccessToken(token: string): VerifiedAccessToken | undefined {
        const payload = this.verifySignedToken(token, "at");
        if (!payload) {
            return undefined;
        }
        return {
            clientId: payload.sub,
            scope: payload.scope,
            resource: payload.res,
        };
    }

    isValidAccessToken(token: string): boolean {
        return this.verifyAccessToken(token) !== undefined;
    }

    consumeRefreshToken(
        refreshToken: string,
        clientId?: string,
    ): { clientId: string; scope: string; resource?: string } | undefined {
        this.pruneExpired();
        const payload = this.verifySignedToken(refreshToken, "rt");
        if (!payload) {
            return undefined;
        }
        if (clientId && payload.sub !== clientId) {
            return undefined;
        }
        // Enforce refresh_token rotation: prevent replay of already consumed jti
        if (this.consumedRefreshJtis.has(payload.jti)) {
            return undefined;
        }
        this.consumedRefreshJtis.set(payload.jti, payload.exp * 1000);
        return {
            clientId: payload.sub,
            scope: payload.scope,
            resource: payload.res,
        };
    }

    private pruneExpired(): void {
        const now = Date.now();
        for (const [key, record] of this.authCodes.entries()) {
            if (record.expiresAt < now) {
                this.authCodes.delete(key);
            }
        }
        for (const [key, record] of this.authSessions.entries()) {
            if (record.expiresAt < now) {
                this.authSessions.delete(key);
            }
        }
        for (const [jti, expMs] of this.consumedRefreshJtis.entries()) {
            if (expMs < now) {
                this.consumedRefreshJtis.delete(jti);
            }
        }
    }
}

export function verifyPkceChallenge(
    codeVerifier: string,
    codeChallenge: string,
    method = "S256",
): boolean {
    if (!codeVerifier || !codeChallenge) {
        return false;
    }
    if (method !== "S256") {
        return false;
    }
    const computed = createHash("sha256")
        .update(codeVerifier, "ascii")
        .digest("base64url");
    const a = Buffer.from(computed, "utf8");
    const b = Buffer.from(codeChallenge, "utf8");
    if (a.length !== b.length) {
        return false;
    }
    return timingSafeEqual(a, b);
}
