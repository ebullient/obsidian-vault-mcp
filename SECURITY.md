# Security Policy

I only support the latest version of this plugin. Given the rapid
evolution of the MCP protocol and dependencies, running/maintaining older
versions isn't feasible.

## Security Considerations

This plugin runs a local HTTP server on your machine to expose vault
access via the MCP protocol:

- **Network exposure**: The server listens on localhost by default but
  supports CORS for remote access (e.g., via Tailscale)
- **Authentication**: Currently there is no authentication mechanism - any
  client that can reach the configured port can access your vault
- **Data privacy**: All data stays on your machine; the plugin does not
  connect to external services or collect telemetry
- **Bridge script**: The `mcp-bridge.js` script runs as a Node.js process
  and bridges stdio to HTTP

## Reporting a Vulnerability

Please report suspected security issues privately using GitHub's "Report a
vulnerability" link in the repository sidebar.

Do **not** open a public issue for suspected vulnerabilities.

When reporting, please include:

- A description of the issue and affected versions
- Steps to reproduce (ideally a minimal proof-of-concept)
- Assessment of potential impact (network exposure, data access, etc.)
- Your contact information
- Any specific requests, such as anonymity for you and/or the
  organization you represent
