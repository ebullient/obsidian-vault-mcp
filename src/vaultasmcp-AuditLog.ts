export interface AuditLogEntry {
    timestamp: string;
    authType: "bearer" | "oauth" | "anonymous";
    clientId?: string;
    method: string;
    target?: string;
    status: "success" | "error";
    detail?: string;
}

export class AuditLogStore {
    private entries: AuditLogEntry[] = [];

    constructor(private readonly maxEntries = 100) {}

    record(
        entry: Omit<AuditLogEntry, "timestamp"> & { timestamp?: string },
    ): void {
        this.entries.unshift({
            ...entry,
            timestamp: entry.timestamp ?? new Date().toISOString(),
        });
        if (this.entries.length > this.maxEntries) {
            this.entries.length = this.maxEntries;
        }
    }

    getEntries(): readonly AuditLogEntry[] {
        return this.entries;
    }

    clear(): void {
        this.entries = [];
    }
}
