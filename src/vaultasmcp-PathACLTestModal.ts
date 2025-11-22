import { type App, debounce, Modal, Setting } from "obsidian";
import type { CurrentSettings, Logger, PathACL } from "./@types/settings";
import { PathACLChecker } from "./vaultasmcp-PathACL";

interface TestResult {
    path: string;
    canRead: boolean;
    canWrite: boolean;
    reason: string;
}

// Silent logger for test modal
const testLogger: Logger = {
    debug: () => {},
    warn: () => {},
    error: () => "",
};

export class PathACLTestModal extends Modal {
    private acl: PathACL;
    private aclChecker: PathACLChecker;
    private resultsDiv?: HTMLElement;

    constructor(app: App, acl: PathACL) {
        super(app);
        this.acl = acl;

        // Wrap PathACL in CurrentSettings interface for test modal
        const currentSettings: CurrentSettings = {
            pathACL: () => acl,
            serverPort: () => 0,
            bearerToken: () => "",
        };

        this.aclChecker = new PathACLChecker(currentSettings, testLogger);
    }

    onOpen() {
        this.modalEl.addClass("vault-mcp-acl-test-modal");

        const { contentEl } = this;
        contentEl.empty();

        // Show current rules
        this.displayCurrentRules(contentEl);

        // Path tester
        this.createPathTester(contentEl);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    private displayCurrentRules(container: HTMLElement) {
        new Setting(container).setName("Current ACL rules").setHeading();

        const rulesDiv = container.createDiv("acl-current-rules");
        const rulesList = rulesDiv.createEl("ul");

        // Forbidden
        const forbiddenItem = rulesList.createEl("li");
        forbiddenItem.createEl("strong", { text: "Forbidden: " });
        forbiddenItem.createSpan({
            text:
                this.acl.forbidden.length > 0
                    ? JSON.stringify(this.acl.forbidden)
                    : "(none)",
        });

        // Read-only
        const readOnlyItem = rulesList.createEl("li");
        readOnlyItem.createEl("strong", { text: "Read-only: " });
        readOnlyItem.createSpan({
            text:
                this.acl.readOnly.length > 0
                    ? JSON.stringify(this.acl.readOnly)
                    : "(none)",
        });

        // Writable
        const writableItem = rulesList.createEl("li");
        writableItem.createEl("strong", { text: "Writable: " });
        writableItem.createSpan({
            text:
                this.acl.writable.length > 0
                    ? JSON.stringify(this.acl.writable)
                    : "(empty = all allowed)",
        });
    }

    private createPathTester(container: HTMLElement) {
        new Setting(container).setName("Test paths").setHeading();

        const section = container.createDiv("acl-path-test");

        new Setting(section)
            .setName("Path to test")
            .setDesc("Enter a vault path to test against ACL rules.")
            .addText((text) => {
                text.setPlaceholder("notes/example.md").onChange(
                    debounce(
                        (value: string) => {
                            this.testPaths(value);
                        },
                        200,
                        true,
                    ),
                );
            });

        this.resultsDiv = section.createDiv("acl-test-results");

        // Create table structure upfront
        const table = this.resultsDiv.createEl("table", {
            cls: "acl-results-table",
        });

        // Header
        const thead = table.createEl("thead");
        const headerRow = thead.createEl("tr");
        headerRow.createEl("th", { text: "Path" });
        headerRow.createEl("th", { text: "Read" });
        headerRow.createEl("th", { text: "Write" });
        headerRow.createEl("th", { text: "Status" });

        // Empty tbody (will be populated by displayResults)
        table.createEl("tbody");

        // Test root path initially
        this.testPaths("");
    }

    private testPaths(value: string) {
        const path = value.trim();

        // Empty path = test root
        const result = this.testPath(path || "");
        this.displayResults([result]);
    }

    private testPath(path: string): TestResult {
        let canRead = false;
        let canWrite = false;
        let reason = "";

        // Test read access
        try {
            this.aclChecker.checkReadAccess(path);
            canRead = true;
        } catch (error) {
            reason = error instanceof Error ? error.message : "Access denied";
        }

        // Test write access
        try {
            this.aclChecker.checkWriteAccess(path);
            canWrite = true;
        } catch (error) {
            if (!reason) {
                reason =
                    error instanceof Error ? error.message : "Access denied";
            }
        }

        // Determine reason if no errors
        if (canRead && canWrite) {
            reason = "Full access granted";
        } else if (canRead && !canWrite) {
            reason = "Read-only access";
        }

        return { path, canRead, canWrite, reason };
    }

    private displayResults(results: TestResult[]) {
        if (!this.resultsDiv) return;

        // Find existing tbody and clear it
        const tbody = this.resultsDiv.querySelector("tbody");
        if (!tbody) return;
        tbody.empty();
        for (const result of results) {
            const row = tbody.createEl("tr");

            // Path with icon
            const pathCell = row.createEl("td");
            const icon = this.getResultIcon(result);
            pathCell.createSpan({ text: `${icon} ${result.path}` });

            // Read permission
            const readCell = row.createEl("td", { cls: "acl-center" });
            readCell.createSpan({
                text: result.canRead ? "✓" : "✗",
                cls: result.canRead ? "acl-success" : "acl-forbidden",
            });

            // Write permission
            const writeCell = row.createEl("td", { cls: "acl-center" });
            writeCell.createSpan({
                text: result.canWrite ? "✓" : "✗",
                cls: result.canWrite ? "acl-success" : "acl-forbidden",
            });

            // Status
            const statusCell = row.createEl("td");
            statusCell.createSpan({
                text: result.reason,
                cls: this.getStatusClass(result),
            });
        }
    }

    private getResultIcon(result: TestResult): string {
        if (!result.canRead) return "❌";
        if (result.canRead && !result.canWrite) return "📖";
        return "✅";
    }

    private getStatusClass(result: TestResult): string {
        if (!result.canRead) return "acl-forbidden";
        if (result.canRead && !result.canWrite) return "acl-readonly";
        return "acl-success";
    }
}
