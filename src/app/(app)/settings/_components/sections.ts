import type { Grants, Permission } from "@/lib/permissions";

export type SettingsSection = {
  key: string;
  label: string;
  href: string;
  description: string;
  /** Visible with any of these tenant-wide permissions. */
  anyOf: Permission[];
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { key: "general", label: "General", href: "/settings/general", description: "Company name, time zone, fiscal year and employee IDs.", anyOf: ["settings.manage"] },
  { key: "legal-entities", label: "Legal entities", href: "/settings/legal-entities", description: "Registered companies and their statutory registrations.", anyOf: ["settings.manage"] },
  { key: "locations", label: "Locations", href: "/settings/locations", description: "Offices, sites and attendance geofences.", anyOf: ["org.manage"] },
  { key: "structure", label: "Structure", href: "/settings/structure", description: "Departments, designations, grades and cost centers.", anyOf: ["org.manage"] },
  { key: "users", label: "Users & invitations", href: "/settings/users", description: "Who can sign in, and with which roles.", anyOf: ["users.manage"] },
  { key: "roles", label: "Roles & permissions", href: "/settings/roles", description: "What each role can see and do.", anyOf: ["roles.manage"] },
  { key: "approvals", label: "Approval policies", href: "/settings/approvals", description: "Who approves leave, expenses, offers and more.", anyOf: ["workflows.manage", "settings.manage"] },
  { key: "audit", label: "Audit log", href: "/settings/audit", description: "Every change made in your organization.", anyOf: ["audit.view"] },
];

export const visibleSections = (grants: Grants) =>
  SETTINGS_SECTIONS.filter((s) => s.anyOf.some((p) => grants[p] === "all"));
