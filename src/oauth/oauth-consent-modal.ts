import { type App, Modal, Notice, Setting } from "obsidian";

export interface OAuthConsentPrompt {
    sessionId: string;
    clientName: string;
    clientId: string;
    redirectUri: string;
    scope: string;
    pin: string;
    approve: () => void;
    deny: () => void;
}

export class OAuthConsentModal extends Modal {
    constructor(
        app: App,
        private readonly prompt: OAuthConsentPrompt,
    ) {
        super(app);
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

        new Setting(contentEl).setName("Scope").setDesc(this.prompt.scope);

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
                        this.prompt.approve();
                        new Notice(
                            `Approved OAuth access for "${this.prompt.clientName}".`,
                        );
                        this.close();
                    }),
            );
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
