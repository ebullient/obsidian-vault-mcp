# Vault as MCP

An Obsidian plugin that exposes your vault as an MCP (Model Context Protocol) server via HTTP, enabling external LLM tools like Open WebUI to interact with your notes.

## Features

- **HTTP-based MCP Server**: Runs a Fastify server implementing the MCP protocol
- **Status Bar Indicator**: Shows server status (stopped/running/error) with click-to-toggle functionality
- **Configurable Settings**: Adjust server port, auto-start behavior, and log level
- **CORS Support**: Enables access from remote machines via Tailscale or local network
- **Five MCP Tools**:
  - `read_note` - Read the full content of a note by path
  - `search_notes` - Search notes by tag, folder, or text content
  - `get_linked_notes` - Get all notes linked from a specific note
  - `list_incomplete_tasks` - Find incomplete tasks in a note or folder
  - `list_notes_by_tag` - Get all notes with specific tag(s)

## Installation

### Manual Installation

1. Download the latest release from GitHub
2. Extract the files to your vault's `.obsidian/plugins/vault-as-mcp/` directory
3. Reload Obsidian
4. Enable "Vault as MCP" in Settings → Community Plugins

### Development

```bash
npm install
npm run dev
```

Set `OUTDIR` environment variable to your test vault's plugin directory:

```bash
export OUTDIR="/path/to/vault/.obsidian/plugins/vault-as-mcp"
npm run dev
```

## Usage

### Starting the Server

The plugin provides three ways to control the server:

1. **Status Bar**: Click the status indicator in the bottom-right to toggle the server on/off
2. **Commands**: Use the command palette to:
   - Start MCP Server
   - Stop MCP Server
   - Restart MCP Server
3. **Auto-start**: Enable in settings to automatically start the server when Obsidian loads

### Configuration

Open Settings → Vault as MCP:

- **Server Port**: Port number for the MCP server (default: 8765)
- **Auto-start Server**: Automatically start when Obsidian loads
- **Log Level**: Set logging verbosity (debug, info, warn, error)

### Connecting from Open WebUI

In Open WebUI's MCP configuration, add a new server:

```
URL: http://localhost:8765/mcp
```

If Open WebUI is running on a remote machine (e.g., via Tailscale):

```
URL: http://<your-machine-ip>:8765/mcp
```

### Connecting from Claude Desktop

Claude Desktop uses stdio transport for MCP servers, so you'll need the included `mcp-bridge.js` to bridge stdio to HTTP.

**Requirements:**
- Node.js 18+ (for native fetch support)
- VaultAsMCP plugin running in Obsidian

**Setup:**

1. Locate the bridge script in your plugin directory:
   ```
   ~/.obsidian/plugins/vault-as-mcp/mcp-bridge.js
   ```
   (Or wherever you installed the plugin)

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
         "args": ["/absolute/path/to/.obsidian/plugins/vault-as-mcp/mcp-bridge.js"],
         "env": {
           "VAULT_MCP_URL": "http://localhost:8765/mcp"
         }
       }
     }
   }
   ```

4. **Important**: Replace `/absolute/path/to/` with the actual path to your vault

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

Read the full content of a note by its path.

**Parameters:**
- `path` (string, required): Path to the note (e.g., `"folder/note.md"`)

**Example:**
```json
{
  "name": "read_note",
  "arguments": {
    "path": "Daily Notes/2025-01-15.md"
  }
}
```

### search_notes

Search for notes by tag, folder path, or text content.

**Parameters:**
- `tag` (string, optional): Tag to search for without # (e.g., `"daily"`)
- `folder` (string, optional): Folder path to search within
- `text` (string, optional): Text to search for in note content

**Example:**
```json
{
  "name": "search_notes",
  "arguments": {
    "tag": "project",
    "folder": "Work"
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

### list_incomplete_tasks

Find all incomplete tasks (unchecked checkboxes) in a note or folder.

**Parameters:**
- `path` (string, required): Path to a note or folder

**Example:**
```json
{
  "name": "list_incomplete_tasks",
  "arguments": {
    "path": "Projects"
  }
}
```

### list_notes_by_tag

Get all notes that have specific tag(s).

**Parameters:**
- `tags` (string[], required): Array of tags to search for without #

**Example:**
```json
{
  "name": "list_notes_by_tag",
  "arguments": {
    "tags": ["todo", "urgent"]
  }
}
```

## Development

See [CLAUDE.md](CLAUDE.md) for development guidelines and architecture details.

## License

MIT

## Author

[ebullient](https://github.com/ebullient)
