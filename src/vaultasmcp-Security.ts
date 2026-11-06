import { timingSafeEqual } from "node:crypto";

export function timingSafeTokenEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
        return false;
    }
    return timingSafeEqual(bufA, bufB);
}

export function extractBearerToken(
    authorizationHeader: string | undefined,
): string | undefined {
    if (!authorizationHeader?.startsWith("Bearer ")) {
        return undefined;
    }
    const token = authorizationHeader.substring(7).trim();
    return token || undefined;
}

export function validateServerExposure(
    serverHost: string,
    bearerToken: string | undefined,
    oauthEnabled = false,
): string | undefined {
    if (serverHost === "0.0.0.0" && !bearerToken && !oauthEnabled) {
        return "Bearer token is required when server host is 0.0.0.0.";
    }

    return undefined;
}

export function validateTlsConfiguration(
    tlsEnabled: boolean,
    tlsCertificatePem: string | undefined,
    tlsPrivateKey: string | undefined,
): string | undefined {
    if (!tlsEnabled) {
        return undefined;
    }

    if (!tlsCertificatePem?.trim()) {
        return "SSL certificate PEM is required when SSL is enabled.";
    }

    if (!tlsPrivateKey?.trim()) {
        return "SSL private key is required when SSL is enabled.";
    }

    return undefined;
}
