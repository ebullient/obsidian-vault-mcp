import { type App, Modal, Setting } from "obsidian";
import type { AuditLogStore } from "./vaultasmcp-AuditLog";

export class AuditLogModal extends Modal {
    constructor(
        app: App,
        private readonly auditLog: AuditLogStore,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        new Setting(contentEl)
            .setName("MCP audit log")
            .setDesc("Recent MCP requests processed by this vault.")
            .setHeading()
            .addButton((button) =>
                button.setButtonText("Clear").onClick(() => {
                    this.auditLog.clear();
                    this.onOpen();
                }),
            );

        const entries = this.auditLog.getEntries();
        if (entries.length === 0) {
            contentEl.createEl("p", {
                text: "No MCP requests recorded yet.",
                cls: "acl-no-results",
            });
            return;
        }

        const table = contentEl.createEl("table", {
            cls: "acl-results-table",
        });
        const thead = table.createEl("thead");
        const headerRow = thead.createEl("tr");
        headerRow.createEl("th", { text: "Time" });
        headerRow.createEl("th", { text: "Auth" });
        headerRow.createEl("th", { text: "Action" });
        headerRow.createEl("th", { text: "Target" });
        headerRow.createEl("th", { text: "Status" });

        const tbody = table.createEl("tbody");
        for (const item of entries) {
            const row = tbody.createEl("tr");
            row.createEl("td", { text: item.timestamp.slice(11, 19) });
            row.createEl("td", {
                text: item.clientId
                    ? `${item.authType} (${item.clientId.slice(0, 12)})`
                    : item.authType,
            });
            row.createEl("td", { text: item.method });
            row.createEl("td", { text: item.target ?? "-" });
            row.createEl("td", {
                text: item.status === "success" ? "✓" : "✗",
                cls:
                    item.status === "success" ? "acl-success" : "acl-forbidden",
            });
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
