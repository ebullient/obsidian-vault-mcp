export function validateServerExposure(
    serverHost: string,
    bearerToken: string | undefined,
): string | undefined {
    if (serverHost === "0.0.0.0" && !bearerToken) {
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
