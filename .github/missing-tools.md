# Control-M MCP Enhancement Specification

## Purpose

Enhance the current Control-M MCP Agent by implementing missing Automation API capabilities that exist in the Control-M Automation API specification but are not currently exposed as MCP tools.

## Implementation Status for the Attached 9.22.40 API YAML

The attached `.github/OpenAPI-YAML.yaml` is a Swagger 2.0 document containing 347 operations. The server's OpenAPI tool generator supports this format, so operations in that document are exposed automatically as MCP tools. Selected operation IDs use the readable names suggested below; other operations use the configured `ctm_` prefix.

All generated non-read operations require `_confirm: true`. Tool responses redact password, token, and secret-value fields.

Of the 56 operation IDs in this enhancement list, 41 are present under their listed IDs. The following 15 are not defined in the attached YAML and must not be presented as dedicated API operations without another verified API contract:

| Requested operation | Status in 9.22.40 YAML | Available alternative or limitation |
|---|---|---|
| `buildConnectionProfile` | Not present | Use the generic definitions-file build API where applicable. |
| `deployConnectionProfile` | Not present | Use the generic definitions-file deploy API where applicable. |
| `deleteAiJobtype` | Not present | No equivalent operation is documented. |
| `deployCalendar` | Not present | Use the generic definitions-file deploy API where applicable. |
| `setSiteStandardPolicies` | Not present | `deploySiteStandardPolicies` is available for deploying policy definitions. |
| `getForecastStatus` | Not present | No equivalent forecast-ID status operation is documented in this YAML. |
| `deleteForecast` | Not present | No forecast-delete operation is documented. |
| `getDeployDescriptors` | Not present | No deploy-descriptor listing operation is documented. |
| `getDeploymentHistory` | Not present | No deployment-history operation is documented. |
| `deleteDeploymentArtifact` | Not present | No deployment-artifact deletion operation is documented. |
| `downloadReport` | Different operation ID | `downloadReportByName` is available and exposed as `download_report`. |
| `deleteReport` | Not present | No report-delete operation is documented. |
| `getReportDefinitions` | Not present | `getReportByName` retrieves a single report by name; it is not a definitions-list operation. |
| `createSecret` | Different operation ID | `addSecret` is available and exposed as `create_secret`. |
| `getSecretByName` | Not present | The spec lists secret names but does not document retrieval of a secret value by name. |

---

# Current State

The following tool groups are already implemented.

## Authentication

```text
controlm_login
controlm_logout
controlm_refresh_token
controlm_session_status
ctm_login
ctm_logout
```

## Environment & Agents

```text
environment_summary
health_check_workflow
agent_health_report
agent_inventory
list_agents
add_agent
delete_agent
ping_agent
test_agent
remediate_agent
install_and_validate_agent
upgrade_agent
upgrade_fleet
ctm_get_agents
ctm_add_agent
ctm_delete_agent
ctm_ping_agent
ctm_test_agent
```

## Workload Management

```text
list_active_jobs
get_job_status
get_job_output
run_job
run_and_monitor_job
order_folder
hold_job
free_job
kill_job
rerun_job
ctm_get_job_status
ctm_get_run_status
ctm_run_job
ctm_order_folder
ctm_hold_job
ctm_free_job
ctm_kill_job
ctm_rerun_job
```

## Provisioning

```text
provision_install_agent
provision_upgrade_agent
provision_uninstall_agent
provision_status
ctm_provision_install_agent
ctm_provision_upgrade_agent
ctm_provision_uninstall_agent
ctm_provision_status
ctm_provision_list_images
```

## Build & Deploy

```text
build
ctm_build
deploy
ctm_deploy
deploy_application
deploy_status
repository_management
```

## Forecast

```text
forecast_application
get_forecast
poll_forecast
ctm_create_forecast
ctm_get_forecast_by_id
```

## Diagnostics & Reports

```text
collect_diagnostics
list_alerts
update_alerts
generate_report
list_reports
report_status
run_report
```

## Security & Administration

```text
manage_users
manage_roles
manage_secrets
ctm_get_users
ctm_get_roles
ctm_get_secrets
ctm_get_servers
ctm_describe_api
```

---

# Required New MCP Tools

## 1. API Token Management

### Automation API Operations

```text
createToken
updateToken
deleteToken
getTokenData
getTokenList
updateMyPassword
```

### Suggested MCP Tool Names

```text
create_api_token
update_api_token
delete_api_token
get_api_token
list_api_tokens
update_user_password
```

**Priority:** HIGH

---

## 2. Connection Profile Management

### Automation API Operations

```text
getLocalConnectionProfiles
getSharedConnectionProfiles
getDeployedConnectionProfilesStatus
testConnectionProfile
deleteLocalConnectionProfile
deleteSharedConnectionProfile
buildConnectionProfile
deployConnectionProfile
```

### Suggested MCP Tool Names

```text
list_local_connection_profiles
list_shared_connection_profiles
get_connection_profile_status
test_connection_profile
delete_local_connection_profile
delete_shared_connection_profile
build_connection_profile
deploy_connection_profile
```

**Priority:** HIGH

---

## 3. AI JobType Operations

### Automation API Operations

```text
deployAiJobtype
deleteAiJobtype
getDeployedAiJobtypes
```

### Suggested MCP Tool Names

```text
deploy_ai_jobtype
delete_ai_jobtype
list_ai_jobtypes
```

**Priority:** HIGH

---

## 4. Folder Management

### Automation API Operations

```text
getDeployedFolders
getDeployedFoldersNew
deleteFolder
```

### Suggested MCP Tool Names

```text
list_deployed_folders
get_folder_details
delete_folder
```

**Priority:** HIGH

---

## 5. Calendar Management

### Automation API Operations

```text
getDeployedCalendars
deployCalendar
deleteCalendar
```

### Suggested MCP Tool Names

```text
list_calendars
deploy_calendar
delete_calendar
```

**Priority:** HIGH

---

## 6. Archive Services

### Automation API Operations

```text
searchJobs
getArchiveJobLog
getArchiveJobOutput
```

### Suggested MCP Tool Names

```text
search_archive_jobs
get_archive_job_log
get_archive_job_output
```

**Priority:** HIGH

### Business Justification

Archive retrieval and historical job analysis are critical operational capabilities and are currently unavailable through the MCP layer.

---

## 7. Advanced Monitoring Actions

### Automation API Operations

```text
runNow
confirmJob
setToOK
deleteJob
undeleteJob
getActiveJob
getWaitingInfo
```

### Suggested MCP Tool Names

```text
run_job_now
confirm_job
set_job_ok
delete_active_job
undelete_job
get_active_job
get_waiting_info
```

**Priority:** HIGH

---

## 8. Site Standards Management

### Automation API Operations

```text
getSiteStandardFieldRestrictions
setSiteStandardFieldRestrictions
getSiteStandardPolicies
setSiteStandardPolicies
```

### Suggested MCP Tool Names

```text
get_site_standard_restrictions
set_site_standard_restrictions
get_site_standard_policies
set_site_standard_policies
```

**Priority:** MEDIUM

---

## 9. Agent Upgrade Activity Tracking

### Automation API Operations

```text
getEligibleAgentsForUpgrade
getUpgradeActivityStatusPerUpgradeId
getUpgradeActivityLog
retryUpgradeActivity
cancelUpgradeActivity
deleteUpgradeActivity
```

### Suggested MCP Tool Names

```text
get_upgrade_candidates
get_upgrade_status
get_upgrade_log
retry_upgrade
cancel_upgrade
delete_upgrade_activity
```

**Priority:** HIGH

---

## 10. Forecast Lifecycle Operations

### Automation API Operations

```text
getForecastStatus
deleteForecast
```

### Suggested MCP Tool Names

```text
get_forecast_status
delete_forecast
```

**Priority:** MEDIUM

---

## 11. Deployment History & Repository Operations

### Automation API Operations

```text
getDeployDescriptors
getDeploymentHistory
deleteDeploymentArtifact
```

### Suggested MCP Tool Names

```text
get_deploy_descriptors
get_deployment_history
delete_deployment_artifact
```

**Priority:** MEDIUM

---

## 12. Report Management Extensions

### Automation API Operations

```text
downloadReport
deleteReport
getReportDefinitions
```

### Suggested MCP Tool Names

```text
download_report
delete_report
list_report_definitions
```

**Priority:** MEDIUM

---

## 13. File Transformation Services

### Automation API Operations

```text
transformFile
```

### Suggested MCP Tool Name

```text
transform_file
```

**Priority:** LOW

---

## 14. Secret Lifecycle Operations

### Automation API Operations

```text
createSecret
updateSecret
deleteSecret
getSecretByName
```

### Suggested MCP Tool Names

```text
create_secret
update_secret
delete_secret
get_secret
```

**Priority:** HIGH

---

# Recommended Implementation Roadmap

## Phase 1 (Highest Business Value)

```text
Connection Profiles
Archive Services
Advanced Monitoring
AI JobTypes
Folder Management
Calendar Management
```

### Deliverables

- Full Connection Profile lifecycle
- Archive Job Search and Retrieval
- Advanced Job Monitoring Actions
- AI JobType deployment support
- Folder lifecycle operations
- Calendar lifecycle operations

---

## Phase 2

```text
API Token Management
Secret Management
Upgrade Activity Tracking
```

### Deliverables

- Token lifecycle support
- Secret lifecycle support
- Agent upgrade tracking and management

---

## Phase 3

```text
Deployment History
Forecast Lifecycle
Site Standards
Enhanced Reporting
```

### Deliverables

- Deployment audit capabilities
- Forecast lifecycle controls
- Site Standard administration
- Extended report management

---

## Phase 4

```text
Transform File
Optional Utility APIs
Future Enhancements
```

---

# Functional Gaps Covered

| Capability Area | Current Status | After Enhancement |
|-----------------|---------------|-------------------|
| Connection Profiles | Partial | Complete |
| AI JobTypes | Missing | Complete |
| Folder Lifecycle | Partial | Complete |
| Calendar Lifecycle | Partial | Complete |
| Archive Services | Missing | Complete |
| Monitoring Actions | Partial | Complete |
| Site Standards | Missing | Complete |
| Upgrade Tracking | Partial | Complete |
| Token Management | Missing | Complete |
| Secret Management | Partial | Complete |
| Deployment History | Missing | Complete |
| Reporting Extensions | Partial | Complete |
| File Transformation | Missing | Complete |

---

# Expected Outcome

Upon completion, the MCP Server should provide near-complete coverage of the Control-M Automation API and support:

- Full Connection Profile lifecycle management
- Full Folder lifecycle management
- Full Calendar lifecycle management
- AI JobType deployment and administration
- Archive Job Search, Log Retrieval, and Output Retrieval
- Advanced Monitoring Operations
- Agent Upgrade Activity Management
- API Token Management
- Secret Lifecycle Management
- Deployment History and Audit Tracking
- Site Standards Administration
- Enhanced Reporting Services

This enhancement package closes the major functional gaps between the current MCP tool inventory and the available Control-M Automation API capabilities.