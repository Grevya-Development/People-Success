import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { deletedAt, money, pk, tenantRef, timestamps } from "./_helpers";
import { tenants } from "./identity";

/* ------------------------------------------------------------------ */
/* Organization structure                                              */
/* ------------------------------------------------------------------ */

export type Address = {
  line1?: string;
  line2?: string;
  city?: string;
  stateCode?: string;
  postalCode?: string;
  countryCode?: string;
};

export type LegalEntityRegistrations = {
  pan?: string;
  tan?: string;
  gstin?: string;
  cin?: string;
  pfEstablishmentCode?: string;
  esiEmployerCode?: string;
  ptRegistration?: string;
  lwfRegistration?: string;
};

export const legalEntities = pgTable(
  "legal_entities",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    legalName: text().notNull(),
    countryCode: text().notNull().default("IN"),
    /** ISO 3166-2:IN subdivision code without prefix, e.g. "KA", "MH". */
    stateCode: text(),
    currency: text().notNull().default("INR"),
    registrations: jsonb().$type<LegalEntityRegistrations>().notNull().default({}),
    address: jsonb().$type<Address>().notNull().default({}),
    isDefault: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("legal_entities_tenant_name_key").on(t.tenantId, t.name),
    uniqueIndex("legal_entities_one_default")
      .on(t.tenantId)
      .where(sql`${t.isDefault}`),
  ],
);

export const locationType = pgEnum("location_type", [
  "office",
  "branch",
  "site",
  "remote",
]);

export type Geofence = { lat: number; lng: number; radiusMeters: number };

export const locations = pgTable(
  "locations",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    legalEntityId: uuid().references(() => legalEntities.id),
    name: text().notNull(),
    code: text(),
    type: locationType().notNull().default("office"),
    address: jsonb().$type<Address>().notNull().default({}),
    stateCode: text(),
    timezone: text().notNull().default("Asia/Kolkata"),
    geofence: jsonb().$type<Geofence | null>(),
    holidayCalendarId: uuid(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("locations_tenant_name_key").on(t.tenantId, t.name)],
);

export const businessUnits = pgTable(
  "business_units",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    code: text(),
    headEmployeeId: uuid(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("business_units_tenant_name_key").on(t.tenantId, t.name)],
);

export const costCenters = pgTable(
  "cost_centers",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    legalEntityId: uuid().references(() => legalEntities.id),
    code: text().notNull(),
    name: text().notNull(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("cost_centers_tenant_code_key").on(t.tenantId, t.code)],
);

export const departments = pgTable(
  "departments",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    code: text(),
    parentId: uuid(),
    businessUnitId: uuid().references(() => businessUnits.id),
    costCenterId: uuid().references(() => costCenters.id),
    headEmployeeId: uuid(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("departments_tenant_name_key").on(t.tenantId, t.name),
    index("departments_parent_idx").on(t.parentId),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    departmentId: uuid().references(() => departments.id),
    name: text().notNull(),
    leadEmployeeId: uuid(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("teams_tenant_name_key").on(t.tenantId, t.name)],
);

export const jobFamilies = pgTable(
  "job_families",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    description: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex("job_families_tenant_name_key").on(t.tenantId, t.name)],
);

export const grades = pgTable(
  "grades",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    code: text().notNull(),
    name: text().notNull(),
    /** Ordering within the ladder; higher is more senior. */
    rank: integer().notNull().default(0),
    minAnnualCtc: money(),
    maxAnnualCtc: money(),
    currency: text().notNull().default("INR"),
    ...timestamps,
  },
  (t) => [uniqueIndex("grades_tenant_code_key").on(t.tenantId, t.code)],
);

export const designations = pgTable(
  "designations",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    title: text().notNull(),
    jobFamilyId: uuid().references(() => jobFamilies.id),
    gradeId: uuid().references(() => grades.id),
    description: text(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("designations_tenant_title_key").on(t.tenantId, t.title)],
);

export const positionStatus = pgEnum("position_status", [
  "planned",
  "open",
  "filled",
  "frozen",
  "closed",
]);

export const positions = pgTable(
  "positions",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    code: text().notNull(),
    title: text().notNull(),
    designationId: uuid().references(() => designations.id),
    departmentId: uuid().references(() => departments.id),
    locationId: uuid().references(() => locations.id),
    legalEntityId: uuid().references(() => legalEntities.id),
    costCenterId: uuid().references(() => costCenters.id),
    reportsToPositionId: uuid(),
    status: positionStatus().notNull().default("planned"),
    budgetedAnnualCtc: money(),
    currency: text().notNull().default("INR"),
    employeeId: uuid(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("positions_tenant_code_key").on(t.tenantId, t.code),
    index("positions_tenant_status_idx").on(t.tenantId, t.status),
    uniqueIndex("positions_employee_key")
      .on(t.employeeId)
      .where(sql`${t.employeeId} is not null`),
  ],
);

/* ------------------------------------------------------------------ */
/* Employee master                                                     */
/* ------------------------------------------------------------------ */

export const employeeStatus = pgEnum("employee_status", [
  /** Offer accepted / created, not yet joined. */
  "pending",
  "active",
  "on_notice",
  "exited",
]);

export const employmentType = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "contract",
  "intern",
  "consultant",
  "temporary",
]);

export const workerType = pgEnum("worker_type", ["employee", "contractor"]);

export const workMode = pgEnum("work_mode", ["onsite", "remote", "hybrid"]);

export const employees = pgTable(
  "employees",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    legalEntityId: uuid()
      .notNull()
      .references(() => legalEntities.id),
    userId: uuid(),
    employeeCode: text().notNull(),
    firstName: text().notNull(),
    middleName: text(),
    lastName: text(),
    displayName: text().notNull(),
    workEmail: text(),
    personalEmail: text(),
    phone: text(),
    dateOfBirth: date(),
    gender: text(),
    maritalStatus: text(),
    nationality: text(),
    bloodGroup: text(),
    photoPath: text(),
    status: employeeStatus().notNull().default("pending"),
    workerType: workerType().notNull().default("employee"),
    employmentType: employmentType().notNull().default("full_time"),
    workMode: workMode().notNull().default("onsite"),
    joiningDate: date().notNull(),
    probationEndDate: date(),
    confirmationDate: date(),
    noticePeriodDays: integer().notNull().default(30),
    resignationDate: date(),
    lastWorkingDate: date(),
    exitDate: date(),
    exitReason: text(),
    /* Current assignment, denormalized from employment_records for fast reads. */
    departmentId: uuid().references(() => departments.id),
    designationId: uuid().references(() => designations.id),
    locationId: uuid().references(() => locations.id),
    managerId: uuid(),
    gradeId: uuid().references(() => grades.id),
    costCenterId: uuid().references(() => costCenters.id),
    positionId: uuid().references(() => positions.id),
    businessUnitId: uuid().references(() => businessUnits.id),
    teamId: uuid().references(() => teams.id),
    customFields: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    isDemo: boolean().notNull().default(false),
    deletedAt: deletedAt(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("employees_tenant_code_key").on(t.tenantId, t.employeeCode),
    uniqueIndex("employees_tenant_work_email_key")
      .on(t.tenantId, sql`lower(${t.workEmail})`)
      .where(sql`${t.workEmail} is not null and ${t.deletedAt} is null`),
    uniqueIndex("employees_tenant_user_key")
      .on(t.tenantId, t.userId)
      .where(sql`${t.userId} is not null`),
    index("employees_tenant_status_idx").on(t.tenantId, t.status),
    index("employees_manager_idx").on(t.managerId),
    index("employees_department_idx").on(t.tenantId, t.departmentId),
    index("employees_location_idx").on(t.tenantId, t.locationId),
    index("employees_joining_idx").on(t.tenantId, t.joiningDate),
  ],
);

export const employmentChangeType = pgEnum("employment_change_type", [
  "hire",
  "rehire",
  "confirmation",
  "transfer",
  "promotion",
  "demotion",
  "manager_change",
  "designation_change",
  "status_change",
  "exit",
  "correction",
]);

/**
 * Effective-dated assignment history. Exactly one open-ended row per employee;
 * an exclusion constraint (custom migration) forbids overlapping ranges.
 */
export const employmentRecords = pgTable(
  "employment_records",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    changeType: employmentChangeType().notNull(),
    status: employeeStatus().notNull(),
    employmentType: employmentType().notNull(),
    legalEntityId: uuid().notNull(),
    departmentId: uuid(),
    designationId: uuid(),
    locationId: uuid(),
    managerId: uuid(),
    gradeId: uuid(),
    costCenterId: uuid(),
    positionId: uuid(),
    reason: text(),
    createdBy: uuid(),
    approvedBy: uuid(),
    ...timestamps,
  },
  (t) => [
    index("employment_records_employee_idx").on(t.employeeId, t.effectiveFrom),
  ],
);

export const managerRelationType = pgEnum("manager_relation_type", [
  "dotted",
  "interim",
]);

/** Dotted-line and interim managers. The solid-line manager lives on employees.manager_id. */
export const managerRelationships = pgTable(
  "manager_relationships",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    managerId: uuid()
      .notNull()
      .references(() => employees.id),
    type: managerRelationType().notNull(),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    ...timestamps,
  },
  (t) => [index("manager_relationships_employee_idx").on(t.employeeId)],
);

export const compensationReason = pgEnum("compensation_reason", [
  "hire",
  "revision",
  "promotion",
  "correction",
  "market_adjustment",
]);

/** Compensation history. Restricted by RLS to compensation viewers and the employee. */
export const compensationRecords = pgTable(
  "compensation_records",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    annualCtc: money().notNull(),
    currency: text().notNull().default("INR"),
    salaryStructureId: uuid(),
    /** Snapshot of component amounts (annual, minor units) at the time of the record. */
    components: jsonb()
      .$type<{ code: string; name: string; annualAmount: number }[]>()
      .notNull()
      .default([]),
    reason: compensationReason().notNull(),
    notes: text(),
    approvedBy: uuid(),
    createdBy: uuid(),
    ...timestamps,
  },
  (t) => [index("compensation_records_employee_idx").on(t.employeeId, t.effectiveFrom)],
);

/**
 * Sensitive statutory, identity and bank details. Identity numbers and bank
 * account numbers are encrypted application-side (AES-256-GCM); only the last
 * four characters are stored in clear for display.
 */
export const employeeSensitive = pgTable("employee_sensitive", {
  employeeId: uuid()
    .primaryKey()
    .references(() => employees.id),
  tenantId: tenantRef().references(() => tenants.id),
  panEnc: text(),
  panLast4: text(),
  aadhaarEnc: text(),
  aadhaarLast4: text(),
  passportEnc: text(),
  passportLast4: text(),
  uan: text(),
  esicNumber: text(),
  bankAccountEnc: text(),
  bankAccountLast4: text(),
  bankIfsc: text(),
  bankName: text(),
  accountHolderName: text(),
  taxRegime: text().notNull().default("new"),
  updatedBy: uuid(),
  ...timestamps,
});

export const addressType = pgEnum("address_type", ["current", "permanent"]);

export const employeeAddresses = pgTable(
  "employee_addresses",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    type: addressType().notNull(),
    line1: text().notNull(),
    line2: text(),
    city: text().notNull(),
    stateCode: text(),
    postalCode: text(),
    countryCode: text().notNull().default("IN"),
    ...timestamps,
  },
  (t) => [uniqueIndex("employee_addresses_type_key").on(t.employeeId, t.type)],
);

export const emergencyContacts = pgTable(
  "emergency_contacts",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    name: text().notNull(),
    relationship: text().notNull(),
    phone: text().notNull(),
    email: text(),
    isPrimary: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [index("emergency_contacts_employee_idx").on(t.employeeId)],
);

export const dependents = pgTable(
  "dependents",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    name: text().notNull(),
    relationship: text().notNull(),
    dateOfBirth: date(),
    isNominee: boolean().notNull().default(false),
    nominationPercent: smallint(),
    ...timestamps,
  },
  (t) => [index("dependents_employee_idx").on(t.employeeId)],
);

export const qualifications = pgTable(
  "qualifications",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: text().notNull().default("education"),
    title: text().notNull(),
    institution: text(),
    fieldOfStudy: text(),
    startYear: smallint(),
    endYear: smallint(),
    grade: text(),
    issuedOn: date(),
    expiresOn: date(),
    credentialId: text(),
    documentId: uuid(),
    ...timestamps,
  },
  (t) => [index("qualifications_employee_idx").on(t.employeeId)],
);

export const skills = pgTable(
  "skills",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text().notNull(),
    category: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex("skills_tenant_name_key").on(t.tenantId, sql`lower(${t.name})`)],
);

export const employeeSkills = pgTable(
  "employee_skills",
  {
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    skillId: uuid()
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    /** 1 (aware) to 5 (expert). */
    proficiency: smallint().notNull(),
    source: text().notNull().default("self"),
    verifiedBy: uuid(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.employeeId, t.skillId] }),
    index("employee_skills_skill_idx").on(t.skillId),
  ],
);

export const assetStatus = pgEnum("asset_status", [
  "available",
  "assigned",
  "in_repair",
  "retired",
  "lost",
]);

export const assets = pgTable(
  "assets",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    tag: text().notNull(),
    category: text().notNull(),
    name: text().notNull(),
    serialNumber: text(),
    status: assetStatus().notNull().default("available"),
    purchasedOn: date(),
    cost: money(),
    currency: text().notNull().default("INR"),
    notes: text(),
    ...timestamps,
  },
  (t) => [uniqueIndex("assets_tenant_tag_key").on(t.tenantId, t.tag)],
);

export const assetAssignments = pgTable(
  "asset_assignments",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    assetId: uuid()
      .notNull()
      .references(() => assets.id),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    assignedOn: date().notNull(),
    dueBackOn: date(),
    returnedOn: date(),
    conditionOut: text(),
    conditionIn: text(),
    assignedBy: uuid(),
    receivedBy: uuid(),
    ...timestamps,
  },
  (t) => [
    index("asset_assignments_employee_idx").on(t.employeeId),
    uniqueIndex("asset_assignments_one_open")
      .on(t.assetId)
      .where(sql`${t.returnedOn} is null`),
  ],
);

export const changeRequestStatus = pgEnum("change_request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

/** Employee-initiated corrections to their own master data. */
export const dataChangeRequests = pgTable(
  "data_change_requests",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id),
    requestedBy: uuid().notNull(),
    changes: jsonb()
      .$type<Record<string, { from: unknown; to: unknown }>>()
      .notNull(),
    reason: text(),
    status: changeRequestStatus().notNull().default("pending"),
    reviewedBy: uuid(),
    reviewedAt: timestamp({ withTimezone: true }),
    reviewComment: text(),
    ...timestamps,
  },
  (t) => [index("data_change_requests_tenant_status_idx").on(t.tenantId, t.status)],
);

export const customFieldType = pgEnum("custom_field_type", [
  "text",
  "number",
  "date",
  "boolean",
  "select",
]);

export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    entity: text().notNull().default("employee"),
    key: text().notNull(),
    label: text().notNull(),
    type: customFieldType().notNull(),
    options: text().array(),
    required: boolean().notNull().default(false),
    sensitive: boolean().notNull().default(false),
    sortOrder: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("custom_fields_tenant_entity_key").on(t.tenantId, t.entity, t.key)],
);

/** Per-tenant atomic counters (employee codes, document numbers, ...). */
export const tenantCounters = pgTable(
  "tenant_counters",
  {
    tenantId: tenantRef().references(() => tenants.id),
    key: text().notNull(),
    value: bigint({ mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);
