import { vi } from "vitest";
import type { CurrentSettings, Logger } from "../src/@types/settings.js";

export const logger: Logger = {
    debug: vi.fn(),
    warn: vi.fn(),
    warnAcl: vi.fn(),
    error: vi.fn(),
};

export const openSettings: CurrentSettings = {
    pathACL: () => ({ forbidden: [], readOnly: [], writable: [] }),
    bearerToken: () => undefined,
    serverPort: () => 3000,
    serverHost: () => "localhost",
    serverVersion: () => "1",
    normalizeQuotes: () => true,
    tlsEnabled: () => false,
    tlsCertificatePem: () => undefined,
    getTlsPrivateKeyPem: () => undefined,
    oauthEnabled: () => false,
    oauthPublicUrl: () => undefined,
    oauthRateLimitMax: () => 30,
    getOAuthSigningSecret: () => "test-signing-secret-0123456789abcdef",
};

// The daily-notes-interface mock is not exported: vi.mock()/vi.hoisted()
// factories are hoisted above every import, so an imported value would
// still be uninitialized when the factory runs — each test file needs
// its own inline vi.hoisted()/vi.mock() pair.
