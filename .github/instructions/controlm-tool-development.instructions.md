---
description: "Use when adding, changing, or reviewing Control-M MCP API tools, workflows, OpenAPI mappings, or tool safety behavior."
applyTo: "src/**/*.ts"
---

# Control-M Tool Development

- Inspect the OpenAPI contract and existing generated or first-class tools before implementing a new capability. Avoid duplicate tools for an operation already exposed from the spec.
- Prefer generated tools for direct API coverage. Use `src/tools/` for focused helpers and `src/workflows/` for multi-step tasks with meaningful orchestration.
- Route Automation API calls through the shared `ControlMClient`; preserve its authentication, TLS, retry, and error handling behavior.
- Validate inputs with the existing Zod patterns. Keep tool names, descriptions, annotations, and confirmation requirements aligned with actual behavior.
- Treat every non-GET API operation as a write. Preserve explicit confirmation, read-only-mode behavior, and accurate destructive annotations; never infer permission from a confirmation flag.
- Redact secrets and avoid logging credentials, tokens, private keys, or sensitive API response data.
- Update relevant API coverage documentation when tool availability or limitations change.
- Add regression tests for changed behavior. Run `npm test` and `npm run typecheck`; report any validation that cannot be completed.
- Do not use live Control-M writes to validate code changes unless the user explicitly requests and authorizes them.
