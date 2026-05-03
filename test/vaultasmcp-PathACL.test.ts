import { describe, expect, it, vi } from "vitest";
import type { CurrentSettings, Logger } from "../src/@types/settings.js";
import { PathACLChecker } from "../src/vaultasmcp-PathACL.js";

function makeSettings(
    forbidden: string[] = [],
    readOnly: string[] = [],
    writable: string[] = [],
): CurrentSettings {
    return {
        pathACL: () => ({ forbidden, readOnly, writable }),
        bearerToken: () => undefined,
        serverPort: () => 3000,
        serverHost: () => "localhost",
        serverVersion: () => "1",
    };
}

const logger: Logger = {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

describe("PathACLChecker.checkReadAccess", () => {
    it("allows read when no rules set", () => {
        const acl = new PathACLChecker(makeSettings(), logger);
        expect(() => acl.checkReadAccess("notes/foo.md")).not.toThrow();
    });

    it("throws for forbidden path", () => {
        const acl = new PathACLChecker(
            makeSettings(["private/**"]),
            logger,
        );
        expect(() =>
            acl.checkReadAccess("private/secret.md"),
        ).toThrow("Access forbidden");
    });

    it("allows path that does not match forbidden glob", () => {
        const acl = new PathACLChecker(
            makeSettings(["private/**"]),
            logger,
        );
        expect(() => acl.checkReadAccess("notes/foo.md")).not.toThrow();
    });
});

describe("PathACLChecker.checkWriteAccess", () => {
    it("allows write when no rules set", () => {
        const acl = new PathACLChecker(makeSettings(), logger);
        expect(() => acl.checkWriteAccess("notes/foo.md")).not.toThrow();
    });

    it("throws for forbidden path", () => {
        const acl = new PathACLChecker(
            makeSettings(["archive/**"]),
            logger,
        );
        expect(() =>
            acl.checkWriteAccess("archive/old.md"),
        ).toThrow("Access forbidden");
    });

    it("throws when path not in writable list", () => {
        const acl = new PathACLChecker(
            makeSettings([], [], ["inbox/**"]),
            logger,
        );
        expect(() =>
            acl.checkWriteAccess("notes/foo.md"),
        ).toThrow("not in writable list");
    });

    it("allows write when path matches writable list", () => {
        const acl = new PathACLChecker(
            makeSettings([], [], ["inbox/**"]),
            logger,
        );
        expect(() => acl.checkWriteAccess("inbox/task.md")).not.toThrow();
    });

    it("throws for read-only path", () => {
        const acl = new PathACLChecker(
            makeSettings([], ["templates/**"]),
            logger,
        );
        expect(() =>
            acl.checkWriteAccess("templates/daily.md"),
        ).toThrow("read-only");
    });
});

describe("PathACLChecker glob matching", () => {
    it("* does not cross directory boundaries", () => {
        const acl = new PathACLChecker(
            makeSettings(["private/*"]),
            logger,
        );
        // matches single-level
        expect(() =>
            acl.checkReadAccess("private/secret.md"),
        ).toThrow();
        // does NOT match nested path
        expect(() =>
            acl.checkReadAccess("private/sub/deep.md"),
        ).not.toThrow();
    });

    it("** crosses directory boundaries", () => {
        const acl = new PathACLChecker(
            makeSettings(["private/**"]),
            logger,
        );
        expect(() =>
            acl.checkReadAccess("private/sub/deep.md"),
        ).toThrow();
    });

    it("exact path match works", () => {
        const acl = new PathACLChecker(
            makeSettings(["private/secret.md"]),
            logger,
        );
        expect(() =>
            acl.checkReadAccess("private/secret.md"),
        ).toThrow();
        expect(() =>
            acl.checkReadAccess("private/other.md"),
        ).not.toThrow();
    });
});
