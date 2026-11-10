import type { LogLevel } from './config.js';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  error: 10,
  warn: 20,
  info: 30,
  debug: 40,
  trace: 50,
};

const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|authorization|auth|credential|apikey|api_key|x-api-key|private)/i;

const REDACTED = '[REDACTED]';

export type LogFields = Record<string, unknown>;

export interface LoggerOptions {
  level: LogLevel;
  pretty: boolean;
  name?: string;
  base?: LogFields;
}

/** Recursively removes secrets from arbitrary structures before they reach a log sink. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redact(entry, depth + 1));
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(entry, depth + 1);
    }
    return out;
  }

  if (typeof value === 'string' && value.length > 4_000) {
    return `${value.slice(0, 4_000)}…[truncated ${value.length - 4_000} chars]`;
  }

  return value;
}

/**
 * Structured logger writing NDJSON to stderr.
 * stdout is reserved for the MCP stdio transport and must never be polluted.
 */
export class Logger {
  private readonly level: LogLevel;
  private readonly pretty: boolean;
  private readonly name: string;
  private readonly base: LogFields;

  constructor(options: LoggerOptions) {
    this.level = options.level;
    this.pretty = options.pretty;
    this.name = options.name ?? 'controlm-mcp';
    this.base = options.base ?? {};
  }

  child(name: string, base: LogFields = {}): Logger {
    return new Logger({
      level: this.level,
      pretty: this.pretty,
      name: `${this.name}:${name}`,
      base: { ...this.base, ...base },
    });
  }

  error(message: string, fields?: LogFields): void {
    this.write('error', message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.write('warn', message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.write('info', message, fields);
  }

  debug(message: string, fields?: LogFields): void {
    this.write('debug', message, fields);
  }

  trace(message: string, fields?: LogFields): void {
    this.write('trace', message, fields);
  }

  private write(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_WEIGHT[level] > LEVEL_WEIGHT[this.level]) return;

    const record = {
      ts: new Date().toISOString(),
      level,
      logger: this.name,
      msg: message,
      ...(redact({ ...this.base, ...(fields ?? {}) }) as LogFields),
    };

    const line = this.pretty
      ? `${record.ts} ${level.toUpperCase().padEnd(5)} [${record.logger}] ${message} ${
          fields ? JSON.stringify(redact(fields)) : ''
        }`.trimEnd()
      : JSON.stringify(record);

    process.stderr.write(`${line}\n`);
  }
}

let rootLogger: Logger | undefined;

export function initLogger(level: LogLevel, pretty: boolean): Logger {
  rootLogger = new Logger({ level, pretty });
  return rootLogger;
}

export function getLogger(): Logger {
  if (!rootLogger) {
    rootLogger = new Logger({ level: 'info', pretty: false });
  }
  return rootLogger;
}
