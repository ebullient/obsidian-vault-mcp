import { describe, expect, it } from "vitest";
import {
    extractBearerToken,
    timingSafeTokenEqual,
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
        expect(
            validateServerExposure("0.0.0.0", "secret-token"),
        ).toBeUndefined();
    });

    it("allows all-interface binding when OAuth 2.1 is enabled", () => {
        expect(
            validateServerExposure("0.0.0.0", undefined, true),
        ).toBeUndefined();
    });
});

describe("timingSafeTokenEqual & extractBearerToken", () => {
    it("compares tokens safely in constant time", () => {
        expect(timingSafeTokenEqual("abc-123", "abc-123")).toBe(true);
        expect(timingSafeTokenEqual("abc-123", "abc-124")).toBe(false);
        expect(timingSafeTokenEqual("short", "longer-token")).toBe(false);
    });

    it("extracts bearer token from Authorization header", () => {
        expect(extractBearerToken("Bearer my-secret")).toBe("my-secret");
        expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeUndefined();
        expect(extractBearerToken("Bearer   ")).toBeUndefined();
        expect(extractBearerToken(undefined)).toBeUndefined();
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
