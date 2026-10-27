import { type App, Modal, Notice, Setting } from "obsidian";
import {
    DEFAULT_OAUTH_SCOPE,
    READ_ONLY_OAUTH_SCOPE,
} from "./oauth-token-store";

export interface OAuthConsentPrompt {
    sessionId: string;
    clientName: string;
    clientId: string;
    redirectUri: string;
    scope: string;
    pin: string;
    approve: (grantedScope?: string) => void;
    deny: () => void;
}

export class OAuthConsentModal extends Modal {
    private selectedScope: string;

    constructor(
        app: App,
        private readonly prompt: OAuthConsentPrompt,
    ) {
        super(app);
        const requestedTokens = prompt.scope.split(/\s+/).filter(Boolean);
        this.selectedScope =
            requestedTokens.includes(READ_ONLY_OAUTH_SCOPE) &&
            !requestedTokens.includes(DEFAULT_OAUTH_SCOPE)
                ? READ_ONLY_OAUTH_SCOPE
                : DEFAULT_OAUTH_SCOPE;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        new Setting(contentEl)
            .setName("Authorize MCP client access")
            .setHeading();

        contentEl.createEl("p", {
            text: `"${this.prompt.clientName}" is requesting OAuth 2.1 access to your Obsidian vault.`,
        });

        new Setting(contentEl)
            .setName("Redirect URI")
            .setDesc(this.prompt.redirectUri);

        new Setting(contentEl)
            .setName("Access level (Scope)")
            .setDesc(
                "Choose whether this client gets full read/write access (subject to Path ACL) or strictly read-only access.",
            )
            .addDropdown((dropdown) =>
                dropdown
                    .addOption(
                        DEFAULT_OAUTH_SCOPE,
                        `Full access (Read & Write — ${DEFAULT_OAUTH_SCOPE})`,
                    )
                    .addOption(
                        READ_ONLY_OAUTH_SCOPE,
                        `Read-only (Read & Search only — ${READ_ONLY_OAUTH_SCOPE})`,
                    )
                    .setValue(this.selectedScope)
                    .onChange((value) => {
                        this.selectedScope = value;
                    }),
            );

        new Setting(contentEl)
            .setName("One-time approval PIN (8 digits)")
            .setDesc(
                `Click Approve below to authorize immediately, or enter PIN ${this.prompt.pin} on the authorization web page.`,
            );

        new Setting(contentEl)
            .addButton((button) =>
                button.setButtonText("Deny").onClick(() => {
                    this.prompt.deny();
                    new Notice(
                        `Denied OAuth access for "${this.prompt.clientName}".`,
                    );
                    this.close();
                }),
            )
            .addButton((button) =>
                button
                    .setButtonText("Approve")
                    .setCta()
                    .onClick(() => {
                        this.prompt.approve(this.selectedScope);
                        new Notice(
                            `Approved OAuth access (${this.selectedScope}) for "${this.prompt.clientName}".`,
                        );
                        this.close();
                    }),
            );
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
