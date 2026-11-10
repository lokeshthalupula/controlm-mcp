# Control-M MCP

An MCP server for the BMC Control-M Automation API. This guide covers setting up the project on a new Windows machine and connecting it to VS Code.

For a plain-language explanation of the complete project layout and the purpose of its files, see [PROJECT-GUIDE.md](./PROJECT-GUIDE.md).

The workspace includes a tool-scoped Control-M agent team under `.github/agents/`: read-only investigators and analysts plus separate, confirmation-gated operator agents. The registered-tool snapshot and per-agent assignments are listed in `.github/controlm-tool-inventory.md`. See the **Control-M agent team** section in the project guide for routing, roles, and safety boundaries.

## Prerequisites

- Windows 10/11 or Windows Server with network access to the Control-M Automation API.
- Node.js 20 or later and npm. Restart VS Code after installing Node.js so it can find `node` on `PATH`.
- A Control-M account with the API permissions needed for the tools you plan to use.
- This project directory, including `.github/OpenAPI-YAML.yaml`.

Check the installation in PowerShell:

```powershell
node --version
npm --version
```

## First-time setup

Open PowerShell in the project directory.

1. Create a local environment file. Do not overwrite an existing `.env`:

   ```powershell
   if (-not (Test-Path .env)) { Copy-Item .env.example .env }
   ```

2. Edit `.env` and set:
   - `CONTROLM_BASE_URL` to your Automation API URL, for example `https://controlm-host:8443/automation-api`.
   - `CONTROLM_USERNAME` and `CONTROLM_PASSWORD`, or set `CONTROLM_TOKEN`.
   - `CONTROLM_CA_CERT_PATH` if your Control-M API uses a private certificate authority.

   Keep `CONTROLM_TLS_REJECT_UNAUTHORIZED=true` and use the trusted CA certificate when possible. Disabling TLS verification weakens security and should only be a temporary, explicitly approved exception for a trusted internal environment.

3. Install locked dependencies and compile the server:

   ```powershell
   npm run setup
   ```

   This runs `npm ci` followed by the TypeScript build. For later source updates, run `npm ci` when dependencies change, then `npm run build`.

## Connect with VS Code

1. Open this project directory itself as the VS Code workspace (not its parent directory).
2. Trust the workspace if VS Code asks.
3. The project includes `.vscode/mcp.json`. It starts `dist/server.js` with the project as its working directory. The server loads `.env` using `dotenv`; do not put credentials in the MCP configuration.
4. Open Copilot Chat in **Agent** mode and start or enable the `controlm-mcp` server from the MCP tools list. Select **Control-M Operations Lead** to route requests to a specialist or **Control-M Admin Operator** for agent lifecycle administration and other administrative changes; each agent has an explicit `controlm-mcp/...` tool list. The Lead has only limited direct read-only fallback tools. Reload the VS Code window after changing agent definitions; rebuild/restart the MCP server only when its code or MCP configuration changes.
5. Choose the specialist that matches your request. For example, use **Control-M Job Investigator** for status/logs, **Control-M Job Operator** for job actions, **Control-M Admin Operator** for agent enable/disable/add/delete and administration routing, **Control-M Workflow Deployment Operator** for job definitions/deployment, or **Control-M Platform Health Investigator** for inventory/health. A write-capable agent must inspect the target, explain impact, and ask for confirmation of the exact change before invoking a write tool.

For another MCP client, see `examples/mcp-client-config.json`. Configure its working directory as the project directory so the server can find `.env` and the configured API specification.

## Safety and credentials

- `.env` is ignored by Git. Keep real credentials there or use an approved secret manager; never commit or paste secrets into chat.
- The checked-in `.env.example` starts with `CONTROLM_READ_ONLY=true` and `CONTROLM_ALLOW_REMEDIATION=false`. Keep these defaults while validating a new environment.
- If either safety variable is omitted, the server also defaults to read-only with remediation disabled.
- Some workspace agents have write-capable tool references, but the MCP server can still block writes in read-only mode, and the Control-M account still needs permission. Agent files do not change `.env`, server policy, or account permissions.
- Operator-agent instructions require explicit confirmation of the specific target and action, but model instructions are not a security boundary. Enforce least privilege and approvals through server configuration, account permissions, and your organization's change controls.
- Write operations and remediation can change jobs, agents, deployments, identities, MFT resources, and platform configuration. Enable them only when needed and review every target and impact.
- Some generated write tools require `_confirm: true`; this is an acknowledgement, not a substitute for reviewing the operation.
- The server redacts sensitive password, token, and secret-value fields from tool responses and logs.

## API specification

The local OpenAPI file is `.github/OpenAPI-YAML.yaml` (Control-M 9.22.40). The checked-in `.env.example` points `CONTROLM_OPENAPI_PATH` to this file. Keep the file with the project when moving or packaging the setup. The server uses it to generate API tools; missing or incompatible specifications can reduce the available tool set.

## Development and adding tools

The source is divided by responsibility:

| Location | Responsibility |
|---|---|
| `src/controlm-client.ts` | Shared Automation API HTTP client, authentication, retries, and request handling |
| `src/tool-generator.ts` and `src/swagger-loader.ts` | OpenAPI parsing, validation, and generated API tools |
| `src/tools/` | First-class, single-purpose tools grouped by Control-M domain |
| `src/workflows/` | Multi-step operations with reporting and safety controls |
| `src/copilot/` | Reusable analysis and orchestration logic |
| `.github/OpenAPI-YAML.yaml` | Versioned API contract used to generate tools |

When adding a capability:

1. Check the API specification and existing tools first. Prefer the generated tool when it fully covers the operation; add a readable alias only when it improves discovery.
2. Add a hand-written tool when it provides meaningful validation, aggregation, or user experience beyond a direct API call. Follow the relevant module and registration pattern in `src/tools/` or `src/workflows/`.
3. Keep API calls in the shared client. Mark read-only and destructive behavior accurately, and require explicit confirmation for writes. A confirmation flag is an acknowledgement, not authorization.
4. Update this guide and `.github/missing-tools.md` when coverage, naming, or documented limitations change. Do not claim an operation is available unless the API contract or implementation verifies it.
5. Add or update regression tests, then run:

   ```powershell
   npm test
   npm run typecheck
   ```

   Tests use Node's built-in test runner; no additional test dependency is required. `npm test` compiles the project before running tests.

Do not use production credentials or perform live Control-M changes to validate a code-only change. Keep API versions and any compatibility limitations explicit when updating the OpenAPI contract.

## Troubleshooting

| Symptom | Check |
|---|---|
| MCP server does not start | Confirm Node.js is on `PATH`, run `npm run setup`, and ensure VS Code opened the project root. |
| Server starts but API tools are missing | Confirm `.github/OpenAPI-YAML.yaml` exists and `CONTROLM_OPENAPI_PATH` in `.env` points to it; rebuild and restart the MCP server. |
| Authentication fails | Check the API URL and credentials in `.env`, and confirm the account has API access. Do not share the secret when asking for help. |
| TLS certificate error | Configure `CONTROLM_CA_CERT_PATH` with the trusted PEM CA certificate. Avoid disabling certificate verification. |
| Connection timeout or DNS error | Check VPN/network access, resolve the API hostname, and verify the configured port and any required proxy. |
| Tool returns permission denied | Ask the Control-M administrator to grant the account the necessary API permissions. |

Use the VS Code **Output** panel and select the MCP server output for startup details. Logs are written to stderr so they do not interfere with the MCP stdio protocol.
