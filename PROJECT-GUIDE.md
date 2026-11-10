# Control-M MCP: A Plain-Language Project Guide

This guide explains what this project is, how its parts work together, and what the files are for. It is written for readers who may not work with software every day.

## In one sentence

This project is a secure translator between an AI chat client (such as VS Code Copilot) and the Control-M Automation API: it turns approved chat requests into Control-M API calls and returns the results in the conversation.

## The main pieces

| Part | Plain-language explanation |
|---|---|
| You and the chat client | You ask for information or an operation in normal language. The chat client chooses an available MCP tool. |
| This project (the MCP server) | It provides the tools, checks inputs and safety rules, contacts the API, and formats the result. |
| Control-M Automation API | The supported interface through which the project reads or changes Control-M. |
| Control-M | The workload automation environment that runs and manages jobs, agents, folders, and related resources. |

The MCP server does **not** connect to Control-M's internal database. It communicates through the Automation API using the endpoint and credentials configured locally.

## What happens when you ask a question

1. The chat client starts this project's built server using the configuration in `.vscode/mcp.json`.
2. The server reads local settings from `.env`. That file supplies the API address, authentication information, and safety settings; it is not sent as a file to Control-M.
3. The server makes its tools available to the chat client. Some tools are written specifically for common tasks; many others are generated from the OpenAPI specification.
4. When a tool is called, the shared client handles the API request, authentication, connection settings, retries, and error reporting.
5. The result is returned to the chat. Sensitive fields are redacted where the server recognizes them.

For multi-step requests, a workflow can call several API operations in sequence and return a combined report. A workflow is still subject to the same API permissions and safety settings.

## Project tree

This is the maintained project layout. `node_modules` and `dist` are intentionally described separately because they are installed or generated, not hand-maintained source.

```text
controlm-mcp/
|-- .env                              Local settings and credentials; private, not shared
|-- .env.example                     Safe template for creating a local .env
|-- .github/
|   |-- agents/
|   |   |-- controlm-admin-operator.agent.md
|   |   |-- controlm-agent-lifecycle-operator.agent.md
|   |   |-- controlm-mcp-maintainer.agent.md
|   |   |-- controlm-credentials-secrets-operator.agent.md
|   |   |-- controlm-integrations-extensions-operator.agent.md
|   |   |-- controlm-job-operator.agent.md
|   |   |-- controlm-mft-operator.agent.md
|   |   |-- controlm-mft-infrastructure-operator.agent.md
|   |   |-- controlm-operations-lead.agent.md
|   |   |-- controlm-platform-configuration-operator.agent.md
|   |   |-- controlm-reporting-forecast-analyst.agent.md
|   |   |-- controlm-security-identity-operator.agent.md
|   |   |-- controlm-workflow-deployment-operator.agent.md
|   |   |-- controlm-workload-configuration-operator.agent.md
|   |   |-- controlm-job-investigator.agent.md
|   |   `-- controlm-platform-health-investigator.agent.md
|   |-- instructions/
|   |   `-- controlm-tool-development.instructions.md
|   |-- copilot-instructions.md
|   |-- controlm-tool-inventory.md
|   |-- missing-tools.md
|   `-- OpenAPI-YAML.yaml
|-- .gitignore
|-- .nvmrc
|-- .vscode/
|   `-- mcp.json
|-- Control-M-MCP-Copilot-Chat-Transcript.docx
|-- examples/
|   `-- mcp-client-config.json
|-- openapi/
|   `-- controlm-9.22.json
|-- package.json
|-- package-lock.json
|-- PROJECT-GUIDE.md
|-- README.md
|-- scripts/
|   `-- make_transcript_docx.py
|-- src/
|   |-- auth.ts
|   |-- config.ts
|   |-- controlm-client.ts
|   |-- copilot/
|   |   |-- alert-analyzer.ts
|   |   |-- failure-analyzer.ts
|   |   |-- job-monitor.ts
|   |   |-- orchestrator.ts
|   |   `-- report-builder.ts
|   |-- errors.ts
|   |-- http.ts
|   |-- logger.ts
|   |-- polling.ts
|   |-- schema-builder.ts
|   |-- scripts/
|   |   `-- generate-types.ts
|   |-- server.ts
|   |-- swagger-loader.ts
|   |-- tool-generator.ts
|   |-- tools/
|   |   |-- agent-tools.ts
|   |   |-- auth-tools.ts
|   |   |-- deploy-tools.ts
|   |   |-- forecast-tools.ts
|   |   |-- index.ts
|   |   |-- provisioning-tools.ts
|   |   |-- reporting-tools.ts
|   |   |-- security-tools.ts
|   |   `-- workload-tools.ts
|   |-- types.ts
|   `-- workflows/
|       |-- agent-health-report.ts
|       |-- agent-inventory.ts
|       |-- agent-provisioning-workflows.ts
|       |-- delivery-workflows.ts
|       |-- environment-summary.ts
|       |-- forecast-application.ts
|       |-- generate-report.ts
|       |-- index.ts
|       |-- observability-workflows.ts
|       |-- remediate-agent.ts
|       `-- upgrade-fleet.ts
|-- tests/
|   |-- config.test.js
|   `-- tool-generator.test.js
`-- tsconfig.json
```

## Files and folders explained

### Setup and project information

| File or folder | What it is for |
|---|---|
| `README.md` | The practical setup guide: prerequisites, installation, connecting VS Code, security advice, and troubleshooting. Start here when installing the project. |
| `PROJECT-GUIDE.md` | This plain-language map of the project and how its parts fit together. |
| `package.json` | The project identity, supported Node.js version, dependencies, and commands such as `npm run setup`, `npm start`, and `npm test`. |
| `package-lock.json` | Records the exact dependency versions used by npm so installations are repeatable across machines. |
| `.nvmrc` | Declares the Node.js version to use with Node version managers; this project specifies version 20. |
| `tsconfig.json` | Tells TypeScript how to check and compile the source code. Most users do not need to edit it. |
| `.gitignore` | Prevents local secrets, installed packages, generated output, logs, and test coverage from being added to Git by accident. |
| `.env.example` | A safe starting template. It contains no real credentials and defaults to read-only behavior with remediation disabled. |
| `.env` | This machine's private configuration: API URL, credentials or token, TLS options, and safety settings. Keep it private; do not email, commit, or paste it into chat. Create a separate `.env` on every machine. |

### AI assistant and editor configuration

| File or folder | What it is for |
|---|---|
| `.vscode/mcp.json` | Tells VS Code how to start the MCP server: run Node.js on the compiled `dist/server.js` file from the project directory. It does not contain API credentials. |
| `.github/copilot-instructions.md` | Workspace response-format preferences, such as using clear headings and readable tables when useful. |
| `.github/agents/controlm-mcp-maintainer.agent.md` | An on-demand specialist for future changes to tools, workflows, API mappings, tests, and docs. It does not make changes on its own. |
| `.github/agents/controlm-operations-lead.agent.md` | The user-facing router. It delegates to a domain specialist, consolidates findings, and has limited direct read-only job/health fallback tools. |
| `.github/agents/controlm-admin-operator.agent.md` | The user-facing Control-M administration agent. It can directly manage agent/agentless-host lifecycle within its assigned tool set and routes other administrative updates/deletes to domain-specific operators. |
| `.github/agents/controlm-job-investigator.agent.md` | Read-only current/historical job status, logs, output, waiting information, statistics, and archive lookups. |
| `.github/agents/controlm-job-operator.agent.md` | Job run/order, hold/free, rerun, kill, bypass, confirm, and active-job state actions. Requires specific per-action confirmation. |
| `.github/agents/controlm-platform-health-investigator.agent.md` | Read-only server/component and agent inventory, health reports, logs, and connectivity probes. |
| `.github/agents/controlm-agent-lifecycle-operator.agent.md` | Agent and agentless/remote-host installation, lifecycle, upgrade, certificate, and parameter actions. |
| `.github/agents/controlm-workflow-deployment-operator.agent.md` | Job/folder definition changes, variables, calendars, site standards, build, and deployments. |
| `.github/agents/controlm-platform-configuration-operator.agent.md` | Control-M/EM server, gateway, HA/failover, database, and system-setting operations. |
| `.github/agents/controlm-workload-configuration-operator.agent.md` | Resource/event, archive, workload-policy, host restriction/group, alert, FTS, and insights-export settings. |
| `.github/agents/controlm-security-identity-operator.agent.md` | User, role, authorization, external identity, and run-as account administration. |
| `.github/agents/controlm-credentials-secrets-operator.agent.md` | API token, secret, and authentication-session lifecycle; never returns secret material. |
| `.github/agents/controlm-mft-operator.agent.md` | Managed File Transfer users/groups, folder permissions, and processing rules. |
| `.github/agents/controlm-mft-infrastructure-operator.agent.md` | MFT gateways, hosts, hubs/clusters, SSH/PGP keys, data assurance, and transport settings. |
| `.github/agents/controlm-integrations-extensions-operator.agent.md` | Connection-profile inventory/tests, provisioning repositories, API discovery, and integration status. |
| `.github/agents/controlm-reporting-forecast-analyst.agent.md` | Read-only reports, forecasts, statistics, usage, archive metrics, and workflow insights. |
| `.github/controlm-tool-inventory.md` | Snapshot of the locally registered Control-M MCP tools and which workspace agents are assigned each tool. The effective list can vary with MCP server settings and the OpenAPI specification. |
| `.github/instructions/controlm-tool-development.instructions.md` | Development rules that apply when working on TypeScript source, including reuse of existing tools, safety checks, documentation, and testing. |
| `examples/mcp-client-config.json` | Example configuration for other MCP clients. Replace the placeholder workspace path for the target computer; never add credentials here. |

### Control-M API descriptions

| File or folder | What it is for |
|---|---|
| `.github/OpenAPI-YAML.yaml` | The included Control-M 9.22.40 API description. The server reads this contract to learn which API operations exist and generate corresponding tools. Keep it with the project. |
| `openapi/controlm-9.22.json` | An additional JSON-format API description in the repository. It can be selected as the input by configuring `CONTROLM_OPENAPI_PATH`; the active document is whichever path the local `.env` selects. |
| `.github/missing-tools.md` | Tracks requested API capabilities that were not present in the supplied API contract, as well as available alternatives. This helps avoid promising or inventing unsupported operations. |

The API description is like a menu of operations and their required inputs. It does not itself execute jobs. The server uses it to create tools that call the actual Automation API.

### Application source (`src/`)

These are the TypeScript files that make up the server. They are compiled into JavaScript before the server starts.

#### Core server and shared services

| File | What it does |
|---|---|
| `src/server.ts` | Starts the MCP server, registers built-in and generated tools, applies output redaction, and connects to the chat client over standard input/output. |
| `src/config.ts` | Reads and validates settings from `.env`, including connection details, limits, logging, and safety defaults. |
| `src/controlm-client.ts` | Shared Control-M API client. Domain tools use it rather than making their own network connections. |
| `src/auth.ts` | Logs in, manages the API session token, refreshes it when needed, and handles logout. |
| `src/http.ts` | Sets up HTTP/HTTPS, TLS certificates, optional proxy, retries, and network error conversion. |
| `src/errors.ts` | Converts failures into consistent, readable error information. |
| `src/logger.ts` | Writes structured diagnostic logs to the error stream and redacts sensitive values. The standard output stream is kept available for MCP messages. |
| `src/polling.ts` | Repeats a status check at intervals until work finishes or a time limit is reached. |
| `src/types.ts` | TypeScript descriptions of common Control-M request and response data. These help catch mistakes while developing. |
| `src/schema-builder.ts` | Converts API schema descriptions into input validation rules and TypeScript representations. |
| `src/swagger-loader.ts` | Loads and interprets the configured Swagger/OpenAPI document, including its operations and schemas. |
| `src/tool-generator.ts` | Turns API operations into chat-callable tools, applies naming, input checks, read-only filtering, and confirmation requirements for generated writes. |

#### First-class tools (`src/tools/`)

These are tools written by the project rather than generated directly from an API operation. They provide friendlier inputs or combine API calls for common tasks.

| File | Main area |
|---|---|
| `src/tools/index.ts` | Gathers and registers the first-class tool groups. |
| `src/tools/auth-tools.ts` | Login, logout, session status, and token actions. |
| `src/tools/agent-tools.ts` | Agent listing and agent configuration/health operations. |
| `src/tools/provisioning-tools.ts` | Agent installation, upgrade, removal, and provisioning status. |
| `src/tools/workload-tools.ts` | Job status and output, active jobs, and job/folder run controls. |
| `src/tools/deploy-tools.ts` | Build/validate and deploy Control-M definition files. |
| `src/tools/forecast-tools.ts` | Request and monitor job or folder forecasts. |
| `src/tools/reporting-tools.ts` | Reports, alerts, and reporting-oriented summaries. |
| `src/tools/security-tools.ts` | User, role, and secret-management helper tools. |

#### Multi-step workflows (`src/workflows/`)

Workflows combine related steps, for example gathering several health results into one report. They call the shared client and return a combined result.

| File | Main area |
|---|---|
| `src/workflows/index.ts` | Collects and registers workflow tools. |
| `src/workflows/agent-inventory.ts` | Builds an inventory of Control-M agents. |
| `src/workflows/agent-health-report.ts` | Probes agents and summarizes health results. |
| `src/workflows/environment-summary.ts` | Summarizes the Control-M environment, servers, and agent state. |
| `src/workflows/observability-workflows.ts` | Health-check and diagnostic collection workflows. |
| `src/workflows/agent-provisioning-workflows.ts` | Guided agent installation and upgrade workflows. |
| `src/workflows/upgrade-fleet.ts` | Coordinates multi-agent upgrade campaigns with limits and reporting. |
| `src/workflows/remediate-agent.ts` | Plans or performs agent remediation according to configured safety controls. |
| `src/workflows/delivery-workflows.ts` | Deployment and job delivery/run workflows. |
| `src/workflows/forecast-application.ts` | Produces a workflow-level forecast for an application or workload. |
| `src/workflows/generate-report.ts` | Collects and formats operational report information. |

#### Analysis helpers (`src/copilot/`)

These modules interpret data already returned by Control-M; they are not separate connections to Control-M.

| File | What it helps with |
|---|---|
| `src/copilot/orchestrator.ts` | Runs workflow steps in order, tracks timing and outcomes, and can compensate for completed steps when configured. |
| `src/copilot/job-monitor.ts` | Categorizes job states and monitors a run until its jobs finish or the timeout is reached. |
| `src/copilot/failure-analyzer.ts` | Uses known patterns in job status/output text to suggest possible failure causes. Suggestions are diagnostic clues, not guaranteed root causes. |
| `src/copilot/alert-analyzer.ts` | Groups and summarizes alerts by severity and theme. |
| `src/copilot/report-builder.ts` | Formats collected operational data as readable Markdown, plain text, or JSON. |

#### Helper script

| File | What it does |
|---|---|
| `src/scripts/generate-types.ts` | Optional script that generates TypeScript definitions from the API document. It can create `src/generated/controlm-api.ts`; that generated file is not currently part of the checked-in tree and should not be hand-edited. |

### Tests, scripts, and reference material

| File or folder | What it is for |
|---|---|
| `tests/config.test.js` | Checks that omitted safety settings default to read-only with remediation disabled. |
| `tests/tool-generator.test.js` | Checks generated tool naming, API request dispatch, write confirmation, and read-only filtering. |
| `scripts/make_transcript_docx.py` | Utility script used to produce the conversation transcript document. It is not needed to run the MCP server. |
| `Control-M-MCP-Copilot-Chat-Transcript.docx` | A saved conversation/reference document, not application code. Review it for private information before sharing it outside its intended audience. |

### Created automatically

| Folder | What it is for |
|---|---|
| `node_modules/` | Third-party software packages downloaded by `npm ci`. Do not edit these files manually. Recreate them with `npm ci`. |
| `dist/` | Compiled JavaScript output created from `src/` by `npm run build`. VS Code starts `dist/server.js`, so rebuild after source changes. Do not make lasting edits directly in `dist/`. |

These generated folders are excluded by `.gitignore`. A clean copy or source archive may not contain them; run the setup command to recreate them.

## Control-M agent team

The `.github/agents/` folder contains a maintainer and a Control-M operations team:

- **Project maintainer:** `controlm-mcp-maintainer.agent.md` helps make changes to this software.
- **Control-M Operations Lead:** user-facing router that delegates to a domain specialist and combines results.
- **Control-M Admin Operator:** user-facing admin entry point for agent administration and routing changes to the domain operators.
- **Read-only specialists:** Job Investigator, Platform Health Investigator, and Reporting and Forecast Analyst.
- **Write-capable specialists:** Job Operator, Agent Lifecycle Operator, Workflow Deployment Operator, Platform Configuration Operator, Workload Configuration Operator, Security and Identity Operator, Credentials and Secrets Operator, MFT Access Operator, MFT Infrastructure Operator, and Integrations and Extensions Operator. These agents are separated by use case and assigned explicit tool lists.

The Operations Lead routes job investigations to the Job Investigator, job actions to the Job Operator, and administrative changes to the Admin Operator; platform health and reporting requests go to their read-only specialists. The Admin Operator directly handles agent/agentless-host lifecycle operations within its explicit tool list and routes other administrative changes to the matching domain operator. Coordinators may delegate independent parts of a multi-domain request to multiple specialists and consolidate their results. The Operations Lead has limited direct read-only job/health tools for fallback. Specialists are selectable directly when direct execution is preferred or delegation has a tool-context limitation.

Each agent lists explicit `controlm-mcp/...` tools rather than using a wildcard. The Lead is restricted to its listed specialists. Here, `controlm-mcp` is the server name in `.vscode/mcp.json`. Operator instructions require inspecting the target, describing impact, and receiving explicit confirmation in the current conversation before a write; they also require verifying results. The tool lists provide separation of duties, but instructions are not a security boundary and do not override MCP server settings or Control-M account permissions.

The available tool catalog is organized into job operations, platform/agent health, agent and host lifecycle, workflow deployment, server/EM administration, workload configuration, identity, credentials, MFT access, MFT infrastructure, integrations, and reporting/analytics. The full local `tools/list` snapshot and its per-agent assignments are in `.github/controlm-tool-inventory.md`. Tool names are explicitly listed per agent. The unrestricted `ctm_send_ctl_command`, generic item-recycle operation, and token-data lookup tool are intentionally not granted because they can execute broad or sensitive operations. Review newly added MCP tools before assigning them to an agent.

To use the team, open this project as the VS Code workspace, start the `controlm-mcp` server, and select **Control-M Operations Lead** in Copilot Chat. Ask a read-only question or describe a specific change; the Lead routes it to the relevant specialist. You may instead select a specialist directly. Reload the VS Code window after changing agent files. Write actions still require server write mode, account permissions, and any organization approval.

This design limits which tools the agents are offered; it is not a replacement for server-side access control. The MCP server and the Control-M account still need safe permissions. Before using write agents in a production environment, configure least-privilege credentials, auditable approvals, and independent result verification.

## Safety in everyday terms

- The investigator and analyst agents are read-only. Separate operator agents expose explicitly scoped write tools; server-level read-only mode can still block those writes.
- **Remediation** means actions intended to repair or change resources. It is separately disabled by default in the sample and runtime defaults.
- Operator instructions require explicit confirmation for the specific change. Some tools also require a confirmation input. Neither an agent instruction nor a tool confirmation flag replaces least privilege, server-side controls, or organizational approvals.
- The Control-M account still determines what the server is allowed to do. The MCP server cannot grant itself access the account does not have.
- TLS certificate verification should stay enabled. Use a trusted certificate or CA file rather than disabling verification.
- Never share `.env`; keep credentials in a local secret store or approved secret manager.

## How to install or refresh the project

On a new machine:

1. Copy the project, including the API specification files.
2. Install Node.js 20 (the version recorded in `.nvmrc`).
3. In PowerShell, open the project folder and create `.env` from `.env.example` without replacing an existing `.env`.
4. Enter the correct API URL and authentication settings privately in `.env`; leave read-only mode on while validating.
5. Run `npm run setup` to install the locked dependencies and compile the server.
6. Open this folder as the VS Code workspace and start the `controlm-mcp` server.
7. Test a read-only request first. Restart the MCP server after rebuilding.

Useful commands:

| Command | Meaning |
|---|---|
| `npm run setup` | Installs exact dependency versions and builds the server. |
| `npm run build` | Compiles TypeScript source into `dist/`. |
| `npm start` | Starts the compiled MCP server. |
| `npm test` | Builds the server and runs the regression tests. |
| `npm run typecheck` | Checks TypeScript types without producing a new build. |
| `npm run clean` | Removes generated `dist/` output; the next build recreates it. |

## Where to go next

- For installation and common connection problems, see [README.md](./README.md).
- For requested API operations that are not in the supplied API description, see [`.github/missing-tools.md`](./.github/missing-tools.md).
- When adding a feature, first check whether the OpenAPI document already provides it; then follow the development guidance in [`.github/instructions/controlm-tool-development.instructions.md`](./.github/instructions/controlm-tool-development.instructions.md) and run `npm test` and `npm run typecheck`.
