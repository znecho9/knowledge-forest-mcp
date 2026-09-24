# Security policy

## Supported versions

Until `1.0`, security fixes are released for the latest minor version only.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose or corrupt private learning data, escape the configured data boundary, or execute commands through crafted forest content.

Use GitHub's private vulnerability reporting for `znecho9/knowledge-forest-mcp`. Include:

- affected version and operating system;
- MCP host and launch configuration;
- a minimal reproduction using non-sensitive data;
- expected impact;
- any proposed mitigation.

Do not include real learning archives, credentials, home-directory listings, or other personal data. If private reporting is not available, open a public issue that asks the maintainer to enable a private channel without publishing exploit details.

## Security model

Knowledge Forest MCP is a local stdio process. It can read and modify the one configured forest file using the same operating-system account as the MCP host. It does not make outbound network requests, execute forest content, collect telemetry, or expose an HTTP port.

The server is not a sandbox. Only connect it to hosts and models you trust with the configured learning archive. Use an explicit `KNOWLEDGE_FOREST_FILE` path and protect the containing directory with normal operating-system permissions.
