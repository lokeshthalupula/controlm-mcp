/**
 * Control-M Automation API 9.22.x domain types.
 *
 * These mirror the shapes returned by the REST endpoints. `swagger-loader` can
 * emit a superset of these at build time (`npm run gen:types`); the handwritten
 * definitions below are the stable contract used by the first-class tools.
 */

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  username?: string;
  /** Present on some 9.22 fix packs. Seconds until expiry. */
  expiresIn?: number;
}

export interface MessageResponse {
  message?: string;
  errors?: Array<{ message?: string; code?: string }>;
  [key: string]: unknown;
}

export type AgentStatus = 'Available' | 'Unavailable' | 'Disabled' | 'Unknown' | string;

export interface Agent {
  nodeid: string;
  status?: AgentStatus;
  operatingSystem?: string;
  version?: string;
  hostgroups?: string[];
  ctmServer?: string;
  [key: string]: unknown;
}

export interface AgentListResponse {
  agents?: Agent[];
  [key: string]: unknown;
}

export interface AddAgentRequest {
  server: string;
  host: string;
  /** Optional provisioning hints accepted by 9.22 `POST /config/server/{server}/agent`. */
  port?: number;
  [key: string]: unknown;
}

export interface PingAgentResult {
  nodeid: string;
  server: string;
  reachable: boolean;
  message?: string;
  raw?: unknown;
}

export interface TestAgentResult {
  nodeid: string;
  server: string;
  passed: boolean;
  message?: string;
  raw?: unknown;
}

export interface ProvisionInstallRequest {
  /** Logical name of the Control-M/Server that will own the agent. */
  server: string;
  /** Target host where the agent binaries are installed. */
  host: string;
  /** Agent version from the provisioning repository, e.g. "9.0.21.200". */
  version?: string;
  /** Installation path on the target host. */
  installationPath?: string;
  /** Remote host user used by the deployment. */
  user?: string;
  port?: number;
  [key: string]: unknown;
}

export interface ProvisionOperationResponse {
  operationId?: string;
  /** Some fix packs return `requestId`. */
  requestId?: string;
  status?: string;
  message?: string;
  [key: string]: unknown;
}

export interface RepositoryPackage {
  name?: string;
  version?: string;
  os?: string;
  type?: string;
  [key: string]: unknown;
}

export interface RunJobRequest {
  server?: string;
  jobName?: string;
  folder?: string;
  ctm?: string;
  variables?: Array<Record<string, string>>;
  [key: string]: unknown;
}

export interface RunResponse {
  runId: string;
  statusURI?: string;
  monitorPageURI?: string;
  [key: string]: unknown;
}

export interface JobStatus {
  jobId: string;
  name?: string;
  folder?: string;
  status?: string;
  type?: string;
  held?: boolean;
  startTime?: string;
  endTime?: string;
  numberOfRuns?: number;
  outputURI?: string;
  logURI?: string;
  ctm?: string;
  [key: string]: unknown;
}

export interface RunStatusResponse {
  statuses?: JobStatus[];
  startIndex?: number;
  itemsPerPage?: number;
  total?: number;
  completed?: number;
  [key: string]: unknown;
}

export interface DeployResultItem {
  deploymentFile?: string;
  successfulFoldersCount?: number;
  successfulSmartFoldersCount?: number;
  successfulSubFoldersCount?: number;
  successfulJobsCount?: number;
  successfulConnectionProfilesCount?: number;
  successfulDriversCount?: number;
  isDeployDescriptorValid?: boolean;
  errors?: unknown[];
  warnings?: unknown[];
  [key: string]: unknown;
}

export interface Alert {
  alertId?: string | number;
  severity?: string;
  status?: string;
  message?: string;
  jobName?: string;
  runId?: string;
  server?: string;
  node?: string;
  component?: string;
  time?: string;
  [key: string]: unknown;
}

export interface AlertListResponse {
  alerts?: Alert[];
  returned?: number;
  total?: number;
  [key: string]: unknown;
}

export interface ReportDefinition {
  name?: string;
  description?: string;
  owner?: string;
  type?: string;
  [key: string]: unknown;
}

export interface ReportRunResponse {
  runId?: string;
  reportId?: string;
  status?: string;
  progress?: number;
  downloadURI?: string;
  [key: string]: unknown;
}

export interface ForecastRequest {
  /** Folder or service to forecast. */
  folder?: string;
  ctm?: string;
  from?: string;
  to?: string;
  [key: string]: unknown;
}

export interface ForecastResponse {
  forecastId?: string;
  status?: string;
  progress?: number;
  result?: unknown;
  [key: string]: unknown;
}

export interface Role {
  name: string;
  description?: string;
  members?: string[];
  authorizations?: unknown[];
  [key: string]: unknown;
}

export interface User {
  name: string;
  fullName?: string;
  email?: string;
  roles?: string[];
  [key: string]: unknown;
}

export interface Secret {
  name: string;
  value?: string;
  [key: string]: unknown;
}

export interface HealthReportEntry {
  nodeid: string;
  server: string;
  status?: AgentStatus;
  version?: string;
  reachable?: boolean;
  testPassed?: boolean;
  healthy: boolean;
  findings: string[];
}

export interface AgentHealthReport {
  generatedAt: string;
  serversScanned: string[];
  totalAgents: number;
  healthyAgents: number;
  unhealthyAgents: number;
  entries: HealthReportEntry[];
}

export interface EnvironmentSummary {
  generatedAt: string;
  servers: Array<{
    name: string;
    state?: string;
    hosts?: string[];
    agentCount: number;
    unavailableAgentCount: number;
  }>;
  totals: {
    servers: number;
    agents: number;
    unavailableAgents: number;
  };
  warnings: string[];
}
