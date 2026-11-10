# Control-M MCP tool inventory and agent assignments

**Snapshot date:** 2026-11-09  
**Registered tools:** 397  
**Workspace agent definitions audited:** 16  
**Registered tools assigned to at least one agent:** 394  
**Unassigned tools:** 3

## How this snapshot was collected

The list is from the local MCP server standard `tools/list` method, using the checked-in `.github/OpenAPI-YAML.yaml` and the compiled server. For inventory only, the server was started with a dummy token and unreachable loopback URL, with OpenAPI tools enabled and write-tool exposure enabled. No MCP operation was invoked and no Control-M API call or state change was made. This is the complete tool set exposed under that local full-capability configuration; the actual VS Code session can show fewer tools depending on its `.env`, read-only/remediation settings, OpenAPI filters, spec file, and server version. Refresh this snapshot after changing those.

## Agent assignment summary

| Agent | Assigned registered MCP tools |
|---|---:|
| Control-M Admin Operator ([definition](./agents/controlm-admin-operator.agent.md)) | 20 |
| Control-M Agent Lifecycle Operator ([definition](./agents/controlm-agent-lifecycle-operator.agent.md)) | 51 |
| Control-M Credentials and Secrets Operator ([definition](./agents/controlm-credentials-secrets-operator.agent.md)) | 16 |
| Control-M Integrations and Extensions Operator ([definition](./agents/controlm-integrations-extensions-operator.agent.md)) | 16 |
| Control-M Job Investigator ([definition](./agents/controlm-job-investigator.agent.md)) | 18 |
| Control-M Job Operator ([definition](./agents/controlm-job-operator.agent.md)) | 30 |
| Control-M MCP Maintainer ([definition](./agents/controlm-mcp-maintainer.agent.md)) | 0 |
| Control-M MFT Access Operator ([definition](./agents/controlm-mft-operator.agent.md)) | 41 |
| Control-M MFT Infrastructure Operator ([definition](./agents/controlm-mft-infrastructure-operator.agent.md)) | 32 |
| Control-M Operations Lead ([definition](./agents/controlm-operations-lead.agent.md)) | 6 |
| Control-M Platform Configuration Operator ([definition](./agents/controlm-platform-configuration-operator.agent.md)) | 52 |
| Control-M Platform Health Investigator ([definition](./agents/controlm-platform-health-investigator.agent.md)) | 35 |
| Control-M Reporting and Forecast Analyst ([definition](./agents/controlm-reporting-forecast-analyst.agent.md)) | 20 |
| Control-M Security and Identity Operator ([definition](./agents/controlm-security-identity-operator.agent.md)) | 52 |
| Control-M Workflow Deployment Operator ([definition](./agents/controlm-workflow-deployment-operator.agent.md)) | 42 |
| Control-M Workload Configuration Operator ([definition](./agents/controlm-workload-configuration-operator.agent.md)) | 39 |

The MCP Maintainer agent has no Control-M MCP tools. Assignments listed below come from explicit `controlm-mcp/<tool>` references in each workspace agent. Tools may intentionally be assigned to more than one agent.

## Registered tools

| Tool name | Assigned agent(s) |
|---|---|
| `add_agent` | Control-M Agent Lifecycle Operator |
| `agent_health_report` | Control-M Platform Health Investigator |
| `agent_inventory` | Control-M Platform Health Investigator |
| `build` | Control-M Workflow Deployment Operator |
| `cancel_upgrade` | Control-M Agent Lifecycle Operator |
| `collect_diagnostics` | Control-M Platform Health Investigator |
| `confirm_job` | Control-M Job Operator |
| `controlm_login` | Control-M Credentials and Secrets Operator |
| `controlm_logout` | Control-M Credentials and Secrets Operator |
| `controlm_refresh_token` | Control-M Credentials and Secrets Operator |
| `controlm_session_status` | Control-M Credentials and Secrets Operator |
| `create_api_token` | Control-M Credentials and Secrets Operator |
| `create_secret` | Control-M Credentials and Secrets Operator |
| `ctm_activate_workload_policy` | Control-M Workload Configuration Operator |
| `ctm_add_agent` | Control-M Admin Operator, Control-M Agent Lifecycle Operator |
| `ctm_add_agentless_host` | Control-M Admin Operator, Control-M Agent Lifecycle Operator |
| `ctm_add_archive_rule` | Control-M Workload Configuration Operator |
| `ctm_add_ctm_security_group` | Control-M Security and Identity Operator |
| `ctm_add_ctm_security_user` | Control-M Security and Identity Operator |
| `ctm_add_emcomponent` | Control-M Platform Configuration Operator |
| `ctm_add_event` | Control-M Workload Configuration Operator |
| `ctm_add_external_user` | Control-M Security and Identity Operator |
| `ctm_add_external_user_for_site` | Control-M MFT Access Operator |
| `ctm_add_external_user_or_user_group_to_mftfolder` | Control-M MFT Access Operator |
| `ctm_add_external_user_or_user_group_to_mftfolder_for_site` | Control-M MFT Access Operator |
| `ctm_add_external_user_to_mftuser_group_for_site` | Control-M MFT Access Operator |
| `ctm_add_gateway` | Control-M Platform Configuration Operator |
| `ctm_add_gateway_for_site` | Control-M MFT Infrastructure Operator |
| `ctm_add_host_restriction` | Control-M Workload Configuration Operator |
| `ctm_add_host_to_hostgroup` | Control-M Agent Lifecycle Operator, Control-M Workload Configuration Operator |
| `ctm_add_hub_to_cluster` | Control-M Platform Configuration Operator |
| `ctm_add_hub_to_cluster_for_site` | Control-M MFT Infrastructure Operator |
| `ctm_add_ldap_group_to_mftuser_group_for_site` | Control-M MFT Access Operator |
| `ctm_add_mft_user_group` | Control-M MFT Access Operator |
| `ctm_add_mft_user_group_for_site` | Control-M MFT Access Operator |
| `ctm_add_mftfolder` | Control-M MFT Access Operator |
| `ctm_add_mftfolder_for_site` | Control-M MFT Access Operator |
| `ctm_add_mftprocessing_rule_for_site` | Control-M MFT Access Operator |
| `ctm_add_pgp_template` | Control-M MFT Infrastructure Operator |
| `ctm_add_provision_repo` | Control-M Integrations and Extensions Operator |
| `ctm_add_remote_host` | Control-M Admin Operator, Control-M Agent Lifecycle Operator |
| `ctm_add_resource` | Control-M Workload Configuration Operator |
| `ctm_add_role` | Control-M Security and Identity Operator |
| `ctm_add_role_to_ldap_group` | Control-M Security and Identity Operator |
| `ctm_add_role_to_user` | Control-M Security and Identity Operator |
| `ctm_add_server` | Control-M Platform Configuration Operator |
| `ctm_add_ssh_key` | Control-M MFT Infrastructure Operator |
| `ctm_add_user` | Control-M Security and Identity Operator |
| `ctm_add_wdagateway` | Control-M Platform Configuration Operator |
| `ctm_add_workload_policies` | Control-M Workload Configuration Operator |
| `ctm_add_zos_template` | Control-M Workflow Deployment Operator |
| `ctm_authorize_mft_ssh_cluster` | Control-M MFT Infrastructure Operator |
| `ctm_authorize_mft_ssh_host` | Control-M MFT Infrastructure Operator |
| `ctm_authorize_ssh_known_agentlesshost` | Control-M Agent Lifecycle Operator |
| `ctm_authorize_ssh_known_remotehost` | Control-M MFT Infrastructure Operator |
| `ctm_build_file` | Control-M Workflow Deployment Operator |
| `ctm_bypass` | Control-M Job Operator |
| `ctm_change_user_password` | Control-M Security and Identity Operator |
| `ctm_create_agent_certificate_signing_request` | Control-M Agent Lifecycle Operator |
| `ctm_create_gateway` | Control-M MFT Infrastructure Operator, Control-M Platform Configuration Operator |
| `ctm_create_run_as_user` | Control-M Security and Identity Operator |
| `ctm_ctm_pause` | Control-M Platform Configuration Operator |
| `ctm_ctm_server_rename` | Control-M Platform Configuration Operator |
| `ctm_ctm_server_rename_preview` | Control-M Platform Configuration Operator |
| `ctm_database_to_sync_mode` | Control-M Platform Configuration Operator |
| `ctm_deactivate_workload_policy` | Control-M Workload Configuration Operator |
| `ctm_define_server` | Control-M Platform Configuration Operator |
| `ctm_delete_agent` | Control-M Admin Operator, Control-M Agent Lifecycle Operator |
| `ctm_delete_agentless_host` | Control-M Admin Operator, Control-M Agent Lifecycle Operator |
| `ctm_delete_archive_rule` | Control-M Workload Configuration Operator |
| `ctm_delete_authorization_role` | Control-M Security and Identity Operator |
| `ctm_delete_ctm_security_group` | Control-M Security and Identity Operator |
| `ctm_delete_ctm_security_user` | Control-M Security and Identity Operator |
| `ctm_delete_emcomponent` | Control-M Platform Configuration Operator |
| `ctm_delete_event` | Control-M Workload Configuration Operator |
| `ctm_delete_external_user` | Control-M Security and Identity Operator |
| `ctm_delete_external_user_for_site` | Control-M MFT Access Operator |
| `ctm_delete_external_user_from_mftuser_group_for_site` | Control-M MFT Access Operator |
| `ctm_delete_external_user_or_user_group_from_mftfolder` | Control-M MFT Access Operator |
| `ctm_delete_external_user_or_user_group_from_mftfolder_for_site` | Control-M MFT Access Operator |
| `ctm_delete_host_from_group` | Control-M Agent Lifecycle Operator, Control-M Workload Configuration Operator |
| `ctm_delete_host_group` | Control-M Workload Configuration Operator |
| `ctm_delete_host_restrictions` | Control-M Workload Configuration Operator |
| `ctm_delete_job_path` | Control-M Workflow Deployment Operator |
| `ctm_delete_ldap_group_from_mftuser_group_for_site` | Control-M MFT Access Operator |
| `ctm_delete_mft_user_group` | Control-M MFT Access Operator |
| `ctm_delete_mft_user_group_for_site` | Control-M MFT Access Operator |
| `ctm_delete_mftfolder` | Control-M MFT Access Operator |
| `ctm_delete_mftfolder_for_site` | Control-M MFT Access Operator |
| `ctm_delete_mftprocessing_rule_for_site` | Control-M MFT Access Operator |
| `ctm_delete_pgp_template` | Control-M MFT Infrastructure Operator |
| `ctm_delete_provision_repo` | Control-M Integrations and Extensions Operator |
| `ctm_delete_remote_host` | Control-M Admin Operator, Control-M Agent Lifecycle Operator |
| `ctm_delete_resource` | Control-M Workload Configuration Operator |
| `ctm_delete_role_from_ldap_group` | Control-M Security and Identity Operator |
| `ctm_delete_run_as_user` | Control-M Security and Identity Operator |
| `ctm_delete_site_standard` | Control-M Workflow Deployment Operator |
| `ctm_delete_site_standard_policy` | Control-M Workflow Deployment Operator |
| `ctm_delete_ssh_key` | Control-M MFT Infrastructure Operator |
| `ctm_delete_sub_folder` | Control-M Workflow Deployment Operator |
| `ctm_delete_user` | Control-M Security and Identity Operator |
| `ctm_delete_variables` | Control-M Workflow Deployment Operator |
| `ctm_delete_workload_policy` | Control-M Workload Configuration Operator |
| `ctm_delete_zos_template` | Control-M Workflow Deployment Operator |
| `ctm_deploy_agent_certificate` | Control-M Agent Lifecycle Operator |
| `ctm_deploy_file` | Control-M Workflow Deployment Operator |
| `ctm_deploy_jobtype_file` | Control-M Workflow Deployment Operator |
| `ctm_describe_api` | Control-M Integrations and Extensions Operator |
| `ctm_disable_agent` | Control-M Admin Operator, Control-M Agent Lifecycle Operator |
| `ctm_disable_agentless_host` | Control-M Admin Operator, Control-M Agent Lifecycle Operator |
| `ctm_disable_ctm_server` | Control-M Platform Configuration Operator |
| `ctm_disable_mft_processing_rule_for_site` | Control-M MFT Access Operator |
| `ctm_do_login` | Control-M Credentials and Secrets Operator |
| `ctm_do_logout` | Control-M Credentials and Secrets Operator |
| `ctm_em_db_check_space` | Control-M Platform Configuration Operator |
| `ctm_em_db_get_details` | Control-M Platform Configuration Operator |
| `ctm_enable_agent` | Control-M Admin Operator, Control-M Agent Lifecycle Operator |
| `ctm_enable_agentless_host` | Control-M Admin Operator, Control-M Agent Lifecycle Operator |
| `ctm_enable_ctm_server` | Control-M Platform Configuration Operator |
| `ctm_enable_mft_processing_rule_for_site` | Control-M MFT Access Operator |
| `ctm_failover` | Control-M Platform Configuration Operator |
| `ctm_fallback` | Control-M Platform Configuration Operator |
| `ctm_free_job` | Control-M Job Operator |
| `ctm_generate_mft_rsa_ssh_key` | Control-M MFT Infrastructure Operator |
| `ctm_get_active_services` | Control-M Platform Configuration Operator, Control-M Platform Health Investigator |
| `ctm_get_agent_certificate_expiration_date` | Control-M Agent Lifecycle Operator, Control-M Platform Health Investigator |
| `ctm_get_agent_parameters` | Control-M Admin Operator, Control-M Agent Lifecycle Operator |
| `ctm_get_agentless_host_properties` | Control-M Agent Lifecycle Operator |
| `ctm_get_agentless_hosts` | Control-M Admin Operator, Control-M Agent Lifecycle Operator, Control-M Platform Health Investigator |
| `ctm_get_agents` | Control-M Admin Operator, Control-M Agent Lifecycle Operator, Control-M Operations Lead, Control-M Platform Health Investigator |
| `ctm_get_agents_log` | Control-M Admin Operator, Control-M Agent Lifecycle Operator, Control-M Platform Health Investigator |
| `ctm_get_all_archive_rules` | Control-M Workload Configuration Operator |
| `ctm_get_all_authorization_roles` | Control-M Security and Identity Operator |
| `ctm_get_all_organization_groups` | Control-M Security and Identity Operator |
| `ctm_get_all_organization_users` | Control-M Security and Identity Operator |
| `ctm_get_all_roles_associated_with_organization_group` | Control-M Security and Identity Operator |
| `ctm_get_all_roles_associated_with_organization_user` | Control-M Security and Identity Operator |
| `ctm_get_all_upgrade_activities_status` | Control-M Agent Lifecycle Operator |
| `ctm_get_all_users` | Control-M Security and Identity Operator |
| `ctm_get_archive_statistics` | Control-M Reporting and Forecast Analyst |
| `ctm_get_communication_analysis_report_for_agent` | Control-M Admin Operator, Control-M Agent Lifecycle Operator, Control-M Platform Health Investigator |
| `ctm_get_ctm_ai_job_type_plugin` | Control-M Workflow Deployment Operator |
| `ctm_get_ctm_gate_ways` | Control-M MFT Infrastructure Operator, Control-M Platform Configuration Operator, Control-M Platform Health Investigator |
| `ctm_get_ctm_security_attributes` | Control-M Security and Identity Operator |
| `ctm_get_ctm_security_entities` | Control-M Security and Identity Operator |
| `ctm_get_ctmhigh_availability_status` | Control-M Platform Configuration Operator, Control-M Platform Health Investigator |
| `ctm_get_data_assurance_configuration` | Control-M MFT Infrastructure Operator |
| `ctm_get_deploy_versions` | Control-M Workflow Deployment Operator |
| `ctm_get_detailed_workload_policies` | Control-M Workload Configuration Operator |
| `ctm_get_emcomponent` | Control-M Platform Configuration Operator, Control-M Platform Health Investigator |
| `ctm_get_emhigh_availability_status` | Control-M Platform Configuration Operator, Control-M Platform Health Investigator |
| `ctm_get_events` | Control-M Workflow Deployment Operator, Control-M Workload Configuration Operator |
| `ctm_get_external_user_authorized_folders` | Control-M MFT Access Operator |
| `ctm_get_external_user_authorized_folders_for_site` | Control-M MFT Access Operator |
| `ctm_get_external_users` | Control-M MFT Access Operator, Control-M Security and Identity Operator |
| `ctm_get_external_users_for_site` | Control-M MFT Access Operator |
| `ctm_get_forecast_timeline` | Control-M Reporting and Forecast Analyst |
| `ctm_get_fts_settings` | Control-M Workload Configuration Operator |
| `ctm_get_host_restriction_list` | Control-M Platform Health Investigator, Control-M Workload Configuration Operator |
| `ctm_get_hostgroups` | Control-M Agent Lifecycle Operator, Control-M Platform Health Investigator, Control-M Workload Configuration Operator |
| `ctm_get_hostgroups_and_agents_with_tag` | Control-M Agent Lifecycle Operator, Control-M Platform Health Investigator |
| `ctm_get_hosts_in_group` | Control-M Agent Lifecycle Operator, Control-M Platform Health Investigator, Control-M Workload Configuration Operator |
| `ctm_get_hub_status_details` | Control-M MFT Infrastructure Operator, Control-M Platform Health Investigator |
| `ctm_get_hub_status_details_for_site` | Control-M MFT Infrastructure Operator, Control-M Platform Health Investigator |
| `ctm_get_identity_provider_metadata` | Control-M Security and Identity Operator |
| `ctm_get_images` | Control-M Workflow Deployment Operator |
| `ctm_get_job_log` | Control-M Job Investigator, Control-M Job Operator, Control-M Operations Lead |
| `ctm_get_job_output` | Control-M Job Investigator, Control-M Job Operator, Control-M Operations Lead |
| `ctm_get_job_statistics` | Control-M Job Investigator, Control-M Reporting and Forecast Analyst |
| `ctm_get_job_status` | Control-M Job Investigator, Control-M Job Operator, Control-M Operations Lead |
| `ctm_get_jobs_status` | Control-M Job Investigator |
| `ctm_get_jobs_status_by_filter` | Control-M Job Investigator, Control-M Job Operator, Control-M Operations Lead, Control-M Workflow Deployment Operator |
| `ctm_get_list_of_un_ordered_jobs_for_specified_user_daily` | Control-M Job Investigator, Control-M Job Operator |
| `ctm_get_load_balancer_properties` | Control-M Platform Configuration Operator, Control-M Platform Health Investigator |
| `ctm_get_locked_external_users` | Control-M Security and Identity Operator |
| `ctm_get_locked_external_users_for_site` | Control-M MFT Access Operator |
| `ctm_get_mft_configuration` | Control-M MFT Infrastructure Operator |
| `ctm_get_mft_gateways` | Control-M MFT Infrastructure Operator |
| `ctm_get_mft_gateways_for_site` | Control-M MFT Infrastructure Operator |
| `ctm_get_mft_user_groups` | Control-M MFT Access Operator |
| `ctm_get_mft_user_groups_for_site` | Control-M MFT Access Operator |
| `ctm_get_mftfolders` | Control-M MFT Access Operator |
| `ctm_get_mftfolders_for_site` | Control-M MFT Access Operator |
| `ctm_get_mftprocessing_rules_for_site` | Control-M MFT Access Operator |
| `ctm_get_organization_group_user_simulation` | Control-M Security and Identity Operator |
| `ctm_get_pgp_templates` | Control-M MFT Infrastructure Operator |
| `ctm_get_provision_repo` | Control-M Integrations and Extensions Operator |
| `ctm_get_related_job_services` | Control-M Job Investigator |
| `ctm_get_remote_host_properties` | Control-M Agent Lifecycle Operator, Control-M MFT Infrastructure Operator |
| `ctm_get_remote_hosts` | Control-M Admin Operator, Control-M Agent Lifecycle Operator, Control-M MFT Infrastructure Operator, Control-M Platform Health Investigator |
| `ctm_get_report_filters` | Control-M Reporting and Forecast Analyst |
| `ctm_get_report_status` | Control-M Reporting and Forecast Analyst |
| `ctm_get_resources` | Control-M Workload Configuration Operator |
| `ctm_get_role` | Control-M Security and Identity Operator |
| `ctm_get_role_associates` | Control-M Security and Identity Operator |
| `ctm_get_run_as_user` | Control-M Security and Identity Operator |
| `ctm_get_run_as_users_list` | Control-M Security and Identity Operator |
| `ctm_get_server_definition` | Control-M Platform Configuration Operator, Control-M Platform Health Investigator |
| `ctm_get_server_system_setting` | Control-M Platform Configuration Operator, Control-M Platform Health Investigator |
| `ctm_get_servers` | Control-M Admin Operator, Control-M Agent Lifecycle Operator, Control-M Operations Lead, Control-M Platform Configuration Operator, Control-M Platform Health Investigator |
| `ctm_get_site_standard_policies_details` | Control-M Workflow Deployment Operator |
| `ctm_get_site_standards` | Control-M Workflow Deployment Operator |
| `ctm_get_site_standards_details` | Control-M Workflow Deployment Operator |
| `ctm_get_ssh_key` | Control-M MFT Infrastructure Operator |
| `ctm_get_ssh_keys_list` | Control-M MFT Infrastructure Operator |
| `ctm_get_status` | Control-M Platform Configuration Operator, Control-M Platform Health Investigator |
| `ctm_get_system_setting` | Control-M Platform Configuration Operator |
| `ctm_get_token_data_by_value` | Not assigned |
| `ctm_get_un_ordered_jobs_for_specified_user_daily` | Control-M Job Investigator, Control-M Job Operator |
| `ctm_get_usage_jobs` | Control-M Job Investigator, Control-M Reporting and Forecast Analyst |
| `ctm_get_user` | Control-M Security and Identity Operator |
| `ctm_get_user_effective_rights` | Control-M Security and Identity Operator |
| `ctm_get_user_simulation` | Control-M Security and Identity Operator |
| `ctm_get_variables` | Control-M Workflow Deployment Operator |
| `ctm_get_wdagateways` | Control-M Platform Configuration Operator, Control-M Platform Health Investigator |
| `ctm_get_workflow_insights_data_export_status` | Control-M Reporting and Forecast Analyst, Control-M Workload Configuration Operator |
| `ctm_get_workflow_insights_data_export_system_params` | Control-M Reporting and Forecast Analyst, Control-M Workload Configuration Operator |
| `ctm_get_workflow_insights_status` | Control-M Reporting and Forecast Analyst |
| `ctm_get_workload_policies` | Control-M Workload Configuration Operator |
| `ctm_get_zos_templates` | Control-M Workflow Deployment Operator |
| `ctm_hold_job` | Control-M Job Operator |
| `ctm_kill_job` | Control-M Job Operator |
| `ctm_list_provision_repos` | Control-M Integrations and Extensions Operator |
| `ctm_lock_external_user` | Control-M Security and Identity Operator |
| `ctm_lock_external_user_for_site` | Control-M MFT Access Operator |
| `ctm_managed_ctm_server` | Control-M Platform Configuration Operator |
| `ctm_modify_job` | Control-M Workflow Deployment Operator |
| `ctm_order_jobs_in_folder` | Control-M Job Operator |
| `ctm_perform_em_failover` | Control-M Platform Configuration Operator |
| `ctm_perform_em_fallback` | Control-M Platform Configuration Operator |
| `ctm_ping_agent` | Control-M Platform Health Investigator |
| `ctm_ping_agentless_host` | Control-M Platform Health Investigator |
| `ctm_poll_add_ssh_key_request_by_polling_id` | Control-M MFT Infrastructure Operator |
| `ctm_poll_deploy_results` | Control-M Workflow Deployment Operator |
| `ctm_poll_forecast_timeline_request` | Control-M Reporting and Forecast Analyst |
| `ctm_recycle_item` | Not assigned |
| `ctm_refresh_server_system_settings` | Control-M Platform Configuration Operator |
| `ctm_remove_controlm_server` | Control-M Platform Configuration Operator |
| `ctm_remove_ctm_gateway` | Control-M Platform Configuration Operator |
| `ctm_remove_gateway` | Control-M MFT Infrastructure Operator |
| `ctm_remove_gateway_for_site` | Control-M MFT Infrastructure Operator |
| `ctm_remove_hub_from_cluster` | Control-M Platform Configuration Operator |
| `ctm_remove_hub_from_cluster_for_site` | Control-M MFT Infrastructure Operator |
| `ctm_remove_old_alerts` | Control-M Workload Configuration Operator |
| `ctm_remove_role_from_user` | Control-M Security and Identity Operator |
| `ctm_remove_wdagateway` | Control-M Platform Configuration Operator |
| `ctm_rename_role` | Control-M Security and Identity Operator |
| `ctm_rename_site_standard` | Control-M Workflow Deployment Operator |
| `ctm_rename_site_standard_policy` | Control-M Workflow Deployment Operator |
| `ctm_replicate_database` | Control-M Platform Configuration Operator |
| `ctm_rerun_job` | Control-M Job Operator |
| `ctm_resume_ctm` | Control-M Platform Configuration Operator |
| `ctm_run_jobs` | Control-M Job Operator |
| `ctm_run_on_demand` | Control-M Job Operator |
| `ctm_run_report` | Control-M Reporting and Forecast Analyst |
| `ctm_run_un_ordered_jobs_for_specified_user_daily` | Control-M Job Operator |
| `ctm_send_archive_cleanup_request` | Control-M Workload Configuration Operator |
| `ctm_send_ctl_command` | Not assigned |
| `ctm_set_active_shout_destination_list` | Control-M Workload Configuration Operator |
| `ctm_set_agent_parameter` | Control-M Admin Operator, Control-M Agent Lifecycle Operator |
| `ctm_set_ctm_desired_state` | Control-M Platform Configuration Operator |
| `ctm_set_data_assurance_configuration` | Control-M MFT Infrastructure Operator |
| `ctm_set_em_as_primary` | Control-M Platform Configuration Operator |
| `ctm_set_server_system_setting` | Control-M Platform Configuration Operator |
| `ctm_set_system_param` | Control-M Platform Configuration Operator |
| `ctm_set_system_setting` | Control-M Platform Configuration Operator |
| `ctm_set_user_preferences` | Control-M Security and Identity Operator |
| `ctm_set_variables` | Control-M Workflow Deployment Operator |
| `ctm_set_workflow_insights_data_export_system_params` | Control-M Workload Configuration Operator |
| `ctm_setasprimary` | Control-M Platform Configuration Operator |
| `ctm_test_agent` | Control-M Platform Health Investigator |
| `ctm_test_agentless_host` | Control-M Platform Health Investigator |
| `ctm_test_run_as_user` | Control-M Security and Identity Operator |
| `ctm_transfer_and_install_product` | Control-M Agent Lifecycle Operator |
| `ctm_uninstall_product` | Control-M Agent Lifecycle Operator |
| `ctm_unlock_external_user` | Control-M Security and Identity Operator |
| `ctm_unlock_external_user_for_site` | Control-M MFT Access Operator |
| `ctm_unlock_external_users` | Control-M Security and Identity Operator |
| `ctm_unlock_external_users_for_site` | Control-M MFT Access Operator |
| `ctm_unmanaged_ctm_server` | Control-M Platform Configuration Operator |
| `ctm_update_agent_parameter` | Control-M Admin Operator, Control-M Agent Lifecycle Operator |
| `ctm_update_agentless_host` | Control-M Admin Operator, Control-M Agent Lifecycle Operator |
| `ctm_update_alert` | Control-M Workload Configuration Operator |
| `ctm_update_alert_status` | Control-M Workload Configuration Operator |
| `ctm_update_archive_rule` | Control-M Workload Configuration Operator |
| `ctm_update_ctm_gateway` | Control-M MFT Infrastructure Operator, Control-M Platform Configuration Operator |
| `ctm_update_ctm_security_attributes` | Control-M Security and Identity Operator |
| `ctm_update_ctm_security_group` | Control-M Security and Identity Operator |
| `ctm_update_ctm_security_user` | Control-M Security and Identity Operator |
| `ctm_update_em_component_desired_state` | Control-M Platform Configuration Operator |
| `ctm_update_emcomponent` | Control-M Platform Configuration Operator |
| `ctm_update_external_user` | Control-M Security and Identity Operator |
| `ctm_update_external_user_for_site` | Control-M MFT Access Operator |
| `ctm_update_fts_settings` | Control-M Workload Configuration Operator |
| `ctm_update_host_restriction` | Control-M Workload Configuration Operator |
| `ctm_update_hosts_in_hostgroup` | Control-M Agent Lifecycle Operator, Control-M Workload Configuration Operator |
| `ctm_update_load_balancer` | Control-M Platform Configuration Operator |
| `ctm_update_mft_configuration` | Control-M MFT Infrastructure Operator |
| `ctm_update_mft_user_group` | Control-M MFT Access Operator |
| `ctm_update_mft_user_group_for_site` | Control-M MFT Access Operator |
| `ctm_update_mftfolder` | Control-M MFT Access Operator |
| `ctm_update_mftfolder_for_site` | Control-M MFT Access Operator |
| `ctm_update_mftprocessing_rule_for_site` | Control-M MFT Access Operator |
| `ctm_update_pgp_template` | Control-M MFT Infrastructure Operator |
| `ctm_update_resource` | Control-M Workload Configuration Operator |
| `ctm_update_role` | Control-M Security and Identity Operator |
| `ctm_update_run_as_user` | Control-M Security and Identity Operator |
| `ctm_update_server` | Control-M Platform Configuration Operator |
| `ctm_update_ssh_key` | Control-M MFT Infrastructure Operator |
| `ctm_update_user` | Control-M Security and Identity Operator |
| `ctm_update_zos_template` | Control-M Workflow Deployment Operator |
| `delete_active_job` | Control-M Job Operator |
| `delete_agent` | Control-M Agent Lifecycle Operator |
| `delete_api_token` | Control-M Credentials and Secrets Operator |
| `delete_calendar` | Control-M Workflow Deployment Operator |
| `delete_connection_profile` | Control-M Integrations and Extensions Operator |
| `delete_folder` | Control-M Workflow Deployment Operator |
| `delete_local_connection_profile` | Control-M Integrations and Extensions Operator |
| `delete_secret` | Control-M Credentials and Secrets Operator |
| `delete_shared_connection_profile` | Control-M Integrations and Extensions Operator |
| `delete_upgrade_activity` | Control-M Agent Lifecycle Operator |
| `deploy` | Control-M Workflow Deployment Operator |
| `deploy_ai_jobtype` | Control-M Workflow Deployment Operator |
| `deploy_application` | Control-M Workflow Deployment Operator |
| `deploy_site_standard_policies` | Control-M Workflow Deployment Operator |
| `deploy_status` | Control-M Workflow Deployment Operator |
| `download_report` | Control-M Reporting and Forecast Analyst |
| `environment_summary` | Control-M Platform Health Investigator |
| `forecast_application` | Control-M Reporting and Forecast Analyst |
| `free_job` | Control-M Job Operator |
| `generate_report` | Control-M Reporting and Forecast Analyst |
| `get_active_job` | Control-M Job Investigator, Control-M Job Operator |
| `get_api_token` | Control-M Credentials and Secrets Operator |
| `get_archive_job_log` | Control-M Job Investigator |
| `get_archive_job_output` | Control-M Job Investigator |
| `get_connection_profile_deployment_status` | Control-M Integrations and Extensions Operator |
| `get_connection_profile_status` | Control-M Integrations and Extensions Operator |
| `get_forecast` | Control-M Reporting and Forecast Analyst |
| `get_job_output` | Control-M Job Investigator, Control-M Job Operator |
| `get_job_status` | Control-M Job Investigator, Control-M Job Operator |
| `get_report_definition` | Control-M Reporting and Forecast Analyst |
| `get_site_standard_policies` | Control-M Workflow Deployment Operator |
| `get_site_standard_restrictions` | Control-M Workflow Deployment Operator |
| `get_upgrade_candidates` | Control-M Agent Lifecycle Operator |
| `get_upgrade_log` | Control-M Agent Lifecycle Operator |
| `get_upgrade_status` | Control-M Agent Lifecycle Operator |
| `get_waiting_info` | Control-M Job Investigator |
| `health_check_workflow` | Control-M Platform Health Investigator |
| `hold_job` | Control-M Job Operator |
| `install_and_validate_agent` | Control-M Agent Lifecycle Operator |
| `kill_job` | Control-M Job Operator |
| `list_active_jobs` | Control-M Job Investigator |
| `list_agents` | Control-M Platform Health Investigator |
| `list_ai_jobtypes` | Control-M Workflow Deployment Operator |
| `list_alerts` | Control-M Workload Configuration Operator |
| `list_api_tokens` | Control-M Credentials and Secrets Operator |
| `list_calendars` | Control-M Workflow Deployment Operator |
| `list_deployed_connection_profiles` | Control-M Integrations and Extensions Operator |
| `list_deployed_folders` | Control-M Workflow Deployment Operator |
| `list_deployed_jobs` | Control-M Workflow Deployment Operator |
| `list_local_connection_profiles` | Control-M Integrations and Extensions Operator |
| `list_reports` | Control-M Reporting and Forecast Analyst |
| `list_secrets` | Control-M Credentials and Secrets Operator |
| `list_shared_connection_profiles` | Control-M Integrations and Extensions Operator |
| `manage_roles` | Control-M Security and Identity Operator |
| `manage_secrets` | Control-M Credentials and Secrets Operator |
| `manage_users` | Control-M Security and Identity Operator |
| `order_folder` | Control-M Job Operator |
| `ping_agent` | Control-M Platform Health Investigator |
| `poll_forecast` | Control-M Reporting and Forecast Analyst |
| `provision_install_agent` | Control-M Agent Lifecycle Operator |
| `provision_status` | Control-M Agent Lifecycle Operator |
| `provision_uninstall_agent` | Control-M Agent Lifecycle Operator |
| `provision_upgrade_agent` | Control-M Agent Lifecycle Operator |
| `remediate_agent` | Control-M Agent Lifecycle Operator |
| `report_status` | Control-M Reporting and Forecast Analyst |
| `repository_management` | Control-M Integrations and Extensions Operator |
| `rerun_job` | Control-M Job Operator |
| `retry_upgrade` | Control-M Agent Lifecycle Operator |
| `run_and_monitor_job` | Control-M Job Operator |
| `run_job` | Control-M Job Operator |
| `run_job_now` | Control-M Job Operator |
| `run_report` | Control-M Reporting and Forecast Analyst |
| `search_archive_jobs` | Control-M Job Investigator |
| `set_job_ok` | Control-M Job Operator |
| `set_site_standard_restrictions` | Control-M Workflow Deployment Operator |
| `test_agent` | Control-M Platform Health Investigator |
| `test_connection_profile` | Control-M Integrations and Extensions Operator |
| `test_shared_connection_profile` | Control-M Integrations and Extensions Operator |
| `transform_file` | Control-M Workflow Deployment Operator |
| `undelete_job` | Control-M Job Operator |
| `update_alerts` | Control-M Workload Configuration Operator |
| `update_api_token` | Control-M Credentials and Secrets Operator |
| `update_secret` | Control-M Credentials and Secrets Operator |
| `update_user_password` | Control-M Security and Identity Operator |
| `upgrade_agent` | Control-M Agent Lifecycle Operator |
| `upgrade_fleet` | Control-M Agent Lifecycle Operator |

## Intentionally unassigned tools

- `ctm_get_token_data_by_value`
- `ctm_recycle_item`
- `ctm_send_ctl_command`

These high-risk/general-purpose tools are intentionally omitted from agent tool lists: `ctm_send_ctl_command` can issue broad Control-M commands; `ctm_recycle_item` is generic and potentially destructive; `ctm_get_token_data_by_value` can expose token material. Review the security impact before assigning any of them.

## Safety note

Agent tool lists are a UI/model capability boundary, not a substitute for server-side authorization. Write actions still require server write mode, Control-M permissions, and the per-agent confirmation workflow. Keep credentials and secrets out of this catalog.
