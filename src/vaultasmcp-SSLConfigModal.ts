import { type App, Modal, Notice, Setting } from "obsidian";

export interface SSLConfigDraft {
    tlsEnabled: boolean;
    tlsCertificatePem?: string;
    tlsPrivateKeyPem?: string;
    clearStoredPrivateKey: boolean;
}

export class SSLConfigModal extends Modal {
    private tlsEnabled: boolean;
    private tlsCertificatePem: string;
    private tlsPrivateKeyPem = "";
    private clearStoredPrivateKey = false;

    constructor(
        app: App,
        private readonly initial: {
            tlsEnabled: boolean;
            tlsCertificatePem?: string;
            hasStoredPrivateKey: boolean;
        },
        private readonly onApply: (draft: SSLConfigDraft) => Promise<void>,
    ) {
        super(app);
        this.tlsEnabled = initial.tlsEnabled;
        this.tlsCertificatePem = initial.tlsCertificatePem ?? "";
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        new Setting(contentEl).setName("SSL configuration").setHeading();

        new Setting(contentEl)
            .setName("Enable SSL / HTTPS")
            .setDesc(
                "Recommended if the MCP server is exposed beyond localhost.",
            )
            .addToggle((toggle) =>
                toggle.setValue(this.tlsEnabled).onChange((value) => {
                    this.tlsEnabled = value;
                }),
            );

        new Setting(contentEl)
            .setName("Certificate PEM")
            .setDesc("Paste the PEM-encoded SSL certificate.")
            .addTextArea((text) => {
                text.setPlaceholder("-----BEGIN CERTIFICATE-----")
                    .setValue(this.tlsCertificatePem)
                    .onChange((value) => {
                        this.tlsCertificatePem = value;
                    });
                text.inputEl.rows = 8;
                text.inputEl.cols = 50;
            });

        new Setting(contentEl)
            .setName("Private key PEM")
            .setDesc(
                this.initial.hasStoredPrivateKey
                    ? "Leave blank to keep the currently stored private key, paste a new PEM to replace it, or choose to clear it."
                    : "Paste the PEM-encoded private key to store it in Obsidian secret storage.",
            )
            .addTextArea((text) => {
                text.setPlaceholder("-----BEGIN PRIVATE KEY-----").onChange(
                    (value) => {
                        this.tlsPrivateKeyPem = value;
                    },
                );
                text.inputEl.rows = 8;
                text.inputEl.cols = 50;
            });

        if (this.initial.hasStoredPrivateKey) {
            new Setting(contentEl)
                .setName("Clear stored private key")
                .setDesc(
                    "Remove the private key currently stored in Obsidian secret storage.",
                )
                .addToggle((toggle) =>
                    toggle
                        .setValue(this.clearStoredPrivateKey)
                        .onChange((value) => {
                            this.clearStoredPrivateKey = value;
                        }),
                );
        }

        new Setting(contentEl)
            .addButton((button) =>
                button.setButtonText("Cancel").onClick(() => this.close()),
            )
            .addButton((button) =>
                button
                    .setButtonText("Apply")
                    .setCta()
                    .onClick(async () => {
                        if (
                            this.clearStoredPrivateKey &&
                            this.tlsPrivateKeyPem.trim()
                        ) {
                            new Notice(
                                "Clear the stored private key or paste a replacement, not both.",
                            );
                            return;
                        }

                        try {
                            await this.onApply({
                                tlsEnabled: this.tlsEnabled,
                                tlsCertificatePem:
                                    this.tlsCertificatePem.trim() || undefined,
                                tlsPrivateKeyPem:
                                    this.tlsPrivateKeyPem.trim() || undefined,
                                clearStoredPrivateKey:
                                    this.clearStoredPrivateKey,
                            });
                            this.close();
                        } catch (error) {
                            const message =
                                error instanceof Error
                                    ? error.message
                                    : String(error);
                            new Notice(message);
                        }
                    }),
            );
    }

    onClose() {
        this.contentEl.empty();
    }
}
