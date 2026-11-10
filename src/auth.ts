import type { AxiosInstance } from 'axios';
import type { AppConfig } from './config.js';
import { ControlMError } from './errors.js';
import { normalizeAxiosError, requestWithRetry } from './http.js';
import type { Logger } from './logger.js';
import type { LoginResponse, MessageResponse } from './types.js';

export interface SessionState {
  authenticated: boolean;
  username?: string;
  source: 'static-token' | 'login' | 'none';
  issuedAt?: string;
  expiresAt?: string;
  secondsRemaining?: number;
}

interface TokenRecord {
  token: string;
  issuedAtMs: number;
  expiresAtMs: number;
  source: 'static-token' | 'login';
  username?: string;
}

/**
 * Owns the Control-M session token lifecycle:
 * login, proactive refresh, 401-driven re-authentication and logout.
 *
 * Concurrent callers share a single in-flight login promise so a burst of tool
 * calls never produces a storm of /session/login requests.
 */
export class AuthManager {
  private record?: TokenRecord;
  private inFlight?: Promise<string>;

  constructor(
    private readonly http: AxiosInstance,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    if (config.staticToken) {
      const now = Date.now();
      this.record = {
        token: config.staticToken,
        issuedAtMs: now,
        expiresAtMs: now + config.token.ttlSeconds * 1_000,
        source: 'static-token',
        username: config.username,
      };
    }
  }

  get hasCredentials(): boolean {
    return Boolean(this.config.username && this.config.password);
  }

  /** Returns a usable token, logging in or refreshing when required. */
  async getToken(): Promise<string> {
    if (this.record && !this.isStale(this.record)) {
      return this.record.token;
    }

    if (this.record?.source === 'static-token' && !this.hasCredentials) {
      // Nothing to refresh with; keep using the supplied token.
      return this.record.token;
    }

    return this.login();
  }

  /** Forces a new session, discarding any cached token. */
  async login(): Promise<string> {
    if (this.inFlight) return this.inFlight;

    if (!this.hasCredentials) {
      if (this.record) return this.record.token;
      throw new ControlMError(
        'No Control-M credentials configured. Set CONTROLM_USERNAME/CONTROLM_PASSWORD or CONTROLM_TOKEN.',
        { code: 'CONFIG_ERROR', operation: 'login' },
      );
    }

    this.inFlight = this.performLogin().finally(() => {
      this.inFlight = undefined;
    });

    return this.inFlight;
  }

  private async performLogin(): Promise<string> {
    const started = Date.now();
    try {
      const data = await requestWithRetry<LoginResponse>(
        this.http,
        {
          method: 'POST',
          url: '/session/login',
          data: { username: this.config.username, password: this.config.password },
          headers: { 'Content-Type': 'application/json' },
        },
        {
          operation: 'session.login',
          logger: this.logger,
          policy: {
            maxRetries: this.config.http.maxRetries,
            baseDelayMs: this.config.http.retryBaseDelayMs,
            maxDelayMs: this.config.http.retryMaxDelayMs,
          },
          idempotent: true,
        },
      );

      if (!data?.token) {
        throw new ControlMError('Control-M login response did not contain a token.', {
          code: 'AUTH_ERROR',
          operation: 'session.login',
        });
      }

      const now = Date.now();
      const ttlSeconds = data.expiresIn && data.expiresIn > 0 ? data.expiresIn : this.config.token.ttlSeconds;

      this.record = {
        token: data.token,
        issuedAtMs: now,
        expiresAtMs: now + ttlSeconds * 1_000,
        source: 'login',
        username: data.username ?? this.config.username,
      };

      this.logger.info('session.login.success', {
        username: this.record.username,
        ttlSeconds,
        durationMs: now - started,
      });

      return this.record.token;
    } catch (error) {
      this.record = undefined;
      const normalized = normalizeAxiosError(error, 'session.login');
      this.logger.error('session.login.failure', {
        code: normalized.code,
        status: normalized.status,
        message: normalized.message,
      });
      throw normalized;
    }
  }

  /** Re-authenticates after a 401. Returns the fresh token. */
  async refresh(): Promise<string> {
    this.logger.info('session.refresh');
    this.record = undefined;
    return this.login();
  }

  async logout(): Promise<MessageResponse> {
    const token = this.record?.token;
    this.record = undefined;

    if (!token) {
      return { message: 'No active Control-M session.' };
    }

    try {
      const data = await requestWithRetry<MessageResponse>(
        this.http,
        {
          method: 'POST',
          url: '/session/logout',
          headers: { Authorization: `Bearer ${token}` },
        },
        {
          operation: 'session.logout',
          logger: this.logger,
          policy: {
            maxRetries: 1,
            baseDelayMs: this.config.http.retryBaseDelayMs,
            maxDelayMs: this.config.http.retryMaxDelayMs,
          },
          idempotent: true,
        },
      );
      this.logger.info('session.logout.success');
      return data ?? { message: 'Logged out.' };
    } catch (error) {
      const normalized = normalizeAxiosError(error, 'session.logout');
      // The local session is already discarded; a server-side failure is non-fatal.
      this.logger.warn('session.logout.failure', {
        code: normalized.code,
        message: normalized.message,
      });
      return { message: `Local session cleared; server logout failed: ${normalized.message}` };
    }
  }

  /** Discards the cached token without contacting the server. */
  invalidate(): void {
    this.record = undefined;
  }

  state(): SessionState {
    if (!this.record) {
      return { authenticated: false, source: 'none' };
    }
    return {
      authenticated: true,
      username: this.record.username,
      source: this.record.source,
      issuedAt: new Date(this.record.issuedAtMs).toISOString(),
      expiresAt: new Date(this.record.expiresAtMs).toISOString(),
      secondsRemaining: Math.max(0, Math.round((this.record.expiresAtMs - Date.now()) / 1_000)),
    };
  }

  private isStale(record: TokenRecord): boolean {
    const skewMs = this.config.token.refreshSkewSeconds * 1_000;
    return Date.now() >= record.expiresAtMs - skewMs;
  }
}
