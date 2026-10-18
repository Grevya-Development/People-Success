import type { Grants, Permission } from "./permissions";

type Entry = { label: string; href: string; anyOf: Permission[]; ready: boolean };

/** Global "New" menu. Entries appear as their modules ship. */
export const QUICK_CREATE: Entry[] = [
  { label: "Employee", href: "/employees/new", anyOf: ["employees.create"], ready: true },
  { label: "Leave request", href: "/leave/new", anyOf: ["leave.view"], ready: true },
  { label: "Job requisition", href: "/recruitment/requisitions/new", anyOf: ["requisitions.create"], ready: true },
  { label: "Expense claim", href: "/expenses/new", anyOf: ["expenses.view"], ready: true },
  { label: "HR ticket", href: "/helpdesk/new", anyOf: ["ai.use"], ready: true },
];

export function quickCreateFor(grants: Grants) {
  return QUICK_CREATE.filter((e) => e.ready && e.anyOf.some((p) => !!grants[p])).map(({ label, href }) => ({ label, href }));
}
