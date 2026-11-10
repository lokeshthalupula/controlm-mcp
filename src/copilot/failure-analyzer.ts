import type { JobStatus } from '../types.js';

export type FailureCategory =
  | 'AGENT_UNAVAILABLE'
  | 'AUTHENTICATION'
  | 'PERMISSIONS'
  | 'RESOURCE_MISSING'
  | 'DISK_SPACE'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'DEPENDENCY'
  | 'DATA_ERROR'
  | 'SCRIPT_ERROR'
  | 'CONFIGURATION'
  | 'CAPACITY'
  | 'UNKNOWN';

export interface FailureSignature {
  category: FailureCategory;
  /** 0-1 heuristic confidence for this individual match. */
  weight: number;
  pattern: RegExp;
  likelyCause: string;
  recommendedActions: string[];
}

/**
 * Ordered heuristics applied to job OUTPUT/sysout and Control-M status text.
 * Earlier entries win ties; weights accumulate per category across matches.
 */
const SIGNATURES: FailureSignature[] = [
  {
    category: 'AGENT_UNAVAILABLE',
    weight: 0.95,
    pattern: /(agent (is )?(not available|unavailable|disconnected|down))|(no agent)|(agent not responding)|(CTM\w*\d+[A-Z]?\s+agent)/i,
    likelyCause: 'The Control-M/Agent on the execution host is unavailable or not communicating with the server.',
    recommendedActions: [
      'Run ping_agent and test_agent against the job host.',
      'Run remediate_agent with dryRun=true to get a remediation plan.',
      'Verify the agent service is running and the server-to-agent ports are open.',
    ],
  },
  {
    category: 'AUTHENTICATION',
    weight: 0.9,
    pattern: /(logon failure|authentication failed|invalid (user|password|credential)|access token|kerberos|unable to authenticate|password (has )?expired)/i,
    likelyCause: 'The run-as user credentials are invalid, expired, or missing from the agent/connection profile.',
    recommendedActions: [
      'Check the job RunAs user and its password in the Control-M/Agent or connection profile.',
      'Use manage_secrets to rotate the stored credential.',
      'Confirm the account is not locked or expired in the target directory service.',
    ],
  },
  {
    category: 'PERMISSIONS',
    weight: 0.85,
    pattern: /(permission denied|access is denied|not authorized|forbidden|EACCES|insufficient privileges)/i,
    likelyCause: 'The executing OS account lacks permissions on a file, directory, or resource.',
    recommendedActions: [
      'Verify filesystem/ACL permissions for the RunAs user on the referenced path.',
      'Check Control-M authorizations with manage_roles for the submitting user.',
    ],
  },
  {
    category: 'RESOURCE_MISSING',
    weight: 0.85,
    pattern: /(no such file or directory|ENOENT|cannot find the (file|path)|file not found|command not found|is not recognized as an internal)/i,
    likelyCause: 'A script, binary, or input file referenced by the job does not exist on the execution host.',
    recommendedActions: [
      'Confirm the command/script path in the job definition exists on the agent host.',
      'Check that an upstream job that produces the input file actually ran.',
      'Validate the deployed definition with the build tool.',
    ],
  },
  {
    category: 'DISK_SPACE',
    weight: 0.95,
    pattern: /(no space left|disk (is )?full|ENOSPC|insufficient disk|quota exceeded)/i,
    likelyCause: 'The execution host or the Control-M/Agent filesystem ran out of space.',
    recommendedActions: [
      'Free space on the agent host, especially the agent OUTPUT/proclog directories.',
      'Re-run the job with rerun_job once space is reclaimed.',
    ],
  },
  {
    category: 'TIMEOUT',
    weight: 0.8,
    pattern: /(timed? ?out|exceeded (the )?(maximum|allowed) (time|runtime)|ETIMEDOUT|deadline exceeded|long running)/i,
    likelyCause: 'The job exceeded its allowed runtime or an external call it depends on timed out.',
    recommendedActions: [
      'Compare the run duration against the job SLA and historical averages.',
      'Check downstream systems (database, API, file transfer target) for slowness.',
      'Consider increasing the job timeout or splitting the workload.',
    ],
  },
  {
    category: 'NETWORK',
    weight: 0.8,
    pattern: /(connection (refused|reset|timed out)|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|network is unreachable|could not resolve host|DNS)/i,
    likelyCause: 'A network connection from the agent host to a dependent system failed.',
    recommendedActions: [
      'Verify firewall rules and DNS resolution from the agent host to the target endpoint.',
      'Check whether the dependent service is up.',
    ],
  },
  {
    category: 'DEPENDENCY',
    weight: 0.7,
    pattern: /(waiting for (condition|resource)|prerequisite (not )?(met|satisfied)|predecessor (job )?failed|upstream (job )?fail)/i,
    likelyCause: 'A predecessor job or an IN condition/resource the job depends on was not satisfied.',
    recommendedActions: [
      'Inspect the flow with get_job_status for the predecessor jobs in the same folder.',
      'Verify the prerequisite conditions and quantitative/control resources.',
    ],
  },
  {
    category: 'DATA_ERROR',
    weight: 0.7,
    pattern: /(ORA-\d+|SQL(STATE|CODE)|deadlock|constraint violation|duplicate key|invalid (data|format)|parse error|malformed)/i,
    likelyCause: 'The job failed while processing data: a database error or an invalid input record.',
    recommendedActions: [
      'Read the full output with get_job_output to isolate the failing record or SQL statement.',
      'Coordinate with the data owner before rerunning to avoid duplicate processing.',
    ],
  },
  {
    category: 'CAPACITY',
    weight: 0.75,
    pattern: /(out of memory|OOM|cannot allocate memory|too many open files|EMFILE|resource temporarily unavailable|max.*connections)/i,
    likelyCause: 'The execution host exhausted memory, file handles, or a connection pool.',
    recommendedActions: [
      'Check host resource utilisation at the failure timestamp.',
      'Reduce job concurrency or raise the relevant OS/application limit.',
    ],
  },
  {
    category: 'CONFIGURATION',
    weight: 0.6,
    pattern: /(invalid (parameter|argument|configuration)|unknown option|missing required (parameter|variable)|%%[A-Z0-9_]+ (not )?(defined|resolved))/i,
    likelyCause: 'A job parameter or Control-M auto-edit variable is missing or malformed.',
    recommendedActions: [
      'Review the job variables passed by run_job and the folder-level variable definitions.',
      'Validate the definition with the build tool before redeploying.',
    ],
  },
  {
    category: 'SCRIPT_ERROR',
    weight: 0.5,
    pattern: /(exit (code|status) [1-9]\d*|traceback \(most recent call last\)|exception in thread|syntax error|command failed|returned non-zero)/i,
    likelyCause: 'The job script itself terminated with a non-zero exit code or an unhandled exception.',
    recommendedActions: [
      'Read the tail of the job output with get_job_output to find the application stack trace.',
      'Reproduce the script manually on the agent host as the RunAs user.',
    ],
  },
];

export interface AnalyzedFailure {
  jobId?: string;
  jobName?: string;
  folder?: string;
  status?: string;
  host?: string;
  category: FailureCategory;
  confidence: number;
  likelyCause: string;
  recommendedActions: string[];
  /** All categories that matched, strongest first. */
  secondaryCategories: Array<{ category: FailureCategory; confidence: number }>;
  /** Output lines that triggered the classification. */
  evidence: string[];
}

function extractEvidence(text: string, pattern: RegExp, max = 3): string[] {
  const lines = text.split(/\r?\n/);
  const hits: string[] = [];
  for (const line of lines) {
    if (pattern.test(line)) {
      hits.push(line.trim().slice(0, 300));
      if (hits.length >= max) break;
    }
  }
  return hits;
}

/** Classifies a single job failure from its status record and output text. */
export function analyzeFailure(job: Partial<JobStatus>, output?: string): AnalyzedFailure {
  const haystack = [job.status ?? '', output ?? ''].join('\n');

  const scores = new Map<FailureCategory, { confidence: number; signature: FailureSignature }>();
  const evidence: string[] = [];

  for (const signature of SIGNATURES) {
    if (!signature.pattern.test(haystack)) continue;

    const existing = scores.get(signature.category);
    const confidence = Math.min(0.99, (existing?.confidence ?? 0) + signature.weight);
    if (!existing || signature.weight >= existing.signature.weight) {
      scores.set(signature.category, { confidence, signature });
    } else {
      existing.confidence = confidence;
    }

    if (evidence.length < 6) {
      evidence.push(...extractEvidence(output ?? haystack, signature.pattern, 2));
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1].confidence - a[1].confidence);
  const top = ranked[0];

  if (!top) {
    return {
      jobId: job.jobId,
      jobName: job.name,
      folder: job.folder,
      status: job.status,
      category: 'UNKNOWN',
      confidence: 0,
      likelyCause: 'No known failure signature matched the job output.',
      recommendedActions: [
        'Retrieve the full output with get_job_output and inspect the last 50 lines.',
        'Check the Control-M log for the job with get_job_output kind="log".',
        'Verify the agent health with agent_health_report for the execution host.',
      ],
      secondaryCategories: [],
      evidence: (output ?? '').split(/\r?\n/).filter(Boolean).slice(-5).map((line) => line.trim().slice(0, 300)),
    };
  }

  return {
    jobId: job.jobId,
    jobName: job.name,
    folder: job.folder,
    status: job.status,
    host: typeof job.host === 'string' ? job.host : undefined,
    category: top[0],
    confidence: Number(top[1].confidence.toFixed(2)),
    likelyCause: top[1].signature.likelyCause,
    recommendedActions: top[1].signature.recommendedActions,
    secondaryCategories: ranked.slice(1, 4).map(([category, value]) => ({
      category,
      confidence: Number(value.confidence.toFixed(2)),
    })),
    evidence: [...new Set(evidence)].slice(0, 6),
  };
}

export interface FailureAnalysisSummary {
  analyzedJobs: number;
  byCategory: Array<{ category: FailureCategory; count: number; jobs: string[] }>;
  dominantCategory: FailureCategory | undefined;
  /** De-duplicated, priority-ordered action list across all analyzed failures. */
  consolidatedActions: string[];
  failures: AnalyzedFailure[];
}

/** Aggregates many single-job analyses into one actionable picture. */
export function summarizeFailures(failures: AnalyzedFailure[]): FailureAnalysisSummary {
  const buckets = new Map<FailureCategory, string[]>();
  for (const failure of failures) {
    const list = buckets.get(failure.category) ?? [];
    list.push(failure.jobName ?? failure.jobId ?? 'unknown');
    buckets.set(failure.category, list);
  }

  const byCategory = [...buckets.entries()]
    .map(([category, jobs]) => ({ category, count: jobs.length, jobs }))
    .sort((a, b) => b.count - a.count);

  const consolidatedActions: string[] = [];
  for (const failure of [...failures].sort((a, b) => b.confidence - a.confidence)) {
    for (const action of failure.recommendedActions) {
      if (!consolidatedActions.includes(action)) consolidatedActions.push(action);
    }
  }

  return {
    analyzedJobs: failures.length,
    byCategory,
    dominantCategory: byCategory[0]?.category,
    consolidatedActions: consolidatedActions.slice(0, 10),
    failures,
  };
}
