import { and, eq, isNull } from "drizzle-orm";
import { addMonths, format, isValid, parseISO, subDays } from "date-fns";
import { authorize, type RequestContext } from "../../auth/context";
import type { Tx } from "../../db/client";
import { departments, designations, employees, employmentRecords, grades, legalEntities, locations } from "../../db/schema";
import { audit } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { parseCsv } from "@/lib/csv";
import { todayIn } from "@/lib/format";
import { EMPLOYMENT_TYPES, GENDERS, WORK_MODES, WORKER_TYPES } from "@/lib/validation/employees";
import { generateEmployeeCode } from "./codes";
import { displayNameOf } from "./mutations";

export const IMPORT_COLUMNS = [
  { key: "first_name", required: true, example: "Asha" },
  { key: "middle_name", required: false, example: "" },
  { key: "last_name", required: false, example: "Rao" },
  { key: "employee_code", required: false, example: "" },
  { key: "work_email", required: false, example: "asha.rao@example.com" },
  { key: "personal_email", required: false, example: "" },
  { key: "phone", required: false, example: "+91 98450 00000" },
  { key: "date_of_birth", required: false, example: "1994-06-21" },
  { key: "gender", required: false, example: "female" },
  { key: "joining_date", required: true, example: "2024-04-01" },
  { key: "employment_type", required: false, example: "full_time" },
  { key: "worker_type", required: false, example: "employee" },
  { key: "work_mode", required: false, example: "hybrid" },
  { key: "legal_entity", required: false, example: "" },
  { key: "department", required: false, example: "Engineering" },
  { key: "designation", required: false, example: "Software Engineer" },
  { key: "location", required: false, example: "Bengaluru" },
  { key: "manager_code", required: false, example: "EMP0001" },
  { key: "grade", required: false, example: "" },
  { key: "probation_months", required: false, example: "6" },
  { key: "notice_period_days", required: false, example: "30" },
] as const;

type ColumnKey = (typeof IMPORT_COLUMNS)[number]["key"];
export const MAX_IMPORT_ROWS = 2000;

export type ImportRowResult = {
  line: number;
  name: string;
  code: string | null;
  errors: string[];
};

export type ImportPreview = {
  rows: ImportRowResult[];
  valid: number;
  invalid: number;
  willCreate: { departments: string[]; designations: string[]; locations: string[] };
};

type ParsedRow = {
  line: number;
  v: Record<ColumnKey, string>;
  errors: string[];
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const lc = (s: string) => s.trim().toLowerCase();

function validDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && isValid(parseISO(s));
}

async function analyse(tx: Tx, csv: string, createMissing: boolean) {
  const table = parseCsv(csv);
  if (table.length < 2) throw new AppError("VALIDATION", "The file has no data rows. Use the template and keep the header row.");
  const header = table[0].map((h) => lc(h).replace(/\s+/g, "_"));
  const missingRequired = IMPORT_COLUMNS.filter((c) => c.required && !header.includes(c.key)).map((c) => c.key);
  if (missingRequired.length) throw new AppError("VALIDATION", `Missing required column(s): ${missingRequired.join(", ")}.`);
  const unknown = header.filter((h) => h && !IMPORT_COLUMNS.some((c) => c.key === h));
  if (unknown.length) throw new AppError("VALIDATION", `Unknown column(s): ${unknown.join(", ")}. Download the template for the expected headers.`);
  const body = table.slice(1);
  if (body.length > MAX_IMPORT_ROWS) throw new AppError("VALIDATION", `Import at most ${MAX_IMPORT_ROWS} rows at a time.`);

  const rows: ParsedRow[] = body.map((cells, i) => {
    const v = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, (cells[header.indexOf(c.key)] ?? "").trim()])) as Record<ColumnKey, string>;
    return { line: i + 2, v, errors: [] };
  });

  const [les, deps, desigs, locs, grs, existing] = await Promise.all([
    tx.select({ id: legalEntities.id, name: legalEntities.name, isDefault: legalEntities.isDefault }).from(legalEntities).where(eq(legalEntities.isActive, true)),
    tx.select({ id: departments.id, name: departments.name }).from(departments),
    tx.select({ id: designations.id, title: designations.title }).from(designations),
    tx.select({ id: locations.id, name: locations.name }).from(locations),
    tx.select({ id: grades.id, code: grades.code }).from(grades),
    tx
      .select({ id: employees.id, code: employees.employeeCode, email: employees.workEmail })
      .from(employees)
      .where(isNull(employees.deletedAt)),
  ]);
  const leByName = new Map(les.map((l) => [lc(l.name), l.id]));
  const defaultLe = les.find((l) => l.isDefault)?.id ?? les[0]?.id;
  const depByName = new Map(deps.map((d) => [lc(d.name), d.id]));
  const desigByTitle = new Map(desigs.map((d) => [lc(d.title), d.id]));
  const locByName = new Map(locs.map((l) => [lc(l.name), l.id]));
  const gradeByCode = new Map(grs.map((g) => [lc(g.code), g.id]));
  const existingCodes = new Map(existing.map((e) => [lc(e.code), e.id]));
  const existingEmails = new Set(existing.filter((e) => e.email).map((e) => lc(e.email!)));
  const fileCodes = new Map<string, number>();
  const fileEmails = new Map<string, number>();
  const willCreate = { departments: new Set<string>(), designations: new Set<string>(), locations: new Set<string>() };

  for (const r of rows) {
    const { v, errors } = r;
    if (!v.first_name) errors.push("first_name is required");
    if (!v.joining_date) errors.push("joining_date is required");
    else if (!validDate(v.joining_date)) errors.push("joining_date must be YYYY-MM-DD");
    if (v.date_of_birth && !validDate(v.date_of_birth)) errors.push("date_of_birth must be YYYY-MM-DD");
    for (const [key, allowed] of [
      ["employment_type", EMPLOYMENT_TYPES],
      ["worker_type", WORKER_TYPES],
      ["work_mode", WORK_MODES],
      ["gender", GENDERS],
    ] as const) {
      if (v[key] && !(allowed as readonly string[]).includes(lc(v[key]))) errors.push(`${key} must be one of: ${allowed.join(", ")}`);
    }
    for (const key of ["work_email", "personal_email"] as const) {
      if (v[key] && !EMAIL.test(v[key])) errors.push(`${key} is not a valid email`);
    }
    if (v.work_email) {
      const e = lc(v.work_email);
      if (existingEmails.has(e)) errors.push("work_email already belongs to an employee");
      if (fileEmails.has(e)) errors.push(`work_email duplicates line ${fileEmails.get(e)}`);
      fileEmails.set(e, r.line);
    }
    if (v.employee_code) {
      const c = lc(v.employee_code);
      if (existingCodes.has(c)) errors.push("employee_code already exists");
      if (fileCodes.has(c)) errors.push(`employee_code duplicates line ${fileCodes.get(c)}`);
      fileCodes.set(c, r.line);
    }
    for (const [key, max] of [["probation_months", 24], ["notice_period_days", 365]] as const) {
      if (v[key] && !(/^\d+$/.test(v[key]) && Number(v[key]) <= max)) errors.push(`${key} must be a whole number up to ${max}`);
    }
    if (v.legal_entity && !leByName.has(lc(v.legal_entity))) errors.push(`legal_entity "${v.legal_entity}" not found`);
    if (!v.legal_entity && !defaultLe) errors.push("No legal entity configured");
    if (v.grade && !gradeByCode.has(lc(v.grade))) errors.push(`grade "${v.grade}" not found`);
    for (const [key, map, bucket] of [
      ["department", depByName, willCreate.departments],
      ["designation", desigByTitle, willCreate.designations],
      ["location", locByName, willCreate.locations],
    ] as const) {
      if (v[key] && !map.has(lc(v[key]))) {
        if (createMissing) bucket.add(v[key]);
        else errors.push(`${key} "${v[key]}" not found`);
      }
    }
  }
  // Managers may be existing employees or rows in this file (by code).
  for (const r of rows) {
    const m = r.v.manager_code;
    if (!m) continue;
    if (lc(m) === lc(r.v.employee_code)) r.errors.push("manager_code cannot be the employee's own code");
    else if (!existingCodes.has(lc(m)) && !fileCodes.has(lc(m))) r.errors.push(`manager_code "${m}" not found`);
  }

  return {
    rows,
    maps: { leByName, defaultLe, depByName, desigByTitle, locByName, gradeByCode, existingCodes },
    willCreate: {
      departments: [...willCreate.departments],
      designations: [...willCreate.designations],
      locations: [...willCreate.locations],
    },
  };
}

function toPreview(a: Awaited<ReturnType<typeof analyse>>): ImportPreview {
  const rows = a.rows.map((r) => ({
    line: r.line,
    name: [r.v.first_name, r.v.last_name].filter(Boolean).join(" ") || "(no name)",
    code: r.v.employee_code || null,
    errors: r.errors,
  }));
  const invalid = rows.filter((r) => r.errors.length).length;
  return { rows, valid: rows.length - invalid, invalid, willCreate: a.willCreate };
}

export async function previewImport(ctx: RequestContext, csv: string, createMissing: boolean): Promise<ImportPreview> {
  authorize(ctx, "employees.import", "all");
  return ctx.db(async (tx) => toPreview(await analyse(tx, csv, createMissing)));
}

/** Validate again and import everything in one transaction, or nothing. */
export async function commitImport(ctx: RequestContext, csv: string, createMissing: boolean) {
  authorize(ctx, "employees.import", "all");
  if (createMissing) authorize(ctx, "org.manage", "all");
  const today = todayIn();
  return ctx.db(async (tx) => {
    const a = await analyse(tx, csv, createMissing);
    const preview = toPreview(a);
    if (preview.invalid) throw new AppError("VALIDATION", `${preview.invalid} row(s) have errors. Fix them and preview again.`);
    const { maps } = a;

    const create = async (names: string[], insert: (n: string) => Promise<string>, into: Map<string, string>) => {
      for (const n of names) into.set(lc(n), await insert(n));
    };
    await create(a.willCreate.departments, async (name) => (await tx.insert(departments).values({ tenantId: ctx.tenantId, name }).returning())[0].id, maps.depByName);
    await create(a.willCreate.designations, async (title) => (await tx.insert(designations).values({ tenantId: ctx.tenantId, title }).returning())[0].id, maps.desigByTitle);
    await create(a.willCreate.locations, async (name) => (await tx.insert(locations).values({ tenantId: ctx.tenantId, name }).returning())[0].id, maps.locByName);

    const codeToId = new Map(maps.existingCodes);
    const created: { id: string; managerCode: string }[] = [];
    for (const { v } of a.rows) {
      const code = v.employee_code || (await generateEmployeeCode(tx, ctx.tenantId));
      const probation = v.probation_months ? Number(v.probation_months) : 0;
      const legalEntityId = v.legal_entity ? maps.leByName.get(lc(v.legal_entity))! : maps.defaultLe!;
      const assignment = {
        legalEntityId,
        departmentId: v.department ? maps.depByName.get(lc(v.department))! : null,
        designationId: v.designation ? maps.desigByTitle.get(lc(v.designation))! : null,
        locationId: v.location ? maps.locByName.get(lc(v.location))! : null,
        gradeId: v.grade ? maps.gradeByCode.get(lc(v.grade))! : null,
      };
      const employmentType = (lc(v.employment_type) || "full_time") as (typeof EMPLOYMENT_TYPES)[number];
      const [e] = await tx
        .insert(employees)
        .values({
          tenantId: ctx.tenantId,
          ...assignment,
          employeeCode: code,
          firstName: v.first_name,
          middleName: v.middle_name || null,
          lastName: v.last_name || null,
          displayName: displayNameOf({ firstName: v.first_name, middleName: v.middle_name, lastName: v.last_name }),
          workEmail: v.work_email ? lc(v.work_email) : null,
          personalEmail: v.personal_email ? lc(v.personal_email) : null,
          phone: v.phone || null,
          dateOfBirth: v.date_of_birth || null,
          gender: v.gender ? lc(v.gender) : null,
          status: v.joining_date <= today ? "active" : "pending",
          employmentType,
          workerType: (lc(v.worker_type) || "employee") as (typeof WORKER_TYPES)[number],
          workMode: (lc(v.work_mode) || "onsite") as (typeof WORK_MODES)[number],
          joiningDate: v.joining_date,
          probationEndDate: probation ? format(subDays(addMonths(parseISO(v.joining_date), probation), 1), "yyyy-MM-dd") : null,
          confirmationDate: probation ? null : v.joining_date,
          noticePeriodDays: v.notice_period_days ? Number(v.notice_period_days) : 30,
        })
        .returning({ id: employees.id });
      await tx.insert(employmentRecords).values({
        tenantId: ctx.tenantId,
        employeeId: e.id,
        effectiveFrom: v.joining_date,
        changeType: "hire",
        status: "active",
        employmentType,
        ...assignment,
        reason: "Imported",
        createdBy: ctx.userId,
      });
      codeToId.set(lc(code), e.id);
      if (v.manager_code) created.push({ id: e.id, managerCode: v.manager_code });
    }
    // Second pass: managers (the loop-prevention trigger guards cycles).
    for (const c of created) {
      const managerId = codeToId.get(lc(c.managerCode))!;
      await tx.update(employees).set({ managerId }).where(eq(employees.id, c.id));
      await tx
        .update(employmentRecords)
        .set({ managerId })
        .where(and(eq(employmentRecords.employeeId, c.id), isNull(employmentRecords.effectiveTo)));
    }
    await audit(tx, ctx, {
      action: "employees.imported",
      entityType: "employee",
      metadata: { count: a.rows.length, created: a.willCreate },
    });
    return { imported: a.rows.length };
  });
}

