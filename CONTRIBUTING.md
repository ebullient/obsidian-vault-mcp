# Contributing to Vault as MCP

This Obsidian plugin exposes your vault as an MCP (Model Context Protocol)
server via HTTP, enabling external LLM tools like Open WebUI and Claude
Desktop to interact with your notes.

## Project Structure

This is a TypeScript Obsidian plugin with the following core files:

- **vaultasmcp-Plugin.ts**: Main plugin class
- **vaultasmcp-Server.ts**: Fastify HTTP server implementation
- **vaultasmcp-MCPHandler.ts**: MCP protocol request/response handling
- **vaultasmcp-Tools.ts**: MCP tool implementations
- **vaultasmcp-SettingsTab.ts**: Settings UI
- **vaultasmcp-Constants.ts**: Default settings and configuration

## Build Commands

```bash
# Install dependencies
npm install

# Build the plugin (includes linting via prebuild)
npm run build

# Build and watch for changes
npm run dev

# Lint TypeScript files
npm run lint

# Auto-fix linting issues
npm run fix

# Format code
npm run format
```

## Local Development

### Development Setup

Set the `OUTDIR` environment variable to your test vault's plugin directory
for automatic deployment during development:

```bash
export OUTDIR="/path/to/vault/.obsidian/plugins/vault-as-mcp"
npm run dev
```

Changes will be automatically built and copied to your vault. Reload the
plugin in Obsidian to test.

### Testing with Claude Desktop

When developing locally, the build process creates `mcp-bridge.js` in the
`build/` directory. You can point your Claude Desktop configuration directly
to this file for testing:

```json
{
  "mcpServers": {
    "obsidian-vault-dev": {
      "command": "node",
      "args": ["/absolute/path/to/obsidian-vault-mcp/build/mcp-bridge.js"],
      "env": {
        "VAULT_MCP_URL": "http://localhost:8765/mcp"
      }
    }
  }
}
```

This allows you to test changes to the bridge script without needing to
download from releases.

## Code Standards

- **TypeScript**: Strict mode enabled
- **Line length**: 80 characters (hard limit)
- **Always use braces** for conditionals
- **Method chaining**: Break at dots for readability, even for single chains.
  This keeps lines under 80 chars and prevents Biome from wrapping
  unpredictably.

  ```typescript
  // GOOD - break at dots
  const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder))
      .map((f) => f.path);

  // BAD - all on one line
  const files = this.app.vault.getMarkdownFiles().filter((f) =>
      f.path.startsWith(folder));

  // GOOD - even single chains if they approach 80 chars
  const content = await this.app.vault.cachedRead(file);
  ```

- **Error handling**: Use `try/catch` with user-friendly `Notice` messages
- **Async**: Use `async/await` consistently
- **Naming**: Follow the `vaultasmcp-` prefix pattern for all source files

## Development Patterns

When implementing new features:

1. **Find similar existing functions** in the same module you're modifying
   (use `Grep` to search)
2. **Follow established patterns** already in use rather than creating new
   approaches
3. **Emulate the style exactly**, especially for method chains and
   async/await
4. **Check error handling patterns** and maintain consistency

## Architecture Overview

### HTTP-based MCP server

The plugin runs a Fastify HTTP server that implements the Model Context
Protocol (MCP) over HTTP. This allows any MCP client (like Claude Desktop
via the bridge, or Open WebUI) to interact with your vault.

**Key architectural decisions:**

- **HTTP transport**: Unlike most MCP servers that use stdio, this uses HTTP
  for broader client compatibility
- **CORS enabled**: Supports remote access via Tailscale or local network
- **Obsidian integration**: Runs within Obsidian's plugin sandbox, direct
  vault API access
- **Status bar control**: Visual indicator with click-to-toggle for easy
  server management

### MCP Protocol Implementation

The plugin implements MCP 2024-11-05 protocol with these capabilities:

- **initialize**: Handshake and capability negotiation
- **tools/list**: Expose available vault interaction tools
- **tools/call**: Execute tools with JSON-RPC error handling
- **ping**: Health check endpoint

### Available MCP Tools

1. **read_note**: Read full content of a note by path
2. **search_notes**: Search by tag, folder, or text content
3. **get_linked_notes**: Get outgoing links from a note
4. **list_incomplete_tasks**: Find unchecked tasks in note/folder
5. **list_notes_by_tag**: Get notes with specific tags

### Bridge for stdio Clients

Since Claude Desktop expects stdio transport, the included `mcp-bridge.js`
provides stdio↔HTTP translation. It's a lightweight Node.js script that
proxies JSON-RPC messages between stdin/stdout and the HTTP server.

## AI-Assisted Contributions

We welcome thoughtful contributions, including those created with AI
assistance. However, please ensure:

- **You understand the changes**: You must be able to explain the rationale
  for your decisions clearly
- **You've tested appropriately**: Run `npm run build` and test in a real
  vault
- **You've followed existing patterns**: Check similar functions and emulate
  their style
- **The contribution addresses a real need**: Focus on solving actual
  problems
- **You've read the AI assistant guidelines**: See
  [CLAUDE.md](CLAUDE.md) for AI-specific working guidelines

Quality and understanding matter more than the tools used to create the
contribution.
