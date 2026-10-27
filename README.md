# Vault as MCP

![GitHub all releases](https://img.shields.io/github/downloads/ebullient/obsidian-vault-mcp/total?color=success)

This Obsidian plugin runs an MCP (Model Context Protocol) server directly inside Obsidian, letting external LLM tools access your vault. Supports HTTP transport natively (Open WebUI, remote LLMs). An optional [`bridge` script](#claude-desktop) provides a bridge from HTTP to stdio (Claude Desktop).

> **Important Notes**
>
> - **Network Use**: This plugin runs a local HTTP server on your machine to accept inbound MCP connections. It does not send your vault data to external LLM services by itself.
> - **Privacy**: This plugin lets you control vault access through Obsidian APIs and path ACLs instead of giving external tools direct filesystem access.
> - **Desktop Only**: This plugin requires a desktop environment and will not work on mobile devices.

## Features

- **HTTP-based MCP server**: Runs a Fastify server implementing the MCP protocol
- **Status Bar Indicator**: Shows server status (stopped/running/error) with click-to-toggle functionality
- **Configurable Settings**: Adjust server port, auto-start behavior, logging, and path ACLs to control access to areas of your vault
- **CORS Support**: Enables access from remote machines via Tailscale or local network
- **MCP Tools**: Read, search, list, create, edit, rename, and delete notes; templates and periodic notes — see [MCP Tools Reference](#mcp-tools-reference)

## Installation

### Community Plugins

1. Open Settings → Community Plugins
2. Click "Browse" and search for "Vault as MCP"
3. Install and enable the plugin

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
- **Bearer Token**: Optional static authentication token for secure access (also usable to approve OAuth 2.1 requests)
- **Enable OAuth 2.1**: Enable OAuth 2.1 discovery, dynamic client registration, and PKCE authorization code flow alongside Bearer token authentication
- **OAuth Public Base URL**: Optional public HTTPS URL (e.g., `https://mcp.example.com` or a subpath proxy URL) when exposing the server via reverse proxy or tunnel
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

### OAuth 2.1 Authentication

In addition to static Bearer tokens, the server supports **OAuth 2.1 (Authorization Code + PKCE `S256`)** and can run both authentication methods simultaneously:

- Requests with a valid static **Bearer Token** are accepted immediately.
- Requests with a valid **OAuth 2.1 Access Token** are accepted.
- Unauthenticated requests receive `401 Unauthorized` with a `WWW-Authenticate` header pointing to the Protected Resource Metadata endpoint so OAuth-capable MCP clients can discover and initiate the authorization flow automatically.

#### Supported OAuth 2.1 Endpoints

| Endpoint | Method | Description |
| --- | --- | --- |
| `/.well-known/oauth-protected-resource` | `GET` | OAuth 2.0 Protected Resource Metadata (RFC 9728), advertising scope `vault.access` |
| `/.well-known/oauth-authorization-server` | `GET` | OAuth 2.0 Authorization Server Metadata (RFC 8414), advertising `S256` PKCE support |
| `/register` | `POST` | Dynamic Client Registration (RFC 7591) issuing stateless HMAC-signed `client_id` values; custom connectors may also specify a static non-`mcp_` `client_id` directly |
| `/authorize` | `GET`, `POST` | Renders the user consent page and issues single-use authorization codes upon approval |
| `/authorize/status` | `GET` | Short-polling endpoint for the consent page to detect in-app Obsidian modal approval |
| `/token` | `POST` | Exchanges authorization codes (with PKCE `code_verifier`) or rotates single-use `refresh_token` grants |

#### Approving Authorization Requests

When an MCP client initiates `GET /authorize`:

1. **In-App Obsidian Modal (Recommended)**: Obsidian displays a confirmation modal and notice showing the requesting client name, redirect URI, scope (`vault.access`), and an 8-digit one-time PIN. Clicking **Approve** in Obsidian immediately authorizes the session and redirects the browser. Keep Obsidian running while completing authorization.
2. **Browser Consent Form**: Alternatively, enter either the configured static **Bearer Token** or the **8-digit one-time PIN** shown in Obsidian directly into the web consent page and click **Approve** (after 3 failed PIN attempts, PIN entry is locked for that session and approval must be completed via the Obsidian modal or static Bearer Token).

#### Reverse Proxy & Subpath Routing

- When exposing the server behind a reverse proxy or tunnel, set **OAuth public base URL** in settings (for example, `https://mcp.example.com` or `https://proxy.example.com/mcp/custom-prefix`).
- To prevent Host Header Injection, OAuth metadata and `WWW-Authenticate` headers never trust `X-Forwarded-Host`; they always use the configured **OAuth public base URL** (or fall back to `localhost:<port>`).
- Subpath-prefixed requests (such as `/mcp/.well-known/*`, `/mcp/authorize`, `/mcp/token`, `/mcp/register`, or paths under the configured public URL prefix) are automatically normalized.

#### Credential Persistence

- OAuth HMAC signing keys are generated automatically and stored in Obsidian SecretStorage (`vault-as-mcp-oauth-signing-secret`), allowing issued tokens and registered `client_id` values to remain valid across restarts. If SecretStorage is unavailable, an in-memory signing key is used and OAuth credentials reset when the server restarts.

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
   `~/.obsidian/scripts/mcp-bridge.js`). Source is in the [`bridge` branch](https://github.com/ebullient/obsidian-vault-mcp/tree/bridge/src/mcp-bridge.ts).

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

Tool names, parameters, and behavior are defined in
[`src/vaultasmcp-Tools.ts`](src/vaultasmcp-Tools.ts) and served live via the
MCP `tools/list` endpoint — that's the source of truth for exact parameter
names, types, and descriptions. The summary below is for orientation only.

- `read_note` / `read_multiple_notes` — Read note content by path;
  `metadataOnly` returns structure and size without content
- `search_notes` — Find notes by folder, heading, tag, frontmatter,
  modification time, or text content; returns paths only
- `list_notes` — List notes and subfolders in a directory
- `create_note` — Create a note or binary file, optionally from a template
- `append_to_note` / `update_note` / `patch_note` — Add or edit note
  content; `patch_note` replaces an exact string for surgical edits
- `delete_note` / `rename_note` — Delete or move/rename a note
  (`rename_note` rewrites links that point to it)
- `read_periodic_note` — Get or create a daily/weekly/monthly/etc. note
- `list_templates` — List available Templater templates

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, build commands, and architecture details. AI assistants should also review [CLAUDE.md](CLAUDE.md) for working guidelines.

## License

MIT

## Author

[ebullient](https://github.com/ebullient)
