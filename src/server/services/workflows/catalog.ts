import type { WorkflowStep } from "../../db/schema/automation";
import type { Conditions } from "@/lib/conditions";

/** Events a workflow can be triggered by, with a human label and sample facts. */
export const WORKFLOW_TRIGGERS: { event: string; label: string; subject: "employee" | "candidate" | "payroll" | "other" }[] = [
  { event: "employee.created", label: "Employee created", subject: "employee" },
  { event: "employee.joined", label: "Employee joins", subject: "employee" },
  { event: "employee.job_changed", label: "Job change recorded", subject: "employee" },
  { event: "employee.probation_confirmed", label: "Probation confirmed", subject: "employee" },
  { event: "milestone.reached", label: "Milestone reached (probation ending, anniversary, birthday)", subject: "employee" },
  { event: "candidate.stage_changed", label: "Candidate stage changed", subject: "candidate" },
  { event: "offer.accepted", label: "Offer accepted", subject: "candidate" },
  { event: "leave.requested", label: "Leave requested", subject: "employee" },
  { event: "attendance.exception", label: "Attendance exception detected", subject: "employee" },
  { event: "payroll.period_opened", label: "Payroll period opens", subject: "payroll" },
  { event: "payroll.exception", label: "Payroll exception detected", subject: "payroll" },
  { event: "performance.cycle_started", label: "Performance review starts", subject: "other" },
  { event: "document.expiring", label: "Document expiring", subject: "employee" },
  { event: "resignation.submitted", label: "Resignation submitted", subject: "employee" },
];

export type ActionSpec = {
  action: string;
  label: string;
  description: string;
  /** Param fields for the builder UI. */
  params: { key: string; label: string; type: "text" | "textarea" | "number" | "select"; options?: string[]; required?: boolean; help?: string }[];
};

/** "manager" | "employee" | "hr" | "it" | "finance" | "payroll" | "role:<key>" */
const RECIPIENTS = ["employee", "manager", "hr", "it", "finance", "payroll", "recruiter"];

export const WORKFLOW_ACTIONS: ActionSpec[] = [
  {
    action: "create_task",
    label: "Create task",
    description: "Assign a task to a person or team.",
    params: [
      { key: "title", label: "Title", type: "text", required: true, help: "Supports {{employee.name}}" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "assignee", label: "Assign to", type: "select", options: RECIPIENTS, required: true },
      { key: "dueInDays", label: "Due in (days)", type: "number" },
    ],
  },
  {
    action: "notify",
    label: "Send in-app notification",
    description: "Notify people inside PeopleSuccess.",
    params: [
      { key: "recipients", label: "Recipients", type: "select", options: RECIPIENTS, required: true },
      { key: "title", label: "Title", type: "text", required: true },
      { key: "body", label: "Message", type: "textarea", help: "Do not include confidential values." },
      { key: "href", label: "Link", type: "text" },
    ],
  },
  {
    action: "send_email",
    label: "Send email",
    description: "Email people through the configured email provider.",
    params: [
      { key: "recipients", label: "Recipients", type: "select", options: RECIPIENTS, required: true },
      { key: "subject", label: "Subject", type: "text", required: true },
      { key: "body", label: "Body", type: "textarea", required: true },
    ],
  },
  {
    action: "request_approval",
    label: "Request approval",
    description: "Pause until HR approves; continue on approval, stop on rejection.",
    params: [{ key: "title", label: "Approval title", type: "text", required: true }],
  },
  {
    action: "wait",
    label: "Wait",
    description: "Pause for a number of days or hours.",
    params: [
      { key: "days", label: "Days", type: "number" },
      { key: "hours", label: "Hours", type: "number" },
    ],
  },
  {
    action: "wait_for_event",
    label: "Wait for event",
    description: "Pause until an event happens for the same subject (or time out).",
    params: [
      { key: "event", label: "Event", type: "select", options: WORKFLOW_TRIGGERS.map((t) => t.event), required: true },
      { key: "timeoutDays", label: "Time out after (days)", type: "number" },
    ],
  },
  {
    action: "call_integration",
    label: "Call webhook",
    description: "POST a signed JSON payload to the configured outbound webhook.",
    params: [{ key: "eventName", label: "Event name sent", type: "text", required: true }],
  },
  {
    action: "run_agent",
    label: "Run AI agent",
    description: "Ask an AI agent for a summary that is attached as a note. Read-only.",
    params: [
      { key: "agent", label: "Agent", type: "select", options: ["hr_operations", "onboarding", "exit", "people_success"], required: true },
      { key: "instruction", label: "Instruction", type: "textarea", required: true },
    ],
  },
  {
    action: "escalate",
    label: "Escalate",
    description: "Notify HR administrators that something needs attention.",
    params: [{ key: "message", label: "Message", type: "textarea", required: true }],
  },
];

export type StarterWorkflow = {
  key: string;
  name: string;
  description: string;
  trigger: string;
  conditions: Conditions;
  steps: WorkflowStep[];
};

/** Starter workflows seeded (inactive) for every tenant; HR turns on what they want. */
export const STARTER_WORKFLOWS: StarterWorkflow[] = [
  {
    key: "starter.new_hire_welcome",
    name: "New joiner: welcome and first-week tasks",
    description: "When someone joins, notify their manager and create first-week tasks.",
    trigger: "employee.joined",
    conditions: {},
    steps: [
      { key: "notify_manager", action: "notify", name: "Tell the manager", params: { recipients: "manager", title: "{{employee.name}} joins your team today", href: "/employees/{{employee.id}}" } },
      { key: "it_setup", action: "create_task", name: "IT setup", params: { title: "Confirm laptop and accounts for {{employee.name}}", assignee: "it", dueInDays: 0 } },
      { key: "first_1on1", action: "create_task", name: "First 1:1", params: { title: "Hold a first-week 1:1 with {{employee.name}}", assignee: "manager", dueInDays: 5 } },
    ],
  },
  {
    key: "starter.probation_review",
    name: "Probation review reminder",
    description: "Two weeks before probation ends, ask the manager for a confirmation recommendation.",
    trigger: "milestone.reached",
    conditions: { milestone: "probation_ending" },
    steps: [
      { key: "task", action: "create_task", name: "Manager review", params: { title: "Probation review for {{employee.name}} (ends {{event.date}})", assignee: "manager", dueInDays: 10 } },
      { key: "hr_notice", action: "notify", name: "Inform HR", params: { recipients: "hr", title: "Probation ending soon: {{employee.name}}", href: "/employees/{{employee.id}}" } },
    ],
  },
  {
    key: "starter.leave_requested",
    name: "Leave requested: heads-up to HR for long leave",
    description: "Notify HR when a leave request is 5 days or longer.",
    trigger: "leave.requested",
    conditions: { days: { gte: 5 } },
    steps: [{ key: "notify_hr", action: "notify", name: "Notify HR", params: { recipients: "hr", title: "Long leave requested by {{employee.name}}", body: "{{event.days}} days from {{event.startDate}}", href: "/leave" } }],
  },
  {
    key: "starter.payroll_period",
    name: "Payroll period opened: collect inputs",
    description: "Ask payroll and finance to submit variable pay inputs before cut-off.",
    trigger: "payroll.period_opened",
    conditions: {},
    steps: [{ key: "inputs", action: "create_task", name: "Collect inputs", params: { title: "Submit bonuses, deductions and arrears for the new pay period", assignee: "payroll", dueInDays: 5 } }],
  },
  {
    key: "starter.review_started",
    name: "Performance review started: remind participants",
    description: "Notify HR when a review cycle starts so they can monitor completion.",
    trigger: "performance.cycle_started",
    conditions: {},
    steps: [{ key: "notify", action: "notify", name: "Notify HR", params: { recipients: "hr", title: "A review cycle has started", href: "/performance" } }],
  },
  {
    key: "starter.exit",
    name: "Resignation submitted: start handover",
    description: "Create handover and knowledge-transfer tasks for the manager.",
    trigger: "resignation.submitted",
    conditions: {},
    steps: [
      { key: "handover", action: "create_task", name: "Handover plan", params: { title: "Agree a handover plan with {{employee.name}}", assignee: "manager", dueInDays: 7 } },
      { key: "hr", action: "notify", name: "Inform HR", params: { recipients: "hr", title: "Resignation submitted by {{employee.name}}", href: "/onboarding" } },
    ],
  },
  {
    key: "starter.document_expiring",
    name: "Document expiring: ask the employee to renew",
    description: "Notify the employee and HR 30 days before a document expires.",
    trigger: "document.expiring",
    conditions: {},
    steps: [
      { key: "notify_employee", action: "notify", name: "Notify employee", params: { recipients: "employee", title: "Your document “{{event.title}}” expires on {{event.date}}", href: "/documents" } },
      { key: "task_hr", action: "create_task", name: "HR follow-up", params: { title: "Collect renewed “{{event.title}}” from {{employee.name}}", assignee: "hr", dueInDays: 21 } },
    ],
  },
  {
    key: "starter.offer_accepted",
    name: "Offer accepted: prepare onboarding",
    description: "Tell HR an offer was accepted so pre-boarding can start.",
    trigger: "offer.accepted",
    conditions: {},
    steps: [{ key: "notify", action: "notify", name: "Notify HR", params: { recipients: "hr", title: "Offer accepted by {{event.candidateName}}", href: "/onboarding" } }],
  },
];
