import type { Grants, Permission } from "./permissions";

export type NavIcon =
  | "overview"
  | "inbox"
  | "recruitment"
  | "onboarding"
  | "employees"
  | "organization"
  | "attendance"
  | "leave"
  | "payroll"
  | "expenses"
  | "performance"
  | "learning"
  | "engagement"
  | "referrals"
  | "helpdesk"
  | "documents"
  | "workflows"
  | "reports"
  | "agents"
  | "integrations"
  | "settings";

export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: NavIcon;
  /** Visible if the user holds any of these permissions (any scope). Omit for everyone. */
  anyOf?: Permission[];
  /** Modules are hidden until implemented, so the nav never links to placeholders. */
  ready: boolean;
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAVIGATION: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { key: "overview", label: "Overview", href: "/overview", icon: "overview", ready: true },
      { key: "inbox", label: "Approvals & tasks", href: "/inbox", icon: "inbox", ready: true },
    ],
  },
  {
    label: "People",
    items: [
      { key: "employees", label: "Employees", href: "/employees", icon: "employees", anyOf: ["directory.view", "employees.view"], ready: true },
      { key: "organization", label: "Organization", href: "/organization", icon: "organization", anyOf: ["org.view"], ready: true },
      { key: "recruitment", label: "Recruitment", href: "/recruitment", icon: "recruitment", anyOf: ["recruitment.view", "requisitions.create", "interviews.feedback"], ready: true },
      { key: "onboarding", label: "Onboarding", href: "/onboarding", icon: "onboarding", anyOf: ["onboarding.view", "onboarding.manage", "exits.view", "exits.manage"], ready: true },
      { key: "referrals", label: "Referrals", href: "/referrals", icon: "referrals", ready: true },
    ],
  },
  {
    label: "Time & pay",
    items: [
      { key: "attendance", label: "Attendance", href: "/attendance", icon: "attendance", anyOf: ["attendance.view"], ready: true },
      { key: "leave", label: "Leave", href: "/leave", icon: "leave", anyOf: ["leave.view"], ready: true },
      { key: "payroll", label: "Payroll", href: "/payroll", icon: "payroll", anyOf: ["payroll.view", "payslips.view"], ready: true },
      { key: "expenses", label: "Expenses & benefits", href: "/expenses", icon: "expenses", anyOf: ["expenses.view", "benefits.manage"], ready: true },
    ],
  },
  {
    label: "Talent",
    items: [
      { key: "performance", label: "Performance", href: "/performance", icon: "performance", anyOf: ["performance.view", "performance.manage"], ready: true },
      { key: "learning", label: "Learning", href: "/learning", icon: "learning", anyOf: ["learning.view"], ready: true },
      { key: "engagement", label: "People success", href: "/engagement", icon: "engagement", anyOf: ["engagement.view"], ready: true },
    ],
  },
  {
    label: "Operations",
    items: [
      { key: "helpdesk", label: "HR service desk", href: "/helpdesk", icon: "helpdesk", ready: true },
      { key: "documents", label: "Documents", href: "/documents", icon: "documents", anyOf: ["documents.view", "documents.manage", "policies.manage"], ready: true },
      { key: "workflows", label: "Workflows", href: "/workflows", icon: "workflows", anyOf: ["workflows.manage"], ready: true },
      { key: "reports", label: "Reports & analytics", href: "/reports", icon: "reports", anyOf: ["reports.view", "analytics.executive"], ready: true },
      { key: "agents", label: "AI agents", href: "/agents", icon: "agents", anyOf: ["ai.manage"], ready: true },
      { key: "integrations", label: "Integrations", href: "/integrations", icon: "integrations", anyOf: ["integrations.manage"], ready: true },
    ],
  },
  {
    label: "Administration",
    items: [
      { key: "settings", label: "Settings", href: "/settings", icon: "settings", anyOf: ["settings.manage", "users.manage", "roles.manage", "org.manage", "audit.view"], ready: true },
    ],
  },
];

export function visibleNavigation(grants: Grants): NavGroup[] {
  return NAVIGATION.map((g) => ({
    label: g.label,
    items: g.items.filter((i) => i.ready && (!i.anyOf || i.anyOf.some((p) => !!grants[p]))),
  })).filter((g) => g.items.length > 0);
}

/** Flat label lookup used by breadcrumbs. */
export const SECTION_LABELS: Record<string, string> = Object.fromEntries(
  NAVIGATION.flatMap((g) => g.items.map((i) => [i.href.slice(1), i.label])),
);
