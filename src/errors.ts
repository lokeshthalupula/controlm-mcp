export type ControlMErrorCode =
  | 'CONFIG_ERROR'
  | 'AUTH_ERROR'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'READ_ONLY'
  | 'OPENAPI_ERROR'
  | 'WORKFLOW_ERROR'
  | 'UNKNOWN';

export interface ControlMErrorDetails {
  code: ControlMErrorCode;
  status?: number;
  operation?: string;
  method?: string;
  url?: string;
  requestId?: string;
  retryable?: boolean;
  body?: unknown;
  cause?: unknown;
}

/** Normalized error surfaced to MCP clients. Never carries credentials. */
export class ControlMError extends Error {
  readonly code: ControlMErrorCode;
  readonly status?: number;
  readonly operation?: string;
  readonly method?: string;
  readonly url?: string;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly body?: unknown;

  constructor(message: string, details: ControlMErrorDetails) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = 'ControlMError';
    this.code = details.code;
    this.status = details.status;
    this.operation = details.operation;
    this.method = details.method;
    this.url = details.url;
    this.requestId = details.requestId;
    this.retryable = details.retryable ?? false;
    this.body = details.body;
  }

  toJSON(): Record<string, unknown> {
    return {
      error: true,
      code: this.code,
      message: this.message,
      status: this.status,
      operation: this.operation,
      method: this.method,
      url: this.url,
      requestId: this.requestId,
      retryable: this.retryable,
      details: this.body,
    };
  }
}

export function codeForStatus(status: number): ControlMErrorCode {
  if (status === 400 || status === 422) return 'VALIDATION_ERROR';
  if (status === 401) return 'AUTH_ERROR';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'UNKNOWN';
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

export function toControlMError(error: unknown, operation?: string): ControlMError {
  if (error instanceof ControlMError) return error;
  if (error instanceof Error) {
    return new ControlMError(error.message, { code: 'UNKNOWN', operation, cause: error });
  }
  return new ControlMError(String(error), { code: 'UNKNOWN', operation });
}
