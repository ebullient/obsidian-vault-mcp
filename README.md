# Vault as MCP

![GitHub all releases](https://img.shields.io/github/downloads/ebullient/obsidian-vault-mcp/total?color=success)

An Obsidian plugin that runs an MCP (Model Context Protocol) server, enabling external LLM tools to access your vault. Supports HTTP transport natively (Open WebUI, remote LLMs) and stdio transport via included bridge script (Claude Desktop).

> **Important Notes**
>
> - **Network Use**: This plugin runs a local HTTP server on your machine. It does not connect to external services.
> - **Privacy**: No telemetry or data collection. All data stays on your machine.
> - **Desktop Only**: This plugin requires a desktop environment and will not work on mobile devices.

## Features

- **HTTP-based MCP server**: Runs a Fastify server implementing the MCP protocol
- **Status Bar Indicator**: Shows server status (stopped/running/error) with click-to-toggle functionality
- **Configurable Settings**: Adjust server port, auto-start behavior, and log level
- **CORS Support**: Enables access from remote machines via Tailscale or local network
- **MCP Tools**:
    - `read_note` - Read note content by path; optionally expand embedded content
    - `read_multiple_notes` - Read multiple notes in a single request
    - `search_notes` - Find notes by folder, tag(s), frontmatter, text, or recency
    - `get_linked_notes` - Get outgoing links from a note
    - `list_notes` - List notes and subfolders in a directory
    - `create_note` - Create notes from templates or with direct content
    - `append_to_note` - Append content to an existing note
    - `update_note` - Update an existing note by replacing its entire content
    - `delete_note` - Delete a note (moves to system trash)
    - `rename_note` - Rename or move a note, updating all vault links
    - `get_current_date` - Get the current date for date-based operations
    - `read_periodic_note` - Get path and content (if it exists) for periodic notes (daily/weekly/monthly/quarterly/yearly)
    - `list_templates` - List available templates and templating plugins

## Installation

### Manual Installation

1. Download the latest release from GitHub
2. Extract the files to your vault's `.obsidian/plugins/vault-as-mcp/` directory
3. Reload Obsidian
4. Enable "Vault as MCP" in Settings → Community Plugins

### Install with BRAT

Assuming you have the BRAT plugin installed and enabled:

1. Open BRAT plugin settings
2. Click 'Add beta plugin'
3. Use `https://github.com/ebullient/obsidian-vault-mcp` as the URL, select the latest version and install
4. Enable "Vault as MCP", either as part of installing via BRAT, or in Settings → Community Plugins

## Usage

### Starting the Server

The plugin provides three ways to control the server:

1. **Status Bar**: Click the status indicator in the bottom-right to toggle the server on/off
2. **Commands**: Use the command palette to:
   - Start MCP server
   - Stop MCP server
   - Restart MCP server
3. **Auto-start**: Enable in settings to automatically start the server when Obsidian loads

### Configuration

Open Settings → Vault as MCP:

- **Server Port**: Port number for the MCP server (default: 8765)
- **Bearer Token**: Optional authentication token for secure access
- **Auto-start Server**: Automatically start when Obsidian loads
- **Debug**: Enable debug messages

### Authentication

Bearer token authentication is optional but recommended for security, especially when accessing your vault over a network.

**To enable authentication:**

1. Open Settings → Vault as MCP
2. Click "Generate" to create a secure random token (or enter your own)
3. Copy the token for use in client configuration
4. Save settings and restart the server if it's running

**To disable authentication:**

1. Open Settings → Vault as MCP
2. Click "Clear" to remove the token
3. Save settings and restart the server if it's running

### Connecting from Open WebUI

In Open WebUI's MCP configuration, add a new server: `http://localhost:8765/mcp`

If Open WebUI is running on a remote machine (e.g., via Tailscale): `http://<your-machine-ip>:8765/mcp`

**With authentication enabled**, add the bearer token from your MCP server configuration in Open WebUI using the `Authorization` header:

```http
Authorization: Bearer <your-token-here>
```

### Connecting with Claude Code

```console
claude mcp add -t http -s local Obsidian http://localhost:8765/mcp -H "Authorization: Bearer <token>"
```

Notes:

- Make sure your port matches what you've configured in plugin settings
- Enable authentication and use the bearer token from plugin settings

### Claude Desktop

Claude Desktop uses stdio transport for MCP servers, so you'll need the
`mcp-bridge.js` script to bridge stdio to HTTP.

**Requirements:**

- Node.js 18+ (for native fetch support)
- "Vault as MCP" plugin enabled with the server running in Obsidian

**Setup a stdio bridge (alternative to http):**

1. Download `mcp-bridge.js` from the [latest GitHub
   release](https://github.com/ebullient/obsidian-vault-mcp/releases/latest)
   and save it somewhere accessible (e.g.,
   `~/.obsidian/scripts/mcp-bridge.js`)

2. Find your Claude Desktop config file:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - Linux: `~/.config/claude/claude_desktop_config.json`

3. Add the MCP server configuration:

   ```json
   {
     "mcpServers": {
       "obsidian-vault": {
         "command": "node",
         "args": ["/absolute/path/to/mcp-bridge.js"],
         "env": {
           "VAULT_MCP_URL": "http://localhost:8765/mcp"
         }
       }
     }
   }
   ```

   **With authentication enabled**, add the `VAULT_MCP_TOKEN` environment
   variable:

   ```json
   {
     "mcpServers": {
       "obsidian-vault": {
         "command": "node",
         "args": ["/absolute/path/to/mcp-bridge.js"],
         "env": {
           "VAULT_MCP_URL": "http://localhost:8765/mcp",
           "VAULT_MCP_TOKEN": "your-token-here"
         }
       }
     }
   }
   ```

4. **Important**: Replace `/absolute/path/to/mcp-bridge.js` with the actual
   path where you saved the bridge script

5. Restart Claude Desktop

**Testing:**

- The bridge logs to stderr, so you can see its activity in Claude Desktop's logs
- In Claude, you should see the vault's MCP tools available
- Try asking Claude to "read my note at path Daily Notes/today.md"

**Troubleshooting:**

- Verify the plugin server is running (check Obsidian status bar)
- Check the path to `mcp-bridge.js` is correct and absolute
- Ensure Node.js 18+ is installed: `node --version`
- Look for bridge errors in Claude Desktop's logs

## MCP Tools Reference

### read_note

Read note content by path. Returns raw markdown by default. Pass `includeEmbeds: true` only
when embedded content was explicitly requested — embed expansion is expensive.

**Parameters:**

- `path` (string, required): Path to the note (e.g., `"folder/note.md"`)
- `sections` (string[], optional): Return only these sections by heading text (case-insensitive, includes subheadings)
- `includeEmbeds` (boolean, optional): Expand `![[embed]]` blocks inline (up to 2 levels deep). Default: `false`
- `includeLinks` (boolean, optional): Also expand regular `[[links]]` inline. Only relevant when `includeEmbeds` is `true`. Default: `false`
- `excludePatterns` (string[], optional): Regex patterns to skip certain embeds. Only relevant when `includeEmbeds` is `true`

**Example (plain read):**

```json
{
  "name": "read_note",
  "arguments": {
    "path": "Daily Notes/2025-01-15.md"
  }
}
```

**Example (with embedded content expanded):**

```json
{
  "name": "read_note",
  "arguments": {
    "path": "Projects/overview.md",
    "includeEmbeds": true
  }
}
```

### search_notes

Find notes across the vault by folder, tag(s), frontmatter, modification time, or text content.
All parameters are optional and combine with AND logic, except `tags[]` which is OR within
the tag dimension. Use `list_notes` when folder structure (subfolder names) matters.

**Parameters:**

- `folder` (string, optional): Restrict to notes under this folder path (recursive)
- `tag` (string, optional): Single tag filter, combined with AND logic alongside other params
- `tags` (string[], optional): Return notes that have ANY of these tags (OR logic); cannot be combined with `tag`
- `text` (string, optional): Words must all appear (any order); quote phrases: `meeting "action items"`
- `mtime` (object, optional): Filter by modification time — `before` and/or `after`; each accepts an ISO date (`"2026-04-25"`) or relative days (`"7d"` = 7 days ago)
- `frontmatter` (object, optional): Filter by frontmatter key/value, e.g. `{"type": "quest"}`
- `sort` (string, optional): `"alpha"` (default) or `"recent"` (newest modified first)
- `limit` (number, optional): Max results; only applied when `sort` is `"recent"` (default: 20, max: 50)

**Example (tag + folder AND filter):**

```json
{
  "name": "search_notes",
  "arguments": {
    "tag": "project",
    "folder": "quests"
  }
}
```

**Example (OR across multiple tags):**

```json
{
  "name": "search_notes",
  "arguments": {
    "tags": ["tech/ai", "tech/mcp"]
  }
}
```

**Example (recently modified):**

```json
{
  "name": "search_notes",
  "arguments": {
    "folder": "chronicles",
    "sort": "recent",
    "limit": 10
  }
}
```

### get_linked_notes

Get all notes linked from a specific note (outgoing links).

**Parameters:**

- `path` (string, required): Path to the note

**Example:**

```json
{
  "name": "get_linked_notes",
  "arguments": {
    "path": "Projects/Main.md"
  }
}
```

### create_note

Create a new note or binary file. Can create from a template or with direct content. Automatically creates parent folders if needed.

**Parameters:**

- `path` (string, required): Path for the new file (e.g., `"folder/note.md"` or `"assets/diagram.png"`). The `.md` extension is added automatically for text notes.
- `content` (string, optional): The file content. For text notes, this is markdown. For binary files, this must be base64-encoded data. Not required if `template` is specified.
- `template` (string, optional): Path to a template file (e.g., `"templates/daily.md"`). Requires Core Templates or Templater plugin. If specified, `content` is ignored.
- `binary` (boolean, optional): Set to `true` for binary files (images, PDFs). Default: `false`.

**Example (text note):**

```json
{
  "name": "create_note",
  "arguments": {
    "path": "Projects/new-idea.md",
    "content": "# New Idea\n\nThis is my new note content."
  }
}
```

**Example (binary file):**

```json
{
  "name": "create_note",
  "arguments": {
    "path": "assets/diagram.png",
    "content": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "binary": true
  }
}
```

**Example (from template):**

```json
{
  "name": "create_note",
  "arguments": {
    "path": "Daily Notes/2025-01-19.md",
    "template": "templates/daily.md"
  }
}
```

**Notes:**

- Fails with an error if the file already exists
- Parent folders are created automatically
- Returns the created file's path
- Binary files support: PNG, JPG, PDF, and other formats via base64 encoding
- Template support requires Templater or Core Templates plugin
- Templater provides full template processing (dates, prompts, dynamic content)
- Core Templates processes basic date variables and template content

### append_to_note

Append content to an existing note. Can append to the end of the file or after a specific heading.

**Parameters:**

- `path` (string, required): Path to the note (e.g., `"folder/note.md"`)
- `content` (string, required): The content to append
- `heading` (string, optional): Heading to append after (e.g., `"## Tasks"`). If not specified, appends to end of file.
- `separator` (string, optional): Separator between existing and new content. Default: `"\n"` (single newline)

**Example (append to end of file):**

```json
{
  "name": "append_to_note",
  "arguments": {
    "path": "Daily Notes/2025-01-18.md",
    "content": "## Meeting Notes\n\n- Discussed project timeline"
  }
}
```

**Example (append after heading):**

```json
{
  "name": "append_to_note",
  "arguments": {
    "path": "Projects/roadmap.md",
    "content": "- [ ] Implement new feature",
    "heading": "## Q1 Tasks"
  }
}
```

**Example with custom separator:**

```json
{
  "name": "append_to_note",
  "arguments": {
    "path": "Projects/tasks.md",
    "content": "- [ ] New task",
    "separator": "\n\n"
  }
}
```

**Notes:**

- Fails with an error if the note does not exist
- Fails with an error if the specified heading is not found
- Heading must match exactly (including `##` markers)
- Content is appended at the end of the heading's section
- Use `create_note` first if the note might not exist
- Returns the note's path

### update_note

Update an existing note by replacing its entire content. This is useful when you need to make extensive changes to a note.

**Parameters:**

- `path` (string, required): Path to the note (e.g., `"folder/note.md"`)
- `content` (string, required): The new content that will replace the entire file

**Example:**

```json
{
  "name": "update_note",
  "arguments": {
    "path": "Projects/roadmap.md",
    "content": "# Updated Roadmap\n\n## Q1 2025\n\n- [x] Feature A\n- [ ] Feature B"
  }
}
```

**Notes:**

- Fails with an error if the note does not exist
- Replaces the entire file content (not a partial update)
- Typical workflow: use `read_note` first, modify content, then `update_note`
- Returns the note's path

### delete_note

Delete a note by moving it to the system trash. This is safer than permanent deletion as files can be recovered.

**Parameters:**

- `path` (string, required): Path to the note to delete (e.g., `"folder/note.md"`)

**Example:**

```json
{
  "name": "delete_note",
  "arguments": {
    "path": "Archive/old-note.md"
  }
}
```

**Notes:**

- Fails with an error if the note does not exist
- File is moved to system trash (not permanently deleted)
- File can be recovered from trash if deleted by mistake
- Returns the path of the deleted note

### read_periodic_note

Get the file path for a periodic note based on configured settings, and return its content if the file exists. Supports daily, weekly, monthly, quarterly, and yearly notes. Checks for the Periodic Notes plugin first, then falls back to the core Daily Notes plugin for daily notes.

**Parameters:**

- `period` (string, required): The period type - one of: `"daily"`, `"weekly"`, `"monthly"`, `"quarterly"`, `"yearly"`
- `date` (string, optional): Date in ISO format (e.g., `"2025-01-18"`). Defaults to current date.

**Returns:** `path` always; `content` only if the note file exists.

**Example (daily note):**

```json
{
  "name": "read_periodic_note",
  "arguments": {
    "period": "daily",
    "date": "2025-01-18"
  }
}
```

**Example (weekly note for current week):**

```json
{
  "name": "read_periodic_note",
  "arguments": {
    "period": "weekly"
  }
}
```

**Example (monthly note):**

```json
{
  "name": "read_periodic_note",
  "arguments": {
    "period": "monthly",
    "date": "2025-01-01"
  }
}
```

**Notes:**

- For non-daily periods (weekly, monthly, quarterly, yearly), requires the Periodic Notes community plugin to be installed and configured
- For daily notes, falls back to core Daily Notes plugin if Periodic Notes is not available
- Returns path based on user's configured format and folder settings in their plugin
- Fails if the required plugin is not installed or the period type is not enabled
- Path format depends on user's settings (e.g., `"Daily Notes/2025-01-18.md"` or `"Weekly/2025-W03.md"`)
- If the note file does not yet exist, only `path` is returned (no `content` field)

### list_templates

List available note templates and which templating plugins are enabled. Useful for discovering what templates exist before creating notes.

**Parameters:**

None

**Example:**

```json
{
  "name": "list_templates",
  "arguments": {}
}
```

**Returns:**

```json
{
  "templates_folder": "templates",
  "templates": [
    "templates/daily.md",
    "templates/meeting.md",
    "templates/project.md"
  ],
  "core_templates_enabled": true,
  "templater_enabled": true
}
```

**Notes:**

- Returns the configured templates folder path
- Lists all `.md` files in the templates folder (recursively)
- Indicates which template plugins are enabled (Core Templates, Templater)
- Templates folder location comes from plugin settings
- If neither plugin is enabled, `templates` array will still list files in the default templates folder

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, build commands, and architecture details. AI assistants should also review [CLAUDE.md](CLAUDE.md) for working guidelines.

## License

MIT

## Author

[ebullient](https://github.com/ebullient)
