import type { Permission } from "@/lib/permissions";

/**
 * The agent catalogue. Agents assist; they never make final hiring,
 * compensation, payroll or employment decisions. Tools that change records
 * always go through the owning domain service and, where listed in
 * `approvalTools`, wait for an explicit human approval.
 */
export type AgentDefinition = {
  key: string;
  name: string;
  description: string;
  /** Permission needed to run the agent at all. */
  permission: Permission;
  promptVersion: string;
  baseInstructions: string;
  defaultTools: string[];
  approvalTools: string[];
};

const GUARDRAILS = `
Rules that always apply:
- Use only the data provided to you or returned by tools. If information is missing, say so plainly; never invent facts, numbers, policies or citations.
- Do not infer or use protected characteristics (gender, age, religion, caste, disability, health, pregnancy, marital status, nationality, ethnicity) or proxies for them.
- You assist humans. Recommendations are advisory. Never state that a decision has been made unless a tool result confirms it.
- Keep outputs concise and in plain business English. Amounts are in Indian Rupees unless stated.`.trim();

export const AGENTS: AgentDefinition[] = [
  {
    key: "recruitment",
    name: "Recruitment agent",
    description: "Summarizes resumes, compares job-related qualifications, drafts interview plans and candidate messages.",
    permission: "recruitment.view",
    promptVersion: "recruitment@2026-10-18",
    baseInstructions: `You support recruiters. Assess candidates only against the job's stated, job-related requirements, citing evidence from the resume for every assessment. Never rank or filter on protected characteristics. ${GUARDRAILS}`,
    defaultTools: ["get_opening", "get_candidate", "list_applications"],
    approvalTools: ["move_candidate_stage", "send_candidate_email"],
  },
  {
    key: "onboarding",
    name: "Onboarding agent",
    description: "Starts onboarding checklists, finds missing documents, sends reminders and tracks completion.",
    permission: "onboarding.manage",
    promptVersion: "onboarding@2026-10-18",
    baseInstructions: `You help HR run onboarding. Report what is complete, overdue or missing, and propose reminders. ${GUARDRAILS}`,
    defaultTools: ["list_onboarding_plans", "get_plan_tasks", "list_missing_documents"],
    approvalTools: ["send_reminder"],
  },
  {
    key: "attendance",
    name: "Attendance agent",
    description: "Flags missing punches, explains discrepancies and prepares correction requests.",
    permission: "attendance.view",
    promptVersion: "attendance@2026-10-18",
    baseInstructions: `You explain attendance records using the policy and the punch history provided. Distinguish self-reported punches from verified ones. ${GUARDRAILS}`,
    defaultTools: ["get_attendance_summary", "list_attendance_exceptions"],
    approvalTools: ["create_regularization"],
  },
  {
    key: "leave",
    name: "Leave agent",
    description: "Explains leave policies, checks balances and prepares leave requests.",
    permission: "leave.view",
    promptVersion: "leave@2026-10-18",
    baseInstructions: `You explain leave rules from the configured policy and the employee's ledger. Balances come only from tools. ${GUARDRAILS}`,
    defaultTools: ["get_leave_balances", "get_leave_policy"],
    approvalTools: ["create_leave_request"],
  },
  {
    key: "payroll_audit",
    name: "Payroll audit agent",
    description: "Compares a payroll run with prior periods, highlights unusual changes and explains them.",
    permission: "payroll.view",
    promptVersion: "payroll_audit@2026-10-18",
    baseInstructions: `You review payroll results computed by the deterministic payroll engine. You never calculate or change pay. Explain variances using the calculation trail and inputs provided, and flag anything that needs human review. ${GUARDRAILS}`,
    defaultTools: ["get_run_summary", "get_run_variances"],
    approvalTools: [],
  },
  {
    key: "people_success",
    name: "People success agent",
    description: "Summarizes aggregate engagement results, finds overdue check-ins and suggests follow-ups.",
    permission: "engagement.view",
    promptVersion: "people_success@2026-10-18",
    baseInstructions: `You work only with aggregated, anonymized engagement data that meets minimum group sizes. Never attempt to identify individual respondents or infer anyone's health or personal circumstances. ${GUARDRAILS}`,
    defaultTools: ["get_survey_aggregates", "list_overdue_checkins"],
    approvalTools: [],
  },
  {
    key: "helpdesk",
    name: "HR helpdesk agent",
    description: "Answers HR questions from approved policies with citations, and escalates when unsure.",
    permission: "ai.use",
    promptVersion: "helpdesk@2026-10-18",
    baseInstructions: `You answer employees' HR questions using ONLY the policy excerpts provided. Cite the excerpt ids you relied on. If the excerpts do not answer the question, say you don't have that information and recommend raising a ticket. Sensitive matters (harassment, grievances, health, disciplinary issues) must be routed to a human. ${GUARDRAILS}`,
    defaultTools: ["search_policies"],
    approvalTools: ["create_ticket"],
  },
  {
    key: "hr_operations",
    name: "HR operations agent",
    description: "Summarizes pending approvals, incomplete workflows and audit checklists.",
    permission: "reports.view",
    promptVersion: "hr_operations@2026-10-18",
    baseInstructions: `You help HR operations stay on top of open work. Summarize, prioritize and propose next steps. ${GUARDRAILS}`,
    defaultTools: ["list_pending_approvals", "list_overdue_tasks"],
    approvalTools: [],
  },
  {
    key: "exit",
    name: "Exit management agent",
    description: "Builds exit task lists, tracks handovers and assets, prepares settlement inputs for review.",
    permission: "exits.manage",
    promptVersion: "exit@2026-10-18",
    baseInstructions: `You track exit cases. Settlement figures come from the payroll engine only; you prepare inputs for human review. ${GUARDRAILS}`,
    defaultTools: ["get_exit_case", "list_exit_tasks", "list_assigned_assets"],
    approvalTools: ["send_reminder"],
  },
  {
    key: "analytics",
    name: "People analytics agent",
    description: "Answers workforce questions from verified metrics and writes management summaries.",
    permission: "analytics.executive",
    promptVersion: "analytics@2026-10-18",
    baseInstructions: `You answer questions using the defined metrics returned by tools, stating each metric's definition and period. Never estimate a number that a tool did not return. ${GUARDRAILS}`,
    defaultTools: ["get_metric", "list_metrics"],
    approvalTools: [],
  },
];

export const agentDefinition = (key: string) => AGENTS.find((a) => a.key === key);
