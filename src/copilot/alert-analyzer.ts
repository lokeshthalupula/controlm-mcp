import type { Alert } from '../types.js';

export type AlertSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'INFO' | 'UNKNOWN';

const SEVERITY_ORDER: AlertSeverity[] = ['CRITICAL', 'MAJOR', 'MINOR', 'INFO', 'UNKNOWN'];

/** Control-M emits severity as V/R/U (Very urgent, Regular, Urgent) or as words. */
export function normalizeSeverity(raw: unknown): AlertSeverity {
  const value = String(raw ?? '').trim().toUpperCase();
  if (!value) return 'UNKNOWN';
  if (value === 'V' || value.startsWith('CRIT') || value.startsWith('VERY')) return 'CRITICAL';
  if (value === 'U' || value.startsWith('MAJ') || value.startsWith('URG') || value.startsWith('SEV')) return 'MAJOR';
  if (value === 'R' || value.startsWith('MIN') || value.startsWith('WARN') || value.startsWith('REG')) return 'MINOR';
  if (value.startsWith('INFO') || value.startsWith('NOT')) return 'INFO';
  return 'UNKNOWN';
}

const THEMES: Array<{ theme: string; pattern: RegExp; action: string }> = [
  {
    theme: 'Agent communication',
    pattern: /(agent|node).*(unavailable|disconnect|not responding|communication|unreachable)/i,
    action: 'Run collect_diagnostics with scope="agent", then remediate_agent for the affected nodes.',
  },
  {
    theme: 'Job failure',
    pattern: /(ended not ok|job failed|abend|completion status)/i,
    action: 'Run collect_diagnostics with scope="job" for the referenced runId or jobId.',
  },
  {
    theme: 'SLA / late execution',
    pattern: /(sla|service level|late|did not (start|end)|deadline)/i,
    action: 'Run forecast_application for the affected folder to see downstream schedule impact.',
  },
  {
    theme: 'Resource exhaustion',
    pattern: /(disk|space|memory|cpu|capacity|threshold|utilization)/i,
    action: 'Check host resource utilisation; raise the limit or reduce job concurrency.',
  },
  {
    theme: 'Server / gateway',
    pattern: /(control-m\/server|gateway|em |enterprise manager).*(down|disconnect|fail)/i,
    action: 'Run environment_summary and escalate to the Control-M platform owner.',
  },
  {
    theme: 'Security',
    pattern: /(authentication|authorization|login|password|certificate|expired)/i,
    action: 'Review manage_users / manage_roles and rotate credentials with manage_secrets.',
  },
];

export interface AlertCluster {
  theme: string;
  count: number;
  severity: AlertSeverity;
  sampleMessages: string[];
  affectedNodes: string[];
  affectedJobs: string[];
  recommendedAction: string;
}

export interface AlertAnalysis {
  analyzedAlerts: number;
  openAlerts: number;
  bySeverity: Record<AlertSeverity, number>;
  highestSeverity: AlertSeverity;
  clusters: AlertCluster[];
  /** Nodes appearing in three or more alerts: likely a single infrastructure root cause. */
  repeatOffenders: Array<{ node: string; alerts: number }>;
  topPriorityActions: string[];
}

function isOpen(alert: Alert): boolean {
  const status = String(alert.status ?? '').toLowerCase();
  return status === '' || status.includes('new') || status.includes('open') || status.includes('not_noticed');
}

function text(alert: Alert): string {
  return [alert.message, alert.component, alert.jobName, alert.node].filter(Boolean).join(' ');
}

/** Clusters raw Control-M alerts into themed, prioritised, actionable groups. */
export function analyzeAlerts(alerts: Alert[]): AlertAnalysis {
  const bySeverity: Record<AlertSeverity, number> = {
    CRITICAL: 0,
    MAJOR: 0,
    MINOR: 0,
    INFO: 0,
    UNKNOWN: 0,
  };

  const nodeCounts = new Map<string, number>();
  const clusters = new Map<string, AlertCluster>();
  let openAlerts = 0;

  for (const alert of alerts) {
    const severity = normalizeSeverity(alert.severity);
    bySeverity[severity] += 1;
    if (isOpen(alert)) openAlerts += 1;

    const node = alert.node ? String(alert.node) : undefined;
    if (node) nodeCounts.set(node, (nodeCounts.get(node) ?? 0) + 1);

    const haystack = text(alert);
    const matched = THEMES.find((entry) => entry.pattern.test(haystack));
    const themeName = matched?.theme ?? 'Uncategorised';

    const cluster = clusters.get(themeName) ?? {
      theme: themeName,
      count: 0,
      severity: 'UNKNOWN',
      sampleMessages: [],
      affectedNodes: [],
      affectedJobs: [],
      recommendedAction:
        matched?.action ?? 'Review the alert text manually; no known signature matched.',
    };

    cluster.count += 1;
    if (SEVERITY_ORDER.indexOf(severity) < SEVERITY_ORDER.indexOf(cluster.severity)) {
      cluster.severity = severity;
    }
    if (cluster.sampleMessages.length < 3 && alert.message) {
      cluster.sampleMessages.push(String(alert.message).slice(0, 300));
    }
    if (node && !cluster.affectedNodes.includes(node)) cluster.affectedNodes.push(node);
    if (alert.jobName) {
      const job = String(alert.jobName);
      if (!cluster.affectedJobs.includes(job)) cluster.affectedJobs.push(job);
    }

    clusters.set(themeName, cluster);
  }

  const ranked = [...clusters.values()].sort((a, b) => {
    const bySev = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    return bySev !== 0 ? bySev : b.count - a.count;
  });

  const highestSeverity =
    SEVERITY_ORDER.find((severity) => bySeverity[severity] > 0) ?? 'UNKNOWN';

  return {
    analyzedAlerts: alerts.length,
    openAlerts,
    bySeverity,
    highestSeverity,
    clusters: ranked,
    repeatOffenders: [...nodeCounts.entries()]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .map(([node, count]) => ({ node, alerts: count })),
    topPriorityActions: ranked.slice(0, 5).map((cluster) => `[${cluster.severity}] ${cluster.recommendedAction}`),
  };
}

export function extractAlerts(raw: unknown): Alert[] {
  if (Array.isArray(raw)) return raw as Alert[];
  const record = raw as Record<string, unknown> | null;
  if (record && Array.isArray(record.alerts)) return record.alerts as Alert[];
  return [];
}
