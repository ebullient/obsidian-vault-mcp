import type { CurrentSettings, Logger } from "./@types/settings";

/**
 * Path access control with glob pattern support
 */
export class PathACLChecker {
    constructor(
        private current: CurrentSettings,
        private logger: Logger,
    ) {}

    /**
     * Check if a path can be read
     * @throws Error if path is forbidden
     * @returns true if path can be read
     */
    checkReadAccess(path: string): void {
        const acl = this.current.pathACL();
        if (this.matchesAny(path, acl.forbidden)) {
            this.logger.warn(`ACL denied read access: ${path}`);
            throw new Error(`Access forbidden: ${path}`);
        }
    }

    /**
     * Check if a path can be written (create/update/delete)
     * @throws Error if path is forbidden or read-only
     * @returns true if path can be written
     */
    checkWriteAccess(path: string): void {
        const acl = this.current.pathACL();
        if (this.matchesAny(path, acl.forbidden)) {
            this.logger.warn(`ACL denied write access: ${path} (forbidden)`);
            throw new Error(`Access forbidden: ${path}`);
        }

        // If writable list is not empty, path must be in writable list
        if (acl.writable.length > 0 && !this.matchesAny(path, acl.writable)) {
            this.logger.warn(
                `ACL denied write access: ${path} (not in writable list)`,
            );
            throw new Error(
                `Write access denied: ${path} (not in writable list)`,
            );
        }

        // Check if explicitly read-only
        if (this.matchesAny(path, acl.readOnly)) {
            this.logger.warn(`ACL denied write access: ${path} (read-only)`);
            throw new Error(`Write access denied: ${path} (read-only)`);
        }
    }

    /**
     * Check if path matches any pattern in the list
     */
    private matchesAny(path: string, patterns: string[]): boolean {
        return patterns.some((pattern) => this.matchGlob(path, pattern));
    }

    /**
     * Simple glob matcher supporting * and **
     * - * matches any characters except /
     * - ** matches any characters including /
     */
    private matchGlob(path: string, pattern: string): boolean {
        // Escape special regex characters except * and /
        let regexPattern = pattern
            .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
            .replace(/\*\*/g, "DOUBLE_STAR")
            .replace(/\*/g, "[^/]*")
            .replace(/DOUBLE_STAR/g, ".*");

        // Anchor the pattern
        regexPattern = `^${regexPattern}$`;

        const regex = new RegExp(regexPattern);
        return regex.test(path);
    }
}
