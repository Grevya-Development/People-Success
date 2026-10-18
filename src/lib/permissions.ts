/**
 * Permission catalogue. Shared by server (enforcement) and client (hiding UI
 * the user cannot use). The client copy is cosmetic only; every check is
 * repeated on the server and, for sensitive tables, again by Postgres RLS.
 *
 * A grant is "<permission>:<scope>". Scoped permissions narrow which records
 * the grant covers:
 *   self  - records about the signed-in employee
 *   team  - the employee's reporting subtree (direct and indirect reports)
 *   all   - every record in the tenant
 */

export type Scope = "self" | "team" | "all";

type PermissionDef = { label: string; group: string; scoped?: boolean; sensitive?: boolean };

export const PERMISSIONS = {
  // Administration
  "settings.manage": { label: "Manage company settings", group: "Administration" },
  "users.manage": { label: "Invite and manage users", group: "Administration" },
  "roles.manage": { label: "Manage roles and permissions", group: "Administration" },
  "audit.view": { label: "View audit logs", group: "Administration", sensitive: true },
  "integrations.manage": { label: "Manage integrations", group: "Administration" },
  "workflows.manage": { label: "Manage workflows and automation", group: "Administration" },
  "ai.manage": { label: "Configure AI providers and agents", group: "Administration" },

  // Organization
  "org.view": { label: "View organization structure", group: "Organization" },
  "org.manage": { label: "Manage departments, locations and positions", group: "Organization" },
  "directory.view": { label: "View employee directory", group: "Organization" },

  // Employees
  "employees.view": { label: "View employee profiles", group: "Employees", scoped: true },
  "employees.create": { label: "Create employees", group: "Employees" },
  "employees.edit": { label: "Edit employee records", group: "Employees", scoped: true },
  "employees.delete": { label: "Delete draft employee records", group: "Employees" },
  "employees.import": { label: "Import employees", group: "Employees" },
  "employees.export": { label: "Export employee data", group: "Employees", sensitive: true },
  "employees.sensitive.view": { label: "View identity, bank and statutory details", group: "Employees", sensitive: true },
  "employees.sensitive.edit": { label: "Edit identity, bank and statutory details", group: "Employees", sensitive: true },
  "compensation.view": { label: "View compensation", group: "Employees", scoped: true, sensitive: true },
  "compensation.edit": { label: "Change compensation", group: "Employees", sensitive: true },
  "assets.manage": { label: "Manage company assets", group: "Employees" },

  // Documents
  "documents.view": { label: "View employee documents", group: "Documents", scoped: true },
  "documents.manage": { label: "Upload, verify and delete documents", group: "Documents" },
  "templates.manage": { label: "Manage document templates", group: "Documents" },
  "policies.manage": { label: "Publish policies", group: "Documents" },

  // Recruitment
  "recruitment.view": { label: "View recruitment", group: "Recruitment" },
  "recruitment.manage": { label: "Manage jobs and candidates", group: "Recruitment" },
  "requisitions.create": { label: "Raise job requisitions", group: "Recruitment" },
  "requisitions.approve": { label: "Approve job requisitions", group: "Recruitment" },
  "interviews.feedback": { label: "Submit interview feedback", group: "Recruitment" },
  "offers.manage": { label: "Create and send offers", group: "Recruitment" },
  "offers.approve": { label: "Approve offers", group: "Recruitment" },

  // Onboarding & exit
  "onboarding.view": { label: "View onboarding", group: "Onboarding", scoped: true },
  "onboarding.manage": { label: "Manage onboarding plans", group: "Onboarding" },
  "exits.view": { label: "View exits", group: "Onboarding", scoped: true },
  "exits.manage": { label: "Manage exits and settlements", group: "Onboarding" },

  // Time
  "attendance.view": { label: "View attendance", group: "Time", scoped: true },
  "attendance.manage": { label: "Manage attendance policies and records", group: "Time" },
  "attendance.approve": { label: "Approve regularizations and timesheets", group: "Time", scoped: true },
  "leave.view": { label: "View leave", group: "Time", scoped: true },
  "leave.manage": { label: "Manage leave policies and balances", group: "Time" },
  "leave.approve": { label: "Approve leave", group: "Time", scoped: true },

  // Payroll
  "payroll.view": { label: "View payroll runs", group: "Payroll", sensitive: true },
  "payroll.run": { label: "Prepare and calculate payroll", group: "Payroll", sensitive: true },
  "payroll.approve": { label: "Approve and lock payroll", group: "Payroll", sensitive: true },
  "payroll.config": { label: "Configure salary components and statutory rules", group: "Payroll", sensitive: true },
  "payslips.view": { label: "View payslips", group: "Payroll", scoped: true, sensitive: true },

  // Expenses & benefits
  "expenses.view": { label: "View expense claims", group: "Expenses", scoped: true },
  "expenses.approve": { label: "Approve expense claims", group: "Expenses", scoped: true },
  "expenses.manage": { label: "Manage expense policies and reimbursements", group: "Expenses" },
  "benefits.manage": { label: "Manage benefits", group: "Expenses" },

  // Talent
  "performance.view": { label: "View performance", group: "Talent", scoped: true },
  "performance.manage": { label: "Run review cycles and calibration", group: "Talent" },
  "performance.review": { label: "Write reviews and feedback", group: "Talent", scoped: true },
  "learning.view": { label: "View learning", group: "Talent" },
  "learning.manage": { label: "Manage courses and assignments", group: "Talent" },
  "engagement.view": { label: "View engagement", group: "Talent" },
  "engagement.manage": { label: "Run surveys and recognition programs", group: "Talent" },
  "engagement.results": { label: "View aggregated survey results", group: "Talent", sensitive: true },
  "succession.manage": { label: "Manage succession plans", group: "Talent", sensitive: true },
  "referrals.manage": { label: "Manage referral programs and rewards", group: "Talent" },

  // Service
  "helpdesk.agent": { label: "Work HR tickets", group: "Service" },
  "helpdesk.manage": { label: "Configure helpdesk", group: "Service" },

  // Insights
  "approvals.view": { label: "View all approvals", group: "Insights" },
  "reports.view": { label: "View reports", group: "Insights" },
  "reports.export": { label: "Export reports", group: "Insights", sensitive: true },
  "analytics.executive": { label: "View executive analytics", group: "Insights", sensitive: true },
  "ai.use": { label: "Use the AI assistant", group: "Insights" },
} as const satisfies Record<string, PermissionDef>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const SCOPE_RANK: Record<Scope, number> = { self: 1, team: 2, all: 3 };

export type Grants = Partial<Record<Permission, Scope>>;

export function parseGrant(grant: string): [Permission, Scope] | null {
  const [perm, scope = "all"] = grant.split(":");
  if (!(perm in PERMISSIONS)) return null;
  if (scope !== "self" && scope !== "team" && scope !== "all") return null;
  return [perm as Permission, scope];
}

/** Merge grants from several roles, keeping the widest scope per permission. */
export function mergeGrants(grantLists: string[][]): Grants {
  const out: Grants = {};
  for (const list of grantLists) {
    for (const g of list) {
      const parsed = parseGrant(g);
      if (!parsed) continue;
      const [perm, scope] = parsed;
      const current = out[perm];
      if (!current || SCOPE_RANK[scope] > SCOPE_RANK[current]) out[perm] = scope;
    }
  }
  return out;
}

export function hasScope(grants: Grants, perm: Permission, needed: Scope = "all"): boolean {
  const s = grants[perm];
  return !!s && SCOPE_RANK[s] >= SCOPE_RANK[needed];
}

export const can = (grants: Grants, perm: Permission) => !!grants[perm];

export function serializeGrants(grants: Grants): string {
  return Object.entries(grants)
    .map(([p, s]) => `${p}:${s}`)
    .join(",");
}

/* ------------------------------------------------------------------ */
/* Built-in role templates. Seeded into every tenant; tenants may edit. */
/* ------------------------------------------------------------------ */

const SELF_SERVICE: string[] = [
  "org.view",
  "directory.view",
  "employees.view:self",
  "employees.edit:self",
  "compensation.view:self",
  "documents.view:self",
  "onboarding.view:self",
  "exits.view:self",
  "attendance.view:self",
  "leave.view:self",
  "payslips.view:self",
  "expenses.view:self",
  "performance.view:self",
  "learning.view",
  "engagement.view",
  "ai.use",
];

const MANAGER_EXTRAS: string[] = [
  "employees.view:team",
  "documents.view:team",
  "onboarding.view:team",
  "exits.view:team",
  "attendance.view:team",
  "attendance.approve:team",
  "leave.view:team",
  "leave.approve:team",
  "expenses.view:team",
  "expenses.approve:team",
  "performance.view:team",
  "performance.review:team",
  "requisitions.create",
  "interviews.feedback",
  "recruitment.view",
];

const allOf = (...groups: string[]) =>
  ALL_PERMISSIONS.filter((p) => groups.includes(PERMISSIONS[p].group)).map((p) => `${p}:all`);

export type RoleTemplate = {
  key: string;
  name: string;
  description: string;
  permissions: string[];
};

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "tenant_owner",
    name: "Tenant Owner",
    description: "Full control of the organization, including billing and security settings.",
    permissions: ALL_PERMISSIONS.map((p) => `${p}:all`),
  },
  {
    key: "hr_admin",
    name: "HR Administrator",
    description: "Administers HR operations, policies, employee records and settings.",
    permissions: [
      ...allOf("Organization", "Employees", "Documents", "Onboarding", "Time", "Talent", "Service", "Insights", "Recruitment"),
      "settings.manage",
      "users.manage",
      "roles.manage",
      "audit.view",
      "workflows.manage",
      "integrations.manage",
      "ai.manage",
      "payslips.view:all",
      "expenses.view:all",
      "expenses.approve:all",
      "benefits.manage",
    ],
  },
  {
    key: "hr_manager",
    name: "HR Manager",
    description: "Runs day-to-day HR operations without system administration rights.",
    permissions: [
      ...allOf("Organization", "Documents", "Onboarding", "Time", "Talent", "Service"),
      "employees.view:all",
      "employees.create",
      "employees.edit:all",
      "employees.import",
      "employees.export",
      "employees.sensitive.view",
      "compensation.view:all",
      "assets.manage",
      "recruitment.view",
      "approvals.view",
      "reports.view",
      "reports.export",
      "ai.use",
      "expenses.view:all",
    ],
  },
  {
    key: "recruiter",
    name: "Recruiter",
    description: "Manages job openings, candidates, interviews and offers.",
    permissions: [
      ...SELF_SERVICE,
      "recruitment.view",
      "recruitment.manage",
      "requisitions.create",
      "interviews.feedback",
      "offers.manage",
      "referrals.manage",
      "reports.view",
    ],
  },
  {
    key: "hiring_manager",
    name: "Hiring Manager",
    description: "Raises requisitions, reviews candidates and approves hires for their team.",
    permissions: [...SELF_SERVICE, ...MANAGER_EXTRAS, "offers.approve"],
  },
  {
    key: "interviewer",
    name: "Interviewer",
    description: "Sees assigned interviews and submits feedback.",
    permissions: [...SELF_SERVICE, "interviews.feedback"],
  },
  {
    key: "payroll_admin",
    name: "Payroll Administrator",
    description: "Prepares payroll, manages salary structures and statutory configuration.",
    permissions: [
      ...SELF_SERVICE,
      "employees.view:all",
      "employees.sensitive.view",
      "employees.sensitive.edit",
      "compensation.view:all",
      "compensation.edit",
      "attendance.view:all",
      "leave.view:all",
      "payroll.view",
      "payroll.run",
      "payroll.config",
      "payslips.view:all",
      "expenses.view:all",
      "expenses.manage",
      "exits.view:all",
      "reports.view",
      "reports.export",
    ],
  },
  {
    key: "finance_manager",
    name: "Finance Manager",
    description: "Approves payroll and reimbursements; reviews workforce cost.",
    permissions: [
      ...SELF_SERVICE,
      "employees.view:all",
      "compensation.view:all",
      "payroll.view",
      "payroll.approve",
      "payslips.view:all",
      "expenses.view:all",
      "expenses.approve:all",
      "expenses.manage",
      "benefits.manage",
      "offers.approve",
      "requisitions.approve",
      "reports.view",
      "reports.export",
      "analytics.executive",
    ],
  },
  {
    key: "department_head",
    name: "Department Head",
    description: "Leads a department; approves requisitions and sees departmental analytics.",
    permissions: [...SELF_SERVICE, ...MANAGER_EXTRAS, "requisitions.approve", "offers.approve", "reports.view"],
  },
  {
    key: "people_manager",
    name: "People Manager",
    description: "Manages a team: approvals, reviews and team visibility.",
    permissions: [...SELF_SERVICE, ...MANAGER_EXTRAS],
  },
  {
    key: "employee",
    name: "Employee",
    description: "Self-service access to their own records.",
    permissions: SELF_SERVICE,
  },
  {
    key: "contractor",
    name: "Contractor",
    description: "Limited self-service for non-employee workers.",
    permissions: [
      "directory.view",
      "employees.view:self",
      "documents.view:self",
      "attendance.view:self",
      "learning.view",
    ],
  },
  {
    key: "auditor",
    name: "Auditor",
    description: "Read-only access to records and audit trails for compliance reviews.",
    permissions: [
      "org.view",
      "directory.view",
      "employees.view:all",
      "documents.view:all",
      "attendance.view:all",
      "leave.view:all",
      "payroll.view",
      "payslips.view:all",
      "expenses.view:all",
      "audit.view",
      "approvals.view",
      "reports.view",
    ],
  },
];
