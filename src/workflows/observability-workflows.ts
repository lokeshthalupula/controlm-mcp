import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { ControlMClient } from '../controlm-client.js';
import { analyzeAlerts, extractAlerts, type AlertAnalysis } from '../copilot/alert-analyzer.js';
import { analyzeFailure, summarizeFailures, type AnalyzedFailure } from '../copilot/failure-analyzer.js';
import { classifyJobStatus, safeJobOutput } from '../copilot/job-monitor.js';
import { fail, runWorkflow, type Step } from '../copilot/orchestrator.js';
import type { Logger } from '../logger.js';
import type { ToolDefinition } from '../tool-generator.js';
import type { AgentHealthReport, ForecastResponse, JobStatus } from '../types.js';
import { buildAgentHealthReport } from './agent-health-report.js';
import { buildEnvironmentSummary, type EnvironmentSummaryResult } from './environment-summary.js';

interface HealthState {
  server?: string;
  minVersion?: string;
  session?: Record<string, unknown>;
  environment?: EnvironmentSummaryResult;
  agents?: AgentHealthReport;
  forecast?: ForecastResponse;
  findings: string[];
  score: number;
}

function grade(score: number): 'HEALTHY' | 'DEGRADED' | 'CRITICAL' {
  if (score >= 90) return 'HEALTHY';
  if (score >= 60) return 'DEGRADED';
  return 'CRITICAL';
}

/**
 * health_check_workflow
 *
 * API calls: POST /session/login (implicit) -> GET /config/servers -> GET agents per
 * server -> POST ping + POST test per agent -> optional POST /forecast.
 */
export function createHealthCheckWorkflow(
  client: ControlMClient,
  config: AppConfig,
  logger: Logger,
): ToolDefinition {
  return {
    name: 'health_check_workflow',
    description:
      'End-to-end environment health check. Verifies the Automation API session, enumerates every ' +
      'Control-M/Server and its agents, actively probes each agent with ping and a connectivity test, ' +
      'optionally runs a scheduling forecast, and returns a weighted health score with prioritised findings.',
    inputShape: {
      server: z.string().optional().describe('Restrict the check to one Control-M/Server. Omit to scan all.'),
      probeAgents: z.boolean().optional().describe('Actively ping and test each agent. Default true.'),
      minAgentVersion: z.string().optional().describe('Flag agents below this version, e.g. "9.0.21.000".'),
      maxAgents: z.number().int().min(1).max(1_000).optional().describe('Safety cap on probed agents. Default 200.'),
      includeForecast: z
        .boolean()
        .optional()
        .describe('Also request a scheduling forecast for the window below. Default false.'),
      forecastFolder: z.string().optional().describe('Folder to forecast when includeForecast is true.'),
      forecastFrom: z.string().optional().describe('Forecast window start.'),
      forecastTo: z.string().optional().describe('Forecast window end.'),
      timeoutSeconds: z.number().int().min(30).max(7_200).optional().describe('Total budget. Default 900.'),
    },
    annotations: { title: 'Health check workflow', readOnlyHint: true, idempotentHint: true },
    handler: async (args: Record<string, unknown>) => {
      const state: HealthState = {
        server: args.server as string | undefined,
        minVersion: args.minAgentVersion as string | undefined,
        findings: [],
        score: 100,
      };

      const penalize = (points: number, finding: string) => {
        state.score = Math.max(0, state.score - points);
        state.findings.push(finding);
      };

      const steps: Array<Step<HealthState>> = [
        {
          name: 'verifySession',
          run: async (current) => {
            await client.login();
            current.session = client.sessionState() as unknown as Record<string, unknown>;
            return current.session;
          },
        },
        {
          name: 'scanTopology',
          run: async (current) => {
            current.environment = await buildEnvironmentSummary(client, logger, { includeAgents: true });
            if (current.environment.totals.servers === 0) {
              fail('No Control-M/Servers were returned by the configuration service.');
            }
            for (const warning of current.environment.warnings) {
              penalize(5, warning);
            }
            return current.environment;
          },
        },
        {
          name: 'probeAgents',
          run: async (current) => {
            current.agents = await buildAgentHealthReport(client, logger, {
              server: current.server,
              probe: args.probeAgents !== false,
              minVersion: current.minVersion,
              maxAgents: args.maxAgents as number | undefined,
              concurrency: config.workflows.healthProbeConcurrency,
            });

            const { totalAgents, unhealthyAgents } = current.agents;
            if (totalAgents === 0) {
              penalize(30, 'No agents were discovered in the scanned scope.');
            } else if (unhealthyAgents > 0) {
              const ratio = unhealthyAgents / totalAgents;
              penalize(Math.round(ratio * 50), `${unhealthyAgents} of ${totalAgents} agent(s) are unhealthy.`);
              for (const entry of current.agents.entries.filter((item) => !item.healthy).slice(0, 10)) {
                current.findings.push(`${entry.server}/${entry.nodeid}: ${entry.findings.join(' ')}`);
              }
            }
            return {
              totalAgents,
              healthyAgents: current.agents.healthyAgents,
              unhealthyAgents,
            };
          },
        },
        {
          name: 'schedulingForecast',
          optional: true,
          skip: () => (args.includeForecast === true ? false : 'includeForecast is false.'),
          run: async (current) => {
            const payload: Record<string, unknown> = {};
            for (const [key, value] of [
              ['folder', args.forecastFolder],
              ['from', args.forecastFrom],
              ['to', args.forecastTo],
              ['ctm', current.server],
            ] as const) {
              if (value !== undefined && value !== '') payload[key] = value;
            }
            current.forecast = await client.createForecast(payload);
            return current.forecast;
          },
        },
      ];

      const run = await runWorkflow<HealthState>({
        name: 'health_check_workflow',
        logger,
        state,
        steps,
        timeoutMs: ((args.timeoutSeconds as number | undefined) ?? 900) * 1_000,
        summarize: (current, _records, success) =>
          success
            ? `Environment health: ${grade(current.score)} (score ${current.score}/100). ` +
              `${current.agents?.healthyAgents ?? 0}/${current.agents?.totalAgents ?? 0} agents healthy across ` +
              `${current.environment?.totals.servers ?? 0} server(s).`
            : 'Health check could not complete; the environment state is unknown.',
      });

      return {
        ...run,
        health: {
          grade: grade(state.score),
          score: state.score,
          findings: state.findings,
          recommendedNextSteps: state.findings.length
            ? [
                'Run collect_diagnostics for each unhealthy agent or failing job.',
                'Use remediate_agent with dryRun=true to obtain a remediation plan.',
              ]
            : ['No action required.'],
        },
      };
    },
  };
}

interface DiagnosticsState {
  scope: 'job' | 'agent' | 'folder' | 'environment';
  jobId?: string;
  runId?: string;
  folder?: string;
  server?: string;
  agent?: string;
  jobStatuses: JobStatus[];
  failures: AnalyzedFailure[];
  agentReport?: AgentHealthReport;
  environment?: EnvironmentSummaryResult;
  alerts?: AlertAnalysis;
  correlations: string[];
}

/**
 * collect_diagnostics
 *
 * API calls (job scope): GET /run/status or GET job status -> GET job output -> GET
 * job log -> ping/test the executing agent -> correlate failure category with agent health.
 * API calls (folder scope): GET /run/jobs/status filtered by folder -> output per failure.
 * API calls (agent scope): GET agents -> ping -> test.
 * All scopes optionally pull GET /run/alerts and cluster them.
 */
export function createCollectDiagnosticsTool(
  client: ControlMClient,
  config: AppConfig,
  logger: Logger,
): ToolDefinition {
  return {
    name: 'collect_diagnostics',
    description:
      'Root-cause diagnostics across job, folder, agent and environment scope. For a failed job it pulls the ' +
      'status, OUTPUT and Control-M log, classifies the failure with signature heuristics, then probes the ' +
      'executing agent to confirm or rule out infrastructure causes. For a folder it sweeps every job in that ' +
      'folder. Optionally pulls and clusters Control-M alerts. Returns a correlated diagnosis with ranked, ' +
      'actionable remediation steps. Read-only: it never changes anything.',
    inputShape: {
      scope: z
        .enum(['job', 'folder', 'agent', 'environment'])
        .describe('What to diagnose: a failed job/run, a whole folder, a specific agent, or the environment.'),
      jobId: z.string().optional().describe('Job id to diagnose. Required for scope="job" unless runId is given.'),
      runId: z.string().optional().describe('Run id whose failed jobs should be diagnosed.'),
      folder: z.string().optional().describe('Folder to sweep. Required for scope="folder".'),
      server: z.string().optional().describe('Control-M/Server name. Required for scope="agent".'),
      agent: z.string().optional().describe('Agent node id. Required for scope="agent".'),
      includeLog: z.boolean().optional().describe('Also fetch the Control-M job log. Default true.'),
      includeAlerts: z
        .boolean()
        .optional()
        .describe('Pull Control-M alerts for the scope and cluster them by theme. Default false.'),
      alertLimit: z.number().int().min(1).max(1_000).optional().describe('Max alerts to retrieve. Default 200.'),
      maxJobs: z.number().int().min(1).max(50).optional().describe('Max failed jobs to analyze. Default 10.'),
      maxOutputChars: z.number().int().min(500).max(100_000).optional().describe('Output truncation. Default 8000.'),
      timeoutSeconds: z.number().int().min(30).max(3_600).optional().describe('Total budget. Default 600.'),
    },
    annotations: { title: 'Collect Control-M diagnostics', readOnlyHint: true, idempotentHint: true },
    handler: async (args: Record<string, unknown>) => {
      const maxOutputChars = (args.maxOutputChars as number | undefined) ?? 8_000;
      const maxJobs = (args.maxJobs as number | undefined) ?? 10;

      const state: DiagnosticsState = {
        scope: args.scope as DiagnosticsState['scope'],
        jobId: args.jobId as string | undefined,
        runId: args.runId as string | undefined,
        folder: args.folder as string | undefined,
        server: args.server as string | undefined,
        agent: args.agent as string | undefined,
        jobStatuses: [],
        failures: [],
        correlations: [],
      };

      const steps: Array<Step<DiagnosticsState>> = [
        {
          name: 'collectJobStatus',
          skip: (current) => (current.scope === 'job' ? false : `Scope is "${current.scope}".`),
          run: async (current) => {
            if (current.runId) {
              const run = await client.getRunStatus(current.runId);
              current.jobStatuses = (run.statuses ?? []).filter(
                (job) => classifyJobStatus(job.status) === 'failure',
              );
              if (current.jobStatuses.length === 0) {
                return `Run ${current.runId} has no failed jobs.`;
              }
            } else if (current.jobId) {
              current.jobStatuses = [await client.getJobStatus(current.jobId)];
            } else {
              fail('scope="job" requires either jobId or runId.');
            }
            current.jobStatuses = current.jobStatuses.slice(0, maxJobs);
            return { analyzing: current.jobStatuses.length, jobs: current.jobStatuses.map((job) => job.jobId) };
          },
        },
        {
          name: 'sweepFolder',
          skip: (current) => (current.scope === 'folder' ? false : `Scope is "${current.scope}".`),
          run: async (current) => {
            if (!current.folder) fail('scope="folder" requires a folder name.');

            const response = await client.listJobStatuses({
              folder: current.folder,
              ...(current.server ? { ctm: current.server } : {}),
              limit: 1_000,
            });
            const statuses = response.statuses ?? [];
            const failed = statuses.filter((job) => classifyJobStatus(job.status) === 'failure');
            current.jobStatuses = failed.slice(0, maxJobs);

            const held = statuses.filter((job) => job.held === true);
            if (held.length > 0) {
              current.correlations.push(`${held.length} job(s) in "${current.folder}" are held and will not run.`);
            }

            return {
              folder: current.folder,
              totalJobs: statuses.length,
              failed: failed.length,
              held: held.length,
              active: statuses.filter((job) => classifyJobStatus(job.status) === 'active').length,
              succeeded: statuses.filter((job) => classifyJobStatus(job.status) === 'success').length,
            };
          },
        },
        {
          name: 'analyzeJobOutput',
          skip: (current) =>
            current.jobStatuses.length > 0 ? false : 'No job statuses to analyze.',
          run: async (current) => {
            for (const job of current.jobStatuses) {
              if (!job.jobId) continue;
              const output = await safeJobOutput(client, job.jobId, maxOutputChars);
              let log: string | undefined;
              if (args.includeLog !== false) {
                try {
                  const raw = await client.getJobLog(job.jobId);
                  log = typeof raw === 'string' ? raw.slice(-maxOutputChars) : undefined;
                } catch {
                  log = undefined;
                }
              }
              current.failures.push(analyzeFailure(job, [output.output ?? '', log ?? ''].join('\n')));
            }
            return summarizeFailures(current.failures);
          },
        },
        {
          name: 'probeExecutionAgents',
          optional: true,
          skip: (current) => {
            if (current.scope === 'agent') return false;
            if (current.failures.length > 0) return false;
            return 'No agent scope and no job failures to correlate.';
          },
          run: async (current) => {
            const targets = new Set<string>();
            if (current.scope === 'agent' && current.agent) targets.add(current.agent);
            for (const failure of current.failures) {
              if (failure.host) targets.add(failure.host);
            }

            if (targets.size === 0) {
              current.agentReport = await buildAgentHealthReport(client, logger, {
                server: current.server,
                probe: true,
                onlyUnhealthy: true,
                maxAgents: 100,
              });
              return current.agentReport;
            }

            const server = current.server;
            if (!server) {
              return 'No Control-M/Server supplied; skipping targeted agent probe.';
            }

            const probes = [];
            for (const host of targets) {
              const ping = await client.pingAgent(server, host);
              const test = ping.reachable ? await client.testAgent(server, host) : undefined;
              probes.push({ host, ping, test });

              if (!ping.reachable) {
                current.correlations.push(
                  `Agent "${host}" is unreachable, which is consistent with the observed job failure(s).`,
                );
              } else if (test && !test.passed) {
                current.correlations.push(
                  `Agent "${host}" responds to ping but fails the connectivity test; suspect agent configuration.`,
                );
              } else if (current.failures.length > 0) {
                current.correlations.push(
                  `Agent "${host}" is healthy, so the failure is most likely application-level rather than infrastructure.`,
                );
              }
            }
            return probes;
          },
        },
        {
          name: 'environmentContext',
          optional: true,
          skip: (current) => (current.scope === 'environment' ? false : 'Scope is not "environment".'),
          run: async (current) => {
            current.environment = await buildEnvironmentSummary(client, logger, {
              includeAgents: true,
              includeSecurity: false,
            });
            current.agentReport = await buildAgentHealthReport(client, logger, {
              probe: true,
              onlyUnhealthy: true,
              maxAgents: 200,
            });
            for (const warning of current.environment.warnings) current.correlations.push(warning);
            return { environment: current.environment, unhealthyAgents: current.agentReport.unhealthyAgents };
          },
        },
        {
          name: 'analyzeAlerts',
          optional: true,
          skip: () => (args.includeAlerts === true ? false : 'includeAlerts is false.'),
          run: async (current) => {
            const raw = await client.listAlerts({
              ...(current.server ? { ctm: current.server } : {}),
              ...(current.jobStatuses[0]?.name ? { jobname: String(current.jobStatuses[0].name) } : {}),
              limit: (args.alertLimit as number | undefined) ?? config.workflows.alertLimit,
            });
            current.alerts = analyzeAlerts(extractAlerts(raw));

            for (const offender of current.alerts.repeatOffenders) {
              current.correlations.push(
                `Node "${offender.node}" appears in ${offender.alerts} alerts: likely a single infrastructure root cause.`,
              );
            }
            return current.alerts;
          },
        },
      ];

      const run = await runWorkflow<DiagnosticsState>({
        name: 'collect_diagnostics',
        logger,
        state,
        steps,
        timeoutMs: ((args.timeoutSeconds as number | undefined) ?? 600) * 1_000,
        summarize: (current) => {
          if (current.failures.length > 0) {
            const summary = summarizeFailures(current.failures);
            return `Diagnosed ${current.failures.length} failed job(s). Dominant root cause: ${summary.dominantCategory}.`;
          }
          if (current.agentReport) {
            return `Agent scan found ${current.agentReport.unhealthyAgents} unhealthy agent(s) of ${current.agentReport.totalAgents}.`;
          }
          return 'Diagnostics completed with no failures detected in the requested scope.';
        },
      });

      const analysis = state.failures.length > 0 ? summarizeFailures(state.failures) : undefined;

      return {
        ...run,
        diagnosis: {
          scope: state.scope,
          analysis,
          alerts: state.alerts,
          correlations: state.correlations,
          unhealthyAgents: state.agentReport?.entries.filter((entry) => !entry.healthy) ?? [],
          remediation: {
            available: config.safety.allowRemediation,
            suggestedTools: buildSuggestedTools(state),
          },
        },
      };
    },
  };
}

function buildSuggestedTools(state: DiagnosticsState): string[] {
  const suggestions: string[] = [];
  const categories = new Set(state.failures.map((failure) => failure.category));

  if (categories.has('AGENT_UNAVAILABLE') || (state.agentReport?.unhealthyAgents ?? 0) > 0) {
    suggestions.push('remediate_agent (start with dryRun=true)');
    suggestions.push('agent_health_report to confirm the blast radius');
  }
  if (categories.has('CONFIGURATION') || categories.has('RESOURCE_MISSING')) {
    suggestions.push('deploy_application to redeploy corrected definitions');
  }
  if (categories.has('NETWORK') || categories.has('TIMEOUT') || categories.has('CAPACITY')) {
    suggestions.push('run_and_monitor_job with autoRerunOnTransientFailure=true');
  }
  if (categories.has('AUTHENTICATION') || categories.has('PERMISSIONS')) {
    suggestions.push('manage_secrets to rotate the stored credential');
    suggestions.push('manage_roles to review the submitting user authorizations');
  }
  if (suggestions.length === 0) {
    suggestions.push('get_job_output to read the full sysout');
  }
  return suggestions;
}
