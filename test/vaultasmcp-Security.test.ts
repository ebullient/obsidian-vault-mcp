import { describe, expect, it } from "vitest";
import {
    validateServerExposure,
    validateTlsConfiguration,
} from "../src/vaultasmcp-Security.js";

describe("validateServerExposure", () => {
    it("allows localhost without a bearer token", () => {
        expect(
            validateServerExposure("127.0.0.1", undefined),
        ).toBeUndefined();
    });

    it("requires a bearer token for all-interface binding", () => {
        expect(validateServerExposure("0.0.0.0", undefined)).toBe(
            "Bearer token is required when server host is 0.0.0.0.",
        );
    });

    it("allows all-interface binding when a bearer token is configured", () => {
        expect(validateServerExposure("0.0.0.0", "secret-token")).toBeUndefined();
    });
});

describe("validateTlsConfiguration", () => {
    it("allows disabled TLS without certificate material", () => {
        expect(
            validateTlsConfiguration(false, undefined, undefined),
        ).toBeUndefined();
    });

    it("requires a certificate when TLS is enabled", () => {
        expect(validateTlsConfiguration(true, undefined, "key")).toBe(
            "SSL certificate PEM is required when SSL is enabled.",
        );
    });

    it("requires a private key when TLS is enabled", () => {
        expect(validateTlsConfiguration(true, "cert", undefined)).toBe(
            "SSL private key is required when SSL is enabled.",
        );
    });

    it("allows TLS when both certificate and private key are present", () => {
        expect(validateTlsConfiguration(true, "cert", "key")).toBeUndefined();
    });
});
