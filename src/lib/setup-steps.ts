/** First-run setup wizard steps, in order. */
export const SETUP_STEPS = [
  { key: "organization", title: "Create organization", description: "Name, legal name and registered state." },
  { key: "legal_entity", title: "Legal entity", description: "Statutory registrations (PAN, TAN, PF, ESI, PT) and address." },
  { key: "locations", title: "Locations and fiscal year", description: "Offices, work locations and time zone." },
  { key: "structure", title: "Employee structure", description: "Departments, designations, grades and employee ID format." },
  { key: "time", title: "Leave and attendance", description: "Leave types, holidays, shifts and attendance rules." },
  { key: "payroll", title: "Payroll settings", description: "Pay calendar, salary components and statutory rules." },
  { key: "admins", title: "Invite administrators", description: "HR, payroll and finance colleagues." },
  { key: "import", title: "Import employees", description: "Bring in your employee records from a CSV." },
  { key: "integrations", title: "Integrations", description: "Email, calendar, e-signature and accounting connections." },
  { key: "review", title: "Review readiness", description: "Confirm everything is ready before going live." },
] as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"];
