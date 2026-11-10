import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const boolish = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return defaultValue;
      return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    });

const intish = (defaultValue: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return defaultValue;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : defaultValue;
    })
    .pipe(z.number().int().min(min).max(max));

const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

const EnvSchema = z.object({
  CONTROLM_BASE_URL: z.string().url('CONTROLM_BASE_URL must be a valid URL'),
  CONTROLM_USERNAME: z.string().optional(),
  CONTROLM_PASSWORD: z.string().optional(),
  CONTROLM_TOKEN: z.string().optional(),

  CONTROLM_TLS_REJECT_UNAUTHORIZED: boolish(true),
  CONTROLM_CA_CERT_PATH: z.string().optional(),

  CONTROLM_TIMEOUT_MS: intish(60_000, 1_000, 600_000),
  CONTROLM_MAX_RETRIES: intish(3, 0, 10),
  CONTROLM_RETRY_BASE_DELAY_MS: intish(500, 0, 60_000),
  CONTROLM_RETRY_MAX_DELAY_MS: intish(8_000, 0, 120_000),
  CONTROLM_PROXY_URL: z.string().optional(),

  CONTROLM_TOKEN_TTL_SECONDS: intish(1_800, 60, 86_400),
  CONTROLM_TOKEN_REFRESH_SKEW_SECONDS: intish(120, 0, 3_600),

  CONTROLM_OPENAPI_PATH: z.string().optional(),
  CONTROLM_OPENAPI_URL: z.string().optional(),
  CONTROLM_ENABLE_OPENAPI_TOOLS: boolish(true),
  CONTROLM_OPENAPI_INCLUDE: csv,
  CONTROLM_OPENAPI_EXCLUDE: csv,
  CONTROLM_OPENAPI_MAX_TOOLS: intish(400, 1, 5_000),
  CONTROLM_OPENAPI_TOOL_PREFIX: z.string().optional().default('ctm_'),

  CONTROLM_READ_ONLY: boolish(true),
  CONTROLM_ALLOW_REMEDIATION: boolish(false),

  CONTROLM_FLEET_BATCH_SIZE: intish(5, 1, 50),
  CONTROLM_FLEET_MAX_HOSTS: intish(50, 1, 500),
  CONTROLM_FLEET_ABORT_FAILURE_RATE: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = Number.parseFloat(value ?? '');
      return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.25;
    }),
  CONTROLM_ALERT_LIMIT: intish(200, 1, 1_000),
  CONTROLM_JOB_MONITOR_TIMEOUT_SECONDS: intish(1_800, 30, 21_600),
  CONTROLM_HEALTH_PROBE_CONCURRENCY: intish(6, 1, 32),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug', 'trace']).optional().default('info'),
  LOG_PRETTY: boolish(false),
});

export type LogLevel = z.infer<typeof EnvSchema>['LOG_LEVEL'];

export interface AppConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  staticToken?: string;
  tls: {
    rejectUnauthorized: boolean;
    caCertPath?: string;
  };
  http: {
    timeoutMs: number;
    maxRetries: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
    proxyUrl?: string;
  };
  token: {
    ttlSeconds: number;
    refreshSkewSeconds: number;
  };
  openapi: {
    enabled: boolean;
    path?: string;
    url?: string;
    include: string[];
    exclude: string[];
    maxTools: number;
    toolPrefix: string;
  };
  safety: {
    readOnly: boolean;
    allowRemediation: boolean;
  };
  workflows: {
    fleetBatchSize: number;
    fleetMaxHosts: number;
    fleetAbortFailureRate: number;
    alertLimit: number;
    jobMonitorTimeoutSeconds: number;
    healthProbeConcurrency: number;
  };
  logging: {
    level: LogLevel;
    pretty: boolean;
  };
}

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cached) return cached;

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }

  const env = parsed.data;

  if (!env.CONTROLM_TOKEN && !(env.CONTROLM_USERNAME && env.CONTROLM_PASSWORD)) {
    throw new Error(
      'Invalid configuration: provide CONTROLM_TOKEN, or both CONTROLM_USERNAME and CONTROLM_PASSWORD.',
    );
  }

  cached = {
    baseUrl: normalizeBaseUrl(env.CONTROLM_BASE_URL),
    username: env.CONTROLM_USERNAME || undefined,
    password: env.CONTROLM_PASSWORD || undefined,
    staticToken: env.CONTROLM_TOKEN || undefined,
    tls: {
      rejectUnauthorized: env.CONTROLM_TLS_REJECT_UNAUTHORIZED,
      caCertPath: env.CONTROLM_CA_CERT_PATH || undefined,
    },
    http: {
      timeoutMs: env.CONTROLM_TIMEOUT_MS,
      maxRetries: env.CONTROLM_MAX_RETRIES,
      retryBaseDelayMs: env.CONTROLM_RETRY_BASE_DELAY_MS,
      retryMaxDelayMs: env.CONTROLM_RETRY_MAX_DELAY_MS,
      proxyUrl: env.CONTROLM_PROXY_URL || undefined,
    },
    token: {
      ttlSeconds: env.CONTROLM_TOKEN_TTL_SECONDS,
      refreshSkewSeconds: env.CONTROLM_TOKEN_REFRESH_SKEW_SECONDS,
    },
    openapi: {
      enabled: env.CONTROLM_ENABLE_OPENAPI_TOOLS,
      path: env.CONTROLM_OPENAPI_PATH || undefined,
      url: env.CONTROLM_OPENAPI_URL || undefined,
      include: env.CONTROLM_OPENAPI_INCLUDE,
      exclude: env.CONTROLM_OPENAPI_EXCLUDE,
      maxTools: env.CONTROLM_OPENAPI_MAX_TOOLS,
      toolPrefix: env.CONTROLM_OPENAPI_TOOL_PREFIX,
    },
    safety: {
      readOnly: env.CONTROLM_READ_ONLY,
      allowRemediation: env.CONTROLM_ALLOW_REMEDIATION,
    },
    workflows: {
      fleetBatchSize: env.CONTROLM_FLEET_BATCH_SIZE,
      fleetMaxHosts: env.CONTROLM_FLEET_MAX_HOSTS,
      fleetAbortFailureRate: env.CONTROLM_FLEET_ABORT_FAILURE_RATE,
      alertLimit: env.CONTROLM_ALERT_LIMIT,
      jobMonitorTimeoutSeconds: env.CONTROLM_JOB_MONITOR_TIMEOUT_SECONDS,
      healthProbeConcurrency: env.CONTROLM_HEALTH_PROBE_CONCURRENCY,
    },
    logging: {
      level: env.LOG_LEVEL,
      pretty: env.LOG_PRETTY,
    },
  };

  return cached;
}
