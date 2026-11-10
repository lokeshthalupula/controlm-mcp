import { Readable } from 'node:stream';
import type { AxiosInstance, AxiosRequestConfig, Method } from 'axios';
import FormData from 'form-data';
import { AuthManager, type SessionState } from './auth.js';
import type { AppConfig } from './config.js';
import { ControlMError } from './errors.js';
import { createBaseAxios, normalizeAxiosError, requestWithRetry, type RetryPolicy } from './http.js';
import type { Logger } from './logger.js';
import type {
  AddAgentRequest,
  Agent,
  AgentListResponse,
  Alert,
  AlertListResponse,
  DeployResultItem,
  ForecastResponse,
  JobStatus,
  MessageResponse,
  PingAgentResult,
  ProvisionInstallRequest,
  ProvisionOperationResponse,
  RepositoryPackage,
  ReportDefinition,
  ReportRunResponse,
  Role,
  RunJobRequest,
  RunResponse,
  RunStatusResponse,
  Secret,
  TestAgentResult,
  User,
} from './types.js';

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

const DESTRUCTIVE_HINTS = /(delete|remove|uninstall|kill|purge|drop|undeploy)/i;

export interface RequestOptions {
  method: Method;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Logical name used for logging and error reporting. */
  operation?: string;
  /** Force retry behaviour for non-idempotent verbs the API documents as safe. */
  retryable?: boolean;
  /** Multipart upload payload. */
  form?: FormData;
  responseType?: AxiosRequestConfig['responseType'];
  /** Bypasses the read-only guard for internally-generated safe calls. */
  allowInReadOnly?: boolean;
}

export interface MultipartFile {
  field: string;
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

/**
 * Reusable Control-M Automation API client.
 *
 * Responsibilities: token injection, transparent re-authentication on 401,
 * retry with backoff, read-only safety guard, structured logging and
 * normalized error translation. All domain helpers delegate to `request`.
 */
export class ControlMClient {
  readonly auth: AuthManager;
  private readonly http: AxiosInstance;
  private readonly logger: Logger;
  private readonly policy: RetryPolicy;

  constructor(
    private readonly config: AppConfig,
    logger: Logger,
  ) {
    this.logger = logger.child('client');
    this.http = createBaseAxios(config);
    this.auth = new AuthManager(createBaseAxios(config), config, logger.child('auth'));
    this.policy = {
      maxRetries: config.http.maxRetries,
      baseDelayMs: config.http.retryBaseDelayMs,
      maxDelayMs: config.http.retryMaxDelayMs,
    };
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  sessionState(): SessionState {
    return this.auth.state();
  }

  /** Core transport. Every other method in this class funnels through here. */
  async request<T = unknown>(options: RequestOptions): Promise<T> {
    const method = options.method.toUpperCase() as Method;
    const operation = options.operation ?? `${method} ${options.path}`;

    this.assertAllowed(method, options);

    const buildConfig = (token: string): AxiosRequestConfig => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      };

      let data: unknown = options.body;
      if (options.form) {
        data = options.form;
        Object.assign(headers, options.form.getHeaders());
      } else if (options.body !== undefined && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }

      return {
        method,
        url: normalizePath(options.path),
        params: pruneUndefined(options.query),
        data,
        headers,
        responseType: options.responseType,
      };
    };

    const idempotent = options.retryable ?? IDEMPOTENT_METHODS.has(method);
    const token = await this.auth.getToken();

    try {
      return await requestWithRetry<T>(this.http, buildConfig(token), {
        operation,
        logger: this.logger,
        policy: this.policy,
        idempotent,
      });
    } catch (error) {
      const normalized = normalizeAxiosError(error, operation);

      // A single transparent re-authentication attempt on session expiry.
      if (normalized.code === 'AUTH_ERROR') {
        this.logger.info('auth.reauthenticate', { operation });
        this.auth.invalidate();
        const freshToken = await this.auth.refresh();
        return requestWithRetry<T>(this.http, buildConfig(freshToken), {
          operation,
          logger: this.logger,
          policy: this.policy,
          idempotent,
        });
      }

      throw normalized;
    }
  }

  private assertAllowed(method: Method, options: RequestOptions): void {
    if (!this.config.safety.readOnly || options.allowInReadOnly) return;

    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const destructive = DESTRUCTIVE_HINTS.test(options.path) || method === 'DELETE';

    if (mutating || destructive) {
      throw new ControlMError(
        `Refused: server is running in read-only mode (CONTROLM_READ_ONLY=true). Blocked ${method} ${options.path}.`,
        { code: 'READ_ONLY', operation: options.operation, method: String(method), url: options.path },
      );
    }
  }

  static buildMultipart(files: MultipartFile[], fields: Record<string, string> = {}): FormData {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      form.append(key, value);
    }
    for (const file of files) {
      const buffer = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
      form.append(file.field, Readable.from(buffer), {
        filename: file.filename,
        contentType: file.contentType ?? 'application/octet-stream',
        knownLength: buffer.length,
      });
    }
    return form;
  }

  // ---------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------

  login(): Promise<string> {
    return this.auth.login();
  }

  logout(): Promise<MessageResponse> {
    return this.auth.logout();
  }

  refreshToken(): Promise<string> {
    return this.auth.refresh();
  }

  // ---------------------------------------------------------------------
  // Configuration / topology
  // ---------------------------------------------------------------------

  listServers(): Promise<unknown> {
    return this.request({ method: 'GET', path: '/config/servers', operation: 'config.listServers' });
  }

  async listAgents(server: string, limit?: number): Promise<Agent[]> {
    const data = await this.request<AgentListResponse | Agent[]>({
      method: 'GET',
      path: `/config/server/${encodeURIComponent(server)}/agents`,
      query: { limit },
      operation: 'config.listAgents',
    });
    const agents = Array.isArray(data) ? data : (data?.agents ?? []);
    return agents.map((agent) => ({ ...agent, ctmServer: agent.ctmServer ?? server }));
  }

  addAgent(server: string, payload: Omit<AddAgentRequest, 'server'>): Promise<MessageResponse> {
    return this.request({
      method: 'POST',
      path: `/config/server/${encodeURIComponent(server)}/agent`,
      body: { server, ...payload },
      operation: 'config.addAgent',
    });
  }

  deleteAgent(server: string, agent: string): Promise<MessageResponse> {
    return this.request({
      method: 'DELETE',
      path: `/config/server/${encodeURIComponent(server)}/agent/${encodeURIComponent(agent)}`,
      operation: 'config.deleteAgent',
    });
  }

  async pingAgent(server: string, agent: string): Promise<PingAgentResult> {
    try {
      const raw = await this.request<MessageResponse>({
        method: 'POST',
        path: `/config/server/${encodeURIComponent(server)}/agent/${encodeURIComponent(agent)}/ping`,
        body: {},
        operation: 'config.pingAgent',
        retryable: true,
      });
      return { nodeid: agent, server, reachable: true, message: raw?.message, raw };
    } catch (error) {
      const normalized = normalizeAxiosError(error, 'config.pingAgent');
      if (normalized.code === 'AUTH_ERROR' || normalized.code === 'FORBIDDEN') throw normalized;
      return { nodeid: agent, server, reachable: false, message: normalized.message, raw: normalized.toJSON() };
    }
  }

  async testAgent(server: string, agent: string): Promise<TestAgentResult> {
    try {
      const raw = await this.request<MessageResponse>({
        method: 'POST',
        path: `/config/server/${encodeURIComponent(server)}/agent/${encodeURIComponent(agent)}/test`,
        body: {},
        operation: 'config.testAgent',
        retryable: true,
      });
      return { nodeid: agent, server, passed: true, message: raw?.message, raw };
    } catch (error) {
      const normalized = normalizeAxiosError(error, 'config.testAgent');
      if (normalized.code === 'AUTH_ERROR' || normalized.code === 'FORBIDDEN') throw normalized;
      return { nodeid: agent, server, passed: false, message: normalized.message, raw: normalized.toJSON() };
    }
  }

  // ---------------------------------------------------------------------
  // Provisioning
  // ---------------------------------------------------------------------

  installAgent(payload: ProvisionInstallRequest): Promise<ProvisionOperationResponse> {
    return this.request({
      method: 'POST',
      path: '/provision/install/agent',
      body: payload,
      operation: 'provision.installAgent',
    });
  }

  upgradeAgent(payload: ProvisionInstallRequest): Promise<ProvisionOperationResponse> {
    return this.request({
      method: 'POST',
      path: '/provision/upgrade/agent',
      body: payload,
      operation: 'provision.upgradeAgent',
    });
  }

  uninstallAgent(payload: ProvisionInstallRequest): Promise<ProvisionOperationResponse> {
    return this.request({
      method: 'POST',
      path: '/provision/uninstall/agent',
      body: payload,
      operation: 'provision.uninstallAgent',
    });
  }

  getProvisionStatus(operationId: string): Promise<ProvisionOperationResponse> {
    return this.request({
      method: 'GET',
      path: `/provision/status/${encodeURIComponent(operationId)}`,
      operation: 'provision.status',
    });
  }

  listRepositoryPackages(os?: string): Promise<RepositoryPackage[] | unknown> {
    return this.request({
      method: 'GET',
      path: '/provision/images',
      query: { os },
      operation: 'provision.listImages',
    });
  }

  addRepositoryPackage(name: string, version: string, os: string): Promise<MessageResponse> {
    return this.request({
      method: 'POST',
      path: '/provision/image',
      body: { name, version, os },
      operation: 'provision.addImage',
    });
  }

  deleteRepositoryPackage(name: string): Promise<MessageResponse> {
    return this.request({
      method: 'DELETE',
      path: `/provision/image/${encodeURIComponent(name)}`,
      operation: 'provision.deleteImage',
    });
  }

  // ---------------------------------------------------------------------
  // Workload operations
  // ---------------------------------------------------------------------

  runJob(payload: RunJobRequest): Promise<RunResponse> {
    return this.request({
      method: 'POST',
      path: '/run',
      body: payload,
      operation: 'run.job',
    });
  }

  orderFolder(payload: Record<string, unknown>): Promise<RunResponse> {
    return this.request({
      method: 'POST',
      path: '/run/order',
      body: payload,
      operation: 'run.orderFolder',
    });
  }

  getRunStatus(runId: string): Promise<RunStatusResponse> {
    return this.request({
      method: 'GET',
      path: `/run/status/${encodeURIComponent(runId)}`,
      operation: 'run.status',
    });
  }

  getJobStatus(jobId: string): Promise<JobStatus> {
    return this.request({
      method: 'GET',
      path: `/run/job/${encodeURIComponent(jobId)}/status`,
      operation: 'run.jobStatus',
    });
  }

  rerunJob(jobId: string, body?: Record<string, unknown>): Promise<MessageResponse> {
    return this.request({
      method: 'POST',
      path: `/run/job/${encodeURIComponent(jobId)}/rerun`,
      body,
      operation: 'run.rerunJob',
    });
  }

  holdJob(jobId: string): Promise<MessageResponse> {
    return this.request({
      method: 'POST',
      path: `/run/job/${encodeURIComponent(jobId)}/hold`,
      operation: 'run.holdJob',
      retryable: true,
    });
  }

  freeJob(jobId: string): Promise<MessageResponse> {
    return this.request({
      method: 'POST',
      path: `/run/job/${encodeURIComponent(jobId)}/free`,
      operation: 'run.freeJob',
      retryable: true,
    });
  }

  killJob(jobId: string): Promise<MessageResponse> {
    return this.request({
      method: 'POST',
      path: `/run/job/${encodeURIComponent(jobId)}/kill`,
      operation: 'run.killJob',
    });
  }

  getJobOutput(jobId: string, runNo?: number): Promise<string> {
    return this.request<string>({
      method: 'GET',
      path: `/run/job/${encodeURIComponent(jobId)}/output${runNo ? `/${runNo}` : ''}`,
      operation: 'run.jobOutput',
      responseType: 'text',
    });
  }

  getJobLog(jobId: string): Promise<string> {
    return this.request<string>({
      method: 'GET',
      path: `/run/job/${encodeURIComponent(jobId)}/log`,
      operation: 'run.jobLog',
      responseType: 'text',
    });
  }

  /** Folder-level monitoring: GET /run/jobs/status supports folder/name/status filters. */
  listJobStatuses(query: {
    ctm?: string;
    folder?: string;
    jobname?: string;
    status?: string;
    limit?: number;
  }): Promise<RunStatusResponse> {
    return this.request({
      method: 'GET',
      path: '/run/jobs/status',
      query,
      operation: 'run.jobStatuses',
    });
  }

  listAlerts(query: {
    ctm?: string;
    server?: string;
    severity?: string;
    status?: string;
    jobname?: string;
    fromTime?: string;
    toTime?: string;
    limit?: number;
  }): Promise<AlertListResponse | Alert[]> {
    return this.request({
      method: 'GET',
      path: '/run/alerts',
      query,
      operation: 'run.listAlerts',
    });
  }

  updateAlerts(alertIds: Array<string | number>, status: string, comment?: string): Promise<MessageResponse> {
    return this.request({
      method: 'PUT',
      path: '/run/alerts',
      body: { alertIds, status, ...(comment ? { comment } : {}) },
      operation: 'run.updateAlerts',
    });
  }

  // ---------------------------------------------------------------------
  // Deploy / build
  // ---------------------------------------------------------------------

  build(files: MultipartFile[]): Promise<DeployResultItem[]> {
    return this.request({
      method: 'POST',
      path: '/build',
      form: ControlMClient.buildMultipart(files),
      operation: 'deploy.build',
    });
  }

  deploy(files: MultipartFile[], fields: Record<string, string> = {}): Promise<DeployResultItem[]> {
    return this.request({
      method: 'POST',
      path: '/deploy',
      form: ControlMClient.buildMultipart(files, fields),
      operation: 'deploy.deploy',
    });
  }

  getDeployStatus(deploymentId: string): Promise<unknown> {
    return this.request({
      method: 'GET',
      path: `/deploy/status/${encodeURIComponent(deploymentId)}`,
      operation: 'deploy.status',
    });
  }

  // ---------------------------------------------------------------------
  // Forecast
  // ---------------------------------------------------------------------

  createForecast(payload: Record<string, unknown>): Promise<ForecastResponse> {
    return this.request({
      method: 'POST',
      path: '/forecast',
      body: payload,
      operation: 'forecast.create',
    });
  }

  getForecast(forecastId: string): Promise<ForecastResponse> {
    return this.request({
      method: 'GET',
      path: `/forecast/${encodeURIComponent(forecastId)}`,
      operation: 'forecast.get',
    });
  }

  // ---------------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------------

  listReports(): Promise<ReportDefinition[] | unknown> {
    return this.request({ method: 'GET', path: '/reports', operation: 'reporting.listReports' });
  }

  runReport(name: string, format: string, parameters?: Record<string, unknown>): Promise<ReportRunResponse> {
    return this.request({
      method: 'POST',
      path: `/report/${encodeURIComponent(name)}/run`,
      query: { format },
      body: parameters,
      operation: 'reporting.runReport',
    });
  }

  getReportStatus(runId: string): Promise<ReportRunResponse> {
    return this.request({
      method: 'GET',
      path: `/report/status/${encodeURIComponent(runId)}`,
      operation: 'reporting.reportStatus',
    });
  }

  downloadReport(runId: string): Promise<string> {
    return this.request<string>({
      method: 'GET',
      path: `/report/${encodeURIComponent(runId)}/download`,
      operation: 'reporting.downloadReport',
      responseType: 'text',
    });
  }

  // ---------------------------------------------------------------------
  // Security
  // ---------------------------------------------------------------------

  listRoles(): Promise<Role[] | unknown> {
    return this.request({ method: 'GET', path: '/config/authorization/roles', operation: 'security.listRoles' });
  }

  getRole(name: string): Promise<Role> {
    return this.request({
      method: 'GET',
      path: `/config/authorization/role/${encodeURIComponent(name)}`,
      operation: 'security.getRole',
    });
  }

  upsertRole(role: Role, update: boolean): Promise<MessageResponse> {
    return this.request({
      method: update ? 'PUT' : 'POST',
      path: update
        ? `/config/authorization/role/${encodeURIComponent(role.name)}`
        : '/config/authorization/role',
      body: role,
      operation: update ? 'security.updateRole' : 'security.createRole',
    });
  }

  deleteRole(name: string): Promise<MessageResponse> {
    return this.request({
      method: 'DELETE',
      path: `/config/authorization/role/${encodeURIComponent(name)}`,
      operation: 'security.deleteRole',
    });
  }

  listUsers(): Promise<User[] | unknown> {
    return this.request({ method: 'GET', path: '/config/authentication/users', operation: 'security.listUsers' });
  }

  getUser(name: string): Promise<User> {
    return this.request({
      method: 'GET',
      path: `/config/authentication/user/${encodeURIComponent(name)}`,
      operation: 'security.getUser',
    });
  }

  upsertUser(user: User, update: boolean): Promise<MessageResponse> {
    return this.request({
      method: update ? 'PUT' : 'POST',
      path: update
        ? `/config/authentication/user/${encodeURIComponent(user.name)}`
        : '/config/authentication/user',
      body: user,
      operation: update ? 'security.updateUser' : 'security.createUser',
    });
  }

  deleteUser(name: string): Promise<MessageResponse> {
    return this.request({
      method: 'DELETE',
      path: `/config/authentication/user/${encodeURIComponent(name)}`,
      operation: 'security.deleteUser',
    });
  }

  listSecrets(): Promise<Secret[] | unknown> {
    return this.request({ method: 'GET', path: '/config/secrets', operation: 'security.listSecrets' });
  }

  setSecret(name: string, value: string): Promise<MessageResponse> {
    return this.request({
      method: 'POST',
      path: '/config/secret',
      body: { name, value },
      operation: 'security.setSecret',
    });
  }

  deleteSecret(name: string): Promise<MessageResponse> {
    return this.request({
      method: 'DELETE',
      path: `/config/secret/${encodeURIComponent(name)}`,
      operation: 'security.deleteSecret',
    });
  }
}

function normalizePath(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith('/') ? path : `/${path}`;
}

function pruneUndefined(input?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
