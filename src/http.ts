import { readFileSync } from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { AppConfig } from './config.js';
import {
  ControlMError,
  codeForStatus,
  isRetryableStatus,
  type ControlMErrorCode,
} from './errors.js';
import type { Logger } from './logger.js';

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/** Returns an https.Agent, or an HTTPS proxy agent when CONTROLM_PROXY_URL is set. */
export function createHttpsAgent(config: AppConfig): http.Agent {
  const ca = config.tls.caCertPath ? readFileSync(config.tls.caCertPath) : undefined;

  if (config.http.proxyUrl) {
    return new HttpsProxyAgent(config.http.proxyUrl, {
      rejectUnauthorized: config.tls.rejectUnauthorized,
      ca,
      keepAlive: true,
    });
  }

  return new https.Agent({
    rejectUnauthorized: config.tls.rejectUnauthorized,
    ca,
    keepAlive: true,
    maxSockets: 32,
  });
}

/** Bare axios instance: no auth, no retry. Used by the auth manager and the client core. */
export function createBaseAxios(config: AppConfig): AxiosInstance {
  return axios.create({
    baseURL: config.baseUrl,
    timeout: config.http.timeoutMs,
    httpsAgent: createHttpsAgent(config),
    httpAgent: new http.Agent({ keepAlive: true }),
    maxRedirects: 0,
    // Control-M can return large job outputs; keep a sane ceiling.
    maxContentLength: 64 * 1024 * 1024,
    maxBodyLength: 64 * 1024 * 1024,
    validateStatus: (status) => status >= 200 && status < 300,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'controlm-mcp/1.0 (+modelcontextprotocol)',
    },
  });
}

function networkErrorCode(error: AxiosError): ControlMErrorCode {
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return 'TIMEOUT';
  return 'NETWORK_ERROR';
}

function extractMessage(status: number, body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
    if (Array.isArray(record.errors) && record.errors.length > 0) {
      const first = record.errors[0] as Record<string, unknown> | undefined;
      if (first && typeof first.message === 'string') return first.message;
    }
    if (typeof record.error === 'string' && record.error.trim()) return record.error;
  }
  if (typeof body === 'string' && body.trim()) return body.slice(0, 500);
  return `${fallback} (HTTP ${status})`;
}

export function normalizeAxiosError(error: unknown, operation: string): ControlMError {
  if (error instanceof ControlMError) return error;

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    const method = axiosError.config?.method?.toUpperCase();
    const url = axiosError.config?.url;
    const requestId =
      (axiosError.response?.headers?.['x-request-id'] as string | undefined) ?? undefined;

    if (axiosError.response) {
      const status = axiosError.response.status;
      return new ControlMError(
        extractMessage(status, axiosError.response.data, `Control-M request failed`),
        {
          code: codeForStatus(status),
          status,
          operation,
          method,
          url,
          requestId,
          retryable: isRetryableStatus(status),
          body: axiosError.response.data,
          cause: axiosError,
        },
      );
    }

    return new ControlMError(axiosError.message || 'Control-M request failed', {
      code: networkErrorCode(axiosError),
      operation,
      method,
      url,
      retryable: true,
      cause: axiosError,
    });
  }

  if (error instanceof Error) {
    return new ControlMError(error.message, { code: 'UNKNOWN', operation, cause: error });
  }
  return new ControlMError(String(error), { code: 'UNKNOWN', operation });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Full jitter exponential backoff, honouring Retry-After when the server supplies it. */
function computeDelay(attempt: number, policy: RetryPolicy, retryAfterHeader?: string): number {
  if (retryAfterHeader) {
    const seconds = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, policy.maxDelayMs);
    }
  }
  const exponential = Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs);
  return Math.floor(Math.random() * exponential);
}

export interface RetryContext {
  operation: string;
  logger: Logger;
  policy: RetryPolicy;
  /** Methods considered safe to replay. POST is opt-in per call site. */
  idempotent: boolean;
}

export async function requestWithRetry<T>(
  client: AxiosInstance,
  requestConfig: AxiosRequestConfig,
  context: RetryContext,
): Promise<T> {
  const { policy, logger, operation } = context;
  let lastError: ControlMError | undefined;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt += 1) {
    try {
      const started = Date.now();
      const response = await client.request<T>(requestConfig);
      logger.debug('http.success', {
        operation,
        method: requestConfig.method,
        url: requestConfig.url,
        status: response.status,
        durationMs: Date.now() - started,
        attempt,
      });
      return response.data;
    } catch (rawError) {
      const error = normalizeAxiosError(rawError, operation);
      lastError = error;

      const canRetry =
        attempt < policy.maxRetries &&
        error.retryable &&
        (context.idempotent || error.code === 'RATE_LIMITED' || error.code === 'NETWORK_ERROR');

      logger.warn('http.failure', {
        operation,
        method: requestConfig.method,
        url: requestConfig.url,
        status: error.status,
        code: error.code,
        attempt,
        willRetry: canRetry,
        message: error.message,
      });

      if (!canRetry) throw error;

      const retryAfter = (rawError as AxiosError)?.response?.headers?.['retry-after'] as
        | string
        | undefined;
      await sleep(computeDelay(attempt, policy, retryAfter));
    }
  }

  throw lastError ?? new ControlMError('Request failed', { code: 'UNKNOWN', operation });
}
