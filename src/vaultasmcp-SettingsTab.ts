import { type App, PluginSettingTab, Setting } from "obsidian";
import type { VaultAsMCPPlugin } from "./vaultasmcp-Plugin";

export class VaultAsMCPSettingsTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: VaultAsMCPPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Vault as MCP Settings" });

		// Server Port
		new Setting(containerEl)
			.setName("Server Port")
			.setDesc("Port number for the MCP server (requires restart)")
			.addText((text) =>
				text
					.setPlaceholder("8765")
					.setValue(String(this.plugin.settings.serverPort))
					.onChange(async (value) => {
						const port = Number.parseInt(value, 10);
						if (!Number.isNaN(port) && port > 0 && port < 65536) {
							this.plugin.settings.serverPort = port;
							await this.plugin.saveSettings();
						}
					}),
			);

		// Auto-start
		new Setting(containerEl)
			.setName("Auto-start Server")
			.setDesc("Automatically start the MCP server when Obsidian loads")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoStart)
					.onChange(async (value) => {
						this.plugin.settings.autoStart = value;
						await this.plugin.saveSettings();
					}),
			);

		// Log Level
		new Setting(containerEl)
			.setName("Log Level")
			.setDesc("Logging verbosity (requires server restart)")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("debug", "Debug")
					.addOption("info", "Info")
					.addOption("warn", "Warn")
					.addOption("error", "Error")
					.setValue(this.plugin.settings.logLevel)
					.onChange(async (value) => {
						this.plugin.settings.logLevel = value as
							| "debug"
							| "info"
							| "warn"
							| "error";
						await this.plugin.saveSettings();
					}),
			);

		// Server Status Display
		containerEl.createEl("h3", { text: "Server Status" });

		const statusContainer = containerEl.createDiv("vault-mcp-status-info");

		const updateStatusDisplay = () => {
			statusContainer.empty();

			const status = this.plugin.getServerStatus();
			const statusText = statusContainer.createEl("p");

			switch (status) {
				case "running":
					statusText.setText(
						`✓ Server is running on port ${this.plugin.settings.serverPort}`,
					);
					statusText.style.color = "var(--text-success)";
					break;
				case "error":
					statusText.setText("✕ Server encountered an error");
					statusText.style.color = "var(--text-error)";
					break;
				case "stopped":
					statusText.setText("○ Server is stopped");
					statusText.style.color = "var(--text-muted)";
					break;
			}

			// Add connection info for Open WebUI
			if (status === "running") {
				const infoDiv = statusContainer.createDiv();
				infoDiv.createEl("p", {
					text: "Connection URL for Open WebUI:",
				});
				const codeEl = infoDiv.createEl("code");
				codeEl.setText(
					`http://localhost:${this.plugin.settings.serverPort}/mcp`,
				);
				codeEl.style.display = "block";
				codeEl.style.padding = "8px";
				codeEl.style.marginTop = "4px";
				codeEl.style.backgroundColor = "var(--background-secondary)";
			}
		};

		updateStatusDisplay();

		// Control Buttons
		const buttonContainer = containerEl.createDiv();
		buttonContainer.style.marginTop = "16px";
		buttonContainer.style.display = "flex";
		buttonContainer.style.gap = "8px";

		new Setting(buttonContainer)
			.addButton((button) =>
				button.setButtonText("Start Server").onClick(async () => {
					await this.plugin.startServer();
					updateStatusDisplay();
				}),
			)
			.addButton((button) =>
				button.setButtonText("Stop Server").onClick(async () => {
					await this.plugin.stopServer();
					updateStatusDisplay();
				}),
			)
			.addButton((button) =>
				button.setButtonText("Restart Server").onClick(async () => {
					await this.plugin.restartServer();
					updateStatusDisplay();
				}),
			);

		// Documentation
		containerEl.createEl("h3", { text: "Available MCP Tools" });

		const toolsList = containerEl.createEl("ul");
		const tools = [
			{
				name: "read_note",
				desc: "Read the full content of a note by path",
			},
			{
				name: "search_notes",
				desc: "Search notes by tag, folder, or text content",
			},
			{
				name: "get_linked_notes",
				desc: "Get all notes linked from a specific note",
			},
			{
				name: "list_incomplete_tasks",
				desc: "Find incomplete tasks in a note or folder",
			},
			{
				name: "list_notes_by_tag",
				desc: "Get all notes with specific tag(s)",
			},
		];

		for (const tool of tools) {
			const li = toolsList.createEl("li");
			li.createEl("strong", { text: tool.name });
			li.appendText(`: ${tool.desc}`);
		}
	}
}
