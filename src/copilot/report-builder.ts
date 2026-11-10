import type { AgentHealthReport } from '../types.js';
import type { EnvironmentSummaryResult } from '../workflows/environment-summary.js';
import type { FailureAnalysisSummary } from './failure-analyzer.js';

export type ReportFormat = 'markdown' | 'text' | 'json';

export interface ReportSections {
  title: string;
  environment?: EnvironmentSummaryResult;
  agents?: AgentHealthReport;
  failures?: FailureAnalysisSummary;
  forecast?: unknown;
  runs?: Array<{ runId?: string; folder?: string; total?: number; succeeded?: number; failed?: number }>;
}

function pct(part: number, total: number): string {
  if (total === 0) return 'n/a';
  return `${Math.round((part / total) * 100)}%`;
}

function table(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [head, divider, body].filter(Boolean).join('\n');
}

/** Renders an operational report for humans from already-collected Control-M data. */
export function renderReport(sections: ReportSections, format: ReportFormat = 'markdown'): string {
  if (format === 'json') return JSON.stringify(sections, null, 2);

  const lines: string[] = [];
  const h1 = format === 'markdown' ? '# ' : '';
  const h2 = format === 'markdown' ? '## ' : '';
  const bullet = format === 'markdown' ? '- ' : '  * ';

  lines.push(`${h1}${sections.title}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  if (sections.environment) {
    const env = sections.environment;
    lines.push(`${h2}Environment`);
    lines.push(
      `${bullet}Servers: ${env.totals.servers} | Agents: ${env.totals.agents} | Unavailable agents: ${env.totals.unavailableAgents} (${pct(
        env.totals.unavailableAgents,
        env.totals.agents,
      )})`,
    );
    if (format === 'markdown' && env.servers.length > 0) {
      lines.push('');
      lines.push(
        table(
          ['Server', 'State', 'Agents', 'Unavailable'],
          env.servers.map((server) => [
            server.name,
            server.state ?? 'unknown',
            String(server.agentCount),
            String(server.unavailableAgentCount),
          ]),
        ),
      );
    }
    if (env.warnings.length > 0) {
      lines.push('');
      lines.push(`${h2}Warnings`);
      for (const warning of env.warnings.slice(0, 25)) lines.push(`${bullet}${warning}`);
    }
    lines.push('');
  }

  if (sections.agents) {
    const agents = sections.agents;
    lines.push(`${h2}Agent health`);
    lines.push(
      `${bullet}Healthy: ${agents.healthyAgents}/${agents.totalAgents} (${pct(agents.healthyAgents, agents.totalAgents)})`,
    );
    const unhealthy = agents.entries.filter((entry) => !entry.healthy);
    if (unhealthy.length > 0) {
      lines.push('');
      if (format === 'markdown') {
        lines.push(
          table(
            ['Agent', 'Server', 'Status', 'Version', 'Findings'],
            unhealthy
              .slice(0, 50)
              .map((entry) => [
                entry.nodeid,
                entry.server,
                String(entry.status ?? 'unknown'),
                entry.version ?? 'unknown',
                entry.findings.join('; ').replace(/\|/g, '/'),
              ]),
          ),
        );
      } else {
        for (const entry of unhealthy.slice(0, 50)) {
          lines.push(`${bullet}${entry.server}/${entry.nodeid}: ${entry.findings.join('; ')}`);
        }
      }
    }
    lines.push('');
  }

  if (sections.runs && sections.runs.length > 0) {
    lines.push(`${h2}Job runs`);
    if (format === 'markdown') {
      lines.push(
        table(
          ['Run', 'Folder', 'Jobs', 'Succeeded', 'Failed'],
          sections.runs.map((run) => [
            run.runId ?? 'n/a',
            run.folder ?? 'n/a',
            String(run.total ?? 0),
            String(run.succeeded ?? 0),
            String(run.failed ?? 0),
          ]),
        ),
      );
    } else {
      for (const run of sections.runs) {
        lines.push(`${bullet}${run.runId ?? 'n/a'} (${run.folder ?? 'n/a'}): ${run.succeeded ?? 0} ok, ${run.failed ?? 0} failed`);
      }
    }
    lines.push('');
  }

  if (sections.failures && sections.failures.analyzedJobs > 0) {
    const failures = sections.failures;
    lines.push(`${h2}Failure analysis`);
    lines.push(`${bullet}Analyzed jobs: ${failures.analyzedJobs}`);
    lines.push(`${bullet}Dominant root cause: ${failures.dominantCategory ?? 'UNKNOWN'}`);
    lines.push('');
    if (format === 'markdown') {
      lines.push(
        table(
          ['Category', 'Jobs', 'Examples'],
          failures.byCategory.map((bucket) => [
            bucket.category,
            String(bucket.count),
            bucket.jobs.slice(0, 5).join(', '),
          ]),
        ),
      );
    } else {
      for (const bucket of failures.byCategory) {
        lines.push(`${bullet}${bucket.category}: ${bucket.count} (${bucket.jobs.slice(0, 5).join(', ')})`);
      }
    }
    lines.push('');
    lines.push(`${h2}Recommended actions`);
    failures.consolidatedActions.forEach((action, index) => {
      lines.push(`${format === 'markdown' ? `${index + 1}. ` : `  ${index + 1}. `}${action}`);
    });
    lines.push('');
  }

  if (sections.forecast) {
    lines.push(`${h2}Scheduling forecast`);
    lines.push('```json');
    lines.push(JSON.stringify(sections.forecast, null, 2).slice(0, 8_000));
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
